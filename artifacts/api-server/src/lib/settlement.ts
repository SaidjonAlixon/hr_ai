export function canViewHisobkitob(role?: string | null) {
  return role === "admin" || role === "director" || role === "moliya";
}

export function canEditHisobkitob(role?: string | null) {
  return role === "admin" || role === "director" || role === "moliya";
}

export function canAdminHisobkitob(role?: string | null) {
  return role === "admin";
}

export function roundMoney(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export type SettlementInputs = {
  sales: number;
  percent: number;
  fiksa: number;
  planBonus: number;
  avans: number;
  inventoryFine: number;
  timeFine: number;
  expiryHold: number;
  cardAmount: number | null;
};

export type SettlementComputed = {
  /** H = G × E — faqat shaxsiy savdo */
  oylikPct: number;
  /** O = H+I+J−K−L−M−N */
  net: number;
  card: number;
  /** Q = O − P */
  diff: number;
  /** U = P / taxNetRate */
  gross: number;
};

export function computeLine(input: SettlementInputs, taxNetRate = 0.88): SettlementComputed {
  const sales = Math.max(0, Number(input.sales) || 0);
  const percent = Math.max(0, Number(input.percent) || 0);
  const oylikPct = roundMoney(percent * sales);
  const net = roundMoney(
    oylikPct +
      (Number(input.fiksa) || 0) +
      (Number(input.planBonus) || 0) -
      (Number(input.avans) || 0) -
      (Number(input.inventoryFine) || 0) -
      (Number(input.timeFine) || 0) -
      (Number(input.expiryHold) || 0),
  );
  const card = input.cardAmount == null ? net : roundMoney(Number(input.cardAmount) || 0);
  const rate = taxNetRate > 0 ? taxNetRate : 0.88;
  return {
    oylikPct,
    net,
    card,
    diff: roundMoney(net - card),
    gross: roundMoney(card / rate),
  };
}

export function computeSheetTotals(
  lines: Array<SettlementInputs & SettlementComputed>,
  planCurrent: number,
  planPrev: number,
) {
  const salesTotal = roundMoney(lines.reduce((s, r) => s + (Number(r.sales) || 0), 0));
  const overPrev = roundMoney(salesTotal - (Number(planPrev) || 0));
  const vsPrevPct = planPrev > 0 ? roundMoney((salesTotal * 100) / planPrev) : 0;
  const vsCurrentPct = planCurrent > 0 ? roundMoney((salesTotal * 100) / planCurrent) : 0;
  return {
    salesTotal,
    overPrev,
    vsPrevPct,
    vsCurrentPct,
    netTotal: roundMoney(lines.reduce((s, r) => s + r.net, 0)),
    cardTotal: roundMoney(lines.reduce((s, r) => s + r.card, 0)),
    grossTotal: roundMoney(lines.reduce((s, r) => s + r.gross, 0)),
    oylikPctTotal: roundMoney(lines.reduce((s, r) => s + r.oylikPct, 0)),
    diffTotal: roundMoney(lines.reduce((s, r) => s + r.diff, 0)),
  };
}
