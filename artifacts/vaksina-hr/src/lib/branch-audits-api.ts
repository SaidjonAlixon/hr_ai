import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type AuditAnswer = "yes" | "no" | null;

export type AuditChecklistItem = {
  id: string;
  label: string;
  answer: AuditAnswer;
  note?: string | null;
};

export type AuditCategory = {
  id: string;
  title: string;
  items: AuditChecklistItem[];
};

export type BranchAudit = {
  id: number;
  managerEmployeeId: number;
  branchLocation: string | null;
  managerName: string | null;
  visitDate: string;
  visitName: string;
  monthLabel: string | null;
  coordinatorId: number;
  coordinatorName: string | null;
  generalNote: string | null;
  categories: AuditCategory[];
  scorePercent: number;
  answeredCount: number;
  yesCount: number;
  noCount: number;
  totalCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type AuditBranchOption = {
  id: number;
  managerName: string;
  branchLocation: string;
};

export type BranchAuditInput = {
  managerEmployeeId: number;
  visitDate: string;
  visitName: string;
  monthLabel?: string | null;
  generalNote?: string | null;
  categories: AuditCategory[];
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message || `Xato ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Standart filial audit shabloni — barcha javoblar boshida tanlanmagan */
export function createEmptyAuditTemplate(): AuditCategory[] {
  const mk = (id: string, label: string): AuditChecklistItem => ({
    id,
    label,
    answer: null,
    note: null,
  });

  return [
    {
      id: "tashqi",
      title: "Tashqi hududni tekshirish",
      items: [
        mk("t1", "Jaluzi (pardalar) ochilganligi"),
        mk("t2", "Eshik ochiq/yopiqligi tartibda ekanligi"),
        mk("t3", "Tashqi hudud tozalanganligi"),
        mk("t4", "Reklama peshtoqi (banner/lightbox) yoqilgan/ishlab turganligi"),
        mk("t5", "Kirish oldi toza, reklama materiallari joyida"),
      ],
    },
    {
      id: "ichki",
      title: "Ichki hududni tekshirish",
      items: [
        mk("i1", "Zal toza va tartibli"),
        mk("i2", "Vitrinalar toza, mahsulotlar tartibda joylashgan"),
        mk("i3", "Yoritish yetarli va ishlayotgan"),
        mk("i4", "Konditsioner / harorat normal"),
        mk("i5", "Savdo zonasi toza, axlat qutilari joyida"),
      ],
    },
    {
      id: "xodim",
      title: "Xodimlar va ko‘rinish",
      items: [
        mk("x1", "Xodimlar forma kiygan"),
        mk("x2", "Beyjik / ism yozuvi ko‘rinadi"),
        mk("x3", "Mijozlarga xushmuomalalik"),
        mk("x4", "Ish stoli / kassa zonasi tartibli"),
      ],
    },
    {
      id: "dori",
      title: "Dori va saqlash",
      items: [
        mk("d1", "Muddati o‘tgan dorilar alohida ajratilgan"),
        mk("d2", "Sovuq zanjir (muzlatgich) harorati nazoratda"),
        mk("d3", "Retseptli dorilar tartibda saqlanadi"),
        mk("d4", "Ombor / javonlar tartibli va belgilangan"),
      ],
    },
    {
      id: "hujjat",
      title: "Hujjatlar va nazorat",
      items: [
        mk("h1", "Litsenziya / ruxsatnomalar joyida"),
        mk("h2", "Kunlik hisobot / kassa yozuvlari yuritiladi"),
        mk("h3", "Nazorat daftarlarida yozuvlar mavjud"),
        mk("h4", "Yong‘in xavfsizligi vositalari joyida"),
      ],
    },
  ];
}

export function scoreFromCategories(categories: AuditCategory[]) {
  const items = categories.flatMap((c) => c.items);
  const total = items.length;
  const yes = items.filter((i) => i.answer === "yes").length;
  const no = items.filter((i) => i.answer === "no").length;
  const answered = yes + no;
  const scorePercent = answered === 0 ? 0 : Math.round((yes / answered) * 100);
  return { total, yes, no, answered, scorePercent };
}

export function useAuditBranches() {
  return useQuery({
    queryKey: ["branch-audits", "branches"],
    queryFn: () => apiFetch<AuditBranchOption[]>("/branch-audits/branches"),
  });
}

export function useBranchAudits(managerId?: number | null) {
  const qs = managerId ? `?managerId=${managerId}` : "";
  return useQuery({
    queryKey: ["branch-audits", { managerId: managerId ?? null }],
    queryFn: () => apiFetch<BranchAudit[]>(`/branch-audits${qs}`),
  });
}

export function useCreateBranchAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: BranchAuditInput) =>
      apiFetch<BranchAudit>("/branch-audits", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-audits"] });
    },
  });
}

export function useDeleteBranchAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/branch-audits/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branch-audits"] });
    },
  });
}
