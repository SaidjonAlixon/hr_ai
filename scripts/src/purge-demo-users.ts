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
  const { purgeDemoUsers } = await import(
    "../../artifacts/api-server/src/lib/purge-demo-users.ts"
  );
  const result = await purgeDemoUsers();
  console.log(
    `O'chirildi: ${result.deletedUsers} foydalanuvchi, ${result.deletedEmployees} xodim`,
  );
  if (result.names.length) {
    console.log("Ismlar:", result.names.join(", "));
  } else {
    console.log("Demo yozuvlar topilmadi.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
