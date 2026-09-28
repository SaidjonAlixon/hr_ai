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

/** Foydalanuvchini o‘chirish → Bo‘shatilganlar arxiviga o‘tadi, login/parol bekor */
export async function dismissUser(id: number, reason?: string): Promise<void> {
  const q = reason?.trim() ? `?reason=${encodeURIComponent(reason.trim())}` : "";
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
