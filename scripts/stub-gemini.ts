import http from "node:http";

// A stand-in for the Gemini API, for load tests and local runs that shouldn't spend quota.
// Answers every request with a valid analysis after a configurable delay.

export interface StubOptions {
    port?: number;
    /** Average time to answer. */
    latencyMs?: number;
    /** Random extra delay, up to this much. */
    jitterMs?: number;
    /** Share of requests that get a 503, from 0 to 1. */
    errorRate?: number;
}

const tips = [
    { type: "good", tip: "Clear structure", explanation: "Sections are easy to scan." },
    { type: "improve", tip: "Add more numbers", explanation: "Quantify the impact of each project." },
];

const feedback = {
    overallScore: 78,
    ATS: { score: 82, tips: [{ type: "good", tip: "Standard headings" }, { type: "improve", tip: "Add job keywords" }] },
    toneAndStyle: { score: 75, tips },
    content: { score: 80, tips },
    structure: { score: 85, tips },
    skills: { score: 72, tips },
};

export function startStub({ port = 4010, latencyMs = 3000, jitterMs = 1000, errorRate = 0 }: StubOptions = {}) {
    let requests = 0;

    const server = http.createServer((req, res) => {
        if (req.url === "/stats") return void res.end(JSON.stringify({ requests }));

        req.resume();
        req.on("end", () => {
            requests++;
            setTimeout(() => {
                if (Math.random() < errorRate) {
                    res.writeHead(503, { "Content-Type": "application/json" });
                    return void res.end(JSON.stringify({ error: { code: 503, message: "overloaded", status: "UNAVAILABLE" } }));
                }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(
                    JSON.stringify({
                        candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(feedback) }] }, finishReason: "STOP" }],
                        usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 450, thoughtsTokenCount: 600, totalTokenCount: 2250 },
                    })
                );
            }, latencyMs + Math.random() * jitterMs);
        });
    });

    return new Promise<http.Server>((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.filename === process.argv[1]) {
    const options = {
        port: Number(process.env.STUB_PORT ?? 4010),
        latencyMs: Number(process.env.STUB_LATENCY_MS ?? 3000),
        jitterMs: Number(process.env.STUB_JITTER_MS ?? 1000),
        errorRate: Number(process.env.STUB_ERROR_RATE ?? 0),
    };
    await startStub(options);
    console.log(`stub Gemini on :${options.port}, ${options.latencyMs}ms + up to ${options.jitterMs}ms, ${options.errorRate * 100}% errors`);
}
