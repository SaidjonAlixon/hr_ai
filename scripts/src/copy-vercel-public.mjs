import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Write Vercel Build Output API v3 layout.
 * Skips the flaky dashboard `outputDirectory` check that fails even when
 * `public/` / `www/` exist on disk after a successful Vite build.
 */
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../..");

const viteCandidates = [
  path.join(workspaceRoot, "artifacts/vaksina-hr/dist/public"),
  path.join(workspaceRoot, "artifacts/vaksina-hr/dist"),
  path.join(workspaceRoot, "public"),
];
const viteOut = viteCandidates.find((p) =>
  fs.existsSync(path.join(p, "index.html")),
);
const apiDist = path.join(workspaceRoot, "artifacts/api-server/dist");

if (!viteOut) {
  console.error(
    "Missing Vite index.html. Looked in:",
    viteCandidates.join(", "),
  );
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
    const pkg = JSON.parse(
      fs.readFileSync(path.join(src, "package.json"), "utf8"),
    );
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
console.log("Build Output static:", staticDest, "←", viteOut);

// Express API as /api serverless function
const funcDir = path.join(outputRoot, "functions", "api.func");
fs.mkdirSync(funcDir, { recursive: true });
fs.cpSync(apiDist, funcDir, { recursive: true });
copyPkgWithDeps("pg", path.join(funcDir, "node_modules"));

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
      crons: [
        {
          path: "/api/jobs/vacancy-reminders",
          schedule: "*/10 * * * *",
        },
      ],
    },
    null,
    2,
  ),
);

if (!fs.existsSync(path.join(staticDest, "index.html"))) {
  console.error("Build Output missing static/index.html");
  process.exit(1);
}

console.log("OK: .vercel/output ready at", outputRoot);
console.log(
  "Vercel prepare done. Do NOT set Output Directory override (use Build Output API).",
);
