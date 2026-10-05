/** 0 — Asosiy filial. Qolganlari №12 ko‘rinishida. */
export function filialNumberLabel(no: number | null | undefined): string | null {
  if (no == null || !Number.isFinite(Number(no))) return null;
  if (Number(no) === 0) return "Asosiy";
  return `№${Number(no)}`;
}
