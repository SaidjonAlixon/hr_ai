// Vercel Blob → artifacts/api-server/uploads/blob/<pathname>
//   cd /opt/hr_ai/artifacts/api-server && node ../../deploy/mirror-vercel-blob.mjs
// Token .env dagi BLOB_READ_WRITE_TOKEN dan olinadi. Qayta ishga tushirsa — faqat yo‘qlarini yuklaydi.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const apiDir = process.cwd();
const require = createRequire(path.join(apiDir, "package.json"));
const { get, list } = require("@vercel/blob");

function envToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN.trim();
  for (const p of [path.join(apiDir, ".env"), path.join(apiDir, "../../.env")]) {
    if (!existsSync(p)) continue;
    const line = readFileSync(p, "utf8").split(/\r?\n/).find((l) => l.startsWith("BLOB_READ_WRITE_TOKEN="));
    if (line) return line.slice("BLOB_READ_WRITE_TOKEN=".length).trim();
  }
  return "";
}

const token = envToken();
if (!token) {
  console.error("BLOB_READ_WRITE_TOKEN topilmadi");
  process.exit(1);
}

const root = path.join(apiDir, "uploads", "blob");
let cursor;
let done = 0;
let skipped = 0;
let failed = 0;
do {
  const page = await list({ token, cursor, limit: 1000 });
  for (const b of page.blobs) {
    const dest = path.join(root, ...b.pathname.split("/"));
    if (existsSync(dest)) {
      skipped++;
      continue;
    }
    try {
      const r = await get(b.pathname, { access: "private", token });
      if (!r || r.statusCode !== 200 || !r.stream) throw new Error(`status ${r?.statusCode}`);
      const chunks = [];
      const reader = r.stream.getReader();
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        if (value) chunks.push(Buffer.from(value));
      }
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.concat(chunks));
      await writeFile(`${dest}.meta.json`, JSON.stringify({ contentType: r.blob.contentType, size: b.size }));
      done++;
    } catch (err) {
      failed++;
      console.error(`XATO ${b.pathname}: ${err?.message || err}`);
    }
  }
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

console.log(`Blob ko‘chirish: yangi=${done}, oldin bor=${skipped}, xato=${failed}`);
process.exit(failed ? 1 : 0);
