import os from "node:os";
import path from "node:path";

try {
    process.loadEnvFile();
} catch {}

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_URL ??= "postgres://resumely:resumely@localhost:5442/resumely_test";
process.env.REDIS_URL ??= "redis://localhost:6389";
process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-chars";
process.env.STORAGE_DIR = path.join(os.tmpdir(), "resumely-test-storage");
