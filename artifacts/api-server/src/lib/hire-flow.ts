/** Soddalashtirilgan hire holati (UI) */
export type HireFlow = "yangi" | "jarayonda" | "qabul" | "rad";

export function resolveHireFlow(opts: {
  status?: string | null;
  stage?: string | null;
}): HireFlow {
  const status = String(opts.status || "").toLowerCase();
  const stage = String(opts.stage || "").toLowerCase();
  if (status === "rejected") return "rad";
  if (status === "hired" || stage === "hired") return "qabul";
  if (status === "active" && (stage === "new" || stage === "")) return "yangi";
  if (status === "active") return "jarayonda";
  // legacy / noma'lum
  if (stage === "new") return "yangi";
  return "jarayonda";
}
