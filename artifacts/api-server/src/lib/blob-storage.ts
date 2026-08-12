import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, put } from "@vercel/blob";

const MAX_BYTES = 10 * 1024 * 1024;

function uploadsDir() {
  return path.resolve(process.cwd(), "uploads");
}

function sanitizeFileName(name: string) {
  const base = path.basename(name || "fayl").slice(0, 120);
  return base.replace(/[^\w.\-()\s'а-яА-ЯёЁўқғҳЎҚҒҲ\-]/giu, "_") || "fayl";
}

export function makeUploadId(originalName: string) {
  const safe = sanitizeFileName(originalName);
  const stamp = Date.now().toString(36);
  const rand = randomBytes(5).toString("hex");
  return `tasks__${stamp}_${rand}__${safe}`;
}

export function hasBlobToken() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Private store: API orqali beriladi. Public/local: to‘g‘ridan URL. */
export async function storeUploadBuffer(opts: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<{ url: string; key: string; size: number }> {
  const { buffer, fileName, mimeType } = opts;
  if (!buffer.length) {
    throw new Error("Fayl bo'sh");
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error("Fayl 10 MB dan katta");
  }

  const key = makeUploadId(fileName);
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  if (token) {
    const blob = await put(`tasks/${key}`, buffer, {
      access: "private",
      contentType: mimeType || "application/octet-stream",
      token,
      addRandomSuffix: false,
    });
    // Private blob — brauzer to‘g‘ridan ocholmaydi; API proxy orqali
    return {
      url: `/api/uploads/remote?path=${encodeURIComponent(blob.pathname)}`,
      key: blob.pathname,
      size: buffer.length,
    };
  }

  const dir = uploadsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, key), buffer);
  return {
    url: `/api/uploads/${encodeURIComponent(key)}`,
    key,
    size: buffer.length,
  };
}

export async function readBlobUpload(pathname: string): Promise<{
  buffer: Buffer;
  contentType: string;
  downloadName: string;
} | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  if (!pathname || pathname.includes("..") || !pathname.startsWith("tasks/")) {
    return null;
  }

  const result = await get(pathname, {
    access: "private",
    token,
    useCache: true,
  });
  if (!result || result.statusCode !== 200 || !result.stream) return null;

  const reader = result.stream.getReader();
  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }

  const downloadName =
    pathname.split("/").pop()?.includes("__")
      ? pathname.split("__").pop() || pathname
      : path.basename(pathname);

  return {
    buffer: Buffer.concat(chunks),
    contentType: result.blob.contentType || "application/octet-stream",
    downloadName,
  };
}

export async function readLocalUpload(key: string): Promise<Buffer | null> {
  const safe = path.basename(key);
  if (!safe || safe !== key.replace(/\\/g, "/").split("/").pop()) {
    return null;
  }
  try {
    return await readFile(path.join(uploadsDir(), safe));
  } catch {
    return null;
  }
}

export function attachmentKind(mimeType: string): "image" | "file" {
  return mimeType.startsWith("image/") ? "image" : "file";
}

export function contentHash(buffer: Buffer) {
  return createHash("sha1").update(buffer).digest("hex").slice(0, 12);
}

export { MAX_BYTES };
