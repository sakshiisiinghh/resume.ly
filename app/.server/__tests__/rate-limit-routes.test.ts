import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signUp } from "~/.server/accounts";
import { createSession } from "~/.server/auth";
import { MemoryRateLimitStore, setRateLimitStore } from "~/.server/rate-limit";
import { submitResume } from "~/.server/resumes";
import { action as loginAction } from "~/routes/login";
import { action as resumeAction } from "~/routes/resume";
import { action as signupAction } from "~/routes/signup";
import { action as uploadAction } from "~/routes/upload";
import { closeDb, hasTestDb, resetDb } from "../../../test/db";
import { MemoryStorage } from "../../../test/memory-storage";
import { makePdf, resumeLines } from "../../../test/pdf";

afterAll(closeDb);

type Outcome = { status: number; retryAfter?: string | null; redirected: boolean; error?: string };

async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
    const result = (await run()) as { init?: { status?: number; headers?: HeadersInit }; data?: { error?: string }; status?: number; headers?: Headers } | null;
    if (result instanceof Response) return { status: result.status, redirected: result.status >= 300 && result.status < 400 };

    const headers = new Headers(result?.init?.headers);
    return { status: result?.init?.status ?? 200, retryAfter: headers.get("Retry-After"), error: result?.data?.error, redirected: false };
}

const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    return new Request(`http://localhost${path}`, { method: "POST", body, headers: { Host: "localhost", Origin: "http://localhost", ...headers } });
};

const args = (request: Request, ip?: string, params: Record<string, string> = {}) => ({ request, context: { ip }, params }) as never;

const login = (email: string, password: string, ip?: string) => outcome(() => loginAction(args(post("/login", { email, password, next: "/" }), ip)));
const signup = (email: string, ip?: string) => outcome(() => signupAction(args(post("/signup", { email, password: "a-good-password", next: "/" }), ip)));

describe.skipIf(!hasTestDb)("login limits", () => {
    beforeEach(async () => {
        await resetDb();
        setRateLimitStore(new MemoryRateLimitStore());
        await signUp({ email: "victim@example.com", password: "the-right-password" });
    });

    it("locks an address after ten failed sign-ins, and says how long to wait", async () => {
        for (let i = 0; i < 10; i++) expect((await login("victim@example.com", "wrong-password", `10.0.0.${i}`)).status).toBe(401);

        const blocked = await login("victim@example.com", "wrong-password", "10.0.0.99");

        expect(blocked.status).toBe(429);
        expect(Number(blocked.retryAfter)).toBeGreaterThan(0);
        expect(blocked.error).toMatch(/Too many attempts/);
    });

    it("blocks even the right password during the lockout (the price of stopping guessing)", async () => {
        for (let i = 0; i < 10; i++) await login("victim@example.com", "wrong-password", `10.0.0.${i}`);

        expect((await login("victim@example.com", "the-right-password", "10.0.0.99")).status).toBe(429);
    });

    it("doesn't lock other addresses, or other people from the same IP", async () => {
        for (let i = 0; i < 10; i++) await login("victim@example.com", "wrong-password", "10.0.0.1");
        await signUp({ email: "someone@example.com", password: "another-password" });

        expect((await login("someone@example.com", "another-password", "10.0.0.1")).redirected).toBe(true);
    });

    it("doesn't count successful sign-ins against the lockout", async () => {
        for (let i = 0; i < 12; i++) expect((await login("victim@example.com", "the-right-password", `10.0.1.${i}`)).redirected).toBe(true);

        expect((await login("victim@example.com", "wrong-password", "10.0.1.99")).status).toBe(401);
    });

    it("limits one IP to twenty attempts, whoever it tries", async () => {
        for (let i = 0; i < 20; i++) await login(`nobody${i}@example.com`, "guess", "203.0.113.5");

        expect((await login("nobody-new@example.com", "guess", "203.0.113.5")).status).toBe(429);
        expect((await login("nobody-new@example.com", "guess", "203.0.113.6")).status).toBe(401);
    });

    it("still limits by address when the server doesn't know the IP", async () => {
        for (let i = 0; i < 10; i++) await login("victim@example.com", "wrong-password");

        expect((await login("victim@example.com", "wrong-password")).status).toBe(429);
        expect((await login("other@example.com", "wrong-password")).status).toBe(401);
    });

    it("treats the address case-insensitively", async () => {
        for (let i = 0; i < 10; i++) await login(i % 2 ? "VICTIM@example.com" : "victim@Example.com", "wrong-password");

        expect((await login("Victim@EXAMPLE.com", "wrong-password")).status).toBe(429);
    });
});

describe.skipIf(!hasTestDb)("sign-up limits", () => {
    beforeEach(async () => {
        await resetDb();
        setRateLimitStore(new MemoryRateLimitStore());
    });

    it("allows five accounts an hour from one IP", async () => {
        for (let i = 0; i < 5; i++) expect((await signup(`new${i}@example.com`, "198.51.100.7")).redirected).toBe(true);

        const blocked = await signup("new5@example.com", "198.51.100.7");

        expect(blocked).toMatchObject({ status: 429 });
        expect((await signup("new5@example.com", "198.51.100.8")).redirected).toBe(true);
    });
});

describe.skipIf(!hasTestDb)("analysis limits", () => {
    const storage = new MemoryStorage();
    const store = new MemoryRateLimitStore();

    async function userWithLimitUsedUp() {
        await resetDb();
        setRateLimitStore(store);
        const result = await signUp({ email: "u@example.com", password: "a-good-password" });
        if (!result.ok) throw new Error(result.error);

        const cookie = (await createSession(result.user.id)).split(";")[0];
        for (let i = 0; i < 10; i++) await store.hit(`rl:analysis:${result.user.id}`, { name: "analysis", limit: 10, windowMs: 3_600_000 }, Date.now());
        return { user: result.user, cookie };
    }

    it("refuses an upload once ten analyses were started in the hour, without reading the file", async () => {
        const { cookie } = await userWithLimitUsedUp();
        const body = new FormData();
        body.set("resume", new File([new Uint8Array(makePdf(resumeLines))], "r.pdf", { type: "application/pdf" }));

        const result = await outcome(() => uploadAction(args(new Request("http://localhost/upload", { method: "POST", body, headers: { Host: "localhost", Origin: "http://localhost", Cookie: cookie } }))));

        expect(result).toMatchObject({ status: 429 });
        expect(result.error).toMatch(/Too many attempts/);
    });

    it("refuses a retry the same way, but still allows deleting", async () => {
        const { user, cookie } = await userWithLimitUsedUp();
        const { resumeId } = await submitResume(
            { userId: user.id, fileName: "r.pdf", bytes: makePdf(resumeLines), companyName: "", jobTitle: "", jobDescription: "" },
            { storage, enqueue: vi.fn().mockResolvedValue(undefined), publish: vi.fn(), model: "m" }
        );
        const resumeRequest = (intent: string) => post(`/resume/${resumeId}`, { intent }, { Cookie: cookie });

        const retry = await outcome(() => resumeAction(args(resumeRequest("retry"), undefined, { id: resumeId })));
        const remove = await outcome(() => resumeAction(args(resumeRequest("delete"), undefined, { id: resumeId })));

        expect(retry.status).toBe(429);
        expect(remove.redirected).toBe(true);
    });
});
