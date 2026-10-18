import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "~/.server/env";

export interface StorageDriver {
    put(key: string, data: Buffer): Promise<void>;
    get(key: string): Promise<Buffer | null>;
    delete(key: string): Promise<void>;
}

export class LocalStorage implements StorageDriver {
    private root: string;

    constructor(root: string) {
        this.root = path.resolve(root);
    }

    private resolve(key: string) {
        const full = path.resolve(this.root, key);
        if (!full.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${key}`);
        return full;
    }

    async put(key: string, data: Buffer) {
        const file = this.resolve(key);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, data);
    }

    async get(key: string) {
        try {
            return await readFile(this.resolve(key));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw err;
        }
    }

    async delete(key: string) {
        await rm(this.resolve(key), { force: true });
    }
}

let storage: StorageDriver | undefined;

export function getStorage(): StorageDriver {
    return (storage ??= new LocalStorage(env().STORAGE_DIR));
}
