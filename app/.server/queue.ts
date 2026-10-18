import { Queue } from "bullmq";
import { retryAfterOf } from "~/.server/jobs/errors";
import { getRedis } from "~/.server/redis";
import { withTimeout } from "~/.server/timeout";

export const QUEUE_NAME = "analysis";
export const MAX_ATTEMPTS = 3;

const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 5 * 60 * 1000;
const RETRY_MARGIN_MS = 1000;

export interface AnalysisJob {
    analysisId: string;
    /** The web request that started this job, so one id can be followed through the logs. */
    requestId?: string;
}

export type Enqueue = (job: { analysisId: string; idempotencyKey: string; requestId?: string }) => Promise<void>;

let queue: Queue | undefined;

export function getQueue() {
    return (queue ??= new Queue(QUEUE_NAME, { connection: getRedis() }));
}

// When the provider says how long to wait (a rate limit), wait that long; otherwise back off exponentially.
export function backoffDelay(attemptsMade: number, err?: Error): number {
    const asked = retryAfterOf(err);
    if (asked !== undefined) return Math.min(asked + RETRY_MARGIN_MS, MAX_DELAY_MS);
    return BASE_DELAY_MS * 2 ** (attemptsMade - 1);
}

export const limiterFor = (requestsPerMinute?: number) => (requestsPerMinute ? { max: requestsPerMinute, duration: 60_000 } : undefined);

// jobId is the idempotency key, so BullMQ drops a duplicate that is already queued or running.
export const enqueueAnalysis: Enqueue = async ({ analysisId, idempotencyKey, requestId }) => {
    const job = getQueue().add(
        "analyze",
        { analysisId, requestId } satisfies AnalysisJob,
        {
            jobId: idempotencyKey,
            attempts: MAX_ATTEMPTS,
            backoff: { type: "provider" },
            removeOnComplete: true,
            removeOnFail: true,
        }
    );
    await withTimeout(job, 5000, "enqueue");
};
