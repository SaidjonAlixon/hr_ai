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

const NEW_NAME = "Rustamova Lola";
const USER_ID = 329;
const EMPLOYEE_ID = 140;

const u = await pool.query(
  `UPDATE users SET full_name = $1 WHERE id = $2 RETURNING id, full_name, login, role`,
  [NEW_NAME, USER_ID],
);
const e = await pool.query(
  `UPDATE employees SET full_name = $1, position = 'Koordinator', org_role = 'coordinator'
   WHERE id = $2 RETURNING id, full_name, position, org_role, user_id`,
  [NEW_NAME, EMPLOYEE_ID],
);

console.log("users:", u.rows[0]);
console.log("employees:", e.rows[0]);
await pool.end();
