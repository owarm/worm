import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

export const AUTHORIZED_RESPONSE =
    "If the email is authorized, a verification code has been sent.";
export const LOCAL_MAIL_UNAVAILABLE = "Local mail transport is not available.";

const DEFAULT_OTP_TTL_SECONDS = 600;
const DEFAULT_SESSION_TTL_SECONDS = 3600;
const REQUEST_COOLDOWN_MS = 60_000;
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const RATE_LIMIT_MAX = 10;
const MAX_VERIFY_ATTEMPTS = 5;
const SENDMAIL_PATH = "/usr/sbin/sendmail";

export function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

export function loadAuthConfig(env = process.env) {
    const authorizedEmail = normalizeEmail(env.AUTHORIZED_EMAIL);
    const mailFrom = String(env.MAIL_FROM || "").trim();
    const sessionSecret = String(env.SESSION_SECRET || "");
    const otpTtlSeconds = parsePositiveInt(env.OTP_TTL_SECONDS, DEFAULT_OTP_TTL_SECONDS);
    const sessionTtlSeconds = parsePositiveInt(env.SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS);

    if (!authorizedEmail) {
        throw new Error("AUTHORIZED_EMAIL is required.");
    }
    if (!mailFrom) {
        throw new Error("MAIL_FROM is required.");
    }
    if (!sessionSecret || sessionSecret.length < 32) {
        throw new Error("SESSION_SECRET is required and must be at least 32 characters.");
    }

    return {
        authorizedEmail,
        mailFrom,
        sessionSecret,
        otpTtlMs: otpTtlSeconds * 1000,
        sessionTtlSeconds,
    };
}

export async function createLocalMailTransport({
    sendmailPath = SENDMAIL_PATH,
    nodemailer,
} = {}) {
    try {
        fs.accessSync(sendmailPath, fs.constants.X_OK);
    } catch {
        throw new Error(LOCAL_MAIL_UNAVAILABLE);
    }

    const mailer = nodemailer || await import("nodemailer");
    return mailer.createTransport({
        sendmail: true,
        newline: "unix",
        path: sendmailPath,
    });
}

export function createOtpAuth({
    config,
    transport,
    logger = console,
    now = () => Date.now(),
    randomInt = crypto.randomInt,
    randomBytes = crypto.randomBytes,
} = {}) {
    if (!config) {
        throw new Error("config is required.");
    }
    if (!transport || typeof transport.sendMail !== "function") {
        throw new Error("mail transport is required.");
    }

    let pendingOtp = null;
    const sessions = new Map();
    const cooldowns = new Map();
    const requestBuckets = new Map();

    async function requestOtp(email, ip = "unknown") {
        const normalizedEmail = normalizeEmail(email);
        if (isRateLimited(ip)) {
            return { status: 429, body: { message: AUTHORIZED_RESPONSE } };
        }

        if (normalizedEmail !== config.authorizedEmail) {
            return { status: 200, body: { message: AUTHORIZED_RESPONSE } };
        }

        const cooldownKey = hashValue(`${normalizedEmail}:${ip}`, config.sessionSecret);
        const lastRequest = cooldowns.get(cooldownKey) || 0;
        if (now() - lastRequest < REQUEST_COOLDOWN_MS) {
            return { status: 200, body: { message: AUTHORIZED_RESPONSE } };
        }

        const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
        const salt = randomBytes(16).toString("hex");
        const expiresAt = now() + config.otpTtlMs;
        const otpHash = hashOtp(otp, salt, config.sessionSecret);

        const ttlMinutes = Math.max(1, Math.ceil(config.otpTtlMs / 60_000));
        try {
            await transport.sendMail({
                from: config.mailFrom,
                to: config.authorizedEmail,
                subject: "WebUSB verification code",
                text: [
                    "Your WebUSB verification code is:",
                    "",
                    otp,
                    "",
                    `This code expires in ${ttlMinutes} minute${ttlMinutes === 1 ? "" : "s"}.`,
                    "",
                    "If you did not request this code, ignore this email.",
                ].join("\n"),
            });
        } catch {
            logger.error?.("OTP email delivery failed.");
            return { status: 503, body: { error: "Unable to send verification code." } };
        }

        pendingOtp = {
            emailHash: hashValue(normalizedEmail, config.sessionSecret),
            otpHash,
            salt,
            expiresAt,
            attempts: 0,
        };
        cooldowns.set(cooldownKey, now());
        logger.info?.("OTP email requested for authorized address.");

        return { status: 200, body: { message: AUTHORIZED_RESPONSE } };
    }

    function verifyOtp(email, otp) {
        const normalizedEmail = normalizeEmail(email);
        if (!pendingOtp || pendingOtp.emailHash !== hashValue(normalizedEmail, config.sessionSecret)) {
            return { status: 401, body: { error: "Invalid or expired verification code." } };
        }

        if (now() > pendingOtp.expiresAt || pendingOtp.attempts >= MAX_VERIFY_ATTEMPTS) {
            pendingOtp = null;
            return { status: 401, body: { error: "Invalid or expired verification code." } };
        }

        pendingOtp.attempts += 1;
        const suppliedHash = hashOtp(String(otp || ""), pendingOtp.salt, config.sessionSecret);
        if (!crypto.timingSafeEqual(Buffer.from(suppliedHash), Buffer.from(pendingOtp.otpHash))) {
            if (pendingOtp.attempts >= MAX_VERIFY_ATTEMPTS) {
                pendingOtp = null;
            }
            return { status: 401, body: { error: "Invalid or expired verification code." } };
        }

        pendingOtp = null;
        const token = randomBytes(32).toString("base64url");
        sessions.set(hashValue(token, config.sessionSecret), now() + config.sessionTtlSeconds * 1000);

        return {
            status: 200,
            headers: {
                "Set-Cookie": buildSessionCookie(token, config.sessionTtlSeconds),
            },
            body: { ok: true },
            token,
        };
    }

    function isSessionValid(cookieHeader = "") {
        const cookies = parseCookies(cookieHeader);
        const token = cookies.webusb_auth;
        if (!token) {
            return false;
        }
        const key = hashValue(token, config.sessionSecret);
        const expiresAt = sessions.get(key);
        if (!expiresAt || now() > expiresAt) {
            sessions.delete(key);
            return false;
        }
        return true;
    }

    function destroySession(cookieHeader = "") {
        const cookies = parseCookies(cookieHeader);
        const token = cookies.webusb_auth;
        if (token) {
            sessions.delete(hashValue(token, config.sessionSecret));
        }
        return {
            status: 200,
            headers: {
                "Set-Cookie": buildExpiredSessionCookie(),
            },
            body: { ok: true },
        };
    }

    function isRateLimited(ip) {
        const key = hashValue(String(ip || "unknown"), config.sessionSecret);
        const bucket = requestBuckets.get(key) || [];
        const cutoff = now() - RATE_LIMIT_WINDOW_MS;
        const current = bucket.filter((timestamp) => timestamp > cutoff);
        current.push(now());
        requestBuckets.set(key, current);
        return current.length > RATE_LIMIT_MAX;
    }

    return {
        requestOtp,
        verifyOtp,
        isSessionValid,
        destroySession,
    };
}

export function createAuthServer({ auth, logger = console } = {}) {
    if (!auth) {
        throw new Error("auth is required.");
    }

    return http.createServer(async (req, res) => {
        try {
            if (req.method === "POST" && (req.url === "/auth/request-otp" || req.url === "/auth/request-code")) {
                const body = await readJson(req);
                const result = await auth.requestOtp(body.email, req.socket.remoteAddress);
                return sendJson(res, result);
            }

            if (req.method === "POST" && (req.url === "/auth/verify-otp" || req.url === "/auth/verify-code")) {
                const body = await readJson(req);
                const result = auth.verifyOtp(body.email, body.otp || body.code);
                return sendJson(res, result);
            }

            if (req.method === "GET" && (req.url === "/auth/session" || req.url === "/auth/check")) {
                const authenticated = auth.isSessionValid(req.headers.cookie);
                return sendJson(res, {
                    status: authenticated ? 200 : 401,
                    body: { authenticated },
                });
            }

            if (req.method === "POST" && req.url === "/auth/logout") {
                return sendJson(res, auth.destroySession(req.headers.cookie));
            }

            sendJson(res, { status: 404, body: { error: "Not found." } });
        } catch {
            logger.error?.("Auth request failed.");
            sendJson(res, { status: 400, body: { error: "Invalid request." } });
        }
    });
}

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hashOtp(otp, salt, secret) {
    return crypto.createHmac("sha256", secret).update(`${salt}:${otp}`).digest("hex");
}

function hashValue(value, secret) {
    return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function buildSessionCookie(token, maxAgeSeconds) {
    return [
        `webusb_auth=${token}`,
        "Path=/",
        `Max-Age=${maxAgeSeconds}`,
        "Secure",
        "HttpOnly",
        "SameSite=Strict",
    ].join("; ");
}

function buildExpiredSessionCookie() {
    return [
        "webusb_auth=",
        "Path=/",
        "Max-Age=0",
        "Secure",
        "HttpOnly",
        "SameSite=Strict",
    ].join("; ");
}

function parseCookies(cookieHeader = "") {
    const cookies = {};
    for (const part of String(cookieHeader).split(";")) {
        const index = part.indexOf("=");
        if (index === -1) {
            continue;
        }
        cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
    return cookies;
}

async function readJson(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
}

function sendJson(res, result) {
    res.statusCode = result.status;
    res.setHeader("Content-Type", "application/json");
    for (const [name, value] of Object.entries(result.headers || {})) {
        res.setHeader(name, value);
    }
    res.end(JSON.stringify(result.body));
}
