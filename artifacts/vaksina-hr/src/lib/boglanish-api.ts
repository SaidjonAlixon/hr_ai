export type BoglanishBranch = {
  branchEmployeeId: number;
  branchName: string;
  mudirName: string;
  primaryPhone: string;
  extraPhones: string[];
  telegramNick: string;
  contactFromHm: string;
  contactToHm: string;
  required: boolean;
  complete: boolean;
  updatedAt: string | null;
};

export type BoglanishMe = {
  role: string;
  required: boolean;
  complete: boolean;
  missingCount: number;
  missingBranchNames: string[];
  branches: BoglanishBranch[];
};

export type BoglanishStatus = {
  show: boolean;
  required: boolean;
  complete: boolean;
  missingBranchNames: string[];
  branchCount?: number;
};

export type BoglanishSavePayload = {
  primaryPhone: string;
  extraPhones: string[];
  telegramNick: string;
  contactFromHm: string;
  contactToHm: string;
};

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error || res.statusText || "Xatolik";
  } catch {
    return res.statusText || "Xatolik";
  }
}

export async function fetchBoglanishMe(): Promise<BoglanishMe> {
  const res = await fetch("/api/boglanish/me", { credentials: "include" });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as BoglanishMe;
}

export async function fetchBoglanishStatus(): Promise<BoglanishStatus> {
  const res = await fetch("/api/boglanish/status", { credentials: "include" });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as BoglanishStatus;
}

export async function saveBoglanishBranch(
  branchEmployeeId: number,
  payload: BoglanishSavePayload,
): Promise<BoglanishBranch> {
  const res = await fetch(`/api/boglanish/branch/${branchEmployeeId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { branch: BoglanishBranch };
  return data.branch;
}
