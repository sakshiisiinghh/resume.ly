import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/.server/db";
import { analyses, resumes } from "~/.server/db/schema";
import { MAX_PDF_BYTES, deleteResume, getResume, idempotencyKey, listResumes, submitResume, validatePdf } from "~/.server/resumes";
import { closeDb, createUser, hasTestDb, resetDb } from "../../../test/db";
import { MemoryStorage } from "../../../test/memory-storage";
import { makePdf, resumeLines } from "../../../test/pdf";

afterAll(closeDb);

const pdf = makePdf(resumeLines);
const base = { fileName: "resume.pdf", bytes: pdf, companyName: "Fluxton", jobTitle: "Backend Engineer", jobDescription: "Go and Postgres" };

describe("idempotencyKey", () => {
    const input = { userId: "u1", fileSha256: "abc", jobTitle: "t", jobDescription: "d", promptVersion: "v1", model: "m" };

    it("is stable for identical input", () => {
        expect(idempotencyKey(input)).toBe(idempotencyKey({ ...input }));
    });

    it.each(["userId", "fileSha256", "jobTitle", "jobDescription", "promptVersion", "model"] as const)("changes when %s changes", (field) => {
        expect(idempotencyKey({ ...input, [field]: "other" })).not.toBe(idempotencyKey(input));
    });

    it("can't be forged by shifting text between fields", () => {
        const a = idempotencyKey({ ...input, jobTitle: "ab", jobDescription: "c" });
        const b = idempotencyKey({ ...input, jobTitle: "a", jobDescription: "bc" });
        expect(a).not.toBe(b);
    });
});

describe("validatePdf", () => {
    it("accepts a PDF", () => expect(validatePdf(pdf)).toBeNull());
    it("rejects empty files", () => expect(validatePdf(Buffer.alloc(0))).toMatch(/empty/));
    it("rejects files that only look like PDFs by extension", () => {
        expect(validatePdf(Buffer.from("MZ not a pdf at all"))).toMatch(/Only PDF/);
    });
    it("rejects oversized files", () => {
        const big = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_PDF_BYTES)]);
        expect(validatePdf(big)).toMatch(/10 MB/);
    });
});

describe.skipIf(!hasTestDb)("submitResume", () => {
    const storage = new MemoryStorage();
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const deps = { storage, enqueue, model: "test-model" };

    beforeEach(async () => {
        await resetDb();
        storage.files.clear();
        enqueue.mockClear();
        enqueue.mockResolvedValue(undefined);
    });

    it("stores the file, creates a queued analysis and enqueues once", async () => {
        const user = await createUser();
        const { resumeId, created } = await submitResume({ ...base, userId: user.id }, deps);

        const found = await getResume(user.id, resumeId);
        expect(created).toBe(true);
        expect(found?.analysis).toMatchObject({ status: "queued", model: "test-model", promptVersion: "v1" });
        expect(storage.files.has(found!.resume.fileKey)).toBe(true);
        expect(found!.resume.fileKey).toBe(`users/${user.id}/${resumeId}.pdf`);
        expect(enqueue).toHaveBeenCalledOnce();
        expect(enqueue).toHaveBeenCalledWith({ analysisId: found!.analysis.id, idempotencyKey: found!.analysis.idempotencyKey });
    });

    it("returns the existing resume for a repeated submission", async () => {
        const user = await createUser();
        const first = await submitResume({ ...base, userId: user.id }, deps);
        const second = await submitResume({ ...base, userId: user.id }, deps);

        expect(second).toEqual({ resumeId: first.resumeId, created: false });
        expect(await db.select().from(analyses)).toHaveLength(1);
        expect(await db.select().from(resumes)).toHaveLength(1);
        expect(enqueue).toHaveBeenCalledOnce();
    });

    it("collapses concurrent identical submissions into one analysis", async () => {
        const user = await createUser();

        // Hold every request after its lookup so all six really race to insert.
        const racers = 6;
        let arrived = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const racingStorage = new MemoryStorage();
        const put = racingStorage.put.bind(racingStorage);
        racingStorage.put = async (key, data) => {
            if (++arrived === racers) release();
            await gate;
            return put(key, data);
        };

        const results = await Promise.all(
            Array.from({ length: racers }, () => submitResume({ ...base, userId: user.id }, { ...deps, storage: racingStorage }))
        );

        expect(new Set(results.map((r) => r.resumeId)).size).toBe(1);
        expect(results.filter((r) => r.created)).toHaveLength(1);
        expect(await db.select().from(analyses)).toHaveLength(1);
        expect(racingStorage.files.size).toBe(1);
        expect(enqueue).toHaveBeenCalledOnce();
    });

    it("treats a different job description as a new analysis", async () => {
        const user = await createUser();
        const a = await submitResume({ ...base, userId: user.id }, deps);
        const b = await submitResume({ ...base, userId: user.id, jobDescription: "Rust and Kafka" }, deps);

        expect(b.resumeId).not.toBe(a.resumeId);
        expect(await db.select().from(analyses)).toHaveLength(2);
    });

    it("never shares an analysis between users who upload the same file", async () => {
        const [alice, bob] = await Promise.all([createUser(), createUser()]);
        const a = await submitResume({ ...base, userId: alice.id }, deps);
        const b = await submitResume({ ...base, userId: bob.id }, deps);

        expect(b.resumeId).not.toBe(a.resumeId);
        expect(await getResume(bob.id, a.resumeId)).toBeNull();
    });

    it("re-queues a failed analysis when the same resume is submitted again", async () => {
        const user = await createUser();
        const { resumeId } = await submitResume({ ...base, userId: user.id }, deps);
        await db.update(analyses).set({ status: "failed", errorCode: "llm_unavailable", attempts: 3 });
        enqueue.mockClear();

        await submitResume({ ...base, userId: user.id }, deps);

        const { analysis } = (await getResume(user.id, resumeId))!;
        expect(analysis).toMatchObject({ status: "queued", attempts: 0, errorCode: null });
        expect(enqueue).toHaveBeenCalledOnce();
    });

    it("marks the analysis failed when the queue is unreachable", async () => {
        const user = await createUser();
        enqueue.mockRejectedValue(new Error("redis down"));

        const { resumeId } = await submitResume({ ...base, userId: user.id }, deps);

        const { analysis } = (await getResume(user.id, resumeId))!;
        expect(analysis).toMatchObject({ status: "failed", errorCode: "enqueue_failed" });
    });
});

describe.skipIf(!hasTestDb)("ownership", () => {
    const storage = new MemoryStorage();
    const deps = { storage, enqueue: vi.fn().mockResolvedValue(undefined), model: "test-model" };

    beforeEach(async () => {
        await resetDb();
        storage.files.clear();
    });

    it("hides other users' resumes", async () => {
        const [alice, bob] = await Promise.all([createUser(), createUser()]);
        const { resumeId } = await submitResume({ ...base, userId: alice.id }, deps);

        expect(await getResume(bob.id, resumeId)).toBeNull();
        expect((await listResumes(bob.id, 1, 10)).items).toHaveLength(0);
        expect((await listResumes(alice.id, 1, 10)).items).toHaveLength(1);
    });

    it("refuses to delete another user's resume", async () => {
        const [alice, bob] = await Promise.all([createUser(), createUser()]);
        const { resumeId } = await submitResume({ ...base, userId: alice.id }, deps);

        expect(await deleteResume(bob.id, resumeId, storage)).toBe(false);
        expect(await getResume(alice.id, resumeId)).not.toBeNull();
        expect(storage.files.size).toBe(1);
    });

    it("deletes the rows and stored files for the owner", async () => {
        const alice = await createUser();
        const { resumeId } = await submitResume({ ...base, userId: alice.id }, deps);
        await storage.put(`users/${alice.id}/${resumeId}.webp`, Buffer.from("thumb"));
        await db.update(resumes).set({ thumbKey: `users/${alice.id}/${resumeId}.webp` }).where(eq(resumes.id, resumeId));

        expect(await deleteResume(alice.id, resumeId, storage)).toBe(true);
        expect(storage.files.size).toBe(0);
        expect(await db.select().from(analyses)).toHaveLength(0);
    });

    it("paginates newest first", async () => {
        const alice = await createUser();
        for (const n of [1, 2, 3]) {
            await submitResume({ ...base, userId: alice.id, jobDescription: `job ${n}` }, deps);
        }

        const first = await listResumes(alice.id, 1, 2);
        const second = await listResumes(alice.id, 2, 2);

        expect(first.items.map((i) => i.resume.jobDescription)).toEqual(["job 3", "job 2"]);
        expect(first.hasNext).toBe(true);
        expect(second.items.map((i) => i.resume.jobDescription)).toEqual(["job 1"]);
        expect(second.hasNext).toBe(false);
    });
});
