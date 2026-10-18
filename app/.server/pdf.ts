import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PermanentError } from "~/.server/jobs/errors";

export const MIN_RESUME_TEXT_LENGTH = 200;
const MAX_PAGES = 10;
const MAX_TEXT_CHARS = 20_000;
const THUMBNAIL_WIDTH = 800;

export interface TextItem {
    str?: string;
    hasEOL?: boolean;
}

export function textFromItems(items: TextItem[]): string {
    let text = "";
    for (const item of items) {
        if (typeof item.str !== "string") continue;
        text += item.str;
        if (item.hasEOL) text += "\n";
    }
    return text
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
}

interface CanvasFactory {
    create(width: number, height: number): {
        canvas: { encode(format: "webp", quality: number): Promise<Buffer> };
        context: CanvasRenderingContext2D;
    };
}

export interface ParsedPdf {
    text: string;
    pageCount: number;
    thumbnail: Buffer | null;
}

export async function readPdf(bytes: Buffer): Promise<ParsedPdf> {
    let doc: pdfjs.PDFDocumentProxy;
    try {
        doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: pdfjs.VerbosityLevel.ERRORS }).promise;
    } catch {
        throw new PermanentError("This PDF is damaged, encrypted or can't be read.", "invalid_pdf");
    }

    try {
        const pages: string[] = [];
        for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
            const page = await doc.getPage(n);
            pages.push(textFromItems((await page.getTextContent()).items as TextItem[]));
        }

        const text = pages.join("\n\n").trim();
        if (text.length < MIN_RESUME_TEXT_LENGTH) {
            throw new PermanentError(
                "This PDF has little or no selectable text (it may be a scanned image). ATS software can't read it either. Export a text-based PDF and try again.",
                "no_text_layer"
            );
        }

        return {
            text: text.slice(0, MAX_TEXT_CHARS),
            pageCount: doc.numPages,
            thumbnail: await renderThumbnail(doc).catch(() => null),
        };
    } finally {
        await doc.destroy();
    }
}

async function renderThumbnail(doc: pdfjs.PDFDocumentProxy): Promise<Buffer> {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / base.width });

    // pdf.js's Node canvas factory is backed by @napi-rs/canvas, but its types don't say so.
    const factory = (doc as unknown as { canvasFactory: CanvasFactory }).canvasFactory;
    const { canvas, context } = factory.create(viewport.width, viewport.height);
    await page.render({ canvasContext: context, viewport, canvas } as Parameters<typeof page.render>[0]).promise;
    return canvas.encode("webp", 80);
}
