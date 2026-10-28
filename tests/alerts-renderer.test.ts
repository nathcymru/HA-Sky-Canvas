// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bootstrapSkyCanvas } from "../src/renderer/adapter";
import type { RendererHandle } from "../src/renderer/adapter";
import type { HomeAssistant, SkyConfig } from "../src/types";
import type { SkyCanvasWeatherAlerts } from "../src/alerts";
import { ALERT_NOW, weatherEntity } from "./alerts-fixtures";

let handle: RendererHandle | undefined;
const flush = async (view: HTMLElement) => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await view.querySelector<SkyCanvasWeatherAlerts>("ha-sky-canvas-weather-alerts")?.updateComplete;
};
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(ALERT_NOW); vi.spyOn(document, "hidden", "get").mockReturnValue(false); history.replaceState(null, "", "/dashboard-overview/home"); });
afterEach(() => { handle?.destroy(); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

function fixture() {
  const app = document.createElement("home-assistant") as HTMLElement & { hass?: HomeAssistant };
  const shadowChild = (parent: Element, tag: string) => { const child = document.createElement(tag); parent.attachShadow({ mode: "open" }).append(child); return child; };
  const main = shadowChild(app, "home-assistant-main"), panel = shadowChild(main, "ha-panel-lovelace"), root = shadowChild(panel, "hui-root"), container = shadowChild(root, "hui-view-container");
  container.id = "view";
  const background = document.createElement("hui-view-background"); background.attachShadow({ mode: "open" }); container.append(background);
  const view = document.createElement("hui-view"); view.style.cssText = "display:flex;flex-direction:column"; container.append(view);
  const config: SkyConfig = { revision: 1, weatherEntity: "weather.unused", frostEntity: null, applyToAll: false, dashboards: ["dashboard-another"], priority: [], quality: "low", lightning: false, themes: [], alerts: { enabled: true, weatherEntity: "sensor.weather_warning", floodEntity: null } };
  let receive: (config: SkyConfig) => void = () => {};
  const stop = vi.fn();
  const hass: HomeAssistant = { states: { "sensor.weather_warning": weatherEntity() }, config: { time_zone: "Europe/London" }, callWS: vi.fn(async () => config) as HomeAssistant["callWS"], fetchWithAuth: vi.fn(), connection: { subscribeMessage: vi.fn(async callback => { receive = callback as (config: SkyConfig) => void; return stop; }) } };
  app.hass = hass; document.body.append(app);
  return { app, view, background, hass, config, stop, save(next: SkyConfig) { receive(next); } };
}

it("shows global warnings on a dashboard excluded from the background, using the existing one subscription", async () => {
  const f = fixture(); handle = bootstrapSkyCanvas(); await flush(f.view);
  expect(f.view.querySelector("ha-sky-canvas-weather-alerts")).not.toBeNull();
  expect(f.background.shadowRoot!.children).toHaveLength(0);
  expect(f.hass.connection!.subscribeMessage).toHaveBeenCalledOnce();
  expect(f.hass.callWS).toHaveBeenCalledOnce();
  expect(f.hass.fetchWithAuth).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
});

it("uses existing refresh for expiry/failure and removes the banner when disabled, disconnected or destroyed", async () => {
  const f = fixture(); handle = bootstrapSkyCanvas(); await flush(f.view);
  const element = f.view.querySelector<SkyCanvasWeatherAlerts>("ha-sky-canvas-weather-alerts")!;
  f.hass.states["sensor.weather_warning"]!.state = "unavailable";
  await vi.advanceTimersByTimeAsync(2000); await flush(f.view);
  expect(element.shadowRoot!.textContent).toContain("warning information is unavailable");
  f.save({ ...f.config, revision: 2, alerts: { ...f.config.alerts!, enabled: false } }); await flush(f.view);
  expect(f.view.querySelector("ha-sky-canvas-weather-alerts")).toBeNull();
  f.save({ ...f.config, revision: 3 }); await flush(f.view);
  expect(f.view.querySelector("ha-sky-canvas-weather-alerts")).not.toBeNull();
  delete f.app.hass;
  await vi.advanceTimersByTimeAsync(2000); await flush(f.view);
  expect(f.view.querySelector("ha-sky-canvas-weather-alerts")).toBeNull();
  handle.destroy(); expect(f.stop).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
