export const CONDITIONS = ["clear", "rain", "frost", "snow"] as const;
export const PERIODS = ["day", "night"] as const;
export type ImageCondition = (typeof CONDITIONS)[number];
export type Period = (typeof PERIODS)[number];
export type ImageSlot = `${ImageCondition}_${Period}`;
export type ImageMap = Record<ImageSlot, string | null>;
export interface ThemeSchedule { start: string; end: string; annual: boolean; }
export interface SkyTheme {
  id: string;
  name: string;
  enabled: boolean;
  schedule: ThemeSchedule | null;
  images: ImageMap;
}
export interface AlertSettings {
  enabled: boolean;
  weatherEntity: string | null;
  floodEntity: string | null;
}
export interface SkyConfig {
  revision: number;
  weatherEntity: string;
  frostEntity: string | null;
  applyToAll: boolean;
  dashboards: string[];
  priority: string[];
  quality: "low" | "medium" | "high";
  lightning: boolean;
  weatherCardSurface?: "solid" | "glass";
  alerts?: AlertSettings;
  themes: SkyTheme[];
}
export interface HassEntity {
  state: string;
  attributes: Record<string, unknown>;
  last_updated?: string;
}
export interface HomeAssistant {
  states: Record<string, HassEntity | undefined>;
  config: { time_zone: string; latitude?: number; longitude?: number };
  user?: { is_admin: boolean };
  /** Effective appearance, including Auto; selectedTheme.dark is only a preference. */
  themes?: { darkMode: boolean };
  panels?: Record<string, { component_name: string; url_path?: string; title?: string; config?: Record<string, unknown> }>;
  callWS<T = unknown>(message: Record<string, unknown>): Promise<T>;
  fetchWithAuth(path: string, options?: RequestInit): Promise<Response>;
  connection?: { subscribeMessage<T>(callback: (message: T) => void, message: Record<string, unknown>): Promise<() => void> };
}
export interface Dashboard { url_path: string; title: string; }
export interface SaveThemeResponse { config: SkyConfig; }
