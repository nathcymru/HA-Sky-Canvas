import type { HomeAssistant, SkyConfig } from "../types";
import { SkyCanvasWeatherAlerts } from "./banner";
import { floodAlerts, weatherAlerts } from "./model";

export interface WeatherAlertsHandle {
  update(config: Pick<SkyConfig, "alerts"> | null, hass: HomeAssistant | null): void;
  destroy(): void;
}
export interface WeatherAlertsOptions {
  /** Only verified normal-flow containers; never the decorative background. */
  resolveHost?: () => HTMLElement | null;
  now?: () => number;
}

/** Bounded HA compatibility boundary. Unsupported panel layouts fail closed. */
export function locateAlertsHost(documentRoot: Document = document): HTMLElement | null {
  const app = documentRoot.querySelector("home-assistant");
  const main = app?.shadowRoot?.querySelector("home-assistant-main");
  const resolver = main?.shadowRoot?.querySelector("partial-panel-resolver");
  const panel = main?.shadowRoot?.querySelector("ha-panel-lovelace, ha-panel-energy")
    ?? resolver?.shadowRoot?.querySelector("ha-panel-lovelace, ha-panel-energy");
  const root = panel?.shadowRoot?.querySelector("hui-root");
  const container = root?.shadowRoot?.querySelector<HTMLElement>("hui-view-container#view");
  const view = container?.querySelector<HTMLElement>("hui-view");
  if (!view?.isConnected || view.parentElement !== container) return null;
  // Core 2026.10: the outer container is a horizontal flex row. Inserting there
  // puts the banner beside cards. Its hui-view child is the verified column.
  const style = getComputedStyle(view);
  return style.display === "flex" && style.flexDirection === "column" ? view : null;
}

export function createWeatherAlerts(options: WeatherAlertsOptions = {}): WeatherAlertsHandle {
  const resolveHost = options.resolveHost ?? locateAlertsHost;
  const now = options.now ?? Date.now;
  let element: SkyCanvasWeatherAlerts | null = null;
  let disposed = false;
  let currentConfig: Pick<SkyConfig, "alerts"> | null = null;
  let currentHass: HomeAssistant | null = null;
  function render(): void {
    if (disposed) return;
    const settings = currentConfig?.alerts, hass = currentHass;
    if (!hass || !settings?.enabled || (!settings.weatherEntity && !settings.floodEntity)) {
      element?.remove(); element = null; return;
    }
    const host = resolveHost();
    if (!host?.isConnected) { element?.remove(); return; }
    // Only the primary warning entity establishes current feed availability.
    // A geometry diagnostic cannot clear an unavailable or stale warning feed.
    element ??= document.createElement("ha-sky-canvas-weather-alerts") as SkyCanvasWeatherAlerts;
    const clock = now();
    element.timeZone = hass.config.time_zone;
    element.feeds = [
      ...(settings.weatherEntity ? [weatherAlerts(hass.states[settings.weatherEntity], clock)] : []),
      ...(settings.floodEntity ? [floodAlerts(hass.states[settings.floodEntity], clock)] : []),
    ];
    if (element.parentElement !== host) host.prepend(element);
  }
  return {
    update(config, hass): void {
      if (disposed) return;
      currentConfig = config; currentHass = hass; render();
    },
    destroy(): void { disposed = true; currentConfig = null; currentHass = null; element?.remove(); element = null; },
  };
}

export { SkyCanvasWeatherAlerts } from "./banner";
