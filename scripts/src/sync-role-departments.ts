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

async function main() {
  const { syncAllRoleDepartmentAssignments } = await import(
    "../../artifacts/api-server/src/lib/role-departments.ts"
  );
  await syncAllRoleDepartmentAssignments();
  console.log("Barcha rollar o‘z bo‘limlariga moslashtirildi (mudir/farmasevt/stajyor — Farmasevt)");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
