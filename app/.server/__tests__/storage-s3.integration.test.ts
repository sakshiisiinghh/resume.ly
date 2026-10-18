import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it } from "vitest";
import { S3Storage } from "../storage";

const endpoint = process.env.TEST_S3_ENDPOINT;

describe.skipIf(!endpoint)("S3Storage against a real S3-compatible server", () => {
    const real = {
        bucket: process.env.TEST_S3_BUCKET ?? "resumely-test",
        region: "us-east-1",
        endpoint,
        accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? "resumely",
        secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? "resumely-secret",
        forcePathStyle: true,
    };
    const storage = new S3Storage(real);

    beforeEach(async () => {
        const client = new S3Client({ region: real.region, endpoint, forcePathStyle: true, credentials: { accessKeyId: real.accessKeyId, secretAccessKey: real.secretAccessKey } });
        await client.send(new CreateBucketCommand({ Bucket: real.bucket })).catch((err) => {
            if (!/BucketAlready/.test(err.name)) throw err;
        });
    });

    it("round-trips binary data unchanged", async () => {
        const bytes = Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 256));

        await storage.put("users/u1/round-trip.bin", bytes);

        expect((await storage.get("users/u1/round-trip.bin"))?.equals(bytes)).toBe(true);
        await storage.delete("users/u1/round-trip.bin");
    });

    it("replaces an object written twice", async () => {
        await storage.put("users/u1/twice.txt", Buffer.from("first"));
        await storage.put("users/u1/twice.txt", Buffer.from("second"));

        expect((await storage.get("users/u1/twice.txt"))?.toString()).toBe("second");
        await storage.delete("users/u1/twice.txt");
    });

    it("returns null for an object that was never written, and after it is deleted", async () => {
        expect(await storage.get("users/u1/never.txt")).toBeNull();

        await storage.put("users/u1/gone.txt", Buffer.from("x"));
        await storage.delete("users/u1/gone.txt");

        expect(await storage.get("users/u1/gone.txt")).toBeNull();
    });

    it("tolerates deleting something that isn't there", async () => {
        await expect(storage.delete("users/u1/not-there.txt")).resolves.toBeUndefined();
    });
});
