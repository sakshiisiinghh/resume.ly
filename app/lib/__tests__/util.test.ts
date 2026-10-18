import { describe, expect, it } from "vitest";
import { formatSize, safeRedirect } from "~/lib/util";

describe("formatSize", () => {
    it.each([
        [0, "0 Bytes"],
        [-5, "0 Bytes"],
        [500, "500 Bytes"],
        [1024, "1 KB"],
        [1536, "1.5 KB"],
        [20 * 1024 * 1024, "20 MB"],
    ])("formats %d as %s", (bytes, expected) => {
        expect(formatSize(bytes)).toBe(expected);
    });
});

describe("safeRedirect", () => {
    it.each(["/", "/resume/123", "/upload?x=1"])("allows local path %s", (path) => {
        expect(safeRedirect(path)).toBe(path);
    });

    it.each([null, undefined, "", "https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "resume"])(
        "falls back for %s",
        (target) => {
            expect(safeRedirect(target)).toBe("/");
        }
    );
});
