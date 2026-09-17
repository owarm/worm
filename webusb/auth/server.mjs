import {
    LOCAL_MAIL_UNAVAILABLE,
    createAuthServer,
    createLocalMailTransport,
    createOtpAuth,
    loadAuthConfig,
} from "./email-otp.mjs";

const PORT = Number.parseInt(process.env.PORT || "8787", 10);

try {
    const config = loadAuthConfig();
    const transport = await createLocalMailTransport();
    const auth = createOtpAuth({ config, transport });
    const server = createAuthServer({ auth });

    server.listen(PORT, "127.0.0.1", () => {
        console.info(`WebUSB auth server listening on 127.0.0.1:${PORT}`);
    });
} catch (error) {
    if (error?.message === LOCAL_MAIL_UNAVAILABLE) {
        console.error(LOCAL_MAIL_UNAVAILABLE);
    } else {
        console.error(error?.message || "Auth server startup failed.");
    }
    process.exit(1);
}
