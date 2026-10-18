import { createRequestHandler } from "@react-router/express";
import type { ServerBuild } from "react-router";
import { logger } from "../app/.server/logger";
import { flushMonitoring, initMonitoring, reportError } from "../app/.server/monitoring";
import { createApp, loadContext } from "./app";

const port = Number(process.env.PORT ?? 3000);

initMonitoring({ dsn: process.env.SENTRY_DSN || undefined, environment: process.env.NODE_ENV ?? "production", service: "web" });
process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandled rejection");
    reportError(reason);
});

// A number is how many proxies to trust (1 behind a single load balancer); "true" trusts them all.
const trustProxy = process.env.TRUST_PROXY === "true" ? true : Number(process.env.TRUST_PROXY) || false;

// The build is generated, so it has no types; a variable path keeps TypeScript from looking for them.
const buildPath = "../build/server/index.js";
const build = (await import(buildPath)) as ServerBuild;
const app = createApp({ handler: createRequestHandler({ build, getLoadContext: loadContext }), trustProxy });

const server = app.listen(port, "0.0.0.0", () => logger.info({ port, trustProxy }, "server listening"));

function shutdown(signal: string) {
    logger.info({ signal }, "shutting down");
    server.close(() => flushMonitoring().then(() => process.exit(0)));
    // Don't wait forever for open connections such as progress streams.
    setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
