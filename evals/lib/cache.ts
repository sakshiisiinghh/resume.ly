import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RunRecord } from "./llm";

export interface RunStore {
    get(key: string): RunRecord | undefined;
    set(key: string, record: RunRecord): void;
}

/** Identifies one call by everything that could change its answer. */
export const runKey = (parts: { model: string; system: string; user: string; run: number }) =>
    createHash("sha256").update(JSON.stringify(parts)).digest("hex");

/** Keeps valid runs on disk, so a run cut short by a quota can be finished later. */
export class FileRunStore implements RunStore {
    private records: Record<string, RunRecord>;

    constructor(private file: string) {
        this.records = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    }

    get size() {
        return Object.keys(this.records).length;
    }

    get(key: string) {
        return this.records[key];
    }

    set(key: string, record: RunRecord) {
        this.records[key] = record;
        mkdirSync(path.dirname(this.file), { recursive: true });
        writeFileSync(`${this.file}.tmp`, JSON.stringify(this.records));
        renameSync(`${this.file}.tmp`, this.file);
    }
}
