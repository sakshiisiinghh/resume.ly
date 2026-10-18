import { describe, expect, it, vi } from "vitest";
import { deleteResume } from "~/lib/deleteResume";

const resume = { id: "abc", resumePath: "/files/resume.pdf", imagePath: "/files/resume.png" };

const deps = () => ({
    fs: { delete: vi.fn().mockResolvedValue(undefined) },
    kv: { delete: vi.fn().mockResolvedValue(true) },
});

describe("deleteResume", () => {
    it("deletes the KV record before the files", async () => {
        const d = deps();
        const order: string[] = [];
        d.kv.delete.mockImplementation(async () => { order.push("kv"); return true; });
        d.fs.delete.mockImplementation(async (p: string) => { order.push(p); });

        const result = await deleteResume(resume, d);

        expect(result).toEqual({ ok: true, orphanedFiles: 0 });
        expect(d.kv.delete).toHaveBeenCalledWith("resume:abc");
        expect(order).toEqual(["kv", "/files/resume.pdf", "/files/resume.png"]);
    });

    it("doesn't touch files if the record can't be deleted", async () => {
        const d = deps();
        d.kv.delete.mockRejectedValue(new Error("network down"));

        expect(await deleteResume(resume, d)).toEqual({ ok: false, error: "network down" });
        expect(d.fs.delete).not.toHaveBeenCalled();
    });

    it("reports storage being unavailable", async () => {
        const d = deps();
        d.kv.delete.mockResolvedValue(undefined);

        expect((await deleteResume(resume, d)).ok).toBe(false);
        expect(d.fs.delete).not.toHaveBeenCalled();
    });

    it("still succeeds when a file delete fails, counting the orphan", async () => {
        const d = deps();
        d.fs.delete.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("gone"));

        expect(await deleteResume(resume, d)).toEqual({ ok: true, orphanedFiles: 1 });
    });
});
