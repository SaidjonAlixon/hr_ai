import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasFullPlatformAccess, isHrRole } from "./roles";

export type DisciplineLockRow = {
  id: number;
  userId: number;
  fullName: string;
  position?: string;
  branch?: string;
  strikeN: number;
  eventDate: string;
  kind: string;
  createdAt: string;
  clearedAt: string | null;
  clearedByName: string | null;
};

export type JarimaSwitchState = {
  enabled: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
};

export type DisciplineSummary = {
  month: string;
  jarima?: JarimaSwitchState;
  level3: number;
  level4: number;
  level5: number;
  locks: DisciplineLockRow[];
};

export type DisciplineLockEvent = {
  n: number;
  date: string;
  weekday: string;
  kind: "late" | "absent";
  kindLabel: string;
  checkIn: string | null;
  branch: string;
  shift: string;
  penalty: string;
  trigger: boolean;
};

export type DisciplineLockDetails = {
  id: number;
  userId: number;
  fullName: string;
  position: string;
  branch: string;
  shift: string;
  coordinator: string;
  day: string;
  month: string;
  monthLabel: string;
  strikeN: number;
  triggerDate: string;
  triggerKind: "late" | "absent";
  late: number;
  absent: number;
  events: DisciplineLockEvent[];
  rules: string[];
  createdAt: string;
  clearedAt: string | null;
  clearedByName: string | null;
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

export function useDisciplineLockDetails(id: number | null) {
  return useQuery({
    queryKey: ["discipline-lock-details", id],
    enabled: id != null,
    queryFn: async (): Promise<DisciplineLockDetails> => {
      const res = await fetch(`/api/discipline/locks/${id}/details`, { credentials: "include" });
      if (!res.ok) throw await readError(res, "Asoslar olinmadi");
      return res.json();
    },
  });
}

/** Jarima tizimini hammaga yoqish / o‘chirish */
export function useSetJarimaEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean): Promise<JarimaSwitchState> => {
      const res = await fetch("/api/discipline/jarima", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw await readError(res, "Saqlanmadi");
      return res.json();
    },
    onSuccess: () => {
      for (const key of ["discipline-summary", "explanation-letters", "oylik", "payroll-days"]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["discipline-summary"] });
      void qc.invalidateQueries({ queryKey: ["discipline-lock-details"] });
    },
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
