// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createWeatherAlerts } from "../src/alerts";
import type { SkyCanvasWeatherAlerts, WeatherAlertsHandle } from "../src/alerts";
import type { HassEntity, HomeAssistant } from "../src/types";
import { ALERT_NOW, floodEntity, noMatchingFloodAreas } from "./alerts-fixtures";

const selected = "sensor.my_renamed_flood_warnings";
const settings = { alerts: { enabled: true, weatherEntity: null, floodEntity: selected } };
let handle: WeatherAlertsHandle | undefined;
const banner = () => document.querySelector<SkyCanvasWeatherAlerts>("ha-sky-canvas-weather-alerts");
const flush = async () => { await Promise.resolve(); await banner()?.updateComplete; };
afterEach(() => { handle?.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function mount(primary: HassEntity) {
  let clock = ALERT_NOW;
  const host = document.createElement("main"); document.body.append(host);
  const hass: HomeAssistant = {
    states: { [selected]: primary, "sensor.legacy_coverage": { state: "outside_known_areas", attributes: {
      scope: { type: "area_codes", area_codes: [], selection_method: "home_polygon", coverage_status: "outside_known_areas", resolved_at: new Date(ALERT_NOW).toISOString() },
      fetched_at: new Date(ALERT_NOW).toISOString(),
    } } },
    config: { time_zone: "Europe/London" },
    connection: { subscribeMessage: vi.fn() }, callWS: vi.fn(), fetchWithAuth: vi.fn(),
  };
  handle = createWeatherAlerts({ resolveHost: () => host, now: () => clock });
  handle.update(settings, hass);
  return { hass, advance(ms: number) { clock += ms; }, refresh() { handle!.update(settings, hass); } };
}

it("hides the row for a fresh successful empty home selection without a coverage diagnosis", async () => {
  const f = mount(noMatchingFloodAreas()); await flush();
  expect(banner()?.feeds[0].status).toBe("clear");
  expect(banner()?.shadowRoot?.querySelector(".strip")).toBeNull();
  expect(banner()?.shadowRoot?.textContent).not.toContain("outside the published");
  expect(banner()?.shadowRoot?.textContent).not.toContain("No flood risk");
  expect(f.hass.callWS).not.toHaveBeenCalled();
  expect(f.hass.connection!.subscribeMessage).not.toHaveBeenCalled();
  expect(f.hass.fetchWithAuth).not.toHaveBeenCalled();
});

it("keeps an old unavailable primary unavailable despite a fresh companion geometry diagnostic", async () => {
  const f = mount({ state: "unavailable", attributes: {} }); await flush();
  expect(banner()?.feeds[0].status).toBe("unavailable");
  expect(banner()?.shadowRoot?.textContent).toContain("Flood warning information is unavailable");
  expect(banner()?.shadowRoot?.textContent).not.toContain("outside the published");
  expect(banner()?.feeds[0].notice).toBeUndefined();
  expect(f.hass.callWS).not.toHaveBeenCalled();
});

it("removes an old alert after verified empty selection, then shows a real feed failure", async () => {
  const f = mount(floodEntity()); await flush();
  expect(banner()?.feeds[0].status).toBe("warnings");
  f.hass.states[selected] = noMatchingFloodAreas(); f.refresh(); await flush();
  expect(banner()?.shadowRoot?.querySelector(".strip")).toBeNull();
  f.hass.states[selected] = { state: "unavailable", attributes: {} }; f.refresh(); await flush();
  expect(banner()?.feeds[0].status).toBe("unavailable");
  expect(banner()?.shadowRoot?.textContent).toContain("Current warning status cannot be confirmed");
});

it("withdraws a formerly clear result when its feed becomes stale", async () => {
  const f = mount(noMatchingFloodAreas()); await flush();
  f.advance(30 * 60_000); f.refresh(); await flush();
  expect(banner()?.feeds[0].status).toBe("stale");
  expect(banner()?.shadowRoot?.textContent).toContain("Flood warning information is out of date");
});

it("does not trust a legacy no-area result on an otherwise available primary", async () => {
  const primary = noMatchingFloodAreas();
  primary.attributes.scope = { ...(primary.attributes.scope as object), coverage_status: "outside_known_areas" };
  mount(primary); await flush();
  expect(banner()?.feeds[0].status).toBe("unavailable");
  expect(banner()?.shadowRoot?.textContent).not.toContain("outside the published");
});
