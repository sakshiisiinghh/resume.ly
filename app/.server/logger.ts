import pino from "pino";

export type Logger = pino.Logger;

// Read straight from the environment so the logger works before, and without, the full config.
export const logger: Logger = pino({
    level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
    base: { service: process.env.SERVICE_NAME ?? "resumely" },
    redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
    ...(process.env.NODE_ENV === "development" && { transport: { target: "pino-pretty", options: { colorize: true } } }),
});
