import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export default async function setup() {
    try {
        process.loadEnvFile();
    } catch {}

    const url = process.env.TEST_DATABASE_URL;
    if (!url) return;

    const pool = new pg.Pool({ connectionString: url });
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    await pool.end();
}
