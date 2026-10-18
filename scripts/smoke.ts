import { spawn } from "node:child_process";

// Starts the production build and checks what a browser would depend on. Catches things unit tests can't,
// such as an inline script the Content-Security-Policy would block.
const port = 3199;
const base = `http://127.0.0.1:${port}`;

const server = spawn("npx", ["tsx", "server/index.ts"], {
    env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "production",
        LOG_LEVEL: "silent",
        DATABASE_URL: process.env.DATABASE_URL ?? "postgres://resumely:resumely@localhost:5442/resumely",
        REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6389",
        SESSION_SECRET: process.env.SESSION_SECRET ?? "smoke-test-secret-that-is-long-enough!",
    },
    stdio: ["ignore", "inherit", "inherit"],
});

// Real browsers get streamed HTML, which has extra inline scripts; bots (and curl) don't, so ask like a browser.
const BROWSER = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" };

const failures: string[] = [];
const check = (ok: boolean, message: string) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
    if (!ok) failures.push(message);
};

async function waitForServer() {
    for (let i = 0; i < 60; i++) {
        try {
            if ((await fetch(`${base}/healthz`)).ok) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("The server didn't start");
}

try {
    await waitForServer();

    const res = await fetch(`${base}/login`, { headers: BROWSER });
    const html = await res.text();
    const csp = res.headers.get("content-security-policy") ?? "";
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];

    check(res.status === 200, "the login page renders");
    check(Boolean(nonce), "the CSP carries a nonce");
    check(!/script-src[^;]*unsafe-(inline|eval)/.test(csp), "the CSP doesn't allow inline or eval scripts");

    const inline = [...html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]).filter((attrs) => !/\bsrc=/.test(attrs));
    check(html.includes("$RC(") || html.includes("$RV="), "the page is streamed, as it is for a browser");
    check(inline.length > 0 && inline.every((attrs) => nonce && attrs.includes(`nonce="${nonce}"`)), `every inline script carries the nonce (${inline.length} found)`);
    check(!html.includes("unsafe-inline"), "no script is allowed to be inline");

    const other = await fetch(`${base}/login`, { headers: BROWSER });
    const otherNonce = (other.headers.get("content-security-policy") ?? "").match(/'nonce-([^']+)'/)?.[1];
    check(Boolean(otherNonce) && otherNonce !== nonce, "each request gets its own nonce");

    check(res.headers.get("x-content-type-options") === "nosniff", "nosniff is set");
    check(res.headers.get("x-frame-options") === "DENY", "framing is denied");
    check(Boolean(res.headers.get("x-request-id")), "a request id is returned");
    check(!res.headers.get("x-powered-by"), "the framework isn't advertised");

    const privatePage = await fetch(`${base}/`, { redirect: "manual" });
    check(privatePage.status === 302 && (privatePage.headers.get("location") ?? "").startsWith("/login"), "the dashboard redirects signed-out visitors to the login page");

    const health = await fetch(`${base}/healthz`);
    check(health.status === 200, "the health check answers");
} catch (err) {
    failures.push(String(err));
    console.error(err);
} finally {
    server.kill("SIGTERM");
}

if (failures.length > 0) {
    console.error(`\n${failures.length} smoke check(s) failed`);
    process.exit(1);
}
console.log("\nsmoke test passed");
