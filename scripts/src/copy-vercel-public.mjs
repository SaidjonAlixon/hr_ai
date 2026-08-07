import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Write Vercel Build Output API v3 layout.
 * This skips the flaky dashboard `outputDirectory` check that fails even when
 * `www/` / `public/` exist on disk.
 */
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../..");

const viteOut = path.join(workspaceRoot, "artifacts/vaksina-hr/dist/public");
const apiDist = path.join(workspaceRoot, "artifacts/api-server/dist");

if (!fs.existsSync(path.join(viteOut, "index.html"))) {
  console.error("Missing Vite output:", viteOut);
  process.exit(1);
}
if (!fs.existsSync(path.join(apiDist, "vercel.mjs"))) {
  console.error("Missing API bundle:", path.join(apiDist, "vercel.mjs"));
  process.exit(1);
}

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  rimraf(dest);
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
  if (!src) {
    console.warn("skip missing package:", pkgName);
    return;
  }
  const dest = path.join(destNodeModules, pkgName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
    for (const dep of Object.keys(pkg.dependencies || {})) {
      copyPkgWithDeps(dep, destNodeModules, seen);
    }
  } catch {
    /* ignore */
  }
}

const outputRoot = path.join(workspaceRoot, ".vercel/output");
rimraf(outputRoot);

// Static SPA
const staticDest = path.join(outputRoot, "static");
copyDir(viteOut, staticDest);
console.log("Build Output static:", staticDest);

// Also mirror to public/ for zero-config fallback
for (const dest of new Set([
  path.join(workspaceRoot, "public"),
  path.join(process.cwd(), "public"),
])) {
  copyDir(viteOut, dest);
  console.log("public fallback:", dest);
}

// Express API as /api serverless function
const funcDir = path.join(outputRoot, "functions", "api.func");
fs.mkdirSync(funcDir, { recursive: true });
fs.cpSync(apiDist, funcDir, { recursive: true });

const funcNodeModules = path.join(funcDir, "node_modules");
copyPkgWithDeps("pg", funcNodeModules);

fs.writeFileSync(
  path.join(funcDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs20.x",
      handler: "vercel.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: true,
      supportsResponseStreaming: true,
    },
    null,
    2,
  ),
);
console.log("Build Output function:", funcDir);

fs.writeFileSync(
  path.join(outputRoot, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "/api(?:/.*)?$", dest: "/api" },
        { handle: "filesystem" },
        { src: "/(.*)", dest: "/index.html" },
      ],
      crons: [{ path: "/api/jobs/vacancy-reminders", schedule: "*/10 * * * *" }],
    },
    null,
    2,
  ),
);

console.log("OK: .vercel/output ready at", outputRoot);
