import type { StorageDriver } from "~/.server/storage";

export class MemoryStorage implements StorageDriver {
    files = new Map<string, Buffer>();

    async put(key: string, data: Buffer) {
        this.files.set(key, data);
    }

    async get(key: string) {
        return this.files.get(key) ?? null;
    }

    async delete(key: string) {
        this.files.delete(key);
    }
}
