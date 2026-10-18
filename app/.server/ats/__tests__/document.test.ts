import { describe, expect, it } from "vitest";
import { buildDocument, type RawPage } from "../document";
import { PAGE, docFromLines, pageOfLines, run } from "../../../../test/doc";
import { cleanResumeLines } from "../../../../test/pdf";

const page = (...runs: ReturnType<typeof run>[]): RawPage => ({ ...PAGE, runs });

describe("visible and hidden text", () => {
    it("treats text under 4pt as hidden and leaves it out of the text", () => {
        const doc = buildDocument([page(run("Visible heading", 50, 60), run("stuffed keywords", 50, 700, { size: 1 }))]);

        expect(doc.text).toBe("Visible heading");
        expect(doc.hidden.map((r) => r.text)).toEqual(["stuffed keywords"]);
    });

    it("does not call whitespace-only runs hidden", () => {
        const doc = buildDocument([page(run("   ", 50, 60, { size: 1 }), run("Real text", 50, 80))]);

        expect(doc.hidden).toEqual([]);
    });

    it("keeps 4pt text visible", () => {
        expect(buildDocument([page(run("Footnote", 50, 60, { size: 4 }))]).hidden).toEqual([]);
    });
});

describe("text and lines", () => {
    it("joins runs on one line left to right", () => {
        const doc = buildDocument([page(run("Backend Engineer", 50, 100, { hasEOL: false }), run("July 2023", 400, 100))]);

        expect(doc.lines.map((l) => l.text)).toEqual(["Backend Engineer July 2023"]);
    });

    it("does not add a space inside a word split across runs", () => {
        const doc = buildDocument([page(run("E", 50, 100, { size: 14, hasEOL: false }), { ...run("DUCATION", 57, 100, { size: 10 }), x: 57 })]);

        expect(doc.lines.map((l) => l.text)).toEqual(["EDUCATION"]);
    });

    it("orders lines top to bottom regardless of stream order", () => {
        const doc = buildDocument([page(run("second", 50, 200), run("first", 50, 100))]);

        expect(doc.lines.map((l) => l.text)).toEqual(["first", "second"]);
    });

    it("measures the median font size by characters, not by run count", () => {
        const doc = buildDocument([page(run("A".repeat(100), 50, 60, { size: 10 }), run("tiny", 50, 80, { size: 6 }), run("t", 50, 100, { size: 6 }), run("x", 50, 120, { size: 6 }))]);

        expect(doc.medianFontSize).toBe(10);
    });
});

describe("columns", () => {
    it("finds none in a single-column resume", () => {
        expect(docFromLines(cleanResumeLines).columnPages).toEqual([]);
    });

    it("does not mistake right-aligned dates for a second column", () => {
        const runs = cleanResumeLines.flatMap((text, i) => [
            run(text.padEnd(70, "."), 50, 60 + i * 15, { hasEOL: false }),
            run("2018 - 2022", 500, 60 + i * 15),
        ]);

        expect(buildDocument([page(...runs)]).columnPages).toEqual([]);
    });

    it("finds a gutter between two text columns", () => {
        const left = Array.from({ length: 10 }, (_, i) => run(`Left column line number ${i}`, 40, 60 + i * 15));
        const right = Array.from({ length: 10 }, (_, i) => run(`Right column line number ${i}`, 330, 60 + i * 15));

        expect(buildDocument([page(...left, ...right)]).columnPages).toEqual([1]);
    });

    it("ignores a narrow sidebar holding little of the text", () => {
        const body = Array.from({ length: 10 }, (_, i) => run(`${"Body text that runs most of the way across the page ".repeat(1)}${i}`, 40, 60 + i * 15));
        const sidebar = [run("Aside", 540, 60), run("Note", 540, 75)];

        expect(buildDocument([page(...body, ...sidebar)]).columnPages).toEqual([]);
    });

    it("reads each column as its own lines instead of merging text at the same height", () => {
        const left = Array.from({ length: 10 }, (_, i) => run(i === 0 ? "Skills" : `Left column line number ${i}`, 40, 60 + i * 15));
        const right = Array.from({ length: 10 }, (_, i) => run(i === 0 ? "Experience" : `Right column line number ${i}`, 330, 60 + i * 15));

        const lines = buildDocument([page(...left, ...right)]).lines.map((l) => l.text);

        expect(lines).toContain("Skills");
        expect(lines).toContain("Experience");
        expect(lines.some((l) => l.includes("Skills") && l.includes("Experience"))).toBe(false);
    });

    it("keeps one line per row when there is only one column", () => {
        const doc = buildDocument([page(run("Left", 50, 100, { hasEOL: false }), run("Right side", 330, 100))]);

        expect(doc.lines.map((l) => l.text)).toEqual(["Left Right side"]);
    });

    it("needs enough lines to judge", () => {
        const runs = [run("Left", 40, 60), run("Right", 330, 60), run("Left two", 40, 75), run("Right two", 330, 75)];

        expect(buildDocument([page(...runs)]).columnPages).toEqual([]);
    });
});

describe("reading order", () => {
    const column = (x: number, count: number, label: string) => Array.from({ length: count }, (_, i) => run(`${label} line number ${i}`, x, 60 + i * 15));

    it("has no breaks when text runs top to bottom", () => {
        expect(docFromLines(cleanResumeLines).readingOrderBreaks).toBe(0);
    });

    it("counts one jump back up the page plus one column switch for column-by-column order", () => {
        const doc = buildDocument([page(...column(40, 10, "Left"), ...column(330, 10, "Right"))]);

        expect(doc.readingOrderBreaks).toBe(2);
    });

    it("counts many breaks when the stream alternates between columns", () => {
        const left = column(40, 10, "Left");
        const right = column(330, 10, "Right");
        const doc = buildDocument([page(...left.flatMap((l, i) => [l, right[i]]))]);

        expect(doc.readingOrderBreaks).toBeGreaterThan(10);
    });
});

describe("pages", () => {
    it("numbers lines by page", () => {
        const doc = buildDocument([pageOfLines(["one"]), pageOfLines(["two"])]);

        expect(doc.pageCount).toBe(2);
        expect(doc.lines.map((l) => [l.page, l.text])).toEqual([[1, "one"], [2, "two"]]);
    });
});
