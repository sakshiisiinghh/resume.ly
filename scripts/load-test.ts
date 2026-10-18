import { rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";
import { mean, percentile } from "../evals/lib/metrics";
import { buildPdf, cleanResumeLines, columnItems } from "../test/pdf";

try {
    process.loadEnvFile();
} catch {}

const USAGE = `Usage: tsx scripts/load-test.ts [options]

Signs up users, uploads resumes in parallel, waits for the worker to finish them, and reports timings.
Start the app with RATE_LIMIT_ENABLED=false (the limits would otherwise block the test), a worker, and
the stub AI (npm run stub:gemini) so no real quota is used.

  --base <url>         App address (default http://localhost:3000)
  --users <n>          Accounts to create (default 10)
  --uploads <n>        Uploads per account (default 4)
  --concurrency <n>    Uploads in flight at once (default 20)
  --timeout <seconds>  How long to wait for the queue to drain (default 600)
  --json <file>        Also write the raw numbers here
  --keep               Don't delete the test accounts and files afterwards`;

const { values } = parseArgs({
    options: {
        base: { type: "string" },
        users: { type: "string" },
        uploads: { type: "string" },
        concurrency: { type: "string" },
        timeout: { type: "string" },
        json: { type: "string" },
        keep: { type: "boolean" },
        help: { type: "boolean" },
    },
});
if (values.help) {
    console.log(USAGE);
    process.exit(0);
}

const base = values.base ?? "http://localhost:3000";
const userCount = Number(values.users ?? 10);
const uploadsPerUser = Number(values.uploads ?? 4);
const concurrency = Number(values.concurrency ?? 20);
const timeoutMs = Number(values.timeout ?? 600) * 1000;
const runId = Date.now().toString(36);
const emailPrefix = `load-${runId}-`;
const origin = new URL(base).origin;
const pdf = buildPdf([{ items: columnItems(cleanResumeLines) }]);

async function signup(i: number): Promise<string> {
    const res = await fetch(`${base}/signup`, {
        method: "POST",
        redirect: "manual",
        headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email: `${emailPrefix}${i}@example.com`, password: "load-test-password", next: "/" }),
    });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith("__session="));
    if (res.status !== 302 || !cookie) {
        throw new Error(`Sign-up failed with ${res.status}. If that's 429, start the app with RATE_LIMIT_ENABLED=false.`);
    }
    return cookie.split(";")[0];
}

interface Upload {
    status: number;
    ms: number;
}

async function upload(cookie: string, n: number): Promise<Upload> {
    const body = new FormData();
    body.set("resume", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), "resume.pdf");
    body.set("company-name", `Load ${n}`);
    body.set("job-title", "Backend Engineer");
    body.set("job-description", `Load test ${runId} number ${n}. Requirements: Go, PostgreSQL, Redis, Docker and Kubernetes.`);

    const started = performance.now();
    const res = await fetch(`${base}/upload`, { method: "POST", redirect: "manual", headers: { Origin: origin, Cookie: cookie }, body });
    await res.arrayBuffer();
    return { status: res.status, ms: performance.now() - started };
}

async function pool<T>(count: number, size: number, work: (i: number) => Promise<T>): Promise<T[]> {
    const results: T[] = new Array(count);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(size, count) }, async () => {
            while (next < count) {
                const i = next++;
                results[i] = await work(i);
            }
        })
    );
    return results;
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function rows() {
    const { rows } = await db.query<{ status: string; queued_at: Date; started_at: Date | null; finished_at: Date | null; attempts: number; error_code: string | null }>(
        `select a.status, a.queued_at, a.started_at, a.finished_at, a.attempts, a.error_code
         from analyses a join resumes r on r.id = a.resume_id join users u on u.id = r.user_id
         where u.email like $1`,
        [`${emailPrefix}%`]
    );
    return rows;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const ms = (n: number) => `${Math.round(n)} ms`;

try {
    console.log(`Run ${runId}: ${userCount} users x ${uploadsPerUser} uploads, ${concurrency} at once, against ${base}`);

    const cookies = await Promise.all(Array.from({ length: userCount }, (_, i) => signup(i)));
    const total = userCount * uploadsPerUser;

    const wallStart = performance.now();
    const uploads = await pool(total, concurrency, (n) => upload(cookies[n % userCount], n));
    const uploadWall = performance.now() - wallStart;

    const accepted = uploads.filter((u) => u.status === 302);
    console.log(`${accepted.length} of ${total} uploads accepted in ${seconds(uploadWall)}; waiting for the worker...`);

    const deadline = Date.now() + timeoutMs;
    let finished = await rows();
    while (finished.filter((r) => r.status === "done" || r.status === "failed").length < accepted.length && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        finished = await rows();
        process.stdout.write(`\r${finished.filter((r) => r.status === "done" || r.status === "failed").length}/${accepted.length} analyses finished`);
    }
    process.stdout.write("\n");

    const done = finished.filter((r) => r.status === "done");
    const failed = finished.filter((r) => r.status === "failed");
    const unfinished = accepted.length - done.length - failed.length;
    const queueWait = done.map((r) => r.started_at!.getTime() - r.queued_at.getTime());
    const processing = done.map((r) => r.finished_at!.getTime() - r.started_at!.getTime());
    const endToEnd = done.map((r) => r.finished_at!.getTime() - r.queued_at.getTime());
    const drainMs = done.length ? Math.max(...done.map((r) => r.finished_at!.getTime())) - Math.min(...finished.map((r) => r.queued_at.getTime())) : 0;
    const upMs = accepted.map((u) => u.ms);
    const statuses = uploads.reduce<Record<number, number>>((acc, u) => ({ ...acc, [u.status]: (acc[u.status] ?? 0) + 1 }), {});

    const summary = {
        environment: { cpu: os.cpus()[0].model, cores: os.cpus().length, memoryGb: Math.round(os.totalmem() / 2 ** 30), node: process.version, platform: `${os.platform()} ${os.arch()}` },
        plan: { users: userCount, uploadsPerUser, total, concurrency },
        uploads: { accepted: accepted.length, statuses, p50: percentile(upMs, 50), p95: percentile(upMs, 95), p99: percentile(upMs, 99), max: Math.max(0, ...upMs), wallMs: uploadWall },
        analyses: { done: done.length, failed: failed.length, unfinished, retried: finished.filter((r) => r.attempts > 1).length, errorCodes: failed.map((r) => r.error_code) },
        queueWaitMs: { p50: percentile(queueWait, 50), p95: percentile(queueWait, 95), max: Math.max(0, ...queueWait) },
        processingMs: { p50: percentile(processing, 50), p95: percentile(processing, 95), mean: mean(processing) },
        endToEndMs: { p50: percentile(endToEnd, 50), p95: percentile(endToEnd, 95), max: Math.max(0, ...endToEnd) },
        drainMs,
        throughputPerMinute: drainMs ? (done.length / drainMs) * 60_000 : 0,
        failureRate: accepted.length ? failed.length / accepted.length : 0,
    };

    console.log(`
| Measure | Result |
| --- | --- |
| Machine | ${summary.environment.cpu}, ${summary.environment.cores} cores, ${summary.environment.memoryGb} GB, Node ${summary.environment.node} |
| Uploads accepted | ${accepted.length} of ${total} (statuses ${JSON.stringify(statuses)}) |
| Upload response p50 / p95 / p99 / max | ${ms(summary.uploads.p50)} / ${ms(summary.uploads.p95)} / ${ms(summary.uploads.p99)} / ${ms(summary.uploads.max)} |
| Analyses done / failed / unfinished | ${done.length} / ${failed.length} / ${unfinished} |
| Queue wait p50 / p95 / max | ${seconds(summary.queueWaitMs.p50)} / ${seconds(summary.queueWaitMs.p95)} / ${seconds(summary.queueWaitMs.max)} |
| Processing p50 / p95 | ${seconds(summary.processingMs.p50)} / ${seconds(summary.processingMs.p95)} |
| End to end p50 / p95 / max | ${seconds(summary.endToEndMs.p50)} / ${seconds(summary.endToEndMs.p95)} / ${seconds(summary.endToEndMs.max)} |
| Time to drain the queue | ${seconds(drainMs)} |
| Throughput | ${summary.throughputPerMinute.toFixed(1)} analyses a minute |
| Failure rate | ${(summary.failureRate * 100).toFixed(1)}% |`);

    if (values.json) writeFileSync(values.json, JSON.stringify(summary, null, 2));
    if (failed.length || unfinished) process.exitCode = 1;

    if (!values.keep) {
        const { rows: users } = await db.query<{ id: string }>("select id from users where email like $1", [`${emailPrefix}%`]);
        await db.query("delete from users where email like $1", [`${emailPrefix}%`]);
        if (!process.env.S3_BUCKET) for (const { id } of users) rmSync(path.join(process.env.STORAGE_DIR ?? "./storage", "users", id), { recursive: true, force: true });
        console.log(`Removed ${users.length} test accounts.`);
    }
} catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
} finally {
    await db.end();
}
