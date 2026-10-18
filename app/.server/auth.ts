import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { createCookie, redirect } from "react-router";
import { db } from "~/.server/db";
import { sessions, users, type User } from "~/.server/db/schema";
import { env } from "~/.server/env";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let sessionCookie: ReturnType<typeof createCookie> | undefined;

function cookie() {
    return (sessionCookie ??= createCookie("__session", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: env().NODE_ENV === "production",
        maxAge: SESSION_TTL_MS / 1000,
        secrets: [env().SESSION_SECRET],
    }));
}

// Only the hash is stored, so a leaked sessions table can't be replayed.
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({
        id: hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    return cookie().serialize(token);
}

export async function getUser(request: Request): Promise<User | null> {
    const token = await cookie().parse(request.headers.get("Cookie"));
    if (typeof token !== "string") return null;

    const [row] = await db
        .select({ user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())));

    return row?.user ?? null;
}

export async function requireUser(request: Request): Promise<User> {
    const user = await getUser(request);
    if (user) return user;

    const { pathname, search } = new URL(request.url);
    throw redirect(`/login?next=${encodeURIComponent(pathname + search)}`);
}

export async function destroySession(request: Request): Promise<string> {
    const token = await cookie().parse(request.headers.get("Cookie"));
    if (typeof token === "string") {
        await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
    }
    return cookie().serialize("", { maxAge: 0 });
}

export function assertSameOrigin(request: Request) {
    const origin = request.headers.get("Origin");
    const host = request.headers.get("Host") ?? new URL(request.url).host;
    const crossSite = request.headers.get("Sec-Fetch-Site") === "cross-site";

    if (crossSite || (origin && new URL(origin).host !== host)) {
        throw new Response("Forbidden", { status: 403 });
    }
}
