export type TelegramLinkStatus = {
  linked: boolean;
  office: boolean;
  show: boolean;
  botUsername: string;
};

export type TelegramLinkToken = {
  url: string;
  appUrl: string;
  botUrl: string;
  botUsername: string;
  code: string;
  expiresAt: string;
};

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error || res.statusText || "Xatolik";
  } catch {
    return res.statusText || "Xatolik";
  }
}

export async function fetchTelegramLinkStatus(): Promise<TelegramLinkStatus> {
  const res = await fetch("/api/telegram/link-status", { credentials: "include" });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as TelegramLinkStatus;
}

export async function createTelegramLinkToken(): Promise<TelegramLinkToken> {
  const res = await fetch("/api/telegram/link-token", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as TelegramLinkToken;
}
