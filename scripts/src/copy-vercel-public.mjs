import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Ensure Vercel Output Directory `public` is populated, and also write
 * Build Output API layout as a secondary deploy path.
 */
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../..");

const viteCandidates = [
  path.join(workspaceRoot, "public"),
  path.join(workspaceRoot, "artifacts/vaksina-hr/dist/public"),
];
const viteOut = viteCandidates.find((p) => fs.existsSync(path.join(p, "index.html")));
if (!viteOut) {
  console.error("Missing Vite index.html. Looked in:", viteCandidates.join(", "));
  process.exit(1);
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function resolvePkgDir(name) {
  const candidates = [
    path.join(workspaceRoot, "node_modules", name),
    path.join(workspaceRoot, "artifacts/api-server/node_modules", name),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function copyPkgWithDeps(pkgName, destNodeModules, seen = new Set()) {
  if (seen.has(pkgName)) return;
  seen.add(pkgName);
  const src = resolvePkgDir(pkgName);
  if (!src) return;
  fs.mkdirSync(path.dirname(path.join(destNodeModules, pkgName)), { recursive: true });
  fs.cpSync(src, path.join(destNodeModules, pkgName), { recursive: true });
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
    for (const dep of Object.keys(pkg.dependencies || {})) {
      copyPkgWithDeps(dep, destNodeModules, seen);
    }
  } catch {
    /* ignore */
  }
}

// 1) Force public/ at workspace root AND cwd (Root Directory)
const publicTargets = [...new Set([
  path.join(workspaceRoot, "public"),
  path.join(process.cwd(), "public"),
])];
for (const dest of publicTargets) {
  if (path.resolve(dest) !== path.resolve(viteOut)) {
    copyDir(viteOut, dest);
  }
  const index = path.join(dest, "index.html");
  if (!fs.existsSync(index)) {
    console.error("public/index.html missing at", index);
    process.exit(1);
  }
  console.log("OK public:", dest, "→", fs.readdirSync(dest).join(", "));
}

// 2) Build Output API (optional secondary)
const apiDist = path.join(workspaceRoot, "artifacts/api-server/dist");
if (fs.existsSync(path.join(apiDist, "vercel.mjs"))) {
  const outputRoot = path.join(workspaceRoot, ".vercel/output");
  fs.rmSync(outputRoot, { recursive: true, force: true });
  copyDir(viteOut, path.join(outputRoot, "static"));

  const funcDir = path.join(outputRoot, "functions", "api.func");
  fs.mkdirSync(funcDir, { recursive: true });
  fs.cpSync(apiDist, funcDir, { recursive: true });
  copyPkgWithDeps("pg", path.join(funcDir, "node_modules"));
  fs.writeFileSync(
    path.join(funcDir, ".vc-config.json"),
    JSON.stringify({
      runtime: "nodejs20.x",
      handler: "vercel.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: true,
      supportsResponseStreaming: true,
    }),
  );
  fs.writeFileSync(
    path.join(outputRoot, "config.json"),
    JSON.stringify({
      version: 3,
      routes: [
        { src: "/api(?:/.*)?$", dest: "/api" },
        { handle: "filesystem" },
        { src: "/(.*)", dest: "/index.html" },
      ],
      crons: [{ path: "/api/jobs/vacancy-reminders", schedule: "*/10 * * * *" }],
    }),
  );
  console.log("OK .vercel/output:", outputRoot);
}

console.log("Vercel prepare done. outputDirectory must be: public");
