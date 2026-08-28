export const REVIZIYA_ROLES = ["revizor", "reviziya_rahbar"] as const;

export function isReviziyaRole(role?: string | null): boolean {
  return role === "revizor" || role === "reviziya_rahbar";
}

export function isReviziyaRahbar(role?: string | null): boolean {
  return role === "reviziya_rahbar";
}

export function canViewReviziya(role?: string | null): boolean {
  return (
    isReviziyaRole(role) ||
    role === "admin" ||
    role === "director" ||
    role === "moliya" ||
    role === "sb" ||
    role === "sb_boshliq" ||
    role === "mudir"
  );
}

export function canCreateReviziyaDoc(role?: string | null): boolean {
  return isReviziyaRole(role) || role === "admin";
}

export function canApproveReviziyaHead(role?: string | null): boolean {
  return role === "reviziya_rahbar" || role === "admin";
}

export function canApproveAccountant(role?: string | null): boolean {
  return role === "moliya" || role === "director" || role === "admin";
}

export function canStorno(role?: string | null): boolean {
  return role === "reviziya_rahbar" || role === "admin" || role === "director";
}

export function canExportReviziya(role?: string | null): boolean {
  return role === "reviziya_rahbar" || role === "admin" || role === "director";
}

export function canSbReview(role?: string | null): boolean {
  return role === "sb" || role === "sb_boshliq" || role === "admin" || role === "director";
}

export const DOC_TYPES = [
  "assignment",
  "inventory_act",
  "cash_act",
  "cash_receipt",
  "cash_handover",
  "goods_transfer",
  "explanation",
  "protocol",
] as const;

export type RevisionDocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABEL: Record<string, string> = {
  assignment: "Reviziya topshirig‘i",
  inventory_act: "Inventarizatsiya dalolatnomasi",
  cash_act: "Kassa tekshiruvi dalolatnomasi",
  cash_receipt: "Naqd pulni qabul qilish (filial → revizor)",
  cash_handover: "Markaziy kassa/bankka topshirish",
  goods_transfer: "Muddati o‘tgan / brak tovar qabul-topshirish",
  explanation: "Tushuntirish xati",
  protocol: "Yakuniy reviziya bayonnomasi",
};

export const MAIN_FLOW = [
  "planned",
  "en_route",
  "inspecting",
  "reconciling",
  "signed",
  "accounting_approved",
  "closed",
] as const;

export const SHORTAGE_FLOW = ["awaiting_explanation", "sb_review", "recovery"] as const;

export const STATUS_LABEL: Record<string, string> = {
  planned: "Rejalashtirilgan",
  en_route: "Yo‘lda",
  inspecting: "Tekshiruvda",
  reconciling: "Solishtirish",
  signed: "Imzolangan",
  accounting_approved: "Buxgalteriya tasdig‘i",
  closed: "Yopilgan",
  awaiting_explanation: "Tushuntirish kutilmoqda",
  sb_review: "SB tekshiruvi",
  recovery: "Undirish/Hisobdan chiqarish",
  storno: "Storno",
};

export const SHORTAGE_REASONS = [
  { code: "count_error", label: "Sanoq xatosi" },
  { code: "sale_error", label: "Sotuv xatosi" },
  { code: "theft", label: "O‘g‘irlik" },
  { code: "defect", label: "Brak" },
  { code: "expiry", label: "Muddat" },
  { code: "undoc", label: "Hujjatsiz harakat" },
];

export const DEFAULT_DICTS: Array<{ kind: string; code: string; label: string }> = [
  ...SHORTAGE_REASONS.map((r) => ({ kind: "shortage_reason", ...r })),
  { kind: "violation", code: "cash_diff", label: "Kassa farqi" },
  { kind: "violation", code: "stock_diff", label: "Tovar kamomadi" },
  { kind: "violation", code: "expiry_share", label: "Muddati o‘tgan ulushi" },
  { kind: "violation", code: "no_docs", label: "Hujjatsiz harakat" },
  { kind: "product_category", code: "rx", label: "Retseptli" },
  { kind: "product_category", code: "otc", label: "Retseptsiz" },
  { kind: "product_category", code: "cos", label: "Kosmetika" },
  { kind: "product_category", code: "cons", label: "Iste’mol" },
];

export const LOCKED_STATUSES = new Set(["closed", "storno"]);

export const FORBIDDEN_ACTIONS = [
  "change_price",
  "sales_return",
  "manual_stock_edit",
  "delete_document",
] as const;

export function nextMainStatus(current: string): string | null {
  const i = MAIN_FLOW.indexOf(current as (typeof MAIN_FLOW)[number]);
  if (i < 0 || i >= MAIN_FLOW.length - 1) return null;
  return MAIN_FLOW[i + 1]!;
}

export const SHORTAGE_LIMIT = 500_000;
export const IN_TRANSIT_HOURS = 4;
