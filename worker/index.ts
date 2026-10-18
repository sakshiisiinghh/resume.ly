import { Worker } from "bullmq";
import { logger } from "~/.server/logger";
import { flushMonitoring, initMonitoring, reportError } from "~/.server/monitoring";
import { pool } from "~/.server/db";
import { env } from "~/.server/env";
import { detailOf, failureInfo, isFinalFailure } from "~/.server/jobs/errors";
import { recordFailure, processAnalysis } from "~/.server/jobs/process-analysis";
import { reapStaleAnalyses } from "~/.server/jobs/reaper";
import { createLLMProvider } from "~/.server/llm";
import { backoffDelay, enqueueAnalysis, getQueue, limiterFor, MAX_ATTEMPTS, QUEUE_NAME, type AnalysisJob } from "~/.server/queue";
import { createRedis, getRedis } from "~/.server/redis";
import { getStorage } from "~/.server/storage";

const log = logger.child({ service: "worker" });
initMonitoring({ dsn: env().SENTRY_DSN, environment: env().NODE_ENV, service: "worker" });

const llm = createLLMProvider();
const storage = getStorage();

const worker = new Worker<AnalysisJob>(
    QUEUE_NAME,
    async (job) => {
        if (job.name === "reap") {
            const result = await reapStaleAnalyses(enqueueAnalysis);
            if (result.requeued || result.failed) log.warn(result, "reaper found stuck analyses");
            return;
        }
        await processAnalysis(job.data.analysisId, {
            storage,
            llm,
            log: log.child({ jobId: job.id, analysisId: job.data.analysisId, requestId: job.data.requestId }),
        });
    },
    {
        connection: createRedis(),
        concurrency: env().WORKER_CONCURRENCY,
        limiter: limiterFor(env().LLM_REQUESTS_PER_MINUTE),
        settings: { backoffStrategy: (attemptsMade, _type, err) => backoffDelay(attemptsMade, err) },
    }
);

worker.on("failed", async (job, err) => {
    if (!job || job.name !== "analyze") return;

    const final = isFinalFailure(err, job.attemptsMade, job.opts.attempts ?? MAX_ATTEMPTS);
    const { code } = failureInfo(err);
    log[final ? "error" : "warn"](
        { analysisId: job.data.analysisId, requestId: job.data.requestId, attempt: job.attemptsMade, code, detail: detailOf(err) },
        final ? "analysis failed" : "analysis will retry"
    );
    if (code === "unexpected") reportError(err, { analysisId: job.data.analysisId, requestId: job.data.requestId });
    await recordFailure(job.data.analysisId, err, { final }).catch((e) => log.error({ err: e }, "could not record failure"));
});

worker.on("error", (err) => log.error({ err }, "worker error"));
process.on("unhandledRejection", (reason) => {
    log.error({ err: reason }, "unhandled rejection");
    reportError(reason);
});

await getQueue().upsertJobScheduler("reap-stale", { every: 60_000 }, { name: "reap" });
log.info({ model: llm.model, concurrency: env().WORKER_CONCURRENCY, requestsPerMinute: env().LLM_REQUESTS_PER_MINUTE }, "worker ready");

async function shutdown() {
    log.info("shutting down");
    await worker.close();
    await getQueue().close();
    getRedis().disconnect();
    await pool.end();
    await flushMonitoring();
    process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
