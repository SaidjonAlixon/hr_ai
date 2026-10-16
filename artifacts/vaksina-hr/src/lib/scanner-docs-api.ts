export type ScannerDoc = {
  id: number;
  userId: number;
  userName: string | null;
  userRole: string | null;
  filename: string;
  fileUrl: string;
  size: number;
  pageCount: number;
  sentToTx: boolean;
  createdAt: string;
  expiresAt: string;
  expiresInSec: number;
  ttlHours?: number;
  message?: string;
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    let message = "Xatolik";
    try {
      const body = await res.json();
      message = (body as { error?: string }).error || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** PDF ni 1 soatga saqlash + TX bo‘limiga yuborish */
export async function saveScannerDoc(
  blob: Blob,
  filename: string,
  pageCount = 1,
): Promise<ScannerDoc> {
  const res = await fetch("/api/scanner-docs", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/pdf",
      "X-File-Name": encodeURIComponent(filename),
      "X-Page-Count": String(pageCount),
    },
    body: blob,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Saqlash ${res.status}`);
  return body as ScannerDoc;
}

export async function fetchScannerDocsInbox(): Promise<ScannerDoc[]> {
  return apiFetch<ScannerDoc[]>("/scanner-docs");
}

export async function fetchMyScannerDocs(): Promise<ScannerDoc[]> {
  return apiFetch<ScannerDoc[]>("/scanner-docs/mine");
}

export function scannerDocDownloadUrl(id: number) {
  return `/api/scanner-docs/${id}/file`;
}

export function formatExpiresIn(sec: number): string {
  if (sec <= 0) return "muddati tugagan";
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} daqiqa`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} soat ${rm} daqiqa` : `${h} soat`;
}
