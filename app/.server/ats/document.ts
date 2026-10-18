export interface RawRun {
    text: string;
    x: number;
    y: number;
    width: number;
    fontSize: number;
    hasEOL: boolean;
}

export interface RawPage {
    width: number;
    height: number;
    runs: RawRun[];
}

export type HiddenReason = "tiny";

export interface Run extends RawRun {
    page: number;
    top: number;
    hidden: HiddenReason | null;
}

export interface Line {
    page: number;
    top: number;
    x: number;
    fontSize: number;
    text: string;
}

export interface ExtractedDoc {
    pageCount: number;
    pageHeights: number[];
    hidden: Run[];
    lines: Line[];
    text: string;
    medianFontSize: number;
    columnPages: number[];
    readingOrderBreaks: number;
}

export const MIN_VISIBLE_FONT_SIZE = 4;

const COLUMN_GAP_RATIO = 0.08;
const MIN_LINES_FOR_COLUMNS = 8;
const COLUMN_SIDE_SHARE = 0.25;
const BINS = 100;

const isBlank = (text: string) => text.trim() === "";

// pdf.js drops text outside the page box before we see it, so tiny text is the only hiding we can detect.
function hiddenReason(run: RawRun): HiddenReason | null {
    return !isBlank(run.text) && run.fontSize < MIN_VISIBLE_FONT_SIZE ? "tiny" : null;
}

export function textFromRuns(runs: Pick<RawRun, "text" | "hasEOL">[]): string {
    let text = "";
    for (const run of runs) {
        text += run.text;
        if (run.hasEOL) text += "\n";
    }
    return text
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n");
}

function buildLines(runs: Run[], pageNumber: number): Line[] {
    const sorted = runs
        .filter((r) => r.page === pageNumber)
        .sort((a, b) => a.top - b.top || a.x - b.x);

    const groups: Run[][] = [];
    for (const run of sorted) {
        const group = groups.at(-1);
        const tolerance = Math.max(run.fontSize, 1) * 0.5;
        if (group && Math.abs(group[0].top - run.top) <= tolerance) group.push(run);
        else groups.push([run]);
    }

    return groups
        .map((group) => {
            const ordered = [...group].sort((a, b) => a.x - b.x);
            let text = "";
            let end = Number.NEGATIVE_INFINITY;
            for (const run of ordered) {
                const needsSpace = run.x - end > run.fontSize * 0.25 && text !== "" && !/\s$/.test(text) && !/^\s/.test(run.text);
                text += (needsSpace ? " " : "") + run.text;
                end = run.x + run.width;
            }
            return {
                page: pageNumber,
                top: group[0].top,
                x: Math.min(...ordered.map((r) => r.x)),
                fontSize: Math.max(...ordered.map((r) => r.fontSize)),
                text: text.replace(/\s+/g, " ").trim(),
            };
        })
        .filter((line) => line.text !== "");
}

interface Segment {
    start: number;
    end: number;
    chars: number;
}

// A text column shows up as a vertical band that almost no line crosses,
// with a meaningful share of the text on each side of it.
function findGutter(runs: Run[], page: RawPage): number | null {
    const lines = new Map<number, Run[]>();
    for (const run of runs.filter((r) => !isBlank(r.text))) {
        const key = Math.round(run.top / Math.max(run.fontSize, 1));
        lines.set(key, [...(lines.get(key) ?? []), run]);
    }
    if (lines.size < MIN_LINES_FOR_COLUMNS) return null;

    const segments: Segment[] = [];
    for (const lineRuns of lines.values()) {
        const ordered = [...lineRuns].sort((a, b) => a.x - b.x);
        let current: Segment | null = null;
        for (const run of ordered) {
            const end = run.x + run.width;
            if (current && run.x - current.end <= page.width * COLUMN_GAP_RATIO) {
                current.end = Math.max(current.end, end);
                current.chars += run.text.length;
            } else {
                if (current) segments.push(current);
                current = { start: run.x, end, chars: run.text.length };
            }
        }
        if (current) segments.push(current);
    }

    const coverage = new Array<number>(BINS).fill(0);
    for (const { start, end } of segments) {
        const from = Math.max(0, Math.floor((start / page.width) * BINS));
        const to = Math.min(BINS - 1, Math.floor((end / page.width) * BINS));
        for (let bin = from; bin <= to; bin++) coverage[bin]++;
    }

    const limit = Math.max(1, lines.size * 0.05);
    const totalChars = segments.reduce((sum, s) => sum + s.chars, 0);

    let bin = Math.floor(BINS * 0.2);
    while (bin <= Math.floor(BINS * 0.8)) {
        if (coverage[bin] > limit) {
            bin++;
            continue;
        }
        let end = bin;
        while (end + 1 <= Math.floor(BINS * 0.8) && coverage[end + 1] <= limit) end++;

        if (end - bin + 1 >= 3) {
            const gutterX = (((bin + end + 1) / 2) / BINS) * page.width;
            const left = segments.filter((s) => (s.start + s.end) / 2 < gutterX).reduce((sum, s) => sum + s.chars, 0);
            const right = totalChars - left;
            if (left >= totalChars * COLUMN_SIDE_SHARE && right >= totalChars * COLUMN_SIDE_SHARE) return gutterX;
        }
        bin = end + 1;
    }
    return null;
}

function countReadingOrderBreaks(runs: Run[], gutterX: number | null): number {
    let breaks = 0;
    let previous: Run | null = null;
    for (const run of runs) {
        if (isBlank(run.text)) continue;
        if (previous && previous.page === run.page) {
            if (previous.top - run.top > run.fontSize * 2) breaks++;
            if (gutterX !== null && previous.x < gutterX !== run.x < gutterX) breaks++;
        }
        previous = run;
    }
    return breaks;
}

function weightedMedian(samples: { value: number; weight: number }[]): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a.value - b.value);
    const half = sorted.reduce((sum, s) => sum + s.weight, 0) / 2;
    let seen = 0;
    for (const sample of sorted) {
        seen += sample.weight;
        if (seen >= half) return sample.value;
    }
    return sorted.at(-1)!.value;
}

export function buildDocument(pages: RawPage[]): ExtractedDoc {
    const runs: Run[] = pages.flatMap((page, index) =>
        page.runs.map((run) => ({
            ...run,
            page: index + 1,
            top: page.height - run.y,
            hidden: hiddenReason(run),
        }))
    );
    const visible = runs.filter((r) => r.hidden === null);

    const columnPages: number[] = [];
    const gutters = new Map<number, number>();
    let readingOrderBreaks = 0;
    pages.forEach((page, index) => {
        const pageRuns = visible.filter((r) => r.page === index + 1);
        const gutter = findGutter(pageRuns, page);
        if (gutter !== null) {
            columnPages.push(index + 1);
            gutters.set(index + 1, gutter);
        }
        readingOrderBreaks += countReadingOrderBreaks(pageRuns, gutter);
    });

    return {
        pageCount: pages.length,
        pageHeights: pages.map((p) => p.height),
        hidden: runs.filter((r) => r.hidden !== null),
        lines: pages.flatMap((_, index) => buildLines(visible, index + 1)),
        text: textFromRuns(visible),
        medianFontSize: weightedMedian(
            visible.filter((r) => !isBlank(r.text)).map((r) => ({ value: r.fontSize, weight: r.text.trim().length }))
        ),
        columnPages,
        readingOrderBreaks,
    };
}
