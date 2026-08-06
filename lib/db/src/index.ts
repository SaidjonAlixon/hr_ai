import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const connectionString = process.env.DATABASE_URL;
const isLocal =
  /localhost|127\.0\.0\.1/i.test(connectionString) ||
  connectionString.includes("sslmode=disable");

export const pool = new Pool({
  connectionString,
  // Hosted Postgres (Neon, Supabase, Vercel Postgres) usually needs TLS
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  // Serverless: keep pool small
  max: process.env.VERCEL ? 1 : 10,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
