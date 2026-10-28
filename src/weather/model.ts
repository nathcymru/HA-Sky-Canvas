import type { HassEntity } from "../types";

export type WeatherMode = "current" | "hourly" | "daily";
export const GUIDE_URL = "https://weather.metoffice.gov.uk/guides/what-does-this-forecast-mean";
export const SYMBOL_LABELS: Readonly<Record<number, string>> = Object.freeze({
  0: "Clear night", 1: "Sunny day", 2: "Partly cloudy (night)", 3: "Sunny intervals",
  5: "Mist", 6: "Fog", 7: "Cloudy", 8: "Overcast", 9: "Light rain shower (night)",
  10: "Light rain shower (day)", 11: "Drizzle", 12: "Light rain", 13: "Heavy rain shower (night)",
  14: "Heavy rain shower (day)", 15: "Heavy rain", 16: "Sleet shower (night)",
  17: "Sleet shower (day)", 18: "Sleet", 19: "Hail shower (night)", 20: "Hail shower (day)",
  21: "Hail", 22: "Light snow shower (night)", 23: "Light snow shower (day)",
  24: "Light snow", 25: "Heavy snow shower (night)", 26: "Heavy snow shower (day)",
  27: "Heavy snow", 28: "Thunder shower (night)", 29: "Thunder shower (day)", 30: "Thunder",
});
export interface WeatherSymbol { code: number; label: string; url: string; }
export function weatherSymbol(value: unknown): WeatherSymbol | null {
  if (typeof value !== "number" || !Number.isInteger(value) || !Object.hasOwn(SYMBOL_LABELS, value)) return null;
  return { code: value, label: SYMBOL_LABELS[value], url: `/ha_sky_canvas/weather-icons/v1/${value}.svg` };
}
export const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const nonnegative = (value: unknown): number | null => { const n = finite(value); return n !== null && n >= 0 ? n : null; };
const percent = (value: unknown): number | null => { const n = finite(value); return n !== null && n >= 0 && n <= 100 ? n : null; };

export function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  // Global Spot preserves minute precision (e.g. 2026-10-28T07:00Z);
  // HA's converted forecasts and fetch times can include seconds/fractions.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(part => Number(part ?? 0));
  const calendar = new Date(0); calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null;
}
export function dayKey(time: number, zone: string): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(time); }
  catch { return new Date(time).toISOString().slice(0, 10); }
}
export function displayTime(time: number, zone: string, daily = false): string {
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", ...(!daily ? { hour: "2-digit", minute: "2-digit", timeZoneName: "short" } as const : {}) }).format(time); }
  catch { return new Date(time).toISOString(); }
}

export interface WeatherUnits { temperature: string | null; wind: string | null; precipitation: string | null; pressure: string | null; }
export function weatherUnits(entity: HassEntity | undefined): WeatherUnits {
  const a = entity?.attributes ?? {};
  const unit = (value: unknown, allowed: string[]) => typeof value === "string" && allowed.includes(value) ? value : null;
  return {
    temperature: unit(a.temperature_unit, ["°C", "°F", "K"]),
    wind: unit(a.wind_speed_unit, ["m/s", "km/h", "mph", "kn", "ft/s"]),
    precipitation: unit(a.precipitation_unit, ["mm", "in"]),
    pressure: unit(a.pressure_unit, ["hPa", "Pa", "kPa", "bar", "mbar", "inHg", "mmHg", "psi"]),
  };
}
export type WeatherStatus = "ready" | "unavailable" | "stale";
export function weatherStatus(entity: HassEntity | undefined, now = Date.now(), mode: WeatherMode = "current"): WeatherStatus {
  if (!entity || ["unknown", "unavailable", ""].includes(entity.state)) return "unavailable";
  const a = entity.attributes;
  const provenance: readonly (readonly [string, number])[] = mode === "daily"
    ? [["metoffice_daily_fetched_at", 6], ["metoffice_daily_model_run", 6]]
    : [["fetched_at", 3], ["model_run", 6], ["current_time", 2]];
  for (const [key, maximum] of provenance) {
    const time = timestamp(a[key]);
    if (time === null || time > now + 60_000 || now - time >= maximum * 3_600_000) return "stale";
  }
  return "ready";
}

export interface WeatherPeriod {
  time: number; symbol: WeatherSymbol | null; nightSymbol: WeatherSymbol | null;
  temperature: number | null; low: number | null; feelsLike: number | null;
  probability: number | null; precipitation: number | null; humidity: number | null;
  wind: number | null; gust: number | null; bearing: number | null; uv: number | null; pressure: number | null;
}
function period(a: Record<string, unknown>, time: number): WeatherPeriod {
  const direction = finite(a.wind_bearing);
  return {
    time, symbol: weatherSymbol(a.metoffice_weather_code), nightSymbol: weatherSymbol(a.metoffice_night_weather_code),
    temperature: finite(a.temperature), low: finite(a.templow), feelsLike: finite(a.apparent_temperature),
    probability: percent(a.precipitation_probability), precipitation: nonnegative(a.precipitation), humidity: percent(a.humidity),
    wind: nonnegative(a.wind_speed), gust: nonnegative(a.wind_gust_speed),
    bearing: direction !== null && direction >= 0 && direction <= 360 ? direction : null,
    uv: nonnegative(a.uv_index), pressure: nonnegative(a.pressure),
  };
}
export function currentWeather(entity: HassEntity | undefined, now = Date.now()): WeatherPeriod | null {
  return weatherStatus(entity, now) === "ready" ? period(entity!.attributes, timestamp(entity!.attributes.current_time)!) : null;
}
export function forecastPeriods(value: unknown, mode: "hourly" | "daily", zone: string, now = Date.now()): WeatherPeriod[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  const seen = new Set<number>(), dates = new Set<string>(), result: WeatherPeriod[] = [];
  const today = dayKey(now, zone);
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const a = raw as Record<string, unknown>, time = timestamp(a.datetime);
    if (time === null || seen.has(time)) return null;
    seen.add(time);
    const date = dayKey(time, zone);
    if (mode === "daily" && dates.has(date)) return null;
    dates.add(date);
    if ((mode === "hourly" ? time < Math.floor(now / 3_600_000) * 3_600_000 : date < today) || time > now + 8 * 86_400_000) continue;
    result.push(period(a, time));
  }
  return result.length ? result.sort((a, b) => a.time - b.time) : null;
}
export function measurement(value: number | null, unit: string | null, digits = 1): string {
  if (value === null || unit === null) return "—";
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(value)}${unit === "°C" || unit === "°F" || unit === "%" ? "" : unit ? " " : ""}${unit}`;
}
export function windDirection(value: number | null): string {
  return value === null ? "" : ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(value / 22.5) % 16];
}
