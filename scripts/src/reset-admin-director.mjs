/**
 * Admin va Direktor login/parolini yangilaydi.
 * Ishga tushirish: node scripts/src/reset-admin-director.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "../../node_modules/pg/lib/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(path.join(root, ".env"));
loadEnvFile(path.join(root, "artifacts/api-server/.env"));

const ADMIN = { login: "vaksina_admin", password: "VmHr#Admin26" };
const DIRECTOR = { login: "vaksina_direktor", password: "VmHr#Dir26" };

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function upsertByRole(role, login, password) {
  const byRole = await pool.query(
    `SELECT id, login FROM users WHERE role = $1 ORDER BY id ASC LIMIT 5`,
    [role],
  );
  if (!byRole.rows.length) {
    console.log(`  ! ${role}: topilmadi — o‘tkazib yuborildi`);
    return;
  }

  const primary = byRole.rows[0];
  const conflict = await pool.query(
    `SELECT id FROM users WHERE login = $1 AND id <> $2`,
    [login, primary.id],
  );
  if (conflict.rows[0]) {
    throw new Error(`Login band: ${login} (id=${conflict.rows[0].id})`);
  }

  await pool.query(
    `UPDATE users SET login = $1, password = $2, status = 'active' WHERE id = $3`,
    [login, password, primary.id],
  );
  console.log(`  ✓ ${role} id=${primary.id}: ${primary.login} → ${login}`);
}

try {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL yo‘q");
    process.exit(1);
  }
  console.log("Admin / Direktor login-parol yangilanmoqda...");
  await upsertByRole("admin", ADMIN.login, ADMIN.password);
  await upsertByRole("director", DIRECTOR.login, DIRECTOR.password);
  console.log("Tayyor.");
  console.log("");
  console.log("Yangi kirish:");
  console.log(`  Admin     login: ${ADMIN.login}     parol: ${ADMIN.password}`);
  console.log(`  Direktor  login: ${DIRECTOR.login}  parol: ${DIRECTOR.password}`);
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await pool.end();
}
