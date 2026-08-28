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
  const { syncRahbariyatDepartmentAssignments } = await import(
    "../../artifacts/api-server/src/lib/rahbariyat-department.ts"
  );
  const rahId = await syncRahbariyatDepartmentAssignments();
  console.log(`Rahbariyat bo‘limi (id=${rahId}) — direktor, asoschi va moliya yangilandi`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
