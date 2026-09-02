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

const { rows: deptRows } = await pool.query(
  `INSERT INTO departments (name) VALUES ('Koordinator')
   ON CONFLICT DO NOTHING
   RETURNING id`,
);
let coordDeptId = deptRows[0]?.id;
if (!coordDeptId) {
  const found = await pool.query(`SELECT id FROM departments WHERE name = 'Koordinator' LIMIT 1`);
  coordDeptId = found.rows[0]?.id;
}
if (!coordDeptId) throw new Error("Koordinator bo‘limi topilmadi");

const users = await pool.query(
  `UPDATE users SET department_id = $1
   WHERE role = 'koordinator' AND department_id IS DISTINCT FROM $1
   RETURNING id, full_name`,
  [coordDeptId],
);
const employees = await pool.query(
  `UPDATE employees e SET department_id = $1
   FROM users u
   WHERE e.user_id = u.id AND u.role = 'koordinator'
     AND e.department_id IS DISTINCT FROM $1
   RETURNING e.id, e.full_name`,
  [coordDeptId],
);
const orphanCoords = await pool.query(
  `UPDATE employees SET department_id = $1
   WHERE org_role = 'coordinator' AND department_id IS DISTINCT FROM $1
   RETURNING id, full_name`,
  [coordDeptId],
);

console.log({
  koordinatorDeptId: coordDeptId,
  usersUpdated: users.rowCount,
  employeesUpdated: employees.rowCount + orphanCoords.rowCount,
});
await pool.end();
