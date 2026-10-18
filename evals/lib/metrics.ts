export interface Confusion {
    tp: number;
    fp: number;
    fn: number;
    tn: number;
}

export const emptyConfusion = (): Confusion => ({ tp: 0, fp: 0, fn: 0, tn: 0 });

export function tally(confusion: Confusion, predicted: boolean, expected: boolean) {
    if (predicted && expected) confusion.tp++;
    else if (predicted) confusion.fp++;
    else if (expected) confusion.fn++;
    else confusion.tn++;
}

const ratio = (num: number, den: number) => (den === 0 ? null : Math.round((num / den) * 10000) / 10000);

/** Null when nothing was predicted, so an empty result isn't passed off as perfect. */
export const precision = (c: Confusion) => ratio(c.tp, c.tp + c.fp);

/** Null when there was nothing to find. */
export const recall = (c: Confusion) => ratio(c.tp, c.tp + c.fn);

export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export const mean = (values: number[]) => (values.length === 0 ? 0 : sum(values) / values.length);

/** Sample standard deviation (n - 1). Zero for fewer than two values. */
export function stdev(values: number[]): number {
    if (values.length < 2) return 0;
    const m = mean(values);
    return Math.sqrt(sum(values.map((v) => (v - m) ** 2)) / (values.length - 1));
}

export function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function combinations<T>(items: T[], k: number): T[][] {
    if (k === 0) return [[]];
    if (items.length < k) return [];
    const [head, ...rest] = items;
    return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

export const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
