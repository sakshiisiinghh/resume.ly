import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "~/.server/db";
import { users } from "~/.server/db/schema";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

export async function resetDb() {
    const name = new URL(process.env.DATABASE_URL!).pathname;
    if (!name.includes("test")) throw new Error(`Refusing to reset non-test database ${name}`);
    await db.execute(sql`TRUNCATE users, sessions, resumes, analyses RESTART IDENTITY CASCADE`);
}

export async function createUser(email = `user-${randomUUID()}@test.dev`) {
    const [user] = await db.insert(users).values({ email, passwordHash: "not-a-real-hash" }).returning();
    return user;
}

export const closeDb = () => pool.end();
