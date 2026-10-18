import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { GeminiProvider } from "~/.server/llm/gemini";
import { parseFeedback } from "~/lib/schemas";
import { startStub } from "../stub-gemini";

let server: Awaited<ReturnType<typeof startStub>> | undefined;
afterEach(() => new Promise((resolve) => (server ? server.close(resolve) : resolve(null))));

const start = async (options = {}) => {
    server = await startStub({ port: 0, latencyMs: 0, jitterMs: 0, ...options });
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

describe("stub Gemini", () => {
    it("answers the real provider with a valid analysis and token counts, so it can't drift from what we parse", async () => {
        const provider = new GeminiProvider("stub-model", "stub-key", await start());

        const result = await provider.generate({ system: "s", user: "u" });

        expect(parseFeedback(result.text).ok).toBe(true);
        expect(result).toMatchObject({ tokensIn: 1200, tokensOut: 1050 });
    });

    it("can fail some requests with a retryable error", async () => {
        const provider = new GeminiProvider("stub-model", "stub-key", await start({ errorRate: 1 }));

        await expect(provider.generate({ system: "s", user: "u" })).rejects.toMatchObject({ code: "llm_unavailable" });
    });

    it("takes about as long as it was told to", async () => {
        const provider = new GeminiProvider("stub-model", "stub-key", await start({ latencyMs: 120 }));
        const started = Date.now();

        await provider.generate({ system: "s", user: "u" });

        expect(Date.now() - started).toBeGreaterThanOrEqual(110);
    });

    it("counts the requests it has served", async () => {
        const url = await start();
        const provider = new GeminiProvider("stub-model", "stub-key", url);
        await provider.generate({ system: "s", user: "u" });
        await provider.generate({ system: "s", user: "u" });

        expect(await (await fetch(`${url}/stats`)).json()).toEqual({ requests: 2 });
    });
});
