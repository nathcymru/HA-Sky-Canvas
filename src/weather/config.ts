import type { WeatherMode } from "./model";

export const WEATHER_LAYOUTS = {
  glance: { label: "Glance", columns: 3, rows: 1, description: "Symbol and temperature" },
  tile: { label: "Tile", columns: 6, rows: 1, description: "Current conditions in one row" },
  strip: { label: "Strip", columns: 12, rows: 1, description: "A row of forecast periods" },
  now: { label: "Now", columns: 6, rows: 2, description: "Current conditions, rain and wind" },
  column: { label: "Column", columns: 3, rows: 3, description: "A narrow current weather panel" },
  overview: { label: "Overview", columns: 12, rows: 3, description: "Current conditions beside a short forecast" },
  detail: { label: "Detail", columns: 6, rows: 4, description: "Current conditions and measurements" },
  forecast: { label: "Forecast", columns: 12, rows: 6, description: "Current weather and hourly or daily forecast" },
  table: { label: "Full table", columns: 12, rows: "auto", description: "Every supplied measurement, with horizontal scrolling" },
} as const;
export type WeatherLayout = keyof typeof WEATHER_LAYOUTS;
export type WeatherSurface = "solid" | "glass";
export interface WeatherCardConfig {
  type?: string;
  entity: string;
  mode?: WeatherMode;
  title?: string;
  compact?: boolean;
  limit?: number;
  layout?: WeatherLayout;
  surface?: "default" | WeatherSurface;
  grid_options?: { columns?: number | "full"; rows?: number | "auto"; [key: string]: unknown };
  [key: string]: unknown;
}
export function cardLayout(config: WeatherCardConfig): WeatherLayout {
  return config.layout ?? (config.mode && config.mode !== "current" ? "table" : config.compact ? "now" : "detail");
}
export function forecastMode(config: WeatherCardConfig): "hourly" | "daily" | null {
  if (["glance", "tile", "now", "column", "detail"].includes(cardLayout(config))) return null;
  if (config.mode === "hourly" || config.mode === "daily") return config.mode;
  return ["overview", "forecast", "strip"].includes(cardLayout(config)) ? "hourly" : null;
}
export function validateWeatherConfig(config: WeatherCardConfig): WeatherCardConfig {
  if (!config || typeof config.entity !== "string" || !/^weather\.[a-z0-9_]+$/.test(config.entity)) throw new Error("Choose a weather entity.");
  if (config.mode !== undefined && !["current", "hourly", "daily"].includes(config.mode)) throw new Error("Choose current, hourly or daily weather.");
  if (config.title !== undefined && (typeof config.title !== "string" || config.title.length > 120)) throw new Error("Use a short weather card title.");
  if (config.compact !== undefined && typeof config.compact !== "boolean") throw new Error("Compact must be true or false.");
  if (config.layout !== undefined && !Object.hasOwn(WEATHER_LAYOUTS, config.layout)) throw new Error("Choose a supported weather card layout.");
  if (config.surface !== undefined && !["default", "solid", "glass"].includes(config.surface)) throw new Error("Choose the default, solid or glass background.");
  const maxLimit = config.mode === "daily" ? 10 : 72;
  if (config.limit !== undefined && (!Number.isInteger(config.limit) || config.limit < 1 || config.limit > maxLimit)) throw new Error(`Forecast limit must be between 1 and ${maxLimit}.`);
  const currentOnly = config.layout && ["glance", "tile", "now", "column", "detail"].includes(config.layout);
  return { ...config, mode: currentOnly ? "current" : config.mode ?? "current", compact: config.compact ?? false };
}
