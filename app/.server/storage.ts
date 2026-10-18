import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env, type Env } from "~/.server/env";

export interface StorageDriver {
    put(key: string, data: Buffer): Promise<void>;
    get(key: string): Promise<Buffer | null>;
    delete(key: string): Promise<void>;
}

export function assertSafeKey(key: string) {
    if (!key || key.startsWith("/") || key.includes("\\") || key.split("/").some((part) => part === ".." || part === ".")) {
        throw new Error(`Invalid storage key: ${key}`);
    }
}

export class LocalStorage implements StorageDriver {
    private root: string;

    constructor(root: string) {
        this.root = path.resolve(root);
    }

    private resolve(key: string) {
        assertSafeKey(key);
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

export interface S3Config {
    bucket: string;
    region: string;
    endpoint?: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle?: boolean;
}

export class S3Storage implements StorageDriver {
    private client: S3Client;

    constructor(private config: S3Config) {
        this.client = new S3Client({
            region: config.region,
            endpoint: config.endpoint,
            forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
            credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        });
    }

    async put(key: string, data: Buffer) {
        assertSafeKey(key);
        await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: data }));
    }

    async get(key: string) {
        assertSafeKey(key);
        try {
            const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
            return Buffer.from((await response.Body?.transformToByteArray()) ?? []);
        } catch (err) {
            const { name, $metadata } = err as { name?: string; $metadata?: { httpStatusCode?: number } };
            if (name === "NoSuchKey" || $metadata?.httpStatusCode === 404) return null;
            throw err;
        }
    }

    async delete(key: string) {
        assertSafeKey(key);
        await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
    }
}

export function createStorage(config: Pick<Env, "STORAGE_DIR" | "S3_BUCKET" | "S3_REGION" | "S3_ENDPOINT" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY" | "S3_FORCE_PATH_STYLE">): StorageDriver {
    if (!config.S3_BUCKET) return new LocalStorage(config.STORAGE_DIR);

    return new S3Storage({
        bucket: config.S3_BUCKET,
        region: config.S3_REGION,
        endpoint: config.S3_ENDPOINT,
        accessKeyId: config.S3_ACCESS_KEY_ID!,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
        forcePathStyle: config.S3_FORCE_PATH_STYLE || undefined,
    });
}

let storage: StorageDriver | undefined;

export function getStorage(): StorageDriver {
    return (storage ??= createStorage(env()));
}
