import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { PROMPT_VERSION } from "../../constants";
import { db } from "~/.server/db";
import { isUniqueViolation } from "~/.server/db/errors";
import { analyses, resumes, type Analysis, type Resume } from "~/.server/db/schema";
import { env } from "~/.server/env";
import type { Enqueue } from "~/.server/queue";
import { publishProgress } from "~/.server/redis";
import type { StorageDriver } from "~/.server/storage";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const PDF_MAGIC = "%PDF-";

export interface ResumeWithAnalysis {
    resume: Resume;
    analysis: Analysis;
}

export function idempotencyKey(input: {
    userId: string;
    fileSha256: string;
    jobTitle: string;
    jobDescription: string;
    promptVersion: string;
    model: string;
}) {
    // userId is part of the key so identical uploads from two users never share an analysis.
    const parts = [input.userId, input.fileSha256, input.jobTitle, input.jobDescription, input.promptVersion, input.model];
    return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function validatePdf(bytes: Buffer): string | null {
    if (bytes.length === 0) return "The file is empty";
    if (bytes.length > MAX_PDF_BYTES) return "The file is larger than 10 MB";
    if (bytes.subarray(0, PDF_MAGIC.length).toString("latin1") !== PDF_MAGIC) return "Only PDF files are supported";
    return null;
}

export interface SubmitInput {
    userId: string;
    fileName: string;
    bytes: Buffer;
    companyName: string;
    jobTitle: string;
    jobDescription: string;
}

export interface SubmitDeps {
    storage: StorageDriver;
    enqueue: Enqueue;
    publish?: typeof publishProgress;
    model?: string;
}

async function findByKey(userId: string, key: string): Promise<ResumeWithAnalysis | null> {
    const [row] = await db
        .select({ resume: resumes, analysis: analyses })
        .from(analyses)
        .innerJoin(resumes, eq(resumes.id, analyses.resumeId))
        .where(and(eq(analyses.idempotencyKey, key), eq(resumes.userId, userId)));
    return row ?? null;
}

export async function submitResume(input: SubmitInput, deps: SubmitDeps): Promise<{ resumeId: string; created: boolean }> {
    const model = deps.model ?? env().GEMINI_MODEL;
    const fileSha256 = createHash("sha256").update(input.bytes).digest("hex");
    const key = idempotencyKey({ ...input, fileSha256, promptVersion: PROMPT_VERSION, model });

    const existing = await findByKey(input.userId, key);
    if (existing) {
        if (existing.analysis.status === "failed") await retryAnalysis(existing.analysis.id, deps.enqueue, deps.publish);
        return { resumeId: existing.resume.id, created: false };
    }

    const resumeId = randomUUID();
    const fileKey = `users/${input.userId}/${resumeId}.pdf`;
    await deps.storage.put(fileKey, input.bytes);

    let analysis: Analysis;
    try {
        analysis = await db.transaction(async (tx) => {
            await tx.insert(resumes).values({
                id: resumeId,
                userId: input.userId,
                fileName: input.fileName,
                companyName: input.companyName,
                jobTitle: input.jobTitle,
                jobDescription: input.jobDescription,
                fileKey,
                fileSha256,
            });
            const [row] = await tx
                .insert(analyses)
                .values({ resumeId, promptVersion: PROMPT_VERSION, model, idempotencyKey: key })
                .returning();
            return row;
        });
    } catch (err) {
        await deps.storage.delete(fileKey);
        if (!isUniqueViolation(err)) throw err;

        // Lost a race with an identical concurrent submission.
        const winner = await findByKey(input.userId, key);
        if (!winner) throw err;
        return { resumeId: winner.resume.id, created: false };
    }

    await enqueueOrFail(analysis.id, key, deps.enqueue);
    return { resumeId, created: true };
}

export async function retryAnalysis(analysisId: string, enqueue: Enqueue, publish = publishProgress) {
    const [analysis] = await db
        .update(analyses)
        .set({
            status: "queued",
            stage: null,
            attempts: 0,
            errorCode: null,
            errorMessage: null,
            queuedAt: new Date(),
            startedAt: null,
            heartbeatAt: null,
            finishedAt: null,
        })
        .where(and(eq(analyses.id, analysisId), eq(analyses.status, "failed")))
        .returning();
    if (!analysis) return;

    await publish(analysis.id, { status: "queued", stage: null });
    await enqueueOrFail(analysis.id, analysis.idempotencyKey, enqueue);
}

async function enqueueOrFail(analysisId: string, idempotencyKey: string, enqueue: Enqueue) {
    try {
        await enqueue({ analysisId, idempotencyKey });
    } catch {
        await db
            .update(analyses)
            .set({ status: "failed", errorCode: "enqueue_failed", errorMessage: "Could not queue the analysis. Try again.", finishedAt: new Date() })
            .where(eq(analyses.id, analysisId));
    }
}

export async function getResume(userId: string, resumeId: string): Promise<ResumeWithAnalysis | null> {
    const [row] = await db
        .select({ resume: resumes, analysis: analyses })
        .from(resumes)
        .innerJoin(analyses, eq(analyses.resumeId, resumes.id))
        .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)));
    return row ?? null;
}

export async function listResumes(userId: string, page: number, pageSize: number) {
    const rows = await db
        .select({ resume: resumes, analysis: analyses })
        .from(resumes)
        .innerJoin(analyses, eq(analyses.resumeId, resumes.id))
        .where(eq(resumes.userId, userId))
        .orderBy(desc(resumes.createdAt))
        .limit(pageSize + 1)
        .offset((page - 1) * pageSize);

    return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
}

export async function deleteResume(userId: string, resumeId: string, storage: StorageDriver): Promise<boolean> {
    const [deleted] = await db
        .delete(resumes)
        .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId)))
        .returning();
    if (!deleted) return false;

    const keys = [deleted.fileKey, deleted.thumbKey].filter((k): k is string => Boolean(k));
    await Promise.allSettled(keys.map((k) => storage.delete(k)));
    return true;
}
