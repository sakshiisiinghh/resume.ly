import { z } from "zod";
import { DEFAULT_GEMINI_MODEL } from "../../constants";

try {
    process.loadEnvFile();
} catch {}

const schema = z.object({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default(DEFAULT_GEMINI_MODEL),
    GEMINI_BASE_URL: z.string().url().optional(),
    STORAGE_DIR: z.string().default("./storage"),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    // Jobs started per minute. Free Gemini keys allow 5 requests a minute per model.
    LLM_REQUESTS_PER_MINUTE: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).optional()),
    NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
    const parsed = schema.safeParse(source);
    if (!parsed.success) {
        const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
        throw new Error(`Invalid environment:\n  ${problems}`);
    }
    return parsed.data;
}

let cached: Env | undefined;

export function env(): Env {
    return (cached ??= parseEnv(process.env));
}
