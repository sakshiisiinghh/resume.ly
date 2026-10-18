import { loadPdfJs } from "~/lib/pdf2img";

export interface PdfTextItem {
    str?: string;
    hasEOL?: boolean;
}

export function textFromItems(items: PdfTextItem[]): string {
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

export const MIN_RESUME_TEXT_LENGTH = 200;

export type PdfTextResult =
    | { ok: true; text: string; pageCount: number }
    | { ok: false; error: string };

export async function extractPdfText(file: File): Promise<PdfTextResult> {
    try {
        const lib = await loadPdfJs();
        const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;

        const pages: string[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
            const page = await pdf.getPage(n);
            const content = await page.getTextContent();
            pages.push(textFromItems(content.items));
        }

        const text = pages.join("\n\n").trim();
        if (text.length < MIN_RESUME_TEXT_LENGTH) {
            return {
                ok: false,
                error: "This PDF has little or no selectable text (it may be a scanned image). ATS software can't read it either. Export a text-based PDF and try again.",
            };
        }
        return { ok: true, text, pageCount: pdf.numPages };
    } catch (err) {
        return { ok: false, error: `Failed to read PDF text: ${err instanceof Error ? err.message : String(err)}` };
    }
}
