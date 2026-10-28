import type { Dashboard, HomeAssistant, ImageMap, SkyConfig, SkyTheme } from "../types";

export type GlobalSettings = Omit<SkyConfig, "revision" | "themes">;
type Draft<T> = { value: T; base: T; revision: number };
export const BUILTIN_THEMES = new Set(["default", "christmas", "halloween", "easter", "rugby", "soccer"]);
const clone = <T>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => same(item, b[index]));
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) || Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
};
const draft = <T>(value: T, revision: number): Draft<T> => ({ value: clone(value), base: clone(value), revision });

export function settingsFrom(config: SkyConfig): GlobalSettings {
  const { revision: _revision, themes: _themes, ...settings } = config;
  return clone(settings);
}

/** Preserve a draft's revision when its saved baseline changes elsewhere.
 * An unrelated update can safely advance it only if that baseline is identical.
 */
export class SettingsDrafts {
  config: SkyConfig;
  settings: Draft<GlobalSettings>;
  themes = new Map<string, Draft<SkyTheme>>();
  private pendingChanges = new Set<string>();

  constructor(config: SkyConfig) {
    this.config = clone(config);
    this.settings = draft(settingsFrom(config), config.revision);
    for (const theme of config.themes) this.themes.set(theme.id, draft(theme, config.revision));
  }

  isDirty(scope: string): boolean {
    const item = scope === "settings" || scope === "dashboards" ? this.settings : this.themes.get(scope);
    return Boolean(item && (this.pendingChanges.has(scope) || !same(item.value, item.base) || (scope !== "settings" && scope !== "dashboards" && !this.config.themes.some(t => t.id === scope))));
  }

  /** Keep the upload's draft and conflict baseline stable until its result arrives. */
  beginPendingChange(scope: string): void { this.pendingChanges.add(scope); }
  finishPendingChange(scope: string): void {
    this.pendingChanges.delete(scope);
    // A failed upload has no local edit; recover any server update held during it.
    this.receive(this.config);
  }

  get hasChanges(): boolean {
    return this.isDirty("settings") || [...this.themes.keys()].some(id => this.isDirty(id));
  }

  receive(config: SkyConfig, savedScope?: string): void {
    if (config.revision < this.config.revision) return;
    const globalSaved = savedScope === "settings" || savedScope === "dashboards";
    if (globalSaved || !this.isDirty("settings")) this.settings = draft(settingsFrom(config), config.revision);
    else if (same(settingsFrom(config), this.settings.base)) this.settings.revision = config.revision;
    for (const theme of config.themes) {
      if (theme.id === savedScope || !this.themes.has(theme.id) || !this.isDirty(theme.id)) {
        this.themes.set(theme.id, draft(theme, config.revision));
      } else if (same(theme, this.themes.get(theme.id)!.base)) this.themes.get(theme.id)!.revision = config.revision;
    }
    for (const id of this.themes.keys()) {
      if (!config.themes.some(t => t.id === id) && !this.isDirty(id)) this.themes.delete(id);
    }
    this.config = clone(config);
  }

  /** Discard uses the latest server version, including changes from another device. */
  discard(scope: string): void {
    if (scope === "settings" || scope === "dashboards") {
      this.settings = draft(settingsFrom(this.config), this.config.revision);
      return;
    }
    const theme = this.config.themes.find(t => t.id === scope);
    if (theme) this.themes.set(scope, draft(theme, this.config.revision));
    else this.themes.delete(scope);
  }

  addTheme(id: string, name: string): SkyTheme {
    const images = Object.fromEntries(["clear", "rain", "frost", "snow"].flatMap(condition => ["day", "night"].map(period => [`${condition}_${period}`, null]))) as ImageMap;
    const theme: SkyTheme = { id, name: name.trim(), enabled: false, schedule: null, images };
    this.themes.set(id, draft(theme, this.config.revision));
    return theme;
  }
}

export function availableDashboards(list: Dashboard[], panels: HomeAssistant["panels"] = {}): Dashboard[] {
  const found = new Map<string, Dashboard>();
  for (const dashboard of list) {
    if (dashboard.url_path) found.set(dashboard.url_path, { ...dashboard, title: dashboard.title || dashboard.url_path });
  }
  for (const [key, panel] of Object.entries(panels ?? {})) {
    if (panel.component_name !== "lovelace") continue;
    const path = panel.url_path || key;
    if (!found.has(path)) found.set(path, { url_path: path, title: panel.title || path });
  }
  return [...found.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && /conflict|revision/i.test(String(error.code))) {
    return "These settings changed on another device. Your draft is still here. Discard it to load the latest saved version, then make your changes again.";
  }
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "The change could not be saved. Check your connection and try again.";
}

export function validateTheme(theme: SkyTheme): string | null {
  if (!theme.name.trim()) return "Enter a name for this theme.";
  if (theme.enabled && theme.id !== "default" && (!theme.schedule?.start || !theme.schedule.end)) return "Choose both a start and end date before enabling this theme.";
  if (theme.schedule && Boolean(theme.schedule.start) !== Boolean(theme.schedule.end)) return "Choose both a start and end date, or clear both dates.";
  if (theme.schedule && !theme.schedule.annual && theme.schedule.start && theme.schedule.end && theme.schedule.end < theme.schedule.start) return "The end date must be on or after the start date.";
  return null;
}
