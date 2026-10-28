import type { HomeAssistant, ImageCondition, ImageSlot, Period, SkyConfig, SkyTheme } from "../types";

export type WeatherEffect = "clear" | "cloudy" | "partlycloudy" | "fog" | "rain" | "pouring" | "snow" | "sleet" | "hail" | "storm" | "wind" | "unknown";
export interface SceneState {
  effect: WeatherEffect;
  period: Period;
  imageId: string | null;
  slot: ImageSlot;
  themeId: string | null;
}

/** HA standard weather states. Missing data intentionally yields a neutral sky. */
export function weatherEffect(state: string | undefined): WeatherEffect {
  switch (state) {
    case "sunny": case "clear-night": return "clear";
    case "cloudy": return "cloudy";
    case "partlycloudy": return "partlycloudy";
    case "fog": return "fog";
    case "rainy": return "rain";
    case "pouring": return "pouring";
    case "snowy": return "snow";
    case "snowy-rainy": return "sleet";
    case "hail": return "hail";
    case "lightning": case "lightning-rainy": return "storm";
    case "windy": case "windy-variant": return "wind";
    default: return "unknown";
  }
}

/** Precipitation is a stronger visual signal than a stale frost warning. */
export function imageCondition(state: string | undefined, frost: boolean): ImageCondition {
  if (["snowy", "snowy-rainy", "hail"].includes(state ?? "")) return "snow";
  if (["rainy", "pouring", "lightning-rainy"].includes(state ?? "")) return "rain";
  return frost ? "frost" : "clear";
}

/** ISO dates compare lexicographically after format validation. */
function validDate(value: string, annual: boolean): boolean {
  const full = annual ? `2000-${value}` : value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(full)) return false;
  const parsed = new Date(`${full}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === full;
}

export function dateInZone(now: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  } catch {
    // Corrupt timezone settings must not break dashboard controls.
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  }
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function themeRunsOn(theme: SkyTheme, localDate: string): boolean {
  if (theme.id === "default" || !theme.enabled || !theme.schedule) return false;
  const { start, end, annual } = theme.schedule;
  if (!validDate(start, annual) || !validDate(end, annual)) return false;
  const date = annual ? localDate.slice(5) : localDate;
  if (!annual && start > end) return false;
  return start <= end ? date >= start && date <= end : date >= start || date <= end;
}

export function activeTheme(config: SkyConfig, now: Date, timeZone: string): SkyTheme | undefined {
  const today = dateInZone(now, timeZone);
  // Priority is explicit. Never silently promote an unordered theme.
  for (const id of config.priority) {
    const theme = config.themes.find((item) => item.id === id);
    if (theme && themeRunsOn(theme, today)) return theme;
  }
  return config.themes.find((theme) => theme.id === "default");
}

export function resolveScene(config: SkyConfig, hass: HomeAssistant, now = new Date()): SceneState {
  const condition = hass.states[config.weatherEntity]?.state;
  const sun = hass.states["sun.sun"]?.state;
  // HA sun is authoritative. The weather state is a fallback only if sun is unavailable.
  const period: Period = sun === "below_horizon" || (sun !== "above_horizon" && condition === "clear-night") ? "night" : "day";
  const frost = config.frostEntity !== null && hass.states[config.frostEntity]?.state === "on";
  const slot: ImageSlot = `${imageCondition(condition, frost)}_${period}`;
  const theme = activeTheme(config, now, hass.config.time_zone);
  const fallback = config.themes.find((item) => item.id === "default");
  return {
    effect: weatherEffect(condition), period, slot,
    imageId: theme?.images[slot] ?? fallback?.images[slot] ?? null,
    themeId: theme?.id ?? null,
  };
}

export function dashboardSelected(pathname: string, config: SkyConfig): boolean {
  const root = pathname.split("/").filter(Boolean)[0];
  return Boolean(root && (config.applyToAll || config.dashboards.includes(root)));
}

/** Seeded stream keeps particle fields stable across screenshots and tests. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CanvasSize { width: number; height: number; scale: number; }
export function canvasSize(width: number, height: number, dpr: number, quality: SkyConfig["quality"]): CanvasSize {
  const pixelBudget = { low: 900_000, medium: 1_800_000, high: 3_000_000 }[quality];
  const w = Math.max(1, Number.isFinite(width) ? width : 1);
  const h = Math.max(1, Number.isFinite(height) ? height : 1);
  const scale = Math.min(Math.max(1, Number.isFinite(dpr) ? dpr : 1), 2, Math.sqrt(pixelBudget / (w * h)));
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)), scale };
}
