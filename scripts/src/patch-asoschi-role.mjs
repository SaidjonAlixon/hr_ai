import fs from "fs";
import path from "path";

const roots = ["artifacts/api-server/src", "artifacts/vaksina-hr/src"];
const skip = new Set([
  path.normalize("artifacts/api-server/src/lib/roles.ts"),
  path.normalize("artifacts/vaksina-hr/src/lib/roles.ts"),
]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

function rolesImportFor(file) {
  const to = file.includes(`${path.sep}api-server${path.sep}`)
    ? path.join("artifacts/api-server/src/lib/roles")
    : path.join("artifacts/vaksina-hr/src/lib/roles");
  let rel = path.relative(path.dirname(file), to).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

function ensureImport(src, importPath) {
  if (/isDirectorRole/.test(src) && /import\s*\{[^}]*isDirectorRole/.test(src)) return src;
  const re = /import\s*\{([^}]*)\}\s*from\s*["']([^"']*roles)["']/;
  const m = src.match(re);
  if (m) {
    if (m[1].includes("isDirectorRole")) return src;
    const parts = m[1].split(",").map((x) => x.trim()).filter(Boolean);
    parts.push("isDirectorRole");
    return src.replace(re, `import { ${parts.join(", ")} } from "${m[2]}"`);
  }
  const idx = src.indexOf("\n");
  return `import { isDirectorRole } from "${importPath}";\n` + src;
}

let count = 0;
for (const file of roots.flatMap((r) => walk(r))) {
  if (skip.has(path.normalize(file))) continue;
  let s = fs.readFileSync(file, "utf8");
  const orig = s;
  let needImport = false;

  s = s.replace(/\b([\w.?]+)\s*===\s*["']director["']/g, (m, left) => {
    if (["value", "id", "tone", "kind"].includes(left)) return m;
    if (left.includes("node")) return m;
    needImport = true;
    return `isDirectorRole(${left})`;
  });
  s = s.replace(/\b([\w.?]+)\s*!==\s*["']director["']/g, (m, left) => {
    if (["value", "id", "tone", "kind"].includes(left)) return m;
    needImport = true;
    return `!isDirectorRole(${left})`;
  });

  // role lists: insert asoschi after director if missing on same/nearby list context
  s = s.replace(/(["'])director\1(\s*,)/g, (m, q, sep, offset) => {
    const slice = s.slice(Math.max(0, offset - 80), offset + 80);
    if (slice.includes("asoschi")) return m;
    if (/label\s*:|tone\s*:|Direktor|case\s+['"]director/.test(slice)) return m;
    return `${q}director${q}${sep} ${q}asoschi${q},`;
  });

  if (s === orig) continue;
  if (needImport) s = ensureImport(s, rolesImportFor(file));
  fs.writeFileSync(file, s);
  count += 1;
  console.log(file);
}
console.log("patched", count);
