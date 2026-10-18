import { z } from "zod";

try {
    process.loadEnvFile();
} catch {}

const schema = z.object({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
    GEMINI_BASE_URL: z.string().url().optional(),
    STORAGE_DIR: z.string().default("./storage"),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
    if (cached) return cached;
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
        const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
        throw new Error(`Invalid environment:\n  ${problems}`);
    }
    cached = parsed.data;
    return cached;
}
