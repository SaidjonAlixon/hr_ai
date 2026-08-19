import { drizzle } from "drizzle-orm/node-postgres";
import dns from "node:dns";
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

/** Router DNS sometimes cannot resolve Railway proxy hosts; Google/Cloudflare can. */
const publicResolver = new dns.Resolver();
publicResolver.setServers(["8.8.8.8", "1.1.1.1"]);

function lookupWithDnsFallback(
  hostname: string,
  options: dns.LookupOneOptions | number | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void),
  callback?: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
) {
  const cb =
    typeof options === "function" ? options : callback;
  const opts = typeof options === "object" ? options : { family: 4 };
  if (!cb) return;
  dns.lookup(hostname, opts, (err, address, family) => {
    if (!err && address) {
      cb(null, address, family);
      return;
    }
    publicResolver.resolve4(hostname, (resolveErr, addresses) => {
      if (resolveErr || !addresses?.[0]) {
        cb(err ?? resolveErr ?? new Error("DNS lookup failed"), "", 4);
        return;
      }
      cb(null, addresses[0], 4);
    });
  });
}

export const pool = new Pool({
  connectionString,
  lookup: lookupWithDnsFallback,
  // Hosted Postgres (Neon, Supabase, Vercel Postgres) usually needs TLS
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  // Serverless: keep pool small, but 1 leaked connect would block all logins
  max: process.env.VERCEL ? 3 : 10,
  connectionTimeoutMillis: process.env.VERCEL ? 10_000 : 15_000,
  idleTimeoutMillis: process.env.VERCEL ? 5_000 : 30_000,
  allowExitOnIdle: true,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
