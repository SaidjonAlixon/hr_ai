import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

export type DeviceAcsEvent = {
  time: string;
  employeeNo?: string;
  name?: string;
  serialNo?: number;
  attendanceStatus?: string;
  label?: string;
};

function deviceConfig() {
  const base = String(process.env.HIKVISION_DEVICE_URL || "https://192.168.3.102")
    .trim()
    .replace(/\/+$/, "");
  const user = String(process.env.HIKVISION_DEVICE_USER || "admin").trim();
  const pass = String(process.env.HIKVISION_DEVICE_PASSWORD || "").trim();
  return { base, user, pass };
}

export function hikvisionDeviceConfigured(): boolean {
  return Boolean(deviceConfig().pass);
}

async function curlDigestJson(
  method: "GET" | "POST",
  apiPath: string,
  body?: unknown,
): Promise<unknown> {
  const { base, user, pass } = deviceConfig();
  if (!pass) {
    throw new Error("HIKVISION_DEVICE_PASSWORD .env da yo‘q");
  }
  const args = [
    "-k",
    "-s",
    "-S",
    "--digest",
    "-u",
    `${user}:${pass}`,
    "-H",
    "Content-Type: application/json",
    "-X",
    method,
    "--max-time",
    "45",
    "--connect-timeout",
    "8",
  ];
  let tmp: string | null = null;
  try {
    if (body != null) {
      tmp = path.join(os.tmpdir(), `hik-acs-${process.pid}-${Date.now()}.json`);
      await fs.writeFile(tmp, JSON.stringify(body), "utf8");
      args.push("--data-binary", `@${tmp}`);
    }
    args.push(`${base}${apiPath}`);
    const { stdout } = await execFileAsync("curl", args, {
      encoding: "utf8",
      maxBuffer: 25 * 1024 * 1024,
    });
    if (!stdout?.trim()) return null;
    try {
      return JSON.parse(stdout);
    } catch {
      logger.warn({ preview: stdout.slice(0, 200) }, "hikvision device non-json");
      throw new Error("Qurilma javobi JSON emas");
    }
  } finally {
    if (tmp) await fs.unlink(tmp).catch(() => undefined);
  }
}

function mapInfo(e: Record<string, unknown>): DeviceAcsEvent | null {
  const time = String(e.time || "").trim();
  if (!time) return null;
  return {
    time,
    employeeNo: String(e.employeeNoString || e.employeeNo || "").trim() || undefined,
    name: String(e.name || "").trim() || undefined,
    serialNo: Number(e.serialNo) || undefined,
    attendanceStatus: String(e.attendanceStatus || "").trim() || undefined,
    label: String(e.label || "").trim() || undefined,
  };
}

/**
 * Kunlik Face ID / davomat eventlari (minor 75) — qurilma AcsEvent qidiruvi.
 */
export async function fetchDeviceAttendanceEvents(workDate: string): Promise<DeviceAcsEvent[]> {
  const startTime = `${workDate}T00:00:00+05:00`;
  const endTime = `${workDate}T23:59:59+05:00`;
  const out: DeviceAcsEvent[] = [];
  let position = 0;
  const pageSize = 30;
  for (let page = 0; page < 40; page += 1) {
    const raw = (await curlDigestJson("POST", "/ISAPI/AccessControl/AcsEvent?format=json", {
      AcsEventCond: {
        searchID: `hr-sync-${workDate}-${page}`,
        searchResultPosition: position,
        maxResults: pageSize,
        major: 5,
        minor: 75,
        startTime,
        endTime,
      },
    })) as Record<string, unknown> | null;

    const acs = (raw?.AcsEvent || raw?.acsEvent || {}) as Record<string, unknown>;
    const list = (acs.InfoList || acs.infoList || []) as Record<string, unknown>[];
    const arr = Array.isArray(list) ? list : [];
    for (const row of arr) {
      const mapped = mapInfo(row);
      if (mapped) out.push(mapped);
    }
    const total = Number(acs.totalMatches || acs.numOfMatches || 0) || out.length;
    position += arr.length;
    if (!arr.length || position >= total || arr.length < pageSize) break;
  }
  out.sort((a, b) => a.time.localeCompare(b.time));
  return out;
}
