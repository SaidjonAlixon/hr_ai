import { useQuery } from "@tanstack/react-query";

export type UlanganCategory = "ofis" | "dorixona" | "boshqa";

export type UlanganItem = {
  id: number;
  fullName: string;
  login: string;
  role: string;
  roleLabel: string;
  phone: string | null;
  status: string;
  department: string | null;
  position: string | null;
  branch: string | null;
  category: UlanganCategory;
  linked: boolean;
  telegramId: string | null;
  linkedAt: string | null;
};

type Bucket = { total: number; linked: number };

export type UlanganlarResponse = {
  generatedAt: string;
  botUsername: string;
  totals: {
    all: number;
    linked: number;
    unlinked: number;
    byCategory: Record<UlanganCategory, Bucket>;
  };
  items: UlanganItem[];
};

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error || res.statusText || "Xatolik";
  } catch {
    return res.statusText || "Xatolik";
  }
}

export async function fetchUlanganlar(): Promise<UlanganlarResponse> {
  const res = await fetch("/api/telegram/ulanganlar", { credentials: "include" });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as UlanganlarResponse;
}

export function useUlanganlar(enabled = true) {
  return useQuery({
    queryKey: ["telegram-ulanganlar"],
    queryFn: fetchUlanganlar,
    enabled,
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
}

export async function downloadUlanganlarExcel(category: UlanganCategory | "all"): Promise<void> {
  const res = await fetch(`/api/telegram/ulanganlar/export?category=${encodeURIComponent(category)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(await readError(res));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Ulanganlar_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
