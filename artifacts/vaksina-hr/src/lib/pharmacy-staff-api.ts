import { useMutation, useQueryClient } from "@tanstack/react-query";

export type PharmacyStaffRole = "mudir" | "farmasevt" | "stajyor";

export type PharmacyStaffInput = {
  firstName: string;
  lastName: string;
  phone: string;
  role: PharmacyStaffRole;
  location?: string;
};

export type PharmacyStaffResult = {
  id: number;
  fullName: string;
  role: string;
  login: string;
  phone: string | null;
  temporaryPassword: string;
  employeeId: number;
  orgRole: string | null;
  location: string | null;
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
  return res.json() as Promise<T>;
}

export function useCreatePharmacyStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PharmacyStaffInput) =>
      apiFetch<PharmacyStaffResult>("/pharmacy-network/staff", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/employees"] });
      qc.invalidateQueries({
        predicate: (q) =>
          JSON.stringify(q.queryKey).toLowerCase().includes("employee"),
      });
    },
  });
}
