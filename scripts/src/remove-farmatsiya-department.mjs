/**
 * Farmatsiya bo‘limini tizimdan olib tashlash — xodimlarni to‘g‘ri bo‘limlarga ko‘chirish.
 * Ishlatish: node scripts/src/remove-farmatsiya-department.mjs
 */
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

async function ensureDept(name) {
  const found = await pool.query(`SELECT id FROM departments WHERE name = $1 LIMIT 1`, [name]);
  if (found.rows[0]?.id) return found.rows[0].id;
  const ins = await pool.query(`INSERT INTO departments (name) VALUES ($1) RETURNING id`, [name]);
  return ins.rows[0].id;
}

const ROLE_TO_DEPT = {
  koordinator: "Koordinator",
  mudir: "Farmasevt",
  farmasevt: "Farmasevt",
  stajyor: "Farmasevt",
  texnik: "Texnik",
  texnik_rahbar: "Texnik",
  ombor: "Ombor",
  hr: "HR",
  hr_direktor: "HR",
  hr_menejer: "HR",
  hr_auditor: "HR",
  recruiter: "Rekruting",
  trainer: "Trening",
  mentor: "Trening",
  it: "IT",
  it_rahbar: "IT",
  revizor: "Reviziya",
  reviziya_rahbar: "Reviziya",
  sb: "Xavfsizlik",
  sb_boshliq: "Xavfsizlik",
  admin: "Rahbariyat",
  director: "Rahbariyat",
  asoschi: "Rahbariyat",
  moliya: "Rahbariyat",
  department_head: "HR",
};

const ORG_TO_DEPT = {
  coordinator: "Koordinator",
  manager: "Farmasevt",
  pharmacist: "Farmasevt",
  intern: "Farmasevt",
};

try {
  const farm = await pool.query(`SELECT id FROM departments WHERE name = 'Farmatsiya' LIMIT 1`);
  const farmId = farm.rows[0]?.id;
  if (!farmId) {
    console.log("Farmatsiya bo‘limi topilmadi — hech narsa qilinmadi.");
    await pool.end();
    process.exit(0);
  }

  const deptCache = new Map();
  async function deptIdFor(name) {
    if (!deptCache.has(name)) deptCache.set(name, await ensureDept(name));
    return deptCache.get(name);
  }

  const usersInFarm = await pool.query(
    `SELECT id, role FROM users WHERE department_id = $1`,
    [farmId],
  );
  let usersMoved = 0;
  for (const u of usersInFarm.rows) {
    const targetName = ROLE_TO_DEPT[u.role] || "HR";
    const targetId = await deptIdFor(targetName);
    await pool.query(`UPDATE users SET department_id = $1 WHERE id = $2`, [targetId, u.id]);
    usersMoved += 1;
  }

  const empsInFarm = await pool.query(
    `SELECT id, org_role, user_id FROM employees WHERE department_id = $1`,
    [farmId],
  );
  let empsMoved = 0;
  for (const e of empsInFarm.rows) {
    let targetName = null;
    if (e.user_id) {
      const ur = await pool.query(`SELECT role FROM users WHERE id = $1`, [e.user_id]);
      targetName = ROLE_TO_DEPT[ur.rows[0]?.role];
    }
    if (!targetName && e.org_role) targetName = ORG_TO_DEPT[e.org_role];
    if (!targetName) targetName = "HR";
    const targetId = await deptIdFor(targetName);
    await pool.query(`UPDATE employees SET department_id = $1 WHERE id = $2`, [targetId, e.id]);
    empsMoved += 1;
  }

  const reqs = await pool.query(
    `UPDATE requests SET department_id = $1 WHERE department_id = $2 RETURNING id`,
    [await deptIdFor("HR"), farmId],
  );

  const vacs = await pool.query(
    `UPDATE vacancies SET department_id = $1 WHERE department_id = $2 RETURNING id`,
    [await deptIdFor("HR"), farmId],
  ).catch(() => ({ rowCount: 0, rows: [] }));

  await pool.query(`UPDATE departments SET head_id = NULL WHERE head_id IS NOT NULL AND id = $1`, [farmId]);
  await pool.query(`UPDATE departments SET head_id = NULL WHERE id = $1`, [farmId]);

  const del = await pool.query(`DELETE FROM departments WHERE id = $1 RETURNING id`, [farmId]);

  console.log({
    farmatsiyaRemoved: Boolean(del.rowCount),
    usersMoved,
    employeesMoved: empsMoved,
    requestsMoved: reqs.rowCount,
    vacanciesMoved: vacs.rowCount ?? 0,
  });
} catch (err) {
  console.error("Xato:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
