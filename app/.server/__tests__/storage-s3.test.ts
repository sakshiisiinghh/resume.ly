import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { parseEnv } from "../env";
import { LocalStorage, S3Storage, assertSafeKey, createStorage } from "../storage";

const config = { bucket: "b", region: "auto", accessKeyId: "id", secretAccessKey: "secret" };
const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", REDIS_URL: "redis://localhost:6379", SESSION_SECRET: "x".repeat(32) };

describe("S3Storage", () => {
    const s3 = mockClient(S3Client);
    beforeEach(() => s3.reset());

    it("writes the bytes under the key in the configured bucket", async () => {
        s3.on(PutObjectCommand).resolves({});

        await new S3Storage(config).put("users/u1/a.pdf", Buffer.from("hello"));

        expect(s3.commandCalls(PutObjectCommand)[0].args[0].input).toEqual({ Bucket: "b", Key: "users/u1/a.pdf", Body: Buffer.from("hello") });
    });

    it("reads the bytes back", async () => {
        s3.on(GetObjectCommand).resolves({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } as never });

        expect(await new S3Storage(config).get("a.pdf")).toEqual(Buffer.from([1, 2, 3]));
    });

    it("returns null for a missing object, whichever way the service says so", async () => {
        const storage = new S3Storage(config);

        s3.on(GetObjectCommand).rejects(Object.assign(new Error("gone"), { name: "NoSuchKey" }));
        expect(await storage.get("a.pdf")).toBeNull();

        s3.on(GetObjectCommand).rejects(Object.assign(new Error("gone"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }));
        expect(await storage.get("a.pdf")).toBeNull();
    });

    it("lets real failures through, instead of treating them as a missing file", async () => {
        s3.on(GetObjectCommand).rejects(Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }));

        await expect(new S3Storage(config).get("a.pdf")).rejects.toThrow("denied");
    });

    it("deletes by key", async () => {
        s3.on(DeleteObjectCommand).resolves({});

        await new S3Storage(config).delete("a.pdf");

        expect(s3.commandCalls(DeleteObjectCommand)[0].args[0].input).toEqual({ Bucket: "b", Key: "a.pdf" });
    });

    it.each(["../escape", "/abs", "a/../b", "a\\b", "", "./x"])("refuses the key %j before calling S3", async (key) => {
        const storage = new S3Storage(config);

        await expect(storage.put(key, Buffer.from("x"))).rejects.toThrow(/Invalid storage key/);
        await expect(storage.get(key)).rejects.toThrow(/Invalid storage key/);
        await expect(storage.delete(key)).rejects.toThrow(/Invalid storage key/);
        expect(s3.calls()).toHaveLength(0);
    });
});

describe("assertSafeKey", () => {
    it("allows the keys the app generates", () => {
        expect(() => assertSafeKey("users/0f8f/6a1b.pdf")).not.toThrow();
        expect(() => assertSafeKey("users/0f8f/6a1b.webp")).not.toThrow();
    });
});

describe("createStorage", () => {
    const parsed = (extra: Record<string, string>) => parseEnv({ ...base, ...extra });

    it("uses local disk unless a bucket is configured", () => {
        expect(createStorage(parsed({}))).toBeInstanceOf(LocalStorage);
        expect(createStorage(parsed({ S3_BUCKET: "" }))).toBeInstanceOf(LocalStorage);
    });

    it("uses S3 when a bucket and credentials are configured", () => {
        const storage = createStorage(parsed({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "secret" }));

        expect(storage).toBeInstanceOf(S3Storage);
    });

    it("refuses a bucket without credentials, at startup rather than on the first upload", () => {
        expect(() => parsed({ S3_BUCKET: "b" })).toThrow(/S3_ACCESS_KEY_ID/);
    });

    it("treats empty values, as docker compose passes them, as unset", () => {
        const env = parsed({ S3_BUCKET: "", S3_ENDPOINT: "", S3_ACCESS_KEY_ID: "", S3_FORCE_PATH_STYLE: "" });

        expect(env).toMatchObject({ S3_BUCKET: undefined, S3_ENDPOINT: undefined, S3_FORCE_PATH_STYLE: false, S3_REGION: "auto" });
    });

    it("reads the path-style flag", () => {
        expect(parsed({ S3_FORCE_PATH_STYLE: "true" }).S3_FORCE_PATH_STYLE).toBe(true);
    });
});
