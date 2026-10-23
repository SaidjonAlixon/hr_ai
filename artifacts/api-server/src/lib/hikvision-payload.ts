/**
 * Hikvision HTTP notification body: JSON / XML / multipart(+rasm).
 */

export type ParsedHikvisionBody = {
  eventJson: Record<string, unknown> | null;
  xmlText: string | null;
  images: Array<{ mime: string; data: Buffer }>;
};

function boundaryOf(contentType: string): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || "");
  return (m?.[1] || m?.[2] || "").trim() || null;
}

function headerMap(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Multipart binary-safe split */
function parseMultipart(buf: Buffer, contentType: string): ParsedHikvisionBody {
  const boundary = boundaryOf(contentType);
  const images: Array<{ mime: string; data: Buffer }> = [];
  let eventJson: Record<string, unknown> | null = null;
  let xmlText: string | null = null;
  if (!boundary) return { eventJson, xmlText, images };

  const sep = Buffer.from(`--${boundary}`);
  let start = buf.indexOf(sep);
  while (start >= 0) {
    start += sep.length;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // --
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    else if (buf[start] === 0x0a) start += 1;

    const next = buf.indexOf(sep, start);
    const part = next < 0 ? buf.subarray(start) : buf.subarray(start, next);
    const splitAt =
      part.indexOf(Buffer.from("\r\n\r\n")) >= 0
        ? part.indexOf(Buffer.from("\r\n\r\n"))
        : part.indexOf(Buffer.from("\n\n"));
    if (splitAt < 0) {
      start = next;
      continue;
    }
    const head = part.subarray(0, splitAt).toString("utf8");
    let body = part.subarray(splitAt + (part.includes(Buffer.from("\r\n\r\n")) ? 4 : 2));
    // trailing CRLF
    if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
      body = body.subarray(0, body.length - 2);
    } else if (body.length >= 1 && body[body.length - 1] === 0x0a) {
      body = body.subarray(0, body.length - 1);
    }

    const headers = headerMap(head);
    const ctype = (headers["content-type"] || "").toLowerCase();
    const disp = headers["content-disposition"] || "";
    const isImage =
      ctype.startsWith("image/") ||
      /\.(jpe?g|png|bmp|gif)/i.test(disp) ||
      /name="?(picture|face|image|photo)/i.test(disp);

    if (isImage && body.length > 100) {
      images.push({ mime: ctype.startsWith("image/") ? ctype : "image/jpeg", data: Buffer.from(body) });
    } else if (ctype.includes("json") || body[0] === 0x7b) {
      try {
        eventJson = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    } else if (ctype.includes("xml") || body.toString("utf8", 0, 40).includes("<")) {
      xmlText = body.toString("utf8");
    } else if (!eventJson) {
      const t = body.toString("utf8").trim();
      if (t.startsWith("{")) {
        try {
          eventJson = JSON.parse(t) as Record<string, unknown>;
        } catch {
          /* ignore */
        }
      } else if (t.includes("<AccessController") || t.includes("<EventNotification")) {
        xmlText = t;
      }
    }

    start = next;
  }
  return { eventJson, xmlText, images };
}

function digBase64Image(obj: unknown, depth = 0): Buffer | null {
  if (depth > 6 || obj == null) return null;
  if (typeof obj === "string") {
    const s = obj.trim();
    if (s.startsWith("data:image/") && s.includes("base64,")) {
      const b64 = s.slice(s.indexOf("base64,") + 7);
      try {
        const buf = Buffer.from(b64, "base64");
        return buf.length > 100 ? buf : null;
      } catch {
        return null;
      }
    }
    // raw base64 jpeg/png
    if (s.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 200))) {
      try {
        const buf = Buffer.from(s.replace(/\s+/g, ""), "base64");
        if (buf.length > 100 && (buf[0] === 0xff || buf[0] === 0x89)) return buf;
      } catch {
        return null;
      }
    }
    return null;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const hit = digBase64Image(x, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    const prefer = ["picture", "Picture", "face", "Face", "image", "Image", "photo", "pic", "binaryData"];
    for (const k of prefer) {
      if (k in rec) {
        const hit = digBase64Image(rec[k], depth + 1);
        if (hit) return hit;
      }
    }
    for (const v of Object.values(rec)) {
      const hit = digBase64Image(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

export function bufferToDataUrl(buf: Buffer, mime = "image/jpeg"): string {
  const m = mime.startsWith("image/") ? mime : "image/jpeg";
  return `data:${m};base64,${buf.toString("base64")}`;
}

export function parseHikvisionHttpBody(
  body: unknown,
  contentType: string,
): ParsedHikvisionBody & { pictureDataUrl: string | null } {
  let eventJson: Record<string, unknown> | null = null;
  let xmlText: string | null = null;
  let images: Array<{ mime: string; data: Buffer }> = [];

  const ct = contentType || "";
  if (Buffer.isBuffer(body)) {
    if (ct.includes("multipart/")) {
      const parsed = parseMultipart(body, ct);
      eventJson = parsed.eventJson;
      xmlText = parsed.xmlText;
      images = parsed.images;
    } else {
      const text = body.toString("utf8");
      if (text.trim().startsWith("{")) {
        try {
          eventJson = JSON.parse(text) as Record<string, unknown>;
        } catch {
          /* ignore */
        }
      } else if (text.includes("<")) {
        xmlText = text;
      }
      // whole body might be jpeg
      if (body.length > 100 && body[0] === 0xff && body[1] === 0xd8) {
        images.push({ mime: "image/jpeg", data: body });
      }
    }
  } else if (typeof body === "string") {
    const text = body.trim();
    if (text.startsWith("{")) {
      try {
        eventJson = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    } else if (text.includes("<")) {
      xmlText = text;
    }
  } else if (body && typeof body === "object") {
    eventJson = body as Record<string, unknown>;
  }

  if (eventJson) {
    const fromJson = digBase64Image(eventJson);
    if (fromJson) images.push({ mime: "image/jpeg", data: fromJson });
  }

  const best = images.sort((a, b) => b.data.length - a.data.length)[0];
  let pictureDataUrl: string | null = null;
  if (best) {
    // AI limit — juda katta bo‘lsa ham base64 qilib yuboramiz; face-ai o‘zi kesadi
    pictureDataUrl = bufferToDataUrl(best.data, best.mime);
    if (pictureDataUrl.length > 1_100_000) {
      // juda katta — qisqartirish: faqat boshini emas, sharp yo‘q — rad etamiz emas, AI soft fail
      pictureDataUrl = pictureDataUrl.slice(0, 1_100_000);
    }
  }

  return { eventJson, xmlText, images, pictureDataUrl };
}
