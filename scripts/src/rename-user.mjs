/**
 * Foydalanuvchi va bog‘langan xodim ismini yangilash.
 * Ishlatish: node scripts/src/rename-user.mjs "Eski Ism" "Yangi Ism"
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

const fromName = process.argv[2];
const toName = process.argv[3];
if (!fromName || !toName) {
  console.error('Ishlatish: node scripts/src/rename-user.mjs "Eski Ism" "Yangi Ism"');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL topilmadi");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1/i.test(url) ? undefined : { rejectUnauthorized: false },
});

const client = await pool.connect();
try {
  const users = await client.query(
    `SELECT id, full_name, role, login FROM users
     WHERE full_name ILIKE $1 OR full_name ILIKE $2`,
    [`%${fromName.split(" ")[0]}%`, `%${fromName.split(" ").slice(-1)[0]}%`],
  );

  if (users.rows.length === 0) {
    console.log(`"${fromName}" topilmadi.`);
    process.exit(0);
  }

  for (const u of users.rows) {
    await client.query(`UPDATE users SET full_name = $1 WHERE id = $2`, [toName, u.id]);
    console.log(`users #${u.id} (${u.login}): "${u.full_name}" → "${toName}"`);

    const emp = await client.query(
      `UPDATE employees SET full_name = $1, position = COALESCE(NULLIF(position, ''), 'Koordinator')
       WHERE user_id = $2
       RETURNING id, full_name, position`,
      [toName, u.id],
    );
    if (emp.rows[0]) {
      console.log(`employees #${emp.rows[0].id}: "${emp.rows[0].full_name}" (${emp.rows[0].position})`);
    }

    const empByName = await client.query(
      `UPDATE employees SET full_name = $1
       WHERE user_id IS NULL AND full_name ILIKE $2
       RETURNING id`,
      [toName, `%${fromName.split(" ")[0]}%`],
    );
    if (empByName.rows.length) {
      console.log(`employees (ism bo'yicha): ${empByName.rows.length} ta yangilandi`);
    }
  }

  console.log("Tayyor.");
} finally {
  client.release();
  await pool.end();
}
