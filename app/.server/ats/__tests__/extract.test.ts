import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { PermanentError } from "~/.server/jobs/errors";
import { readPdf } from "~/.server/pdf";
import { buildPdf, cleanResumeLines, columnItems, interleavedTwoColumnItems, twoColumnItems } from "../../../../test/pdf";

describe("readPdf", () => {
    it("reads a single-column resume in order, with no columns or reading-order jumps", async () => {
        const { doc } = await readPdf(buildPdf([{ items: columnItems(cleanResumeLines) }]));

        expect(doc.pageCount).toBe(1);
        expect(doc.text.split("\n").slice(0, 3)).toEqual(cleanResumeLines.slice(0, 3));
        expect(doc.lines.map((l) => l.text)).toEqual(cleanResumeLines);
        expect(doc.columnPages).toEqual([]);
        expect(doc.readingOrderBreaks).toBe(0);
        expect(doc.hidden).toEqual([]);
    });

    it("detects a two-column layout whose stream goes column by column", async () => {
        const { doc } = await readPdf(buildPdf([{ items: twoColumnItems() }]));

        expect(doc.columnPages).toEqual([1]);
        expect(doc.readingOrderBreaks).toBeLessThanOrEqual(2 * doc.pageCount);
    });

    it("flags a two-column layout whose stream alternates between columns", async () => {
        const { doc } = await readPdf(buildPdf([{ items: interleavedTwoColumnItems() }]));

        expect(doc.columnPages).toEqual([1]);
        expect(doc.readingOrderBreaks).toBeGreaterThan(2 * doc.pageCount);
    });

    it("reads every page", async () => {
        const { doc } = await readPdf(
            buildPdf([{ items: columnItems(cleanResumeLines) }, { items: columnItems(["Page two", ...cleanResumeLines.slice(0, 8)]) }])
        );

        expect(doc.pageCount).toBe(2);
        expect(doc.lines.some((l) => l.page === 2 && l.text === "Page two")).toBe(true);
    });

    it("separates tiny text from what a reader can see", async () => {
        const items = [
            ...columnItems(cleanResumeLines),
            { text: "kubernetes terraform kafka", x: 50, y: 40, size: 1 },
        ];
        const { doc } = await readPdf(buildPdf([{ items }]));

        expect(doc.hidden.map((r) => [r.text, r.hidden])).toEqual([["kubernetes terraform kafka", "tiny"]]);
        expect(doc.text).not.toContain("kubernetes terraform");
    });

    it("renders a WebP thumbnail", async () => {
        const { thumbnail } = await readPdf(buildPdf([{ items: columnItems(cleanResumeLines) }]));

        expect(thumbnail?.subarray(8, 12).toString()).toBe("WEBP");
    });

    it("draws the text in the thumbnail, even when the PDF doesn't embed its font", async () => {
        const { thumbnail } = await readPdf(buildPdf([{ items: columnItems(cleanResumeLines) }]));

        const image = await loadImage(thumbnail!);
        const canvas = createCanvas(image.width, image.height);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;

        let dark = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 128) dark++;
        expect(dark).toBeGreaterThan(2000);
    });

    it("gives up on a PDF that takes too long to read, as a permanent failure", async () => {
        const error = await readPdf(buildPdf([{ items: columnItems(cleanResumeLines) }]), { timeoutMs: 1 }).catch((e) => e);

        expect(error).toBeInstanceOf(PermanentError);
        expect(error.code).toBe("pdf_timeout");
    });

    it("refuses a scanned, image-only PDF instead of scoring empty text", async () => {
        const scanned = buildPdf([{ image: true }]);

        await expect(readPdf(scanned)).rejects.toMatchObject({ code: "no_text_layer" });
    });

    it("refuses a malformed PDF", async () => {
        const broken = Buffer.from("%PDF-1.4\nthis is not a real pdf, just text that starts like one");

        const error = await readPdf(broken).catch((e) => e);

        expect(error).toBeInstanceOf(PermanentError);
        expect(error.code).toBe("invalid_pdf");
    });
});
