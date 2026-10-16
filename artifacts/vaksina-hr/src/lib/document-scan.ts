/**
 * CamScanner uslubidagi A4 hujjat skaneri:
 * — markazdan qog‘ozni topish, 4 burchak, perspektiv, oq fonda qora matn
 */

export type Point = { x: number; y: number };

export type ScanMode = "bw" | "gray" | "color";

/** ~200 DPI A4 */
export const A4_WIDTH = 1654;
export const A4_HEIGHT = 2339;

export function defaultCorners(w: number, h: number): Point[] {
  const m = Math.min(w, h) * 0.06;
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
  for (let i = 0; i < gray.length; i++) hist[clamp(Math.round(gray[i]!), 0, 255)]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
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

function pctSorted(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[clamp(Math.floor(sorted.length * p), 0, sorted.length - 1)]!;
}

export function orderCorners(pts: Point[]): Point[] {
  const sorted = [...pts].sort((a, b) => a.y - b.y);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0]!, top[1]!, bottom[1]!, bottom[0]!];
}

/** 4 burchakni biroz ichkariga — orqa fon chekkada qolmasin */
function insetCorners(corners: Point[], w: number, h: number, ratio = 0.012): Point[] {
  const c = orderCorners(corners);
  const cx = (c[0]!.x + c[1]!.x + c[2]!.x + c[3]!.x) / 4;
  const cy = (c[0]!.y + c[1]!.y + c[2]!.y + c[3]!.y) / 4;
  return c.map((p) => ({
    x: clamp(p.x + (cx - p.x) * ratio, 0, w - 1),
    y: clamp(p.y + (cy - p.y) * ratio, 0, h - 1),
  }));
}

function blurGray(gray: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dx = -2; dx <= 2; dx++) {
        const xx = clamp(x + dx, 0, w - 1);
        s += gray[y * w + xx]!;
        n++;
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = clamp(y + dy, 0, h - 1);
        s += tmp[yy * w + x]!;
        n++;
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

/** Markazdan oq/yorug‘ qog‘ozni flood-fill qilish */
function paperMaskFromCenter(gray: Float32Array, w: number, h: number): Uint8Array | null {
  const blurred = blurGray(gray, w, h);
  const thr = Math.max(otsuThreshold(blurred) * 0.88, 100);

  const seedX = Math.floor(w / 2);
  const seedY = Math.floor(h / 2);
  // Markaz atrofida eng yorug‘ nuqta — list markaziga “yopishish”
  let best = { x: seedX, y: seedY, v: blurred[seedY * w + seedX]! };
  const r = Math.floor(Math.min(w, h) * 0.12);
  for (let y = seedY - r; y <= seedY + r; y++) {
    for (let x = seedX - r; x <= seedX + r; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const v = blurred[y * w + x]!;
      if (v > best.v) best = { x, y, v };
    }
  }

  if (best.v < thr * 0.85) return null;

  const seedThr = Math.min(best.v - 18, thr);
  const mask = new Uint8Array(w * h);
  const stackX = new Int32Array(w * h);
  const stackY = new Int32Array(w * h);
  let sp = 0;
  const push = (x: number, y: number) => {
    const i = y * w + x;
    if (mask[i]) return;
    if (blurred[i]! < seedThr) return;
    mask[i] = 1;
    stackX[sp] = x;
    stackY[sp] = y;
    sp++;
  };
  push(best.x, best.y);

  while (sp > 0) {
    sp--;
    const x = stackX[sp]!;
    const y = stackY[sp]!;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }

  // Tez dilate (3×3) — matn teshiklarini biroz yopish
  const closed = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      closed[i] =
        mask[i] ||
        mask[i - 1] ||
        mask[i + 1] ||
        mask[i - w] ||
        mask[i + w] ||
        mask[i - w - 1] ||
        mask[i - w + 1] ||
        mask[i + w - 1] ||
        mask[i + w + 1]
          ? 1
          : 0;
    }
  }

  let count = 0;
  for (let i = 0; i < closed.length; i++) if (closed[i]) count++;
  const areaRatio = count / (w * h);
  if (areaRatio < 0.12 || areaRatio > 0.92) return null;

  return closed;
}

/** Maskadan 4 ekstremal burchak (TL/TR/BR/BL) */
function cornersFromMask(mask: Uint8Array, w: number, h: number): Point[] | null {
  let minX = w;
  let maxX = 0;
  let minY = h;
  let maxY = 0;
  let count = 0;
  let tl = { x: 0, y: 0 };
  let tr = { x: 0, y: 0 };
  let br = { x: 0, y: 0 };
  let bl = { x: 0, y: 0 };
  let tlS = Infinity;
  let trS = -Infinity;
  let brS = -Infinity;
  let blS = Infinity;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // Faqat kontur — ekstremumlar aniqroq
      const isEdge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        !mask[i - 1] ||
        !mask[i + 1] ||
        !mask[i - w] ||
        !mask[i + w];
      if (!isEdge) continue;

      const s1 = x + y;
      const s2 = x - y;
      if (s1 < tlS) {
        tlS = s1;
        tl = { x, y };
      }
      if (s2 > trS) {
        trS = s2;
        tr = { x, y };
      }
      if (s1 > brS) {
        brS = s1;
        br = { x, y };
      }
      if (s2 < blS) {
        blS = s2;
        bl = { x, y };
      }
    }
  }

  if (count < 80 || tlS === Infinity) return null;
  if (maxX - minX < w * 0.2 || maxY - minY < h * 0.2) return null;

  return orderCorners([tl, tr, br, bl]);
}

/** Yorug‘lik bo‘yicha qator/ustun chekkalari (zaxira) */
function cornersFromBrightBounds(gray: Float32Array, w: number, h: number): Point[] | null {
  const thr = Math.max(otsuThreshold(gray) * 0.95, 110);
  const paper = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) paper[i] = gray[i]! >= thr ? 1 : 0;

  const leftX: number[] = [];
  const rightX: number[] = [];
  const topY: number[] = [];
  const botY: number[] = [];

  for (let y = 0; y < h; y++) {
    let L = -1;
    let R = -1;
    let run = 0;
    let bestRun = 0;
    let bestL = -1;
    let bestR = -1;
    for (let x = 0; x < w; x++) {
      if (paper[y * w + x]) {
        if (L < 0) L = x;
        R = x;
        run++;
      } else {
        if (run > bestRun) {
          bestRun = run;
          bestL = L;
          bestR = R;
        }
        L = -1;
        R = -1;
        run = 0;
      }
    }
    if (run > bestRun) {
      bestRun = run;
      bestL = L;
      bestR = R;
    }
    // Eng uzun yorug‘ segment — klaviatura “chiziqlarini” rad etadi
    if (bestL >= 0 && bestR - bestL > w * 0.28) {
      leftX.push(bestL);
      rightX.push(bestR);
    }
  }

  for (let x = 0; x < w; x++) {
    let T = -1;
    let B = -1;
    let run = 0;
    let bestRun = 0;
    let bestT = -1;
    let bestB = -1;
    for (let y = 0; y < h; y++) {
      if (paper[y * w + x]) {
        if (T < 0) T = y;
        B = y;
        run++;
      } else {
        if (run > bestRun) {
          bestRun = run;
          bestT = T;
          bestB = B;
        }
        T = -1;
        B = -1;
        run = 0;
      }
    }
    if (run > bestRun) {
      bestRun = run;
      bestT = T;
      bestB = B;
    }
    if (bestT >= 0 && bestB - bestT > h * 0.28) {
      topY.push(bestT);
      botY.push(bestB);
    }
  }

  if (leftX.length < 12 || topY.length < 12) return null;

  const ls = [...leftX].sort((a, b) => a - b);
  const rs = [...rightX].sort((a, b) => a - b);
  const ts = [...topY].sort((a, b) => a - b);
  const bs = [...botY].sort((a, b) => a - b);

  const L = pctSorted(ls, 0.2);
  const R = pctSorted(rs, 0.8);
  const T = pctSorted(ts, 0.2);
  const B = pctSorted(bs, 0.8);
  if (R - L < w * 0.25 || B - T < h * 0.25) return null;

  return orderCorners([
    { x: L, y: T },
    { x: R, y: T },
    { x: R, y: B },
    { x: L, y: B },
  ]);
}

/** Gradient bo‘yicha burchaklarni qisqa masofada aniqlashtirish (ichkariga ustunlik) */
function refineByGradient(imageData: ImageData, corners: Point[]): Point[] {
  const { width: w, height: h, data } = imageData;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = luminance(data[p]!, data[p + 1]!, data[p + 2]!);
  }
  const mag = (x: number, y: number) => {
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return 0;
    const i = y * w + x;
    const gx =
      -gray[i - w - 1]! +
      gray[i - w + 1]! -
      2 * gray[i - 1]! +
      2 * gray[i + 1]! -
      gray[i + w - 1]! +
      gray[i + w + 1]!;
    const gy =
      -gray[i - w - 1]! -
      2 * gray[i - w]! -
      gray[i - w + 1]! +
      gray[i + w - 1]! +
      2 * gray[i + w]! +
      gray[i + w + 1]!;
    return Math.hypot(gx, gy);
  };

  const cx = w / 2;
  const cy = h / 2;
  const rad = Math.max(8, Math.floor(Math.min(w, h) * 0.025));

  return orderCorners(
    corners.map((c) => {
      let best = c;
      let bestScore = -1;
      for (let dy = -rad; dy <= rad; dy += 1) {
        for (let dx = -rad; dx <= rad; dx += 1) {
          const x = clamp(Math.round(c.x + dx), 1, w - 2);
          const y = clamp(Math.round(c.y + dy), 1, h - 2);
          const m = mag(x, y);
          // Markazga yaqinroq (ichkariga) biroz bonus — orqa fon chekkasiga tortilmasin
          const inward =
            1 + 0.15 * (1 - Math.hypot(x - cx, y - cy) / (Math.hypot(w, h) / 2));
          const score = m * inward;
          if (score > bestScore) {
            bestScore = score;
            best = { x, y };
          }
        }
      }
      return best;
    }),
  );
}

function scoreQuad(corners: Point[], w: number, h: number): number {
  const [tl, tr, br, bl] = orderCorners(corners);
  const area =
    0.5 *
    Math.abs(
      tl.x * tr.y +
        tr.x * br.y +
        br.x * bl.y +
        bl.x * tl.y -
        (tr.x * tl.y + br.x * tr.y + bl.x * br.y + tl.x * bl.y),
    );
  const areaRatio = area / (w * h);
  if (areaRatio < 0.1 || areaRatio > 0.95) return 0;

  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  if (top < 10 || bottom < 10 || left < 10 || right < 10) return 0;

  const avgW = (top + bottom) / 2;
  const avgH = (left + right) / 2;
  const aspect = avgH / avgW;
  // A4 ~1.41; biroz kengroq/torroq ham bo‘lishi mumkin
  const aspectScore = 1 - Math.min(1, Math.abs(aspect - 1.414) / 1.2);

  const parallel =
    1 -
    Math.min(1, Math.abs(top - bottom) / Math.max(top, bottom)) * 0.5 -
    Math.min(1, Math.abs(left - right) / Math.max(left, right)) * 0.5;

  return areaRatio * 0.45 + aspectScore * 0.3 + parallel * 0.25;
}

/** Aniqlash uchun kichikroq rasm — tez va barqaror */
function downscaleForDetect(imageData: ImageData, maxSide = 640): {
  data: ImageData;
  scale: number;
} {
  const { width: w, height: h } = imageData;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  if (scale >= 0.999) return { data: imageData, scale: 1 };
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  src.getContext("2d")!.putImageData(imageData, 0, 0);
  const c = document.createElement("canvas");
  c.width = nw;
  c.height = nh;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, nw, nh);
  return { data: ctx.getImageData(0, 0, nw, nh), scale };
}

/**
 * Qog‘ozni topish: avvalo markaz flood-fill, keyin yorug‘ segmentlar.
 * Natija — faqat list burchaklari (orqa fon emas).
 */
export function detectDocumentCorners(imageData: ImageData): Point[] {
  const fullW = imageData.width;
  const fullH = imageData.height;
  const { data: small, scale } = downscaleForDetect(imageData, 640);
  const { width: w, height: h, data } = small;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = luminance(data[p]!, data[p + 1]!, data[p + 2]!);
  }

  const candidates: Point[][] = [];

  const mask = paperMaskFromCenter(gray, w, h);
  if (mask) {
    const fromMask = cornersFromMask(mask, w, h);
    if (fromMask) candidates.push(fromMask);
  }

  const fromBounds = cornersFromBrightBounds(gray, w, h);
  if (fromBounds) candidates.push(fromBounds);

  candidates.push(defaultCorners(w, h));

  let best = candidates[0]!;
  let bestScore = -1;
  for (const c of candidates) {
    const s = scoreQuad(c, w, h);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }

  // To‘liq o‘lchamga qaytarish
  const scaled = orderCorners(best).map((p) => ({
    x: p.x / scale,
    y: p.y / scale,
  }));
  const refined = refineByGradient(imageData, scaled);
  return insetCorners(refined, fullW, fullH, 0.018);
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
      c[0]!.y = p.y;
      c[1]!.y = p.y;
      break;
    case 2:
      c[1] = p;
      break;
    case 3:
      c[1]!.x = p.x;
      c[2]!.x = p.x;
      break;
    case 4:
      c[2] = p;
      break;
    case 5:
      c[2]!.y = p.y;
      c[3]!.y = p.y;
      break;
    case 6:
      c[3] = p;
      break;
    case 7:
      c[0]!.x = p.x;
      c[3]!.x = p.x;
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

/** Tezkor preview uchun kichik warp */
export function warpPreview(
  source: ImageData,
  corners: Point[],
  maxSide = 420,
): ImageData {
  const aspect = A4_HEIGHT / A4_WIDTH;
  const outW = maxSide;
  const outH = Math.round(maxSide * aspect);
  return warpToA4(source, corners, outW, outH);
}

/** Pechat / muhur / ko‘k-qizil imzo — rangli siyoh */
function isColoredInk(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 35) return false;
  const sat = (max - min) / max;
  if (sat < 0.14) return false;
  const isBlue = b > r + 12 && b > g + 8;
  const isRed = r > g + 18 && r > b + 12;
  const isPurple = r > 70 && b > 70 && g < Math.min(r, b) * 0.88;
  const isGreenStamp = g > r + 15 && g > b + 10 && sat > 0.2;
  return isBlue || isRed || isPurple || isGreenStamp || sat > 0.32;
}

/**
 * Professional skaner:
 * — yumshoq oq fonda o‘qiladigan matn (qalin binary emas)
 * — pechat / muhur / imzo ranglari saqlanadi
 */
export function enhanceDocument(imageData: ImageData, mode: ScanMode = "bw"): ImageData {
  const { width: w, height: h, data } = imageData;
  const out = new ImageData(w, h);
  const od = out.data;

  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = luminance(data[p]!, data[p + 1]!, data[p + 2]!);
  }

  const sample: number[] = [];
  const step = Math.max(1, Math.floor(gray.length / 8000));
  for (let i = 0; i < gray.length; i += step) sample.push(gray[i]!);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.03)] ?? 0;
  const hi = sample[Math.floor(sample.length * 0.97)] ?? 255;
  const span = Math.max(1, hi - lo);

  const stretched = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    stretched[i] = clamp(((gray[i]! - lo) / span) * 255, 0, 255);
  }

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

  const half = 32;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      const r0 = data[p]!;
      const g0 = data[p + 1]!;
      const b0 = data[p + 2]!;
      const g = stretched[i]!;
      const x0 = x - half;
      const y0 = y - half;
      const x1 = x + half + 1;
      const y1 = y + half + 1;
      const area = Math.max(
        1,
        (Math.min(w, x1) - Math.max(0, x0)) * (Math.min(h, y1) - Math.max(0, y0)),
      );
      const mean = rectSum(x0, y0, x1, y1) / area;
      const colored = isColoredInk(r0, g0, b0);

      if (mode === "color" || (mode === "bw" && colored)) {
        // Rangli siyoh / pechat: ranglarni saqlab, fonni biroz oqartirish
        const lift = clamp((mean - g) * 0.35 + 8, -20, 40);
        let rr = clamp(r0 + lift * 0.15, 0, 255);
        let gg = clamp(g0 + lift * 0.15, 0, 255);
        let bb = clamp(b0 + lift * 0.15, 0, 255);
        if (colored) {
          // Muhur/imzo kontrastini biroz kuchaytirish, lekin oqqa yuvmaslik
          const boost = 1.12;
          const mid = (rr + gg + bb) / 3;
          rr = clamp(mid + (rr - mid) * boost, 0, 255);
          gg = clamp(mid + (gg - mid) * boost, 0, 255);
          bb = clamp(mid + (bb - mid) * boost, 0, 255);
        } else if (mode === "color" && g > mean * 0.98 && g > 170) {
          // Oddiy qog‘oz — yumshoq oq
          const t = clamp((g - 160) / 70, 0, 1);
          rr = clamp(rr + (248 - rr) * t * 0.85, 0, 255);
          gg = clamp(gg + (248 - gg) * t * 0.85, 0, 255);
          bb = clamp(bb + (248 - bb) * t * 0.85, 0, 255);
        }
        od[p] = rr;
        od[p + 1] = gg;
        od[p + 2] = bb;
        od[p + 3] = 255;
      } else if (mode === "gray") {
        let v = clamp((g - mean) * 1.25 + 150, 0, 255);
        if (v > 210) v = 245;
        if (v < 50) v = 35;
        od[p] = od[p + 1] = od[p + 2] = v;
        od[p + 3] = 255;
      } else {
        // Yumshoq skaner: binary emas — matn qalinlashmasin
        const thr = mean * 0.97;
        const diff = thr - g;
        let ink: number;
        if (diff > 28) ink = 28;
        else if (diff > 10) ink = clamp(55 + (28 - diff) * 4, 28, 120);
        else if (diff < -20) ink = 252;
        else ink = clamp(210 - diff * 3.2, 90, 252);
        // Juda ochiq joylar — yumshoq oq (qattiq 255 emas)
        if (g > mean * 1.01 && g > 175) ink = Math.max(ink, 248);
        od[p] = od[p + 1] = od[p + 2] = ink;
        od[p + 3] = 255;
      }
    }
  }

  if (mode === "bw") sharpenInPlace(out, 0.18);
  else if (mode === "gray") sharpenInPlace(out, 0.22);
  else sharpenInPlace(out, 0.12);

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
