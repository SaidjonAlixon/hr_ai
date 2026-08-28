import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

function loadEnv() {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), "../../.env"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, "utf8");
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
    break;
  }
}

loadEnv();

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db, usersTable, employeesTable } = await import("@workspace/db");
  const { formatPersonName } = await import(
    "../../artifacts/api-server/src/lib/person-name.ts"
  );

  const users = await db.select({ id: usersTable.id, fullName: usersTable.fullName }).from(usersTable);
  let userUpdates = 0;
  for (const u of users) {
    const next = formatPersonName(u.fullName);
    if (next && next !== u.fullName) {
      await db.update(usersTable).set({ fullName: next }).where(eq(usersTable.id, u.id));
      userUpdates += 1;
    }
  }

  const employees = await db
    .select({ id: employeesTable.id, fullName: employeesTable.fullName })
    .from(employeesTable);
  let employeeUpdates = 0;
  for (const e of employees) {
    const next = formatPersonName(e.fullName);
    if (next && next !== e.fullName) {
      await db.update(employeesTable).set({ fullName: next }).where(eq(employeesTable.id, e.id));
      employeeUpdates += 1;
    }
  }

  console.log(`Yangilandi: ${userUpdates} foydalanuvchi, ${employeeUpdates} xodim`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
