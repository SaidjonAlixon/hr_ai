import { useQuery } from "@tanstack/react-query";

export type OylikDay = {
  date: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
};

export type OylikReport = {
  month: string;
  monthLabel: string;
  from: string;
  to: string;
  fullName: string;
  role: string;
  roleLabel: string;
  position: string | null;
  branch: string | null;
  departmentId: number;
  workedDays: number;
  lateDays: number;
  incompleteDays: number;
  absentDays: number;
  baseSalary: string | null;
  bonus: string | null;
  deduction: string | null;
  netSalary: string | null;
  status: "pending" | "approved";
  note: string;
  days: OylikDay[];
};

async function loadOylik(month?: string): Promise<OylikReport> {
  const q = month ? `?month=${encodeURIComponent(month)}` : "";
  const res = await fetch(`/api/oylik/me${q}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    let message = "Oylik yuklanmadi";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json();
}

export function useOylikMe(month?: string) {
  return useQuery({
    queryKey: ["oylik", "me", month ?? "current"],
    queryFn: () => loadOylik(month),
    staleTime: 60_000,
  });
}

export function currentMonthKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

export function shiftMonthKey(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
