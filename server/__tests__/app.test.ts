import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, loadContext, type AppOptions } from "../app";

let server: Server | undefined;
let dir: string;
let logs: Record<string, any>[];
const handled: { id: string; ip: string | undefined; path: string }[] = [];

const logger = () => pino({ level: "info" }, { write: (line: string) => void logs.push(JSON.parse(line)) });

async function start(options: Partial<AppOptions> = {}) {
    const app = createApp({
        clientDir: dir,
        logger: logger(),
        handler: (req, res) => {
            handled.push({ id: req.id, ip: loadContext(req).ip, path: req.path });
            if (req.path === "/boom") return void res.status(500).send("boom");
            if (req.path === "/missing") return void res.status(404).send("nope");
            res.send("app");
        },
        ...options,
    });
    server = app.listen(0);
    await new Promise((resolve) => server!.once("listening", resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "client-"));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log(1)");
    writeFileSync(path.join(dir, "favicon.ico"), "icon");
    writeFileSync(path.join(path.dirname(dir), "secret.txt"), "do not serve");
    logs = [];
    handled.length = 0;
});

afterEach(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(null)));
    server = undefined;
    rmSync(dir, { recursive: true, force: true });
    rmSync(path.join(path.dirname(dir), "secret.txt"), { force: true });
});

describe("security headers", () => {
    it("are on every response, and the framework isn't advertised", async () => {
        const base = await start();

        for (const url of ["/", "/assets/app-abc123.js", "/favicon.ico", "/missing"]) {
            const res = await fetch(base + url);

            expect(res.headers.get("x-content-type-options"), url).toBe("nosniff");
            expect(res.headers.get("x-frame-options"), url).toBe("DENY");
            expect(res.headers.get("x-powered-by"), url).toBeNull();
        }
    });

    it("include HSTS only when the request really came over HTTPS through a trusted proxy", async () => {
        const trusted = await start({ trustProxy: 1 });
        expect((await fetch(trusted, { headers: { "X-Forwarded-Proto": "https" } })).headers.get("strict-transport-security")).toContain("max-age=31536000");
        expect((await fetch(trusted)).headers.get("strict-transport-security")).toBeNull();
    });

    it("ignore a forwarded protocol from a proxy we don't trust", async () => {
        const base = await start({ trustProxy: false });

        expect((await fetch(base, { headers: { "X-Forwarded-Proto": "https" } })).headers.get("strict-transport-security")).toBeNull();
    });
});

describe("request ids", () => {
    it("are generated, returned, and the same one the app sees", async () => {
        const base = await start();

        const res = await fetch(base);

        const id = res.headers.get("x-request-id")!;
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(handled[0].id).toBe(id);
    });

    it("keep a sensible one supplied by a proxy, so a trace can span services", async () => {
        const base = await start();

        const res = await fetch(base, { headers: { "X-Request-Id": "req_abc-123456" } });

        expect(res.headers.get("x-request-id")).toBe("req_abc-123456");
    });

    it.each(["short", "has spaces in it okay", "x".repeat(65), "<script>alert(1)</script>", "line\\nbreak-injection"])("replace a bad one: %j", async (bad) => {
        const base = await start();

        const res = await fetch(base, { headers: { "X-Request-Id": bad } });

        expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("differ between requests", async () => {
        const base = await start();

        const ids = await Promise.all([fetch(base), fetch(base), fetch(base)].map(async (r) => (await r).headers.get("x-request-id")));

        expect(new Set(ids).size).toBe(3);
    });
});

describe("client IP", () => {
    it("is the connection's address when no proxy is trusted, whatever the headers claim", async () => {
        const base = await start({ trustProxy: false });

        await fetch(base, { headers: { "X-Forwarded-For": "6.6.6.6" } });

        expect(handled[0].ip).toMatch(/127\.0\.0\.1/);
    });

    it("is what the trusted proxy saw, so a client can't spoof it by sending its own header", async () => {
        const base = await start({ trustProxy: 1 });

        // The proxy appends the real address to whatever the client sent.
        await fetch(base, { headers: { "X-Forwarded-For": "6.6.6.6, 203.0.113.9" } });

        expect(handled[0].ip).toBe("203.0.113.9");
    });

    it("is passed to the app in the load context", async () => {
        const base = await start({ trustProxy: 1 });

        await fetch(base, { headers: { "X-Forwarded-For": "198.51.100.4" } });

        expect(handled[0]).toMatchObject({ ip: "198.51.100.4" });
    });
});

describe("static files", () => {
    it("are cached for a year when fingerprinted", async () => {
        const base = await start();

        const res = await fetch(`${base}/assets/app-abc123.js`);

        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
        expect(handled).toHaveLength(0);
    });

    it("are cached for an hour otherwise", async () => {
        const base = await start();

        expect((await fetch(`${base}/favicon.ico`)).headers.get("cache-control")).toBe("public, max-age=3600");
    });

    it("leave everything else to the app", async () => {
        const base = await start();

        expect(await (await fetch(`${base}/resume/123`)).text()).toBe("app");
        expect(handled[0].path).toBe("/resume/123");
    });

    it("can't be used to read files outside the client folder", async () => {
        const base = await start();

        for (const url of ["/assets/..%2f..%2fsecret.txt", "/..%2fsecret.txt", "/%2e%2e/secret.txt"]) {
            expect(await (await fetch(base + url)).text(), url).not.toContain("do not serve");
        }
    });
});

describe("access logs", () => {
    it("record each request with its id, status and duration", async () => {
        const base = await start();

        const res = await fetch(`${base}/resume/1`);
        await new Promise((r) => setTimeout(r, 20));

        expect(logs.find((l) => l.req?.url === "/resume/1")).toMatchObject({ req: { id: res.headers.get("x-request-id") }, res: { statusCode: 200 }, level: 30 });
        expect(logs.find((l) => l.req?.url === "/resume/1")?.responseTime).toBeGreaterThanOrEqual(0);
    });

    it("log client errors as warnings and server errors as errors", async () => {
        const base = await start();

        await fetch(`${base}/missing`);
        await fetch(`${base}/boom`);
        await new Promise((r) => setTimeout(r, 20));

        expect(logs.find((l) => l.req?.url === "/missing")?.level).toBe(40);
        expect(logs.find((l) => l.req?.url === "/boom")?.level).toBe(50);
    });

    it("skip the health check, which would drown everything else", async () => {
        const base = await start();

        await fetch(`${base}/healthz`);
        await new Promise((r) => setTimeout(r, 20));

        expect(logs.filter((l) => l.req?.url === "/healthz")).toHaveLength(0);
    });

    it("never write cookies to the logs", async () => {
        const base = await start({ logger: pino({ level: "info", redact: ["req.headers.cookie"] }, { write: (line: string) => void logs.push(JSON.parse(line)) }) });

        await fetch(base, { headers: { Cookie: "__session=supersecret" } });
        await new Promise((r) => setTimeout(r, 20));

        expect(JSON.stringify(logs)).not.toContain("supersecret");
    });
});
