/**
 * Vaksina lokatsiya bot — alohida token.
 * HR bot (TELEGRAM_BOT_TOKEN) ga tegmaydi.
 */
const TG_API = "https://api.telegram.org";

export type FilialTelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type FilialTelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: FilialTelegramUser;
    chat: { id: number; type: string };
    text?: string;
    location?: { latitude: number; longitude: number; live_period?: number };
  };
  callback_query?: {
    id: string;
    from: FilialTelegramUser;
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
};

export type FilialKeyboardButton =
  | { text: string }
  | { text: string; request_location: true };

export type FilialInlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

function filialToken(): string | null {
  const t = process.env.TELEGRAM_FILIAL_BOT_TOKEN?.trim();
  return t || null;
}

export function isFilialBotConfigured(): boolean {
  return !!filialToken();
}

async function tgCall<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = filialToken();
  if (!token) throw new Error("TELEGRAM_FILIAL_BOT_TOKEN sozlanmagan");
  const res = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; description?: string; result?: T };
  if (!data.ok) {
    throw new Error(data.description || `Filial bot API xato: ${method}`);
  }
  return data.result as T;
}

export async function filialSendMessage(
  chatId: number | string,
  text: string,
  opts?: {
    parse_mode?: "HTML" | "Markdown";
    reply_markup?:
      | { inline_keyboard: FilialInlineButton[][] }
      | {
          keyboard: FilialKeyboardButton[][];
          resize_keyboard?: boolean;
          one_time_keyboard?: boolean;
        }
      | { remove_keyboard: true };
    disable_web_page_preview?: boolean;
  },
) {
  return tgCall("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: opts?.parse_mode ?? "HTML",
    reply_markup: opts?.reply_markup,
    disable_web_page_preview: opts?.disable_web_page_preview ?? true,
  });
}

export async function filialSendDocument(
  chatId: number | string,
  file: Buffer,
  filename: string,
  opts?: { mimeType?: string; caption?: string },
) {
  const token = filialToken();
  if (!token) throw new Error("TELEGRAM_FILIAL_BOT_TOKEN sozlanmagan");
  if (!file?.length) throw new Error("Fayl bo‘sh");

  const safeName = String(filename || "fayl")
    .replace(/[/\\]/g, "_")
    .slice(0, 120);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append(
    "document",
    new Blob([new Uint8Array(file)], {
      type: opts?.mimeType || "application/octet-stream",
    }),
    safeName,
  );
  if (opts?.caption) form.append("caption", opts.caption.slice(0, 1024));

  const res = await fetch(`${TG_API}/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) {
    throw new Error(data.description || "Filial bot sendDocument xato");
  }
  return data;
}

export async function filialEditMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  opts?: {
    parse_mode?: "HTML" | "Markdown";
    reply_markup?: { inline_keyboard: FilialInlineButton[][] };
  },
) {
  return tgCall("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: opts?.parse_mode ?? "HTML",
    reply_markup: opts?.reply_markup,
    disable_web_page_preview: true,
  });
}

export async function filialSendLocation(
  chatId: number | string,
  latitude: number,
  longitude: number,
  opts?: { horizontal_accuracy?: number },
) {
  return tgCall("sendLocation", {
    chat_id: chatId,
    latitude,
    longitude,
    horizontal_accuracy: opts?.horizontal_accuracy ?? 30,
  });
}

export async function filialAnswerCallback(id: string, text?: string) {
  return tgCall("answerCallbackQuery", {
    callback_query_id: id,
    text: text || undefined,
  });
}

export async function filialGetMe() {
  return tgCall<{ id: number; username?: string; first_name?: string }>("getMe", {});
}

export async function filialSetWebhook(url: string, secret?: string) {
  return tgCall("setWebhook", {
    url,
    secret_token: secret || undefined,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

export async function filialDeleteWebhook() {
  return tgCall("deleteWebhook", { drop_pending_updates: false });
}

export async function filialGetWebhookInfo() {
  return tgCall<{
    url: string;
    pending_update_count: number;
    last_error_message?: string;
  }>("getWebhookInfo", {});
}

export async function filialSetMyCommands(
  commands: Array<{ command: string; description: string }>,
) {
  return tgCall("setMyCommands", { commands });
}

export async function filialSetMyName(name: string) {
  return tgCall("setMyName", { name });
}

export async function filialSetMyDescription(description: string) {
  return tgCall("setMyDescription", { description });
}

export async function filialSetMyShortDescription(description: string) {
  return tgCall("setMyShortDescription", { short_description: description });
}

export async function filialGetUpdates(offset?: number, timeoutSec = 25) {
  return tgCall<FilialTelegramUpdate[]>("getUpdates", {
    offset,
    timeout: timeoutSec,
    allowed_updates: ["message", "callback_query"],
  });
}

export function verifyFilialWebhookSecret(header: string | undefined): boolean {
  const secret = process.env.TELEGRAM_FILIAL_WEBHOOK_SECRET?.trim();
  if (!secret) return true;
  return header === secret;
}

export function filialPublicBaseUrl(): string {
  const raw =
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    "";
  if (!raw) return "";
  const withProto = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProto.replace(/\/$/, "");
}

/** Lokal / private URL bo‘lsa webhook ishlamaydi — polling kerak */
export function shouldFilialUsePolling(): boolean {
  if (!isFilialBotConfigured()) return false;
  if (process.env.TELEGRAM_FILIAL_POLLING === "0") return false;
  if (process.env.TELEGRAM_FILIAL_POLLING === "1") return true;
  const base = filialPublicBaseUrl();
  if (!base) return true;
  try {
    const host = new URL(base).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return true;
  } catch {
    return true;
  }
  return false;
}
