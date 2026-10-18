import { Queue } from "bullmq";
import { getRedis } from "~/.server/redis";

export const QUEUE_NAME = "analysis";
export const MAX_ATTEMPTS = 3;

export interface AnalysisJob {
    analysisId: string;
}

export type Enqueue = (job: { analysisId: string; idempotencyKey: string }) => Promise<void>;

let queue: Queue | undefined;

export function getQueue() {
    return (queue ??= new Queue(QUEUE_NAME, { connection: getRedis() }));
}

// jobId is the idempotency key, so BullMQ drops a duplicate that is already queued or running.
export const enqueueAnalysis: Enqueue = async ({ analysisId, idempotencyKey }) => {
    await getQueue().add(
        "analyze",
        { analysisId } satisfies AnalysisJob,
        {
            jobId: idempotencyKey,
            attempts: MAX_ATTEMPTS,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: true,
            removeOnFail: true,
        }
    );
};
