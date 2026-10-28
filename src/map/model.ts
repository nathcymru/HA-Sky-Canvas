import type { HassEntity } from "../types";

export interface MapFrame { id: string; valid_time: string; model_run: string; }
export interface ForecastMap { frames: MapFrame[]; fetchedAt: number; modelRun: number; stale: boolean; region: string; }

/** Require real ISO calendar instants, including an explicit UTC offset. */
function timestamp(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return NaN;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return NaN;
  return Date.parse(value);
}

export function readForecastMap(entity: HassEntity | undefined, now = Date.now()): ForecastMap | null {
  if (!entity || !Number.isFinite(now) || ["unknown", "unavailable"].includes(entity.state)) return null;
  const a = entity.attributes;
  if (!Array.isArray(a.frames) || a.frames.length > 25) return null;
  const fetchedAt = timestamp(a.fetched_at);
  const modelRun = timestamp(a.model_run);
  if (!Number.isFinite(fetchedAt) || !Number.isFinite(modelRun)) return null;
  const ids = new Set<string>();
  const times = new Set<number>();
  const frames: MapFrame[] = [];
  for (const value of a.frames) {
    if (!value || typeof value !== "object") return null;
    const frame = value as Record<string, unknown>;
    if (typeof frame.id !== "string" || !/^[a-f0-9]{64}$/.test(frame.id) || ids.has(frame.id)) return null;
    const valid = timestamp(frame.valid_time);
    const run = timestamp(frame.model_run);
    if (!Number.isFinite(valid) || !Number.isFinite(run) || run !== modelRun || times.has(valid)) return null;
    ids.add(frame.id);
    times.add(valid);
    if (valid < now - 3_600_000 || valid > now + 24 * 3_600_000) continue;
    frames.push({ id: frame.id, valid_time: String(frame.valid_time), model_run: String(frame.model_run) });
  }
  frames.sort((left, right) => Date.parse(left.valid_time) - Date.parse(right.valid_time));
  if (!frames.length) return null;
  const region = typeof a.region === "string" ? a.region : a.region && typeof a.region === "object" ? (a.region as Record<string, unknown>).name : undefined;
  return { frames, fetchedAt, modelRun,
    stale: fetchedAt > now + 300_000 || now - fetchedAt > 2 * 3_600_000 || modelRun > now + 300_000 || now - modelRun > 24 * 3_600_000,
    region: typeof region === "string" && region.trim() ? region.trim().slice(0, 160) : "Selected region" };
}

export function frameKey(model: ForecastMap | null): string {
  return model?.frames.map(frame => frame.id).join(":") ?? "";
}

export function forecastTime(value: string | number, timeZone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(date);
  } catch { return date.toISOString(); }
}
