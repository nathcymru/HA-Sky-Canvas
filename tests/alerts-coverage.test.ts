// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createWeatherAlerts } from "../src/alerts";
import type { SkyCanvasWeatherAlerts, WeatherAlertsHandle } from "../src/alerts";
import { floodAlerts } from "../src/alerts/model";
import type { HassEntity, HomeAssistant } from "../src/types";
import { ALERT_NOW, floodEntity } from "./alerts-fixtures";

const selected = "sensor.my_renamed_flood_warnings";
const companion = "sensor.my_renamed_coverage";
const settings = { alerts: { enabled: true, weatherEntity: null, floodEntity: selected } };
const registry = () => [
  { entity_id: selected, platform: "nrw_flood_direct", unique_id: "nrw_flood_direct_warnings", config_entry_id: "entry-one" },
  { entity_id: companion, platform: "nrw_flood_direct", unique_id: "nrw_flood_direct_coverage_status", config_entry_id: "entry-one" },
];
const coverage = (): HassEntity => ({ state: "outside_known_areas", attributes: { scope: {
  type: "area_codes", label: "Home flood areas", area_codes: [], selection_method: "home_polygon", coverage_status: "outside_known_areas", resolved_at: new Date(ALERT_NOW).toISOString(),
} } });
let handle: WeatherAlertsHandle | undefined;
const banner = () => document.querySelector<SkyCanvasWeatherAlerts>("ha-sky-canvas-weather-alerts");
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await banner()?.updateComplete; };
afterEach(() => { handle?.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function mount(response: unknown = registry()) {
  let clock = ALERT_NOW;
  const host = document.createElement("main"); document.body.append(host);
  const hass: HomeAssistant = {
    states: { [selected]: { state: "unavailable", attributes: {} }, [companion]: coverage() },
    config: { time_zone: "Europe/London" },
    connection: { subscribeMessage: vi.fn() }, callWS: vi.fn(async () => response) as HomeAssistant["callWS"], fetchWithAuth: vi.fn(),
  };
  handle = createWeatherAlerts({ resolveHost: () => host, now: () => clock });
  handle.update(settings, hass);
  return { hass, advance(ms: number) { clock += ms; }, refresh() { handle!.update(settings, hass); } };
}

it("explains unavailable primary with empty attrs using same-entry renamed coverage, and caches the registry lookup", async () => {
  const f = mount(); await flush();
  expect(banner()?.shadowRoot?.textContent).toContain("Home location is outside the published NRW warning areas; this does not mean no flood risk.");
  expect(banner()?.feeds[0].status).toBe("unavailable");
  for (let i = 0; i < 100; i++) { f.advance(2000); f.refresh(); }
  await flush();
  expect(f.hass.callWS).toHaveBeenCalledExactlyOnceWith({ type: "config/entity_registry/list" });
  expect(f.hass.connection!.subscribeMessage).not.toHaveBeenCalled();
  expect(f.hass.fetchWithAuth).not.toHaveBeenCalled();
});

it.each(["entry", "platform", "identity", "duplicate"])("rejects an unverified companion: %s", async reason => {
  const rows = registry();
  if (reason === "entry") rows[1].config_entry_id = "other-entry";
  if (reason === "platform") rows[1].platform = "other-integration";
  if (reason === "identity") rows[0].unique_id = "another-warning-source";
  if (reason === "duplicate") rows.push({ ...rows[1], entity_id: "sensor.another_coverage" });
  mount(rows); await flush();
  expect(banner()?.feeds[0].notice).toBeUndefined();
  expect(banner()?.feeds[0].status).toBe("unavailable");
});

it("refreshes a disappeared companion once after a cooldown, without repeated polling of the registry", async () => {
  const f = mount(); await flush();
  delete f.hass.states[companion];
  f.hass.states["sensor.renamed_again"] = coverage();
  vi.mocked(f.hass.callWS).mockResolvedValue(registry().map(row => row.entity_id === companion ? { ...row, entity_id: "sensor.renamed_again" } : row));
  for (let i = 0; i < 29; i++) { f.advance(2000); f.refresh(); }
  await flush(); expect(f.hass.callWS).toHaveBeenCalledTimes(1);
  expect(banner()?.feeds[0].notice).toBeUndefined();
  f.advance(2000); f.refresh(); await flush();
  expect(banner()?.feeds[0].notice).toContain("outside the published NRW");
  expect(f.hass.callWS).toHaveBeenCalledTimes(2);
  delete f.hass.states["sensor.renamed_again"];
  for (let i = 0; i < 100; i++) { f.advance(2000); f.refresh(); }
  await flush(); expect(f.hass.callWS).toHaveBeenCalledTimes(2);
});

it("bounds failed lookups and never restores a clear state from a coverage diagnostic", async () => {
  const f = mount(); vi.mocked(f.hass.callWS).mockRejectedValue(new Error("offline")); await flush();
  for (let i = 0; i < 200; i++) { f.advance(2000); f.refresh(); await flush(); }
  expect(f.hass.callWS).toHaveBeenCalledTimes(2);
  expect(banner()?.feeds[0].status).toBe("unavailable");
});

it("ignores late responses from an old connection and resolves the replacement connection independently", async () => {
  let resolveOld!: (value: unknown) => void;
  const f = mount(new Promise(resolve => { resolveOld = resolve; })); await flush();
  f.hass.connection = { subscribeMessage: vi.fn() };
  vi.mocked(f.hass.callWS).mockResolvedValue([]);
  f.refresh(); await flush();
  resolveOld(registry()); await flush();
  expect(f.hass.callWS).toHaveBeenCalledTimes(2);
  expect(banner()?.feeds[0].notice).toBeUndefined();
});

it("ignores an in-flight response after disable, selection change or destroy", async () => {
  let resolveOld!: (value: unknown) => void;
  const f = mount(new Promise(resolve => { resolveOld = resolve; })); await flush();
  handle!.update({ alerts: { ...settings.alerts, floodEntity: "sensor.unrelated" } }, f.hass);
  await flush();
  handle!.update(null, f.hass); handle!.destroy();
  resolveOld(registry()); await flush();
  expect(banner()).toBeNull();
});

it("does not initiate a queued request after teardown", async () => {
  const f = mount(); handle!.destroy(); await flush();
  expect(f.hass.callWS).not.toHaveBeenCalled(); expect(banner()).toBeNull();
});

it("requires fresh, available, exact outside-area coverage and never overrides a healthy primary", () => {
  const unavailable = { state: "unavailable", attributes: {} };
  expect(floodAlerts(unavailable, ALERT_NOW, coverage()).notice).toContain("outside the published NRW");
  expect(floodAlerts(unavailable, ALERT_NOW + 86_400_000, coverage()).notice).toBeUndefined();
  expect(floodAlerts(unavailable, ALERT_NOW - 60_001, coverage()).notice).toBeUndefined();
  expect(floodAlerts(unavailable, ALERT_NOW, { ...coverage(), state: "unavailable" }).notice).toBeUndefined();
  expect(floodAlerts(floodEntity(), ALERT_NOW, coverage()).status).toBe("warnings");
  expect(floodAlerts(unavailable, ALERT_NOW, { state: "current", attributes: { scope: { type: "all_wales", area_codes: [] } } }).status).toBe("unavailable");
});
