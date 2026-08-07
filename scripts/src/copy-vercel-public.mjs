import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vite output → Vercel Output Directory (`www`).
 * `public` / `dist` often match .gitignore and Vercel then reports
 * "No Output Directory named … found" even when files exist on disk.
 */
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../..");
const outName = "www";

const src = path.join(workspaceRoot, "artifacts/vaksina-hr/dist/public");
if (!fs.existsSync(path.join(src, "index.html"))) {
  console.error("Missing Vite output:", path.join(src, "index.html"));
  process.exit(1);
}

const destinations = new Set([
  path.join(process.cwd(), outName),
  path.join(workspaceRoot, outName),
]);

for (const dest of destinations) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`Vercel static copy: ${src} → ${dest}`);
}

const verify = path.join(process.cwd(), outName, "index.html");
if (!fs.existsSync(verify)) {
  console.error("Missing after copy:", verify);
  process.exit(1);
}

// Prove directory is visible to a fresh readdir (what Vercel-style checks do)
const listing = fs.readdirSync(path.join(process.cwd(), outName));
console.log(`OK: ${verify} (entries: ${listing.join(", ")})`);
