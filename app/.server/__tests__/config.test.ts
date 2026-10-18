import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_GEMINI_MODEL } from "../../../constants";
import { env, parseEnv } from "../env";

describe("default Gemini model", () => {
    it("is the same in the code, the compose file and the env template", () => {
        expect(readFileSync("docker-compose.yml", "utf8")).toContain(`GEMINI_MODEL:-${DEFAULT_GEMINI_MODEL}`);
        expect(readFileSync(".env.example", "utf8")).toContain(`GEMINI_MODEL=${DEFAULT_GEMINI_MODEL}`);
    });

    it("is used when GEMINI_MODEL isn't set", () => {
        const saved = process.env.GEMINI_MODEL;
        delete process.env.GEMINI_MODEL;
        try {
            expect(env().GEMINI_MODEL).toBe(DEFAULT_GEMINI_MODEL);
        } finally {
            if (saved !== undefined) process.env.GEMINI_MODEL = saved;
        }
    });
});

describe("LLM_REQUESTS_PER_MINUTE", () => {
    const base = { DATABASE_URL: "postgres://u:p@localhost:5432/db", REDIS_URL: "redis://localhost:6379", SESSION_SECRET: "x".repeat(32) };

    it("is optional", () => {
        expect(parseEnv(base).LLM_REQUESTS_PER_MINUTE).toBeUndefined();
    });

    it("treats an empty value, as docker compose passes it, as unset", () => {
        expect(parseEnv({ ...base, LLM_REQUESTS_PER_MINUTE: "" }).LLM_REQUESTS_PER_MINUTE).toBeUndefined();
    });

    it("reads a number", () => {
        expect(parseEnv({ ...base, LLM_REQUESTS_PER_MINUTE: "4" }).LLM_REQUESTS_PER_MINUTE).toBe(4);
    });

    it("rejects zero and junk", () => {
        expect(() => parseEnv({ ...base, LLM_REQUESTS_PER_MINUTE: "0" })).toThrow(/LLM_REQUESTS_PER_MINUTE/);
        expect(() => parseEnv({ ...base, LLM_REQUESTS_PER_MINUTE: "fast" })).toThrow(/LLM_REQUESTS_PER_MINUTE/);
    });
});
