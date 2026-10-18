import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import express, { type RequestHandler } from "express";
import { pinoHttp } from "pino-http";
import { baseSecurityHeaders } from "../app/.server/security-headers";
import { logger as defaultLogger, type Logger } from "../app/.server/logger";

declare module "express-serve-static-core" {
    interface Request {
        id: string;
        nonce: string;
    }
}

export interface AppOptions {
    /** Handles everything that isn't a static file. */
    handler: RequestHandler;
    trustProxy?: boolean | number;
    clientDir?: string;
    logger?: Logger;
}

// Only accept ids we'd be happy to put in a log line.
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function createApp({ handler, trustProxy = false, clientDir = "build/client", logger = defaultLogger }: AppOptions) {
    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", trustProxy);

    app.use((req, res, next) => {
        const supplied = req.get("x-request-id");
        req.id = supplied && SAFE_ID.test(supplied) ? supplied : randomUUID();
        res.setHeader("X-Request-Id", req.id);
        req.nonce = randomBytes(16).toString("base64");

        for (const [name, value] of Object.entries(baseSecurityHeaders({ secure: req.secure }))) res.setHeader(name, value);
        next();
    });

    app.use(
        pinoHttp({
            logger,
            genReqId: (req) => (req as express.Request).id,
            autoLogging: { ignore: (req) => req.url === "/healthz" },
            customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
        })
    );

    app.use("/assets", express.static(path.join(clientDir, "assets"), { immutable: true, maxAge: "1y", index: false }));
    app.use(express.static(clientDir, { maxAge: "1h", index: false }));
    app.all("/{*splat}", handler);

    return app;
}

export const loadContext = (req: express.Request) => ({ ip: req.ip, requestId: req.id, nonce: req.nonce });
