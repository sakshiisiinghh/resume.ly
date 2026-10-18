import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalStorage } from "~/.server/storage";

describe("LocalStorage", () => {
    let dir: string;
    let storage: LocalStorage;

    beforeAll(async () => {
        dir = await mkdtemp(path.join(os.tmpdir(), "resumely-storage-"));
        storage = new LocalStorage(dir);
    });
    afterAll(() => rm(dir, { recursive: true, force: true }));

    it("round-trips bytes under nested keys", async () => {
        await storage.put("users/u1/a.pdf", Buffer.from("hello"));
        expect((await storage.get("users/u1/a.pdf"))?.toString()).toBe("hello");
    });

    it("returns null for a missing key and tolerates deleting one", async () => {
        expect(await storage.get("users/u1/missing.pdf")).toBeNull();
        await expect(storage.delete("users/u1/missing.pdf")).resolves.toBeUndefined();
    });

    it("deletes stored files", async () => {
        await storage.put("users/u1/b.pdf", Buffer.from("x"));
        await storage.delete("users/u1/b.pdf");
        expect(await storage.get("users/u1/b.pdf")).toBeNull();
    });

    it.each(["../escape.pdf", "users/../../escape.pdf", "/etc/passwd"])("refuses key %s outside the storage root", async (key) => {
        await expect(storage.put(key, Buffer.from("x"))).rejects.toThrow(/Invalid storage key/);
        await expect(storage.get(key)).rejects.toThrow(/Invalid storage key/);
    });
});
