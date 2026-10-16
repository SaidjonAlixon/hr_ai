/**
 * Xodim shaxsiy hujjatlari (dossier): 6 PDF slot + oila/manzil maydonlari.
 * Jadval avtomatik yaratiladi (drizzle push shart emas).
 */
import { pool } from "@workspace/db";

export const DOC_KEYS = [
  "hire_application",
  "personal_form",
  "id_document",
  "education_document",
  "hire_order",
  "labor_contract",
] as const;

export type DocKey = (typeof DOC_KEYS)[number];

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

export type EmployeeDossier = {
  employeeId: number;
  documents: Record<DocKey, DossierDocSlot>;
  family: FamilyContacts;
  updatedAt: string | null;
  updatedByName: string | null;
};

const EMPTY_SLOT = (): DossierDocSlot => ({
  notes: "",
  fields: {},
  file: null,
});

export function emptyDocuments(): Record<DocKey, DossierDocSlot> {
  return {
    hire_application: EMPTY_SLOT(),
    personal_form: EMPTY_SLOT(),
    id_document: EMPTY_SLOT(),
    education_document: EMPTY_SLOT(),
    hire_order: EMPTY_SLOT(),
    labor_contract: EMPTY_SLOT(),
  };
}

function emptyAddress(): AddressInfo {
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

function newId() {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

let ready: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  ready ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS employee_dossiers (
         employee_id INT PRIMARY KEY,
         documents JSONB NOT NULL DEFAULT '{}'::jsonb,
         family JSONB NOT NULL DEFAULT '{}'::jsonb,
         updated_by_name TEXT,
         updated_at TIMESTAMPTZ
       )`,
    )
    .then(() => undefined)
    .catch((err) => {
      ready = null;
      throw err;
    });
  return ready;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseSlot(raw: unknown): DossierDocSlot {
  const o = asRecord(raw);
  const fileRaw = asRecord(o.file);
  const file: DossierDocFile | null =
    typeof fileRaw.url === "string" && fileRaw.url
      ? {
          url: String(fileRaw.url),
          name: String(fileRaw.name || "hujjat.pdf"),
          mimeType: String(fileRaw.mimeType || "application/pdf"),
          size: Number(fileRaw.size) || 0,
          uploadedAt: String(fileRaw.uploadedAt || new Date().toISOString()),
        }
      : null;
  const fieldsRaw = asRecord(o.fields);
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(fieldsRaw)) {
    if (typeof v === "string" || typeof v === "number") fields[k] = String(v);
  }
  return {
    notes: typeof o.notes === "string" ? o.notes : "",
    fields,
    file,
  };
}

function parseDocuments(raw: unknown): Record<DocKey, DossierDocSlot> {
  const base = emptyDocuments();
  const o = asRecord(raw);
  for (const key of DOC_KEYS) {
    if (o[key] != null) base[key] = parseSlot(o[key]);
  }
  return base;
}

function parseAddress(raw: unknown, fallbackText = ""): AddressInfo {
  if (typeof raw === "string") {
    return { text: raw, lat: null, lng: null };
  }
  const o = asRecord(raw);
  const lat = typeof o.lat === "number" ? o.lat : o.lat != null ? Number(o.lat) : null;
  const lng = typeof o.lng === "number" ? o.lng : o.lng != null ? Number(o.lng) : null;
  return {
    text: typeof o.text === "string" ? o.text : fallbackText,
    lat: Number.isFinite(lat as number) ? (lat as number) : null,
    lng: Number.isFinite(lng as number) ? (lng as number) : null,
  };
}

function parseRelative(raw: unknown): FamilyRelative | null {
  const o = asRecord(raw);
  const fullName = typeof o.fullName === "string" ? o.fullName : "";
  const phone = typeof o.phone === "string" ? o.phone : "";
  const relation = typeof o.relation === "string" ? o.relation : "";
  if (!fullName && !phone && !relation) return null;
  return {
    id: typeof o.id === "string" && o.id ? o.id : newId(),
    relation,
    fullName,
    phone,
  };
}

/** Eski flat format → yangi relatives[] */
function migrateLegacyRelatives(o: Record<string, unknown>): FamilyRelative[] {
  const out: FamilyRelative[] = [];
  const fatherName = typeof o.fatherName === "string" ? o.fatherName : "";
  const fatherPhone = typeof o.fatherPhone === "string" ? o.fatherPhone : "";
  if (fatherName || fatherPhone) {
    out.push({ id: newId(), relation: "Ota", fullName: fatherName, phone: fatherPhone });
  }
  const motherName = typeof o.motherName === "string" ? o.motherName : "";
  const motherPhone = typeof o.motherPhone === "string" ? o.motherPhone : "";
  if (motherName || motherPhone) {
    out.push({ id: newId(), relation: "Ona", fullName: motherName, phone: motherPhone });
  }
  const relativeName = typeof o.relativeName === "string" ? o.relativeName : "";
  const relativePhone = typeof o.relativePhone === "string" ? o.relativePhone : "";
  const relativeRelation = typeof o.relativeRelation === "string" ? o.relativeRelation : "Qarindosh";
  if (relativeName || relativePhone) {
    out.push({
      id: newId(),
      relation: relativeRelation || "Qarindosh",
      fullName: relativeName,
      phone: relativePhone,
    });
  }
  return out;
}

function parseFamily(raw: unknown): FamilyContacts {
  const base = emptyFamily();
  const o = asRecord(raw);

  if (Array.isArray(o.relatives)) {
    base.relatives = o.relatives.map(parseRelative).filter(Boolean) as FamilyRelative[];
  } else {
    base.relatives = migrateLegacyRelatives(o);
  }

  if (o.homeAddress !== undefined) {
    base.homeAddress = parseAddress(o.homeAddress);
  }
  if (o.registrationAddress !== undefined) {
    base.registrationAddress = parseAddress(o.registrationAddress);
  }
  if (typeof o.notes === "string") base.notes = o.notes;
  return base;
}

function rowToDossier(row: {
  employee_id: number;
  documents: unknown;
  family: unknown;
  updated_at: Date | string | null;
  updated_by_name: string | null;
}): EmployeeDossier {
  return {
    employeeId: row.employee_id,
    documents: parseDocuments(row.documents),
    family: parseFamily(row.family),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedByName: row.updated_by_name,
  };
}

export async function getEmployeeDossier(employeeId: number): Promise<EmployeeDossier> {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT employee_id, documents, family, updated_at, updated_by_name
     FROM employee_dossiers WHERE employee_id = $1`,
    [employeeId],
  );
  if (!rows[0]) {
    return {
      employeeId,
      documents: emptyDocuments(),
      family: emptyFamily(),
      updatedAt: null,
      updatedByName: null,
    };
  }
  return rowToDossier(rows[0] as any);
}

function mergeAddress(cur: AddressInfo, patch: unknown): AddressInfo {
  if (typeof patch === "string") return { ...cur, text: patch };
  const o = asRecord(patch);
  const next = { ...cur };
  if (typeof o.text === "string") next.text = o.text;
  if (o.lat === null) next.lat = null;
  else if (o.lat != null && Number.isFinite(Number(o.lat))) next.lat = Number(o.lat);
  if (o.lng === null) next.lng = null;
  else if (o.lng != null && Number.isFinite(Number(o.lng))) next.lng = Number(o.lng);
  return next;
}

export async function upsertEmployeeDossier(
  employeeId: number,
  patch: {
    documents?: Partial<Record<DocKey, Partial<DossierDocSlot>>>;
    family?: Partial<FamilyContacts> & Record<string, unknown>;
  },
  updatedByName: string | null,
): Promise<EmployeeDossier> {
  await ensureTable();
  const current = await getEmployeeDossier(employeeId);

  if (patch.documents) {
    for (const key of DOC_KEYS) {
      const p = patch.documents[key];
      if (!p) continue;
      const slot = current.documents[key];
      if (typeof p.notes === "string") slot.notes = p.notes;
      if (p.fields && typeof p.fields === "object") {
        slot.fields = { ...slot.fields, ...p.fields };
      }
      if (p.file === null) slot.file = null;
      else if (p.file && typeof p.file === "object" && p.file.url) {
        slot.file = {
          url: String(p.file.url),
          name: String(p.file.name || "hujjat.pdf"),
          mimeType: String(p.file.mimeType || "application/pdf"),
          size: Number(p.file.size) || 0,
          uploadedAt: String(p.file.uploadedAt || new Date().toISOString()),
        };
      }
    }
  }

  if (patch.family) {
    const f = patch.family;
    if (Array.isArray(f.relatives)) {
      current.family.relatives = f.relatives
        .map(parseRelative)
        .filter(Boolean) as FamilyRelative[];
    }
    if (f.homeAddress !== undefined) {
      current.family.homeAddress = mergeAddress(current.family.homeAddress, f.homeAddress);
    }
    if (f.registrationAddress !== undefined) {
      current.family.registrationAddress = mergeAddress(
        current.family.registrationAddress,
        f.registrationAddress,
      );
    }
    if (typeof f.notes === "string") current.family.notes = f.notes;
  }

  await pool.query(
    `INSERT INTO employee_dossiers (employee_id, documents, family, updated_by_name, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4, NOW())
     ON CONFLICT (employee_id) DO UPDATE SET
       documents = EXCLUDED.documents,
       family = EXCLUDED.family,
       updated_by_name = EXCLUDED.updated_by_name,
       updated_at = NOW()`,
    [
      employeeId,
      JSON.stringify(current.documents),
      JSON.stringify(current.family),
      updatedByName,
    ],
  );

  return getEmployeeDossier(employeeId);
}

export function isDocKey(v: string): v is DocKey {
  return (DOC_KEYS as readonly string[]).includes(v);
}
