import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vite yozgan static fayllarni Vercel kutadigan joyga ko‘chiradi.
 * Root Directory `.` yoki `artifacts/...` bo‘lishidan qat'i nazar
 * `process.cwd()/public` mavjud bo‘lishi shart.
 */
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../..");

const candidates = [
  path.join(workspaceRoot, "artifacts/vaksina-hr/dist/public"),
  path.join(workspaceRoot, "public"),
];

const src = candidates.find((p) => fs.existsSync(path.join(p, "index.html")));
if (!src) {
  console.error("Vercel public copy: index.html topilmadi. Qidirildi:");
  for (const p of candidates) console.error(" -", p);
  process.exit(1);
}

const destinations = new Set([
  path.join(process.cwd(), "public"),
  path.join(workspaceRoot, "public"),
]);

for (const dest of destinations) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`Vercel public copy: ${src} → ${dest}`);
}

const verify = path.join(process.cwd(), "public", "index.html");
if (!fs.existsSync(verify)) {
  console.error("Vercel public copy: cwd/public/index.html yo‘q:", verify);
  process.exit(1);
}
console.log("OK:", verify);
