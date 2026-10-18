import { createRequire } from "node:module";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildDocument, type ExtractedDoc, type RawPage } from "~/.server/ats/document";
import { PermanentError } from "~/.server/jobs/errors";
import { withTimeout } from "~/.server/timeout";

export const MIN_RESUME_TEXT_LENGTH = 200;
const MAX_PAGES = 10;
const PARSE_TIMEOUT_MS = 30_000;
const THUMBNAIL_WIDTH = 800;

// PDFs that use the standard fonts without embedding them (common in generated PDFs) draw as blank
// unless pdf.js can load its bundled copies.
const STANDARD_FONTS = `${path.join(path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts")}/`;

interface CanvasFactory {
    create(width: number, height: number): {
        canvas: { encode(format: "webp", quality: number): Promise<Buffer> };
        context: CanvasRenderingContext2D;
    };
}

interface PdfTextItem {
    str: string;
    transform: number[];
    width: number;
    hasEOL: boolean;
}

export interface ParsedPdf {
    doc: ExtractedDoc;
    thumbnail: Buffer | null;
}

export async function readPdf(bytes: Buffer, { thumbnail = true, timeoutMs = PARSE_TIMEOUT_MS } = {}): Promise<ParsedPdf> {
    try {
        return await withTimeout(parsePdf(bytes, thumbnail), timeoutMs, "reading the PDF");
    } catch (err) {
        if (/timed out/.test(String(err))) throw new PermanentError("This PDF took too long to read.", "pdf_timeout");
        throw err;
    }
}

async function parsePdf(bytes: Buffer, thumbnail: boolean): Promise<ParsedPdf> {
    let pdf: pdfjs.PDFDocumentProxy;
    try {
        pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: STANDARD_FONTS, verbosity: pdfjs.VerbosityLevel.ERRORS }).promise;
    } catch {
        throw new PermanentError("This PDF is damaged, encrypted or can't be read.", "invalid_pdf");
    }

    try {
        const pages: RawPage[] = [];
        for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n++) {
            pages.push(await readPage(await pdf.getPage(n)));
        }

        const doc = buildDocument(pages);
        if (doc.text.length < MIN_RESUME_TEXT_LENGTH) {
            throw new PermanentError(
                "This PDF has little or no selectable text (it may be a scanned image). ATS software can't read it either. Export a text-based PDF and try again.",
                "no_text_layer"
            );
        }

        return { doc, thumbnail: thumbnail ? await renderThumbnail(pdf).catch(() => null) : null };
    } finally {
        await pdf.destroy();
    }
}

async function readPage(page: pdfjs.PDFPageProxy): Promise<RawPage> {
    const [x0, y0, x1, y1] = page.view;
    const content = await page.getTextContent();

    const runs = content.items
        .filter((item): item is typeof item & PdfTextItem => "str" in item)
        .map((item) => ({
            text: item.str,
            x: item.transform[4] - x0,
            y: item.transform[5] - y0,
            width: item.width,
            fontSize: Math.hypot(item.transform[2], item.transform[3]),
            hasEOL: item.hasEOL,
        }));

    return { width: x1 - x0, height: y1 - y0, runs };
}

async function renderThumbnail(pdf: pdfjs.PDFDocumentProxy): Promise<Buffer> {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / base.width });

    // pdf.js's Node canvas factory is backed by @napi-rs/canvas, but its types don't say so.
    const factory = (pdf as unknown as { canvasFactory: CanvasFactory }).canvasFactory;
    const { canvas, context } = factory.create(viewport.width, viewport.height);
    await page.render({ canvasContext: context, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
    return canvas.encode("webp", 80);
}
