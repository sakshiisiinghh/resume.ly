import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authenticate, signUp } from "~/.server/accounts";
import { assertSameOrigin, createSession, destroySession, getUser, requireUser } from "~/.server/auth";
import { db } from "~/.server/db";
import { sessions, users } from "~/.server/db/schema";
import { closeDb, hasTestDb, resetDb } from "../../../test/db";

afterAll(closeDb);

const withCookie = (setCookie: string) =>
    new Request("http://localhost/resume/1", { headers: { Cookie: setCookie.split(";")[0] } });

describe.skipIf(!hasTestDb)("accounts", () => {
    beforeEach(resetDb);

    it("stores an argon2 hash, never the password", async () => {
        const result = await signUp({ email: "Sakshi@Example.com ", password: "correct horse battery" });

        expect(result.ok).toBe(true);
        const [row] = await db.select().from(users);
        expect(row.email).toBe("sakshi@example.com");
        expect(row.passwordHash).toMatch(/^\$argon2id\$/);
        expect(row.passwordHash).not.toContain("correct horse");
    });

    it("rejects a duplicate email regardless of case", async () => {
        await signUp({ email: "a@example.com", password: "password123" });
        const again = await signUp({ email: "A@EXAMPLE.COM", password: "password123" });

        expect(again).toEqual({ ok: false, error: "An account with this email already exists" });
    });

    it.each([
        [{ email: "nope", password: "password123" }, /valid email/],
        [{ email: "a@example.com", password: "short" }, /at least 8/],
    ])("validates credentials %#", async (input, message) => {
        const result = await signUp(input);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatch(message);
    });

    it("logs in with the right password only, with one error for every failure", async () => {
        await signUp({ email: "a@example.com", password: "password123" });

        expect((await authenticate({ email: "A@example.com", password: "password123" })).ok).toBe(true);
        const wrongPassword = await authenticate({ email: "a@example.com", password: "wrong-password" });
        const unknownUser = await authenticate({ email: "ghost@example.com", password: "password123" });

        expect(wrongPassword).toEqual({ ok: false, error: "Invalid email or password" });
        expect(unknownUser).toEqual(wrongPassword);
    });
});

describe.skipIf(!hasTestDb)("sessions", () => {
    beforeEach(resetDb);

    async function newUser() {
        const result = await signUp({ email: "a@example.com", password: "password123" });
        if (!result.ok) throw new Error(result.error);
        return result.user;
    }

    it("issues an HttpOnly SameSite cookie and stores only a hash of the token", async () => {
        const user = await newUser();
        const setCookie = await createSession(user.id);

        expect(setCookie).toMatch(/HttpOnly/i);
        expect(setCookie).toMatch(/SameSite=Lax/i);
        const [row] = await db.select().from(sessions);
        expect(row.id).toMatch(/^[0-9a-f]{64}$/);
        expect(setCookie).not.toContain(row.id);
    });

    it("resolves the user from the cookie", async () => {
        const user = await newUser();
        const request = withCookie(await createSession(user.id));

        expect((await getUser(request))?.id).toBe(user.id);
    });

    it("rejects missing, tampered and expired sessions", async () => {
        const user = await newUser();
        const setCookie = await createSession(user.id);

        expect(await getUser(new Request("http://localhost/"))).toBeNull();
        expect(await getUser(withCookie(setCookie.replace(/=[^;]+/, "=tampered")))).toBeNull();

        await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
        expect(await getUser(withCookie(setCookie))).toBeNull();
    });

    it("requireUser redirects to login and remembers where the user was going", async () => {
        const request = new Request("http://localhost/resume/abc?tab=1");

        const thrown = await requireUser(request).catch((r: Response) => r);

        expect(thrown).toBeInstanceOf(Response);
        expect((thrown as Response).status).toBe(302);
        expect((thrown as Response).headers.get("Location")).toBe("/login?next=%2Fresume%2Fabc%3Ftab%3D1");
    });

    it("logging out invalidates the session server-side", async () => {
        const user = await newUser();
        const request = withCookie(await createSession(user.id));

        await destroySession(request);

        expect(await getUser(request)).toBeNull();
        expect(await db.select().from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0);
    });
});

describe("assertSameOrigin", () => {
    const post = (headers: Record<string, string>) => new Request("http://app.test/upload", { method: "POST", headers: { Host: "app.test", ...headers } });

    it("allows same-origin and header-less requests", () => {
        expect(() => assertSameOrigin(post({ Origin: "http://app.test" }))).not.toThrow();
        expect(() => assertSameOrigin(post({}))).not.toThrow();
    });

    it("blocks a foreign Origin or a cross-site fetch", () => {
        expect(() => assertSameOrigin(post({ Origin: "http://evil.test" }))).toThrow();
        expect(() => assertSameOrigin(post({ "Sec-Fetch-Site": "cross-site" }))).toThrow();
    });
});
