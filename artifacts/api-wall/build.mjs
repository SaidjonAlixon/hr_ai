import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(artifactDir, "../..");
const requireFromPkg = createRequire(path.join(artifactDir, "package.json"));
const requireFromRoot = createRequire(path.join(workspaceRoot, "package.json"));

function resolveDep(name) {
  try {
    return requireFromPkg.resolve(name);
  } catch {
    return requireFromRoot.resolve(name);
  }
}

const { build: esbuild } = await import(pathToFileURL(resolveDep("esbuild")).href);

await mkdir(path.join(artifactDir, "dist"), { recursive: true });

await esbuild({
  entryPoints: [path.join(artifactDir, "src/index.ts")],
  outfile: path.join(artifactDir, "dist/index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  packages: "external",
  logLevel: "info",
});

console.log("api-wall build ok → dist/index.mjs");
