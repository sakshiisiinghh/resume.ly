import { defineConfig } from "drizzle-kit";

try {
    process.loadEnvFile();
} catch {}

export default defineConfig({
    dialect: "postgresql",
    schema: "./app/.server/db/schema.ts",
    out: "./drizzle",
    dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
