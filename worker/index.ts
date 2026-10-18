import { Worker } from "bullmq";
import { pool } from "~/.server/db";
import { env } from "~/.server/env";
import { isFinalFailure } from "~/.server/jobs/errors";
import { recordFailure, processAnalysis } from "~/.server/jobs/process-analysis";
import { reapStaleAnalyses } from "~/.server/jobs/reaper";
import { createLLMProvider } from "~/.server/llm";
import { enqueueAnalysis, getQueue, MAX_ATTEMPTS, QUEUE_NAME, type AnalysisJob } from "~/.server/queue";
import { createRedis, getRedis } from "~/.server/redis";
import { getStorage } from "~/.server/storage";

const llm = createLLMProvider();
const storage = getStorage();

const worker = new Worker<AnalysisJob>(
    QUEUE_NAME,
    async (job) => {
        if (job.name === "reap") {
            const result = await reapStaleAnalyses(enqueueAnalysis);
            if (result.requeued || result.failed) console.log("reaper", result);
            return;
        }
        await processAnalysis(job.data.analysisId, { storage, llm });
    },
    { connection: createRedis(), concurrency: env().WORKER_CONCURRENCY }
);

worker.on("failed", async (job, err) => {
    if (!job || job.name !== "analyze") return;

    const final = isFinalFailure(err, job.attemptsMade, job.opts.attempts ?? MAX_ATTEMPTS);
    console.error(`analysis ${job.data.analysisId} ${final ? "failed" : "will retry"}: ${err.message}`);
    await recordFailure(job.data.analysisId, err, { final }).catch((e) => console.error("could not record failure", e));
});

worker.on("error", (err) => console.error("worker error", err));

await getQueue().upsertJobScheduler("reap-stale", { every: 60_000 }, { name: "reap" });
console.log(`worker ready (model ${llm.model}, concurrency ${env().WORKER_CONCURRENCY})`);

async function shutdown() {
    console.log("shutting down");
    await worker.close();
    await getQueue().close();
    getRedis().disconnect();
    await pool.end();
    process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
