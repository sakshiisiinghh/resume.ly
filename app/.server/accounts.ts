import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "~/.server/db";
import { isUniqueViolation } from "~/.server/db/errors";
import { users, type User } from "~/.server/db/schema";

export const credentialsSchema = z.object({
    email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
    password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

export type AuthResult = { ok: true; user: User } | { ok: false; error: string };

export async function signUp(input: unknown): Promise<AuthResult> {
    const parsed = credentialsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

    const { email, password } = parsed.data;
    try {
        const [user] = await db.insert(users).values({ email, passwordHash: await hash(password) }).returning();
        return { ok: true, user };
    } catch (err) {
        if (isUniqueViolation(err)) {
            return { ok: false, error: "An account with this email already exists" };
        }
        throw err;
    }
}

let dummyHash: Promise<string> | undefined;

export async function authenticate(input: unknown): Promise<AuthResult> {
    const parsed = credentialsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid email or password" };

    const { email, password } = parsed.data;
    const [user] = await db.select().from(users).where(eq(users.email, email));

    // Verify against a dummy hash when the user is unknown so timing doesn't reveal which emails exist.
    const valid = await verify(user?.passwordHash ?? (await (dummyHash ??= hash("not-a-real-password"))), password);
    if (!user || !valid) return { ok: false, error: "Invalid email or password" };

    return { ok: true, user };
}
