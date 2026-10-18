import { z } from "zod";
import { DEFAULT_GEMINI_MODEL } from "../../constants";

try {
    process.loadEnvFile();
} catch {}

// Compose and some hosts pass unset variables as empty strings.
const optional = <T extends z.ZodTypeAny>(inner: T) => z.preprocess((v) => (v === "" ? undefined : v), inner.optional());

const schema = z
    .object({
        DATABASE_URL: z.string().url(),
        REDIS_URL: z.string().url(),
        SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
        GEMINI_API_KEY: z.string().optional(),
        GEMINI_MODEL: z.string().default(DEFAULT_GEMINI_MODEL),
        GEMINI_BASE_URL: z.string().url().optional(),
        STORAGE_DIR: z.string().default("./storage"),
        WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
        // Jobs started per minute. Free Gemini keys allow 5 requests a minute per model.
        LLM_REQUESTS_PER_MINUTE: optional(z.coerce.number().int().min(1)),
        // Set S3_BUCKET to store files in S3, Cloudflare R2 or MinIO instead of on local disk.
        S3_BUCKET: optional(z.string().min(1)),
        S3_REGION: z.string().default("auto"),
        S3_ENDPOINT: optional(z.string().url()),
        S3_ACCESS_KEY_ID: optional(z.string().min(1)),
        S3_SECRET_ACCESS_KEY: optional(z.string().min(1)),
        S3_FORCE_PATH_STYLE: z.preprocess((v) => v === "true" || v === true, z.boolean()),
        RATE_LIMIT_ENABLED: z.preprocess((v) => v !== "false" && v !== false, z.boolean()),
        // Scales every limit; for load tests and unusually busy deployments.
        RATE_LIMIT_MULTIPLIER: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().positive().default(1)),
        LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
        // Optional. Without it nothing is sent anywhere.
        SENTRY_DSN: optional(z.string().url()),
        NODE_ENV: z.string().default("development"),
    })
    .superRefine((value, ctx) => {
        if (value.S3_BUCKET && (!value.S3_ACCESS_KEY_ID || !value.S3_SECRET_ACCESS_KEY)) {
            ctx.addIssue({ code: "custom", path: ["S3_ACCESS_KEY_ID"], message: "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when S3_BUCKET is set" });
        }
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
