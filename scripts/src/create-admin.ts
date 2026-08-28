import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

function loadEnv() {
  for (const p of [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), "../../.env"),
  ]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
    break;
  }
}

loadEnv();

const LOGIN = "vaksina_admin";
const PASSWORD = "Vaksina2026!";
const FULL_NAME = "Vaksina Admin";

async function main() {
  const { eq } = await import("drizzle-orm");
  const { db, usersTable } = await import("@workspace/db");
  const { resolveDepartmentIdForRole } = await import(
    "../../artifacts/api-server/src/lib/role-departments.ts"
  );
  const { ensureEmployeeForNewUser } = await import(
    "../../artifacts/api-server/src/lib/user-employee-sync.ts"
  );
  const { formatPersonName } = await import(
    "../../artifacts/api-server/src/lib/person-name.ts"
  );

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.login, LOGIN))
    .limit(1);

  if (existing) {
    await db
      .update(usersTable)
      .set({
        password: PASSWORD,
        role: "admin",
        status: "active",
        fullName: formatPersonName(FULL_NAME),
      })
      .where(eq(usersTable.id, existing.id));
    console.log(`Mavjud admin yangilandi: login=${LOGIN}`);
    process.exit(0);
  }

  const departmentId = await resolveDepartmentIdForRole("admin");

  const [user] = await db
    .insert(usersTable)
    .values({
      fullName: formatPersonName(FULL_NAME),
      role: "admin",
      login: LOGIN,
      password: PASSWORD,
      phone: "+998901000099",
      status: "active",
      departmentId,
    })
    .returning();

  await ensureEmployeeForNewUser({
    id: user.id,
    fullName: user.fullName,
    role: user.role,
    departmentId: user.departmentId,
  });

  console.log(`Yangi admin yaratildi: login=${LOGIN}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
