import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePuterStore } from "~/lib/puter";

describe("usePuterStore kv", () => {
    const kv = { get: vi.fn(), set: vi.fn(), del: vi.fn(), list: vi.fn(), flush: vi.fn() };

    beforeEach(() => {
        vi.clearAllMocks();
        (window as unknown as { puter: unknown }).puter = { kv };
    });
    afterEach(() => {
        delete (window as unknown as { puter?: unknown }).puter;
    });

    it("delete calls puter.kv.del", async () => {
        kv.del.mockResolvedValue(true);

        const result = await usePuterStore.getState().kv.delete("resume:abc");

        expect(kv.del).toHaveBeenCalledWith("resume:abc");
        expect(result).toBe(true);
    });
});
