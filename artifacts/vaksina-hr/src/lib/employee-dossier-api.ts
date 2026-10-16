import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const DOC_KEYS = [
  "hire_application",
  "personal_form",
  "id_document",
  "education_document",
  "hire_order",
  "labor_contract",
] as const;

export type DocKey = (typeof DOC_KEYS)[number];

export const DOC_LABELS: Record<DocKey, string> = {
  hire_application: "Ishga qabul qilish haqidagi ariza",
  personal_form: "Shaxsiy varaqa / so‘rovnoma",
  id_document: "Shaxsni tasdiqlovchi hujjat",
  education_document: "Ma’lumoti haqidagi hujjat",
  hire_order: "Ishga qabul qilish haqidagi buyruq",
  labor_contract: "Mehnat shartnomasi ma’lumotlari",
};

export type DossierDocFile = {
  url: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export type DossierDocSlot = {
  notes: string;
  fields: Record<string, string>;
  file: DossierDocFile | null;
};

export type FamilyRelative = {
  id: string;
  relation: string;
  fullName: string;
  phone: string;
};

export type AddressInfo = {
  text: string;
  lat: number | null;
  lng: number | null;
};

export type FamilyContacts = {
  relatives: FamilyRelative[];
  homeAddress: AddressInfo;
  registrationAddress: AddressInfo;
  notes: string;
};

export type EmploymentMeta = {
  hiredAt: string | null;
  employmentStatus: string | null;
  dismissedAt: string | null;
  fullName: string | null;
  position: string | null;
};

export type EmployeeDossier = {
  employeeId: number;
  documents: Record<DocKey, DossierDocSlot>;
  family: FamilyContacts;
  updatedAt: string | null;
  updatedByName: string | null;
  employment?: EmploymentMeta | null;
};

export const RELATION_PRESETS = [
  "Ota",
  "Ona",
  "Aka",
  "Uka",
  "Opa",
  "Singil",
  "Turmush o‘rtog‘i",
  "Amaki",
  "Tog‘a",
  "Xola",
  "Jiyan",
] as const;

export function emptyAddress(): AddressInfo {
  return { text: "", lat: null, lng: null };
}

export function emptyFamily(): FamilyContacts {
  return {
    relatives: [],
    homeAddress: emptyAddress(),
    registrationAddress: emptyAddress(),
    notes: "",
  };
}

export function newRelativeId() {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeFamily(raw: FamilyContacts | null | undefined): FamilyContacts {
  if (!raw) return emptyFamily();
  const relatives = Array.isArray(raw.relatives)
    ? raw.relatives.map((r) => ({
        id: r.id || newRelativeId(),
        relation: r.relation || "",
        fullName: r.fullName || "",
        phone: r.phone || "",
      }))
    : [];
  const normAddr = (a: AddressInfo | string | undefined): AddressInfo => {
    if (!a) return emptyAddress();
    if (typeof a === "string") return { text: a, lat: null, lng: null };
    return {
      text: a.text || "",
      lat: typeof a.lat === "number" ? a.lat : null,
      lng: typeof a.lng === "number" ? a.lng : null,
    };
  };
  return {
    relatives,
    homeAddress: normAddr(raw.homeAddress),
    registrationAddress: normAddr(raw.registrationAddress),
    notes: raw.notes || "",
  };
}

export function dossierQueryKey(employeeId: number) {
  return ["employee-dossier", employeeId] as const;
}

async function parseError(res: Response) {
  const body = await res.json().catch(() => ({}));
  return (body as { error?: string }).error || `Xatolik ${res.status}`;
}

export async function fetchEmployeeDossier(employeeId: number): Promise<EmployeeDossier> {
  const res = await fetch(`/api/employees/${employeeId}/dossier`, { credentials: "include" });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as EmployeeDossier;
  return { ...data, family: normalizeFamily(data.family) };
}

export async function patchEmployeeDossier(
  employeeId: number,
  patch: { documents?: Partial<Record<DocKey, Partial<DossierDocSlot>>>; family?: Partial<FamilyContacts> },
): Promise<EmployeeDossier> {
  const res = await fetch(`/api/employees/${employeeId}/dossier`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as EmployeeDossier;
  return { ...data, family: normalizeFamily(data.family) };
}

export async function uploadDossierFile(
  employeeId: number,
  docKey: DocKey,
  blob: Blob,
  filename: string,
): Promise<EmployeeDossier> {
  const mime =
    blob.type ||
    (filename.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
  const res = await fetch(`/api/employees/${employeeId}/dossier/${docKey}/file`, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": mime,
      "X-File-Name": encodeURIComponent(filename),
    },
    body: blob,
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as EmployeeDossier;
  return { ...data, family: normalizeFamily(data.family) };
}

export async function deleteDossierFile(employeeId: number, docKey: DocKey): Promise<EmployeeDossier> {
  const res = await fetch(`/api/employees/${employeeId}/dossier/${docKey}/file`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as EmployeeDossier;
  return { ...data, family: normalizeFamily(data.family) };
}

export function useEmployeeDossier(employeeId: number | null) {
  return useQuery({
    queryKey: dossierQueryKey(employeeId ?? 0),
    queryFn: () => fetchEmployeeDossier(employeeId!),
    enabled: Number.isFinite(employeeId) && (employeeId ?? 0) > 0,
  });
}

export function usePatchEmployeeDossier(employeeId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof patchEmployeeDossier>[1]) =>
      patchEmployeeDossier(employeeId, patch),
    onSuccess: (data) => {
      qc.setQueryData(dossierQueryKey(employeeId), data);
    },
  });
}
