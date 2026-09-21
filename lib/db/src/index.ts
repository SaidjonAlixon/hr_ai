import { drizzle } from "drizzle-orm/node-postgres";
import dns from "node:dns";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

/** Windows/router IPv6 AAAA ko‘pincha ENOTFOUND/timeout beradi — avval IPv4. */
dns.setDefaultResultOrder("ipv4first");

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Neon `channel_binding=require` node-pg / Vercel’da ulanishni yiqitadi.
 * sslmode yo‘q bo‘lsa require qo‘yamiz.
 */
export function sanitizeDatabaseUrl(raw: string): string {
  try {
    const u = new URL(raw.replace(/^postgresql:/i, "http:"));
    u.searchParams.delete("channel_binding");
    // Ba’zi stringlarda channel_binding ikki marta keladi
    u.searchParams.delete("channel_binding");
    if (!u.searchParams.get("sslmode")) u.searchParams.set("sslmode", "require");
    const auth = u.username
      ? `${encodeURIComponent(decodeURIComponent(u.username))}:${encodeURIComponent(decodeURIComponent(u.password))}@`
      : "";
    return `postgresql://${auth}${u.host}${u.pathname}${u.search}`;
  } catch {
    return raw
      .replace(/([?&])channel_binding=[^&]*&?/gi, "$1")
      .replace(/\?&/, "?")
      .replace(/[?&]$/, "");
  }
}

const connectionString = sanitizeDatabaseUrl(process.env.DATABASE_URL);
const isLocal =
  /localhost|127\.0\.0\.1/i.test(connectionString) ||
  connectionString.includes("sslmode=disable");
const isPooler = /pooler/i.test(connectionString);
const isVercel = Boolean(process.env.VERCEL);

/** Router DNS sometimes cannot resolve Neon hosts; Google/Cloudflare can. */
const publicResolver = new dns.Resolver();
publicResolver.setServers(["8.8.8.8", "1.1.1.1"]);

/**
 * Node `net.connect` `options.all === true` bo‘lsa callback ikkinchi argumenti
 * `{address,family}[]` bo‘lishi shart. String qaytarsak ulanish osilib
 * "timeout exceeded when trying to connect" beradi.
 */
function lookupWithDnsFallback(
  hostname: string,
  options:
    | dns.LookupOptions
    | number
    | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void),
  callback?: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
) {
  const cb = typeof options === "function" ? options : callback;
  const opts = typeof options === "object" && options ? options : {};
  const all = Boolean((opts as dns.LookupOptions).all);
  if (!cb) return;

  const finish = (ip: string) => {
    if (all) {
      (cb as unknown as (err: null, addresses: Array<{ address: string; family: number }>) => void)(
        null,
        [{ address: ip, family: 4 }],
      );
      return;
    }
    cb(null, ip, 4);
  };

  dns.lookup(hostname, { family: 4, all: false }, (err, address) => {
    if (!err && address) {
      finish(address);
      return;
    }
    // 8.8.8.8 faqat lokal router DNS yiqilganda. Vercel UDP 53 ni bloklaydi — u yerda chaqirilmaydi.
    publicResolver.resolve4(hostname, (resolveErr, addresses) => {
      const ip = addresses?.[0];
      if (!ip) {
        if (all) {
          (cb as unknown as (err: NodeJS.ErrnoException, addresses: never[]) => void)(
            (err ?? resolveErr ?? new Error("DNS lookup failed")) as NodeJS.ErrnoException,
            [],
          );
          return;
        }
        cb((err ?? resolveErr ?? new Error("DNS lookup failed")) as NodeJS.ErrnoException, "", 4);
        return;
      }
      finish(ip);
    });
  });
}

/** `pg` typings ba’zi versiyalarda `lookup` ni `PoolConfig`da ko‘rsatmaydi */
type PoolConfigWithLookup = pg.PoolConfig & {
  lookup?: typeof lookupWithDnsFallback;
};

/**
 * Vercel: har bir serverless instance o‘z poolini ochadi.
 * max>1 + ko‘p concurrent → Neon "too many connections" / 503.
 * Pooler URL majburiy; idle qisqa, timeout biroz uzunroq (cold start).
 */
const poolConfig: PoolConfigWithLookup = {
  connectionString,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  max: isVercel ? 1 : 8,
  min: 0,
  connectionTimeoutMillis: isVercel ? 8_000 : 25_000,
  idleTimeoutMillis: isVercel ? 5_000 : 20_000,
  allowExitOnIdle: true,
  keepAlive: !isLocal,
  keepAliveInitialDelayMillis: isVercel ? 5_000 : 10_000,
};

// Vercel o‘z DNS ini ishlatsin. Custom lookup (options.all) ulanishni timeout qilardi.
if (!isLocal && !isVercel) {
  poolConfig.lookup = lookupWithDnsFallback;
}

// PgBouncer (Neon pooler) startup `options` ni yoqtirmaydi
if (!isPooler && !isVercel) {
  poolConfig.options = "-c statement_timeout=30000";
}

export const pool = new Pool(poolConfig);

pool.on("error", (err) => {
  console.error("[db] idle client error:", err?.message || err);
});

export const db = drizzle(pool, { schema });

/** Neon/Vercel vaqtincha DNS/timeout/connection spike */
export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const code = e.code || e.cause?.code || "";
  const msg = `${e.message || ""} ${e.cause?.message || ""}`;
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "57P01" ||
    code === "57P03" ||
    code === "53300" ||
    code === "08000" ||
    code === "08001" ||
    code === "08003" ||
    code === "08006" ||
    code === "08P01" ||
    /timeout|ECONNRESET|ENOTFOUND|ECONNREFUSED|Connection terminated|Connection refused|too many clients|remaining connection slots|Client has encountered a connection error|cannot connect|server closed the connection|connect ETIMEDOUT|getaddrinfo/i.test(
      msg,
    )
  );
}

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; label?: string },
): Promise<T> {
  const attempts = Math.max(1, opts?.attempts ?? 3);
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTransientDbError(err) || i === attempts - 1) throw err;
      const wait = 120 * (i + 1) + Math.floor(Math.random() * 80);
      console.warn(
        `[db] transient retry ${i + 1}/${attempts}${opts?.label ? ` (${opts.label})` : ""} after ${wait}ms:`,
        (err as Error)?.message || err,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

export * from "./schema";
