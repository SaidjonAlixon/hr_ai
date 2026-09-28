export type DismissedStaff = {
  id: number;
  formerUserId: number | null;
  formerEmployeeId: number | null;
  fullName: string;
  phone: string | null;
  role: string | null;
  login: string | null;
  departmentId: number | null;
  departmentName: string | null;
  position: string | null;
  location: string | null;
  hiredAt: string | null;
  registeredAt: string | null;
  dismissedAt: string | null;
  dismissedById: number | null;
  dismissedByName: string | null;
  reason: string | null;
};

export async function fetchDismissedStaff(search?: string): Promise<DismissedStaff[]> {
  const q = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
  const res = await fetch(`/api/users/dismissed${q}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || "Bo‘shatilganlar yuklanmadi");
  }
  return body as DismissedStaff[];
}

/** archive — faqat Bo‘shatilganlarda qoladi. purge — hech qayerda qolmaydi. */
export async function dismissUser(
  id: number,
  reason?: string,
  mode: "archive" | "purge" = "archive",
): Promise<void> {
  const params = new URLSearchParams();
  if (reason?.trim()) params.set("reason", reason.trim());
  if (mode === "purge") params.set("mode", "purge");
  const q = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`/api/users/${id}${q}`, {
    method: "DELETE",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || "O‘chirilmadi");
  }
}

/** Bo‘shatilganlar arxividan ham o‘chirish — qaytarib bo‘lmaydi */
export async function purgeDismissed(id: number): Promise<void> {
  const res = await fetch(`/api/users/dismissed/${id}`, {
    method: "DELETE",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || "O‘chirilmadi");
  }
}
