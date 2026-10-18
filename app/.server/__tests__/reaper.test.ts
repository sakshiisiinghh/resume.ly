import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/.server/db";
import { analyses } from "~/.server/db/schema";
import { STALE_AFTER_MS, reapStaleAnalyses } from "~/.server/jobs/reaper";
import { MAX_ATTEMPTS } from "~/.server/queue";
import { getResume, submitResume } from "~/.server/resumes";
import { closeDb, createUser, hasTestDb, resetDb } from "../../../test/db";
import { MemoryStorage } from "../../../test/memory-storage";
import { makePdf, resumeLines } from "../../../test/pdf";

afterAll(closeDb);

const storage = new MemoryStorage();
const enqueue = vi.fn().mockResolvedValue(undefined);
const now = new Date("2026-10-18T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

async function analysisWith(patch: Partial<typeof analyses.$inferInsert>) {
    const user = await createUser();
    const { resumeId } = await submitResume(
        { userId: user.id, fileName: "r.pdf", bytes: makePdf(resumeLines), companyName: "", jobTitle: "", jobDescription: "" },
        { storage, enqueue: vi.fn().mockResolvedValue(undefined), model: "m" }
    );
    const { analysis } = (await getResume(user.id, resumeId))!;
    await db.update(analyses).set(patch).where(eq(analyses.id, analysis.id));
    return analysis;
}

const reload = async (id: string) => (await db.select().from(analyses).where(eq(analyses.id, id)))[0];

describe.skipIf(!hasTestDb)("reapStaleAnalyses", () => {
    beforeEach(async () => {
        await resetDb();
        enqueue.mockClear();
    });

    it("re-queues an analysis whose worker stopped heartbeating", async () => {
        const stuck = await analysisWith({ status: "processing", stage: "analyzing", attempts: 1, heartbeatAt: minutesAgo(10) });

        expect(await reapStaleAnalyses(enqueue, now)).toEqual({ requeued: 1, failed: 0 });

        expect(await reload(stuck.id)).toMatchObject({ status: "queued", stage: null });
        expect(enqueue).toHaveBeenCalledWith({ analysisId: stuck.id, idempotencyKey: stuck.idempotencyKey });
    });

    it("fails an analysis that is stale and out of attempts", async () => {
        const stuck = await analysisWith({ status: "processing", attempts: MAX_ATTEMPTS, heartbeatAt: minutesAgo(10) });

        expect(await reapStaleAnalyses(enqueue, now)).toEqual({ requeued: 0, failed: 1 });

        expect(await reload(stuck.id)).toMatchObject({ status: "failed", errorCode: "stalled" });
        expect(enqueue).not.toHaveBeenCalled();
    });

    it("leaves healthy and finished analyses alone", async () => {
        const healthy = await analysisWith({ status: "processing", heartbeatAt: new Date(now.getTime() - STALE_AFTER_MS + 60_000) });
        const done = await analysisWith({ status: "done", heartbeatAt: minutesAgo(60) });
        const queued = await analysisWith({ status: "queued" });

        expect(await reapStaleAnalyses(enqueue, now)).toEqual({ requeued: 0, failed: 0 });

        expect((await reload(healthy.id)).status).toBe("processing");
        expect((await reload(done.id)).status).toBe("done");
        expect((await reload(queued.id)).status).toBe("queued");
    });

    it("is safe to run twice (two workers reaping at once)", async () => {
        await analysisWith({ status: "processing", attempts: 1, heartbeatAt: minutesAgo(10) });

        const results = await Promise.all([reapStaleAnalyses(enqueue, now), reapStaleAnalyses(enqueue, now)]);

        expect(results.reduce((n, r) => n + r.requeued, 0)).toBe(1);
        expect(enqueue).toHaveBeenCalledOnce();
    });
});
