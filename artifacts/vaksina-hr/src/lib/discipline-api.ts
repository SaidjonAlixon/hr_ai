import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasFullPlatformAccess, isHrRole } from "./roles";

export type DisciplineLockRow = {
  id: number;
  userId: number;
  fullName: string;
  strikeN: number;
  eventDate: string;
  kind: string;
  createdAt: string;
  clearedAt: string | null;
  clearedByName: string | null;
};

export type DisciplineSummary = {
  month: string;
  level3: number;
  level4: number;
  level5: number;
  locks: DisciplineLockRow[];
};

export function canSeeDiscipline(role?: string | null) {
  return hasFullPlatformAccess(role) || isHrRole(role);
}

async function readError(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error || fallback);
}

export function useDisciplineSummary(month: string, enabled: boolean) {
  return useQuery({
    queryKey: ["discipline-summary", month],
    enabled,
    refetchInterval: 60_000,
    queryFn: async (): Promise<DisciplineSummary> => {
      const res = await fetch(`/api/discipline/summary?month=${encodeURIComponent(month)}`, { credentials: "include" });
      if (!res.ok) throw await readError(res, "Intizom ma’lumoti olinmadi");
      return res.json();
    },
  });
}

export function useClearDisciplineLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/discipline/locks/${id}/clear`, { method: "POST", credentials: "include" });
      if (!res.ok) throw await readError(res, "Blok ochilmadi");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["discipline-summary"] }),
  });
}

export async function downloadDisciplinePdf(month: string) {
  const res = await fetch(`/api/discipline/report.pdf?month=${encodeURIComponent(month)}`, { credentials: "include" });
  if (!res.ok) throw await readError(res, "PDF yuklanmadi");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `intizom_${month}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
