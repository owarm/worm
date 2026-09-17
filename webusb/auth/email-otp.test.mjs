import { describe, expect, it, vi } from "vitest";
import {
    AUTHORIZED_RESPONSE,
    LOCAL_MAIL_UNAVAILABLE,
    createAuthServer,
    createLocalMailTransport,
    createOtpAuth,
    loadAuthConfig,
} from "./email-otp.mjs";

const config = {
    authorizedEmail: "owner@coffee.pm",
    mailFrom: "WebUSB <no-reply@coffee.pm>",
    sessionSecret: "x".repeat(64),
    otpTtlMs: 600_000,
    sessionTtlSeconds: 3600,
};

function makeAuth(overrides = {}) {
    const transport = overrides.transport || { sendMail: vi.fn().mockResolvedValue({}) };
    const logs = {
        info: vi.fn(),
        error: vi.fn(),
    };
    const auth = createOtpAuth({
        config,
        transport,
        logger: logs,
        randomInt: () => 123456,
        randomBytes: (size) => Buffer.alloc(size, 7),
        now: overrides.now || (() => 1_000_000),
    });
    return { auth, transport, logs };
}

describe("WebUSB email OTP auth", () => {
    it("invokes local mail transport for the authorized email", async () => {
        const { auth, transport } = makeAuth();

        const result = await auth.requestOtp(" OWNER@COFFEE.PM ");

        expect(result.status).toBe(200);
        expect(result.body.message).toBe(AUTHORIZED_RESPONSE);
        expect(transport.sendMail).toHaveBeenCalledTimes(1);
        expect(transport.sendMail.mock.calls[0][0]).toMatchObject({
            from: config.mailFrom,
            to: config.authorizedEmail,
            subject: "WebUSB verification code",
        });
        expect(transport.sendMail.mock.calls[0][0].text).toBe([
            "Your WebUSB verification code is:",
            "",
            "123456",
            "",
            "This code expires in 10 minutes.",
            "",
            "If you did not request this code, ignore this email.",
        ].join("\n"));
    });

    it("uses the configured OTP TTL in the email body", async () => {
        const transport = { sendMail: vi.fn().mockResolvedValue({}) };
        const auth = createOtpAuth({
            config: { ...config, otpTtlMs: 60_000 },
            transport,
            logger: { info: vi.fn(), error: vi.fn() },
            randomInt: () => 123456,
            randomBytes: (size) => Buffer.alloc(size, 7),
            now: () => 1_000_000,
        });

        await auth.requestOtp("owner@coffee.pm");

        expect(transport.sendMail.mock.calls[0][0].text).toContain("This code expires in 1 minute.");
    });

    it("does not invoke mail transport for a different email", async () => {
        const { auth, transport } = makeAuth();

        const result = await auth.requestOtp("other@coffee.pm");

        expect(result.status).toBe(200);
        expect(result.body.message).toBe(AUTHORIZED_RESPONSE);
        expect(transport.sendMail).not.toHaveBeenCalled();
    });

    it("never writes the OTP or full email to logs", async () => {
        const { auth, logs } = makeAuth();

        await auth.requestOtp("owner@coffee.pm");

        const logOutput = JSON.stringify([...logs.info.mock.calls, ...logs.error.mock.calls]);
        expect(logOutput).not.toContain("123456");
        expect(logOutput).not.toContain("owner@coffee.pm");
    });

    it("requires no SMTP credentials", () => {
        expect(() => loadAuthConfig({
            AUTHORIZED_EMAIL: "owner@coffee.pm",
            MAIL_FROM: "WebUSB <no-reply@coffee.pm>",
            SESSION_SECRET: "x".repeat(64),
            OTP_TTL_SECONDS: "600",
            SESSION_TTL_SECONDS: "3600",
        })).not.toThrow();
    });

    it("handles mail transport errors safely", async () => {
        const { auth, logs } = makeAuth({
            transport: { sendMail: vi.fn().mockRejectedValue(new Error("boom 123456 owner@coffee.pm")) },
        });

        const result = await auth.requestOtp("owner@coffee.pm");
        const verifyResult = auth.verifyOtp("owner@coffee.pm", "123456");

        expect(result.status).toBe(503);
        expect(verifyResult.status).toBe(401);
        expect(JSON.stringify(logs.error.mock.calls)).toBe('[["OTP email delivery failed."]]');
    });

    it("keeps OTP single-use session flow valid", async () => {
        const { auth } = makeAuth();

        await auth.requestOtp("owner@coffee.pm");
        const verified = auth.verifyOtp("owner@coffee.pm", "123456");
        const reused = auth.verifyOtp("owner@coffee.pm", "123456");

        expect(verified.status).toBe(200);
        expect(verified.headers["Set-Cookie"]).toContain("Secure; HttpOnly; SameSite=Strict");
        expect(auth.isSessionValid(verified.headers["Set-Cookie"])).toBe(true);
        expect(reused.status).toBe(401);
    });

    it("destroys sessions for logout without exposing the token", async () => {
        const { auth } = makeAuth();

        await auth.requestOtp("owner@coffee.pm");
        const verified = auth.verifyOtp("owner@coffee.pm", "123456");
        const destroyed = auth.destroySession(verified.headers["Set-Cookie"]);

        expect(destroyed.status).toBe(200);
        expect(destroyed.headers["Set-Cookie"]).toContain("Max-Age=0");
        expect(auth.isSessionValid(verified.headers["Set-Cookie"])).toBe(false);
        expect(JSON.stringify(destroyed)).not.toContain(verified.token);
    });

    it("accepts the code/check endpoint aliases used by the WebUSB UI", async () => {
        const { auth } = makeAuth();
        const server = createAuthServer({ auth, logger: { error: vi.fn() } });
        const requestOtp = vi.spyOn(auth, "requestOtp");
        const verifyOtp = vi.spyOn(auth, "verifyOtp");

        await dispatch(server, "POST", "/auth/request-code", { email: "owner@coffee.pm" });
        const verified = await dispatch(server, "POST", "/auth/verify-code", { email: "owner@coffee.pm", code: "123456" });
        const checked = await dispatch(server, "GET", "/auth/check", undefined, verified.headers["set-cookie"]);
        const loggedOut = await dispatch(server, "POST", "/auth/logout", undefined, verified.headers["set-cookie"]);

        expect(requestOtp).toHaveBeenCalledWith("owner@coffee.pm", expect.any(String));
        expect(verifyOtp).toHaveBeenCalledWith("owner@coffee.pm", "123456");
        expect(checked.status).toBe(200);
        expect(loggedOut.status).toBe(200);
        expect(loggedOut.headers["set-cookie"]).toContain("Max-Age=0");
    });

    it("builds nodemailer sendmail transport only when sendmail exists", async () => {
        const nodemailer = { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) };
        const transport = await createLocalMailTransport({ nodemailer });

        expect(transport).toBeTruthy();
        expect(nodemailer.createTransport).toHaveBeenCalledWith({
            sendmail: true,
            newline: "unix",
            path: "/usr/sbin/sendmail",
        });
    });

    it("reports a clear startup error when local mail transport is unavailable", async () => {
        await expect(createLocalMailTransport({
            sendmailPath: "/tmp/webusb-missing-sendmail",
            nodemailer: { createTransport: vi.fn() },
        })).rejects.toThrow(LOCAL_MAIL_UNAVAILABLE);
    });
});

function dispatch(server, method, url, body, cookie) {
    return new Promise((resolve) => {
        const chunks = [];
        const req = {
            method,
            url,
            socket: { remoteAddress: "127.0.0.1" },
            headers: cookie ? { cookie } : {},
            async *[Symbol.asyncIterator]() {
                if (body) {
                    yield Buffer.from(JSON.stringify(body));
                }
            },
        };
        const res = {
            statusCode: 200,
            headers: {},
            setHeader(name, value) {
                this.headers[name.toLowerCase()] = value;
            },
            end(chunk) {
                if (chunk) {
                    chunks.push(Buffer.from(chunk));
                }
                resolve({
                    status: this.statusCode,
                    headers: this.headers,
                    body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
                });
            },
        };
        server.emit("request", req, res);
    });
}
