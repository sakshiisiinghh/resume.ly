import { buildDocument, type ExtractedDoc, type RawPage, type RawRun } from "~/.server/ats/document";

export const PAGE = { width: 612, height: 792 };

export function run(text: string, x: number, top: number, { size = 11, hasEOL = true }: { size?: number; hasEOL?: boolean } = {}): RawRun {
    return { text, x, y: PAGE.height - top, width: text.length * size * 0.5, fontSize: size, hasEOL };
}

/** Lines stacked in one column, `step` points apart, starting `start` points from the top. */
export function pageOfLines(lines: string[], { size = 11, step = 15, start = 60, x = 50 } = {}): RawPage {
    return { ...PAGE, runs: lines.map((text, i) => run(text, x, start + i * step, { size })) };
}

export function docFromLines(lines: string[], options?: Parameters<typeof pageOfLines>[1]): ExtractedDoc {
    return buildDocument([pageOfLines(lines, options)]);
}

export function docFromPages(pages: RawPage[]): ExtractedDoc {
    return buildDocument(pages);
}
