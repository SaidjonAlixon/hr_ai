import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type MalumotnomaStaff = {
  employeeId: number;
  userId: number | null;
  fullName: string;
  position: string;
  branch: string;
  shiftLabel: string;
  workStart: string;
  workEnd: string;
  role: string | null;
};

export type MalumotnomaItem = {
  id: number;
  docNo: string;
  employeeId: number;
  fullName: string;
  position: string;
  branch: string;
  shiftLabel: string;
  workStart: string;
  workEnd: string;
  companyName: string;
  directorName: string;
  directorTitle: string;
  status: "active" | "cancelled";
  issuedAt: string;
  issuedAtLabel: string;
  issuedByName: string | null;
  verifyUrl: string;
  pdfUrl: string;
};

export type MalumotnomaSettings = {
  companyName: string;
  directorTitle: string;
  directorName: string;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || "Xatolik");
  return data as T;
}

export function useMalumotnomaStaff(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ["malumotnoma-staff", q],
    queryFn: () => api<{ items: MalumotnomaStaff[] }>(`/api/malumotnoma/staff?q=${encodeURIComponent(q)}`),
    enabled,
    staleTime: 30_000,
  });
}

export function useMalumotnomaList(enabled: boolean) {
  return useQuery({
    queryKey: ["malumotnoma-list"],
    queryFn: () => api<{ items: MalumotnomaItem[] }>("/api/malumotnoma"),
    enabled,
    staleTime: 15_000,
  });
}

export function useMalumotnomaSettings(enabled: boolean) {
  return useQuery({
    queryKey: ["malumotnoma-settings"],
    queryFn: () => api<MalumotnomaSettings>("/api/malumotnoma/settings"),
    enabled,
  });
}

export function useSaveMalumotnomaSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MalumotnomaSettings) =>
      api<MalumotnomaSettings>("/api/malumotnoma/settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["malumotnoma-settings"] }),
  });
}

export function useCreateMalumotnoma() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (employeeId: number) =>
      api<MalumotnomaItem>("/api/malumotnoma", { method: "POST", body: JSON.stringify({ employeeId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["malumotnoma-list"] }),
  });
}

export function useCancelMalumotnoma() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<MalumotnomaItem>(`/api/malumotnoma/${id}/cancel`, { method: "POST", body: "{}" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["malumotnoma-list"] }),
  });
}

export function useDeleteMalumotnoma() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ ok: boolean }>(`/api/malumotnoma/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["malumotnoma-list"] }),
  });
}

export function useMalumotnomaVerify(token: string) {
  return useQuery({
    queryKey: ["malumotnoma-verify", token],
    queryFn: async () => {
      const res = await fetch(`/api/malumotnoma/verify/${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || "Tekshirib bo‘lmadi");
      return data as {
        valid: boolean;
        cancelled?: boolean;
        status?: string;
        docNo: string;
        fullName: string;
        position: string;
        branch: string;
        shiftLabel: string;
        workStart: string;
        workEnd: string;
        companyName: string;
        issuedAtLabel: string;
        pdfUrl: string;
      };
    },
    enabled: Boolean(token),
  });
}

export async function downloadMalumotnomaPdf(id: number, fullName: string) {
  const res = await fetch(`/api/malumotnoma/${id}/pdf?download=1`, { credentials: "include" });
  if (!res.ok) throw new Error("PDF yuklanmadi");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Malumotnoma_${fullName.replace(/\s+/g, "_")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export function canManageMalumotnoma(role?: string | null) {
  const r = String(role || "").toLowerCase();
  return (
    r === "admin" ||
    r === "asoschi" ||
    r === "director" ||
    r === "direktor_yordamchisi" ||
    r.startsWith("hr_")
  );
}
