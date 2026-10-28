// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWeatherAlerts, locateAlertsHost, SkyCanvasWeatherAlerts } from "../src/alerts";
import type { WeatherAlertsHandle } from "../src/alerts";
import type { HomeAssistant } from "../src/types";
import { ALERT_NOW, floodEntity, weatherEntity, weatherWarning } from "./alerts-fixtures";

const settings = { alerts: { enabled: true, weatherEntity: "sensor.weather_warning", floodEntity: "sensor.flood_warning" } };
const hass = (): HomeAssistant => ({ states: { "sensor.weather_warning": weatherEntity(), "sensor.flood_warning": floodEntity() }, config: { time_zone: "Europe/London" }, callWS: vi.fn(), fetchWithAuth: vi.fn() });
let handle: WeatherAlertsHandle | undefined;
const banner = () => document.querySelector<SkyCanvasWeatherAlerts>("ha-sky-canvas-weather-alerts")!;
const flush = async () => { await Promise.resolve(); await banner()?.updateComplete; };
afterEach(() => { handle?.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function mount(assistant = hass()) {
  const host = document.createElement("main"); document.body.append(host);
  handle = createWeatherAlerts({ resolveHost: () => host, now: () => ALERT_NOW });
  handle.update(settings, assistant);
  return { host, assistant };
}

describe("shared warning banner", () => {
  it("renders distinct sources and native keyboard details without background attributes or provider calls", async () => {
    const { assistant } = mount(); await flush();
    const root = banner().shadowRoot!;
    expect(root.querySelectorAll("details")).toHaveLength(2);
    expect(root.textContent).toContain("Met Office");
    expect(root.textContent).toContain("Natural Resources Wales");
    expect(root.textContent).toContain("Yellow weather warning");
    expect(root.textContent).toContain("Flood alert");
    expect(banner().inert).toBeFalsy();
    expect(banner().hasAttribute("aria-hidden")).toBe(false);
    expect(assistant.callWS).not.toHaveBeenCalled();
    expect(assistant.fetchWithAuth).not.toHaveBeenCalled();
    expect(root.querySelector("[role=status]")?.getAttribute("aria-live")).toBe("polite");
  });

  it("preserves details focus/open state and avoids repeated announcement on unchanged polling", async () => {
    const { assistant } = mount(); await flush();
    const element = banner(), root = element.shadowRoot!;
    const details = root.querySelector("details")!; details.open = true;
    const summary = details.querySelector("summary")!; summary.focus();
    const announcement = root.querySelector("[role=status]")!.textContent;
    assistant.states["sensor.weather_warning"]!.attributes.fetched_at = "2026-10-28T12:00:30Z";
    handle!.update(settings, assistant); await flush();
    expect(root.querySelector("details")).toBe(details);
    expect(details.open).toBe(true);
    expect(root.activeElement).toBe(summary);
    expect(root.querySelector("[role=status]")!.textContent).toBe(announcement);
  });

  it("escapes source text instead of executing HTML and uses trusted links", async () => {
    const assistant = hass();
    assistant.states["sensor.weather_warning"]!.attributes.warnings = [{ ...weatherWarning(), headline: "<img src=x onerror=alert(1)>", details: "<script>evil()</script>", source_url: "javascript:evil()" }];
    mount(assistant); await flush();
    const root = banner().shadowRoot!;
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
    expect([...root.querySelectorAll("a")].every(link => link.protocol === "https:" && link.rel === "noopener noreferrer")).toBe(true);
  });

  it("keeps a broad-area announcement short while every warning remains accessible", async () => {
    const assistant = hass();
    assistant.states["sensor.weather_warning"]!.attributes.warnings = Array.from({ length: 40 }, (_, i) => ({ ...weatherWarning("yellow", `warning-${i}`), headline: "Long synthetic warning headline. ".repeat(30) }));
    mount(assistant); await flush();
    const root = banner().shadowRoot!;
    expect(root.querySelectorAll("article")).toHaveLength(41);
    expect(root.querySelector("[role=status]")!.textContent!.length).toBeLessThan(700);
    expect(root.querySelector("[role=status]")!.textContent).toContain("40 issued warnings");
  });

  it("shows every weather type initially, full source text in details and UK validity times in another HA timezone", async () => {
    const assistant = hass(); assistant.config.time_zone = "America/New_York";
    const full = "Full warning message ".repeat(200);
    assistant.states["sensor.weather_warning"]!.attributes.warnings = [
      { ...weatherWarning("yellow", "rain-wind"), version: "2.0", headline: full, weather_types: ["Rain", "Wind"], what_to_expect: [full] },
      { ...weatherWarning("yellow", "snow"), weather_types: ["Snow"] },
    ];
    mount(assistant); await flush();
    const root = banner().shadowRoot!;
    const summaries = [...root.querySelectorAll("details.weather summary")].map(summary => summary.textContent);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toContain("Rain & Wind");
    expect(summaries[1]).toContain("Snow");
    expect(summaries[0]).toContain("09:00 GMT");
    expect(summaries[0]).toContain("Updated");
    expect(summaries[0]).toContain("Met Office Weather Warnings © Crown Copyright 2026");
    expect(root.textContent).toContain(full);
    expect(root.textContent).toContain("What to expect");
    expect(root.textContent).toContain("Further details");
    expect(root.querySelectorAll("details.weather svg")).toHaveLength(0);
  });

  it("shows unavailable data explicitly, hides healthy clear feeds and never says a flood risk is absent", async () => {
    const assistant = hass(); assistant.states["sensor.weather_warning"] = weatherEntity("none");
    assistant.states["sensor.flood_warning"]!.state = "unavailable";
    mount(assistant); await flush();
    expect(banner().shadowRoot!.querySelectorAll(".feed")).toHaveLength(1);
    expect(banner().shadowRoot!.textContent).toContain("Flood warning information is unavailable");
    expect(banner().shadowRoot!.textContent).not.toContain("No flood risk");
  });

  it("supports navigation without duplicating the banner and removes only its own node", async () => {
    let host = document.createElement("main"); document.body.append(host);
    const retained = document.createElement("button"); host.append(retained);
    handle = createWeatherAlerts({ resolveHost: () => host, now: () => ALERT_NOW });
    const assistant = hass(); handle.update(settings, assistant); await flush();
    const element = banner();
    host = document.createElement("main"); document.body.append(host);
    handle.update(settings, assistant); await flush();
    expect(banner()).toBe(element);
    expect(document.querySelectorAll("ha-sky-canvas-weather-alerts")).toHaveLength(1);
    handle.destroy();
    expect(banner()).toBeNull(); expect(retained.isConnected).toBe(true);
    handle.update(settings, assistant); expect(banner()).toBeNull();
  });

  it("unmounts for absent or disabled config and fails closed on an unknown container", async () => {
    const { assistant } = mount(); await flush();
    handle!.update(null, assistant); expect(banner()).toBeNull();
    handle!.update({ alerts: { ...settings.alerts, enabled: false } }, assistant); expect(banner()).toBeNull();
    handle!.destroy();
    handle = createWeatherAlerts({ resolveHost: () => null });
    handle.update(settings, assistant); expect(banner()).toBeNull();
    expect(locateAlertsHost()).toBeNull();
  });

  it.each(["ha-panel-lovelace", "ha-panel-energy"])("locates only the verified %s column and never the decorative shadow root", (tag) => {
    const app = document.createElement("home-assistant"); document.body.append(app);
    const shadowChild = (parent: Element, tag: string) => { const child = document.createElement(tag); parent.attachShadow({ mode: "open" }).append(child); return child; };
    const main = shadowChild(app, "home-assistant-main"), resolver = shadowChild(main, "partial-panel-resolver"), panel = shadowChild(resolver, tag), root = shadowChild(panel, "hui-root");
    const container = shadowChild(root, "hui-view-container"); container.id = "view";
    expect(locateAlertsHost()).toBeNull();
    container.append(document.createElement("hui-view-background"));
    expect(locateAlertsHost()).toBeNull();
    const view = document.createElement("hui-view"); container.append(view);
    view.style.display = "flex"; view.style.flexDirection = "row";
    expect(locateAlertsHost()).toBeNull();
    view.style.flexDirection = "column";
    expect(locateAlertsHost()).toBe(view);
    panel.remove(); expect(locateAlertsHost()).toBeNull();
  });
});
