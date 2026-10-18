interface DeleteDeps {
    fs: { delete: (path: string) => Promise<void> };
    kv: { delete: (key: string) => Promise<boolean | undefined> };
}

export type DeleteResult = { ok: true; orphanedFiles: number } | { ok: false; error: string };

// Record first, so a failed file delete leaves an orphan, not a card with no files.
export async function deleteResume(
    resume: Pick<Resume, "id" | "resumePath" | "imagePath">,
    { fs, kv }: DeleteDeps
): Promise<DeleteResult> {
    try {
        const removed = await kv.delete(`resume:${resume.id}`);
        if (removed === undefined) return { ok: false, error: "Storage is unavailable. Try again." };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Failed to delete resume" };
    }

    const paths = [resume.resumePath, resume.imagePath].filter(Boolean);
    const results = await Promise.allSettled(paths.map((path) => fs.delete(path)));
    return { ok: true, orphanedFiles: results.filter((r) => r.status === "rejected").length };
}
