/** Qurilma «old» tomoni (ekran yuqorisi) — xarita shimoliga nisbatan clockwise ° */

export function screenOrientationDeg(): number {
  if (typeof window === "undefined") return 0;
  if (typeof screen !== "undefined" && screen.orientation && typeof screen.orientation.angle === "number") {
    return screen.orientation.angle;
  }
  if (typeof window.orientation === "number") return window.orientation;
  return 0;
}

export function normalizeHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Telefon oldi (yuqori qirrasi) qayerga qaraganini beradi.
 * iOS: webkitCompassHeading · Android: absolute alpha.
 */
export function deviceHeadingFromOrientation(event: DeviceOrientationEvent): number | null {
  const e = event as DeviceOrientationEvent & {
    webkitCompassHeading?: number;
    absolute?: boolean;
  };

  // iOS Safari — magnetic north, clockwise (ekran yo‘nalishi hisobga olingan)
  if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading)) {
    return normalizeHeading(e.webkitCompassHeading);
  }

  if (typeof e.alpha !== "number" || !Number.isFinite(e.alpha)) return null;

  const screen = screenOrientationDeg();
  const absolute = e.absolute === true || event.type === "deviceorientationabsolute";

  // Absolute / Chrome: alpha — shimoldan counter-clockwise.
  // Xarita: shimoldan clockwise → 360 - alpha, ekran burilishi bilan.
  if (absolute) {
    return normalizeHeading(360 - e.alpha - screen);
  }

  // Relative (kam ishonchli) — xuddi shu formula
  return normalizeHeading(360 - e.alpha - screen);
}
