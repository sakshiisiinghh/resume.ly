import { Redis } from "ioredis";
import { env } from "~/.server/env";
import { withTimeout } from "~/.server/timeout";

// BullMQ requires maxRetriesPerRequest: null on its connections.
export const createRedis = () => new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });

let shared: Redis | undefined;

export function getRedis() {
    return (shared ??= createRedis());
}

export interface ProgressEvent {
    status: string;
    stage: string | null;
}

export const progressChannel = (analysisId: string) => `analysis:${analysisId}`;

// ioredis queues commands while Redis is down instead of failing, so cap the wait.
// Progress events are best effort; the database is the source of truth.
export async function publishProgress(analysisId: string, event: ProgressEvent) {
    try {
        await withTimeout(getRedis().publish(progressChannel(analysisId), JSON.stringify(event)), 1000, "publish");
    } catch {}
}
