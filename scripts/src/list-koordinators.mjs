import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function loadEnv() {
  try {
    const raw = readFileSync(resolve(root, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2];
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch {
    /* ignore */
  }
}

loadEnv();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/i.test(process.env.DATABASE_URL || "")
    ? undefined
    : { rejectUnauthorized: false },
});

const r = await pool.query(
  `SELECT u.id, u.full_name, u.role, u.login, e.id AS employee_id, e.full_name AS emp_name
   FROM users u
   LEFT JOIN employees e ON e.user_id = u.id
   WHERE u.role = 'koordinator' OR u.full_name ILIKE '%aslan%' OR u.full_name ILIKE '%shox%' OR u.full_name ILIKE '%shoh%'
   ORDER BY u.id`,
);
console.log(JSON.stringify(r.rows, null, 2));
await pool.end();
