import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "~/.server/db";
import { analyses } from "~/.server/db/schema";
import { MAX_ATTEMPTS, type Enqueue } from "~/.server/queue";
import { publishProgress } from "~/.server/redis";

export const STALE_AFTER_MS = 5 * 60 * 1000;

// Re-queues (or fails, once attempts run out) analyses stuck in "processing" with no heartbeat.
export async function reapStaleAnalyses(enqueue: Enqueue, now = new Date()) {
    const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
    const stale = and(eq(analyses.status, "processing"), lt(analyses.heartbeatAt, cutoff));

    const exhausted = await db
        .update(analyses)
        .set({ status: "failed", stage: null, errorCode: "stalled", errorMessage: "The analysis stopped responding.", finishedAt: now })
        .where(and(stale, gte(analyses.attempts, MAX_ATTEMPTS)))
        .returning({ id: analyses.id });

    const requeued = await db
        .update(analyses)
        .set({ status: "queued", stage: null })
        .where(stale)
        .returning({ id: analyses.id, idempotencyKey: analyses.idempotencyKey });

    for (const { id, idempotencyKey } of requeued) await enqueue({ analysisId: id, idempotencyKey });
    await Promise.all([
        ...exhausted.map(({ id }) => publishProgress(id, { status: "failed", stage: null })),
        ...requeued.map(({ id }) => publishProgress(id, { status: "queued", stage: null })),
    ]);

    return { requeued: requeued.length, failed: exhausted.length };
}
