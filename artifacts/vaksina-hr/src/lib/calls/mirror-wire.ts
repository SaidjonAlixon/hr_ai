/**
 * Jonli nusxa kanali formati (rrweb’siz — qabul qiluvchi tomonda asosiy bundle’ga og‘irlik qo‘shmaydi).
 * Matn: "S" — boshlandi, "X" — to‘xtadi, "e<json>" — bitta voqea,
 * "c<id>|<i>|<n>|<bo‘lak>" — siqilmagan katta voqea bo‘laklari (Safari DataChannel xabar hajmi cheklangan).
 * Ikkilik: [0x7a, id:u32, i:u16, n:u16, gzip bo‘lagi] — siqilgan katta voqea (to‘liq nusxa, sahifa o‘tishi).
 */
export const TEXT_CHUNK = 16_000;
export const ZIP_CHUNK = 16 * 1024;
const ZIP_MAGIC = 0x7a;
const ZIP_HEADER = 9;

export const canZip = typeof CompressionStream === "function" && typeof DecompressionStream === "function";

export async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** Safari stil matnida faqat -webkit-backdrop-filter bo‘ladi — Chrome uni tashlab yuboradi, xiralik yo‘qoladi */
export function fixSafariCss(json: string): string {
  if (!json.includes("-webkit-backdrop-filter")) return json;
  return json.replace(/-webkit-backdrop-filter:\s*([^;}"]+)/g, "backdrop-filter: $1; -webkit-backdrop-filter: $1");
}

export function zipFrame(id: number, idx: number, total: number, body: Uint8Array): Uint8Array {
  const frame = new Uint8Array(ZIP_HEADER + body.length);
  const v = new DataView(frame.buffer);
  v.setUint8(0, ZIP_MAGIC);
  v.setUint32(1, id);
  v.setUint16(5, idx);
  v.setUint16(7, total);
  frame.set(body, ZIP_HEADER);
  return frame;
}

export function readZipFrame(buf: ArrayBuffer): { id: number; idx: number; total: number; body: Uint8Array } | null {
  if (buf.byteLength < ZIP_HEADER) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== ZIP_MAGIC) return null;
  return { id: v.getUint32(1), idx: v.getUint16(5), total: v.getUint16(7), body: new Uint8Array(buf, ZIP_HEADER) };
}
