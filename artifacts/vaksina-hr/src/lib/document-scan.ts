/**
 * CamScanner uslubidagi A4 hujjat skaneri:
 * — qog‘oz chetini aniqlash, 4 burchak, perspektiv, oq fonda qora matn
 */

export type Point = { x: number; y: number };

export type ScanMode = "bw" | "gray" | "color";

/** ~200 DPI A4 */
export const A4_WIDTH = 1654;
export const A4_HEIGHT = 2339;

export function defaultCorners(w: number, h: number): Point[] {
  const m = Math.min(w, h) * 0.08;
  return [
    { x: m, y: m },
    { x: w - m, y: m },
    { x: w - m, y: h - m },
    { x: m, y: h - m },
  ];
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function luminance(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function imageToImageData(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
  maxSide = 2000,
): { canvas: HTMLCanvasElement; data: ImageData } {
  const sw =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : (source as HTMLImageElement).naturalWidth || source.width;
  const sh =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : (source as HTMLImageElement).naturalHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh, 1));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  return { canvas, data: ctx.getImageData(0, 0, w, h) };
}

function otsuThreshold(gray: Float32Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[clamp(Math.round(gray[i]), 0, 255)]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      thr = t;
    }
  }
  return thr;
}

/**
 * Qog‘ozni topish: yorug‘ maska + 4 tomondan chekka → burchaklar.
 * Fon qorong‘i, list oq bo‘lganda yaxshi ishlaydi (3-rasm uslubi).
 */
export function detectDocumentCorners(imageData: ImageData): Point[] {
  const { width: w, height: h, data } = imageData;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = luminance(data[p], data[p + 1], data[p + 2]);
  }

  const thr = Math.max(otsuThreshold(gray) * 0.92, 90);
  const paper = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) paper[i] = gray[i] >= thr ? 1 : 0;

  // Har qatordan chap/o‘ng chekka
  const leftX: number[] = [];
  const rightX: number[] = [];
  const topY: number[] = [];
  const botY: number[] = [];

  for (let y = 0; y < h; y++) {
    let L = -1;
    let R = -1;
    for (let x = 0; x < w; x++) {
      if (paper[y * w + x]) {
        L = x;
        break;
      }
    }
    for (let x = w - 1; x >= 0; x--) {
      if (paper[y * w + x]) {
        R = x;
        break;
      }
    }
    if (L >= 0 && R > L + w * 0.15) {
      leftX.push(L);
      rightX.push(R);
    }
  }

  for (let x = 0; x < w; x++) {
    let T = -1;
    let B = -1;
    for (let y = 0; y < h; y++) {
      if (paper[y * w + x]) {
        T = y;
        break;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      if (paper[y * w + x]) {
        B = y;
        break;
      }
    }
    if (T >= 0 && B > T + h * 0.15) {
      topY.push(T);
      botY.push(B);
    }
  }

  if (leftX.length < 10 || topY.length < 10) {
    return refineByGradient(imageData, defaultCorners(w, h));
  }

  const pct = (arr: number[], p: number) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[clamp(Math.floor(s.length * p), 0, s.length - 1)]!;
  };

  // Median-ish: outlierlardan himoya
  const L = pct(leftX, 0.15);
  const R = pct(rightX, 0.85);
  const T = pct(topY, 0.15);
  const B = pct(botY, 0.85);

  if (R - L < w * 0.25 || B - T < h * 0.25) {
    return refineByGradient(imageData, defaultCorners(w, h));
  }

  // Perspektiv uchun chekka chiziqlarini biroz aniqroq: yuqori/pastki qatorlarda L/R
  const band = Math.max(4, Math.floor(h * 0.08));
  const sampleLR = (y0: number, y1: number) => {
    const ls: number[] = [];
    const rs: number[] = [];
    for (let y = y0; y < y1; y++) {
      let l = -1;
      let r = -1;
      for (let x = 0; x < w; x++) {
        if (paper[y * w + x]) {
          l = x;
          break;
        }
      }
      for (let x = w - 1; x >= 0; x--) {
        if (paper[y * w + x]) {
          r = x;
          break;
        }
      }
      if (l >= 0 && r > l) {
        ls.push(l);
        rs.push(r);
      }
    }
    return {
      l: ls.length ? pct(ls, 0.2) : L,
      r: rs.length ? pct(rs, 0.8) : R,
    };
  };

  const topBand = sampleLR(T, Math.min(h, T + band));
  const botBand = sampleLR(Math.max(0, B - band), B + 1);

  const corners: Point[] = [
    { x: topBand.l, y: T },
    { x: topBand.r, y: T },
    { x: botBand.r, y: B },
    { x: botBand.l, y: B },
  ];

  return refineByGradient(imageData, orderCorners(corners));
}

/** Gradient bo‘yicha burchaklarni biroz siljitish */
function refineByGradient(imageData: ImageData, corners: Point[]): Point[] {
  const { width: w, height: h, data } = imageData;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = luminance(data[p], data[p + 1], data[p + 2]);
  }
  const mag = (x: number, y: number) => {
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return 0;
    const i = y * w + x;
    const gx =
      -gray[i - w - 1] +
      gray[i - w + 1] -
      2 * gray[i - 1] +
      2 * gray[i + 1] -
      gray[i + w - 1] +
      gray[i + w + 1];
    const gy =
      -gray[i - w - 1] -
      2 * gray[i - w] -
      gray[i - w + 1] +
      gray[i + w - 1] +
      2 * gray[i + w] +
      gray[i + w + 1];
    return Math.hypot(gx, gy);
  };

  const rad = Math.max(12, Math.floor(Math.min(w, h) * 0.04));
  return orderCorners(
    corners.map((c) => {
      let best = c;
      let bestM = mag(Math.round(c.x), Math.round(c.y));
      for (let dy = -rad; dy <= rad; dy += 2) {
        for (let dx = -rad; dx <= rad; dx += 2) {
          const x = clamp(Math.round(c.x + dx), 1, w - 2);
          const y = clamp(Math.round(c.y + dy), 1, h - 2);
          const m = mag(x, y);
          if (m > bestM) {
            bestM = m;
            best = { x, y };
          }
        }
      }
      return best;
    }),
  );
}

export function orderCorners(pts: Point[]): Point[] {
  const sorted = [...pts].sort((a, b) => a.y - b.y);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0]!, top[1]!, bottom[1]!, bottom[0]!];
}

/** 4 burchak + 4 o‘rta tutqich (CamScanner uslubi) */
export function cornersToHandles(corners: Point[]): Point[] {
  const [tl, tr, br, bl] = orderCorners(corners);
  return [
    tl,
    { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 },
    tr,
    { x: (tr.x + br.x) / 2, y: (tr.y + br.y) / 2 },
    br,
    { x: (br.x + bl.x) / 2, y: (br.y + bl.y) / 2 },
    bl,
    { x: (bl.x + tl.x) / 2, y: (bl.y + tl.y) / 2 },
  ];
}

/** Handle indeksidan 4 burchakni yangilash */
export function applyHandleDrag(
  corners: Point[],
  handleIdx: number,
  pos: Point,
  bounds: { w: number; h: number },
): Point[] {
  const c = orderCorners(corners).map((p) => ({ ...p }));
  const p = {
    x: clamp(pos.x, 0, bounds.w - 1),
    y: clamp(pos.y, 0, bounds.h - 1),
  };
  // 0 TL, 1 top mid, 2 TR, 3 right mid, 4 BR, 5 bottom mid, 6 BL, 7 left mid
  switch (handleIdx) {
    case 0:
      c[0] = p;
      break;
    case 1:
      c[0].y = p.y;
      c[1].y = p.y;
      break;
    case 2:
      c[1] = p;
      break;
    case 3:
      c[1].x = p.x;
      c[2].x = p.x;
      break;
    case 4:
      c[2] = p;
      break;
    case 5:
      c[2].y = p.y;
      c[3].y = p.y;
      break;
    case 6:
      c[3] = p;
      break;
    case 7:
      c[0].x = p.x;
      c[3].x = p.x;
      break;
  }
  return orderCorners(c);
}

function getPerspectiveMatrix(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve8(A, b);
  return [...h, 1];
}

function solve8(A: number[][], b: number[]): number[] {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    const div = M[col]![col]! || 1e-12;
    for (let c = col; c <= n; c++) M[col]![c]! /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]!;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row) => row[n]!);
}

function applyHomography(H: number[], x: number, y: number): Point {
  const w = H[6]! * x + H[7]! * y + H[8]!;
  return {
    x: (H[0]! * x + H[1]! * y + H[2]!) / w,
    y: (H[3]! * x + H[4]! * y + H[5]!) / w,
  };
}

function sampleBilinear(data: ImageData, x: number, y: number): [number, number, number] {
  const { width: w, height: h, data: d } = data;
  const x0 = clamp(Math.floor(x), 0, w - 1);
  const y0 = clamp(Math.floor(y), 0, h - 1);
  const x1 = clamp(x0 + 1, 0, w - 1);
  const y1 = clamp(y0 + 1, 0, h - 1);
  const fx = x - x0;
  const fy = y - y0;
  const idx = (xx: number, yy: number) => (yy * w + xx) * 4;
  const i00 = idx(x0, y0);
  const i10 = idx(x1, y0);
  const i01 = idx(x0, y1);
  const i11 = idx(x1, y1);
  const r =
    d[i00]! * (1 - fx) * (1 - fy) +
    d[i10]! * fx * (1 - fy) +
    d[i01]! * (1 - fx) * fy +
    d[i11]! * fx * fy;
  const g =
    d[i00 + 1]! * (1 - fx) * (1 - fy) +
    d[i10 + 1]! * fx * (1 - fy) +
    d[i01 + 1]! * (1 - fx) * fy +
    d[i11 + 1]! * fx * fy;
  const bl =
    d[i00 + 2]! * (1 - fx) * (1 - fy) +
    d[i10 + 2]! * fx * (1 - fy) +
    d[i01 + 2]! * (1 - fx) * fy +
    d[i11 + 2]! * fx * fy;
  return [r, g, bl];
}

export function warpToA4(
  source: ImageData,
  corners: Point[],
  outW = A4_WIDTH,
  outH = A4_HEIGHT,
): ImageData {
  const dstCorners: Point[] = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];
  const H = getPerspectiveMatrix(dstCorners, orderCorners(corners));
  const out = new ImageData(outW, outH);
  const od = out.data;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyHomography(H, x, y);
      const [r, g, b] = sampleBilinear(source, p.x, p.y);
      const i = (y * outW + x) * 4;
      od[i] = r;
      od[i + 1] = g;
      od[i + 2] = b;
      od[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Professional skaner: dog‘/soya yo‘qoladi, oq qog‘oz + qora matn.
 */
export function enhanceDocument(imageData: ImageData, mode: ScanMode = "bw"): ImageData {
  const { width: w, height: h, data } = imageData;
  const out = new ImageData(w, h);
  const od = out.data;

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = luminance(data[p]!, data[p + 1]!, data[p + 2]!);
  }

  // Percentile stretch — kontrast
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(gray.length / 8000));
  for (let i = 0; i < gray.length; i += step) sample.push(gray[i]!);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.02)] ?? 0;
  const hi = sample[Math.floor(sample.length * 0.98)] ?? 255;
  const span = Math.max(1, hi - lo);

  const stretched = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    stretched[i] = clamp(((gray[i]! - lo) / span) * 255, 0, 255);
  }

  // Integral image — adaptive
  const integ = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rowSum = 0;
    for (let x = 1; x <= w; x++) {
      rowSum += stretched[(y - 1) * w + (x - 1)]!;
      integ[y * (w + 1) + x] = integ[(y - 1) * (w + 1) + x]! + rowSum;
    }
  }
  const rectSum = (x0: number, y0: number, x1: number, y1: number) => {
    x0 = clamp(x0, 0, w);
    y0 = clamp(y0, 0, h);
    x1 = clamp(x1, 0, w);
    y1 = clamp(y1, 0, h);
    return (
      integ[y1 * (w + 1) + x1]! -
      integ[y0 * (w + 1) + x1]! -
      integ[y1 * (w + 1) + x0]! +
      integ[y0 * (w + 1) + x0]!
    );
  };

  const half = 28;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      const g = stretched[i]!;
      const x0 = x - half;
      const y0 = y - half;
      const x1 = x + half + 1;
      const y1 = y + half + 1;
      const area = Math.max(1, (Math.min(w, x1) - Math.max(0, x0)) * (Math.min(h, y1) - Math.max(0, y0)));
      const mean = rectSum(x0, y0, x1, y1) / area;

      if (mode === "color") {
        const gain = clamp((g - mean) * 1.4 + 140, 0, 255) / (g + 1e-3);
        // Fonni oqqa yaqinlashtirish
        const wr = clamp(data[p]! * gain * 0.5 + (g > mean * 0.95 ? 245 : g), 0, 255);
        const wg = clamp(data[p + 1]! * gain * 0.5 + (g > mean * 0.95 ? 245 : g), 0, 255);
        const wb = clamp(data[p + 2]! * gain * 0.5 + (g > mean * 0.95 ? 245 : g), 0, 255);
        od[p] = wr;
        od[p + 1] = wg;
        od[p + 2] = wb;
        od[p + 3] = 255;
      } else if (mode === "gray") {
        let v = clamp((g - mean) * 1.6 + 140, 0, 255);
        if (v > 200) v = 250;
        if (v < 60) v = 20;
        od[p] = od[p + 1] = od[p + 2] = v;
        od[p + 3] = 255;
      } else {
        // B&W CamScanner: oq fon, qora matn, soft edges
        const thr = mean * 0.94;
        const diff = thr - g;
        let ink: number;
        if (diff > 18) ink = 12;
        else if (diff < -12) ink = 255;
        else ink = clamp(200 - diff * 10, 12, 255);
        // Juda ochiq — sof oq
        if (g > mean * 1.02 && g > 160) ink = 255;
        od[p] = od[p + 1] = od[p + 2] = ink;
        od[p + 3] = 255;
      }
    }
  }

  if (mode === "bw" || mode === "gray") {
    sharpenInPlace(out, 0.45);
  }

  return out;
}

function sharpenInPlace(img: ImageData, amount: number) {
  const { width: w, height: h, data } = img;
  const copy = new Uint8ClampedArray(data);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = copy[i + c]! * 5;
        const neigh =
          copy[((y - 1) * w + x) * 4 + c]! +
          copy[((y + 1) * w + x) * 4 + c]! +
          copy[(y * w + x - 1) * 4 + c]! +
          copy[(y * w + x + 1) * 4 + c]!;
        data[i + c] = clamp(center - neigh * amount + copy[i + c]! * (1 - amount * 0.15), 0, 255);
      }
    }
  }
}

export function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = imageData.width;
  c.height = imageData.height;
  c.getContext("2d")!.putImageData(imageData, 0, 0);
  return c;
}

export async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/jpeg",
  quality = 0.94,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Blob yaratilmadi"))), type, quality);
  });
}

export async function pagesToPdfBlob(
  pages: HTMLCanvasElement[],
  filename = "skaner.pdf",
): Promise<{ blob: Blob; filename: string }> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    const dataUrl = pages[i]!.toDataURL("image/jpeg", 0.94);
    pdf.addImage(dataUrl, "JPEG", 0, 0, 210, 297);
  }
  return { blob: pdf.output("blob"), filename };
}

export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Rasm ochilmadi"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
