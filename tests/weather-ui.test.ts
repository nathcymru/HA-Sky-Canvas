// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HassEntity, HomeAssistant } from "../src/types";
import { SkyCanvasWeatherCard } from "../src/weather/index";
import { SkyCanvasWeatherEditor } from "../src/weather/editor";
import { WEATHER_LAYOUTS, type WeatherCardConfig } from "../src/weather/config";

const now = new Date("2026-10-28T12:30:00Z");
const entity = (): HassEntity => ({ state: "rainy", attributes: {
  metoffice_daily_fetched_at: "2026-10-28T12:10:00Z", metoffice_daily_model_run: "2026-10-28T09:00:00Z",
  current_time: "2026-10-28T12:00:00Z", fetched_at: "2026-10-28T12:20:00Z", model_run: "2026-10-28T10:00:00Z",
  metoffice_weather_code: 11, temperature: 0, temperature_unit: "°C", wind_speed: 0, wind_speed_unit: "km/h",
  wind_gust_speed: 0, precipitation_probability: 0, precipitation_unit: "mm", uv_index: 0,
} });
const period = (code = 9, time = "2026-10-28T13:00:00Z") => ({ datetime: time, metoffice_weather_code: code, temperature: 8, precipitation_probability: 0, precipitation: 0, wind_speed: 2, wind_gust_speed: 4, wind_bearing: 270, uv_index: 0 });
let card: SkyCanvasWeatherCard;
let calls: { callback: (event: { forecast: unknown }) => void; request: Record<string, unknown>; stop: ReturnType<typeof vi.fn> }[];
type Subscribe = NonNullable<HomeAssistant["connection"]>["subscribeMessage"];
let subscribe: ReturnType<typeof vi.fn<Subscribe>>;
const root = () => card.shadowRoot!;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await card.updateComplete; };
const mount = async () => { document.body.append(card); await flush(); };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); calls = [];
  subscribe = vi.fn<Subscribe>(async (callback, request) => { const stop = vi.fn(); calls.push({ callback: callback as (event: { forecast: unknown }) => void, request, stop }); return stop; });
  card = document.createElement("ha-sky-canvas-weather-card") as SkyCanvasWeatherCard;
  card.hass = { states: { "weather.metoffice_direct": entity(), "weather.other": entity() }, config: { time_zone: "Europe/London" }, callWS: vi.fn(), fetchWithAuth: vi.fn(), connection: { subscribeMessage: subscribe } };
});
afterEach(() => { card.remove(); delete document.documentElement.dataset.skyWeatherSurface; vi.useRealTimers(); vi.restoreAllMocks(); });

describe("official weather card", () => {
  it("renders current official local artwork, useful labels and zeros without subscribing or external requests", async () => {
    card.setConfig({ entity: "weather.metoffice_direct", mode: "current", compact: true });
    await mount();
    expect(root().querySelector("img")?.getAttribute("src")).toBe("/ha_sky_canvas/weather-icons/v1/11.svg");
    expect(root().querySelector("img")?.getAttribute("alt")).toBe("");
    expect(root().textContent).toContain("Drizzle");
    expect(root().textContent).toContain("0°C");
    expect(root().textContent).toContain("0 km/h");
    expect(root().textContent).toContain("0%");
    expect(root().textContent).toContain("Open Government Licence v3.0");
    expect(root().textContent).toContain("Powered by Met Office data");
    expect(subscribe).not.toHaveBeenCalled();
    expect(card.hass.fetchWithAuth).not.toHaveBeenCalled();
    expect(card.hass.callWS).not.toHaveBeenCalled();
    const info = vi.fn(); card.addEventListener("hass-more-info", info);
    root().querySelector("button")!.click();
    expect((info.mock.calls[0][0] as CustomEvent).detail).toEqual({ entityId: "weather.metoffice_direct" });
  });
  it("uses supported HA subscriptions, exact period symbols, text labels and converted units", async () => {
    card.setConfig({ entity: "weather.metoffice_direct", mode: "hourly" }); await mount();
    expect(calls[0].request).toEqual({ type: "weather/subscribe_forecast", entity_id: "weather.metoffice_direct", forecast_type: "hourly" });
    calls[0].callback({ forecast: [period(9), period(10, "2026-10-28T14:00:00Z")] }); await flush();
    expect([...root().querySelectorAll("img")].map(img => img.getAttribute("src"))).toEqual(["/ha_sky_canvas/weather-icons/v1/9.svg", "/ha_sky_canvas/weather-icons/v1/10.svg"]);
    expect(root().textContent).toContain("Light rain shower (night)");
    expect(root().textContent).toContain("Light rain shower (day)");
    expect(root().textContent).toContain("W 2 km/h");
    expect(root().querySelector('[role="region"]')?.getAttribute("tabindex")).toBe("0");
    expect(root().querySelector("table caption")?.textContent).toContain("Missing measurements");
    card.hass = { ...card.hass }; await flush(); expect(subscribe).toHaveBeenCalledTimes(1);
    calls[0].callback({ forecast: null }); await flush();
    expect(root().querySelector("table")).toBeNull();
    expect(root().textContent).toContain("Forecast unavailable");
  });
  it("renders real Global Spot minute-precision state provenance in current and daily modes", async () => {
    Object.assign(card.hass.states["weather.metoffice_direct"]!.attributes, { current_time: "2026-10-28T12:00Z", model_run: "2026-10-28T10:00Z", fetched_at: "2026-10-28T12:20:00.123456+00:00", metoffice_daily_model_run: "2026-10-28T09:00Z" });
    await mount();
    expect(root().querySelector(".temperature")?.textContent).toContain("0°C");
    expect(root().textContent).not.toContain("out of date");
    expect(root().querySelector("footer")?.textContent).toContain("10:00");
    card.setConfig({ entity: "weather.metoffice_direct", mode: "daily" }); await flush();
    calls[0].callback({ forecast: [{ ...period(3, "2026-10-28T00:00:00+00:00"), templow: -2 }] }); await flush();
    expect(root().querySelector("table")).not.toBeNull();
    expect(root().querySelector("footer")?.textContent).toContain("09:00");
  });
  it("shows supplied daily day/night variants and never invents a missing night symbol", async () => {
    card.setConfig({ entity: "weather.metoffice_direct", mode: "daily" }); await mount();
    calls[0].callback({ forecast: [{ ...period(3, "2026-10-28T00:00:00Z"), metoffice_night_weather_code: 25, templow: -2 }] }); await flush();
    expect(root().textContent).toContain("Sunny intervals");
    expect(root().textContent).toContain("Heavy snow shower (night)");
    expect(root().textContent).toContain("-2°C");
    calls[0].callback({ forecast: [{ ...period(3, "2026-10-28T00:00:00Z"), templow: -2 }] }); await flush();
    expect(root().textContent).toContain("Symbol unavailable");
    expect(root().querySelectorAll("img")).toHaveLength(1);
    expect(root().querySelector("footer")?.textContent).toContain("09:00");
    expect(root().querySelector("footer")?.textContent).not.toContain("10:00");
    card.hass.states["weather.metoffice_direct"]!.attributes.metoffice_daily_model_run = "2026-10-28T06:00:00Z";
    card.hass = { ...card.hass }; await flush();
    expect(root().querySelector("table")).toBeNull();
    expect(root().textContent).toContain("out of date");
  });
  it("unsubscribes for entity, mode and connection changes and rejects late events", async () => {
    card.setConfig({ entity: "weather.metoffice_direct", mode: "hourly" }); await mount();
    card.setConfig({ entity: "weather.other", mode: "daily" }); await flush();
    expect(calls[0].stop).toHaveBeenCalledOnce();
    calls[0].callback({ forecast: [period(11)] }); await flush();
    expect(root().textContent).not.toContain("Drizzle");
    expect(calls[1].request).toEqual({ type: "weather/subscribe_forecast", entity_id: "weather.other", forecast_type: "daily" });
    card.hass = { ...card.hass, connection: { subscribeMessage: subscribe } }; await flush();
    expect(calls[1].stop).toHaveBeenCalledOnce(); expect(calls).toHaveLength(3);
    card.setConfig({ entity: "weather.other", mode: "current" }); await flush();
    expect(calls[2].stop).toHaveBeenCalledOnce(); expect(calls).toHaveLength(3);
  });
  it("cleans up a subscription promise that resolves after disconnect, and subscribes once on reconnect", async () => {
    let resolve!: (stop: () => void) => void;
    subscribe.mockImplementationOnce((callback, request) => { calls.push({ callback: callback as (event: { forecast: unknown }) => void, request, stop: vi.fn() }); return new Promise(done => { resolve = done; }); });
    card.setConfig({ entity: "weather.metoffice_direct", mode: "hourly" }); await mount();
    card.remove(); const stop = vi.fn(); resolve(stop); await flush();
    expect(stop).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    calls[0].callback({ forecast: [period(11)] }); await flush();
    await mount(); expect(subscribe).toHaveBeenCalledTimes(2);
    expect(root().textContent).not.toContain("Drizzle");
    card.remove(); expect(calls[1].stop).toHaveBeenCalledOnce();
  });
  it("reports a subscription failure and supports one explicit retry", async () => {
    subscribe.mockRejectedValueOnce(new Error("unavailable"));
    card.setConfig({ entity: "weather.metoffice_direct", mode: "hourly" }); await mount();
    expect(root().textContent).toContain("Forecast unavailable");
    root().querySelector("button")!.click(); await flush();
    expect(subscribe).toHaveBeenCalledTimes(2);
    calls[0].callback({ forecast: [period()] }); await flush();
    expect(root().querySelector("table")).not.toBeNull();
  });
  it("withdraws stale and unavailable values and retains textual meaning if an icon cannot load", async () => {
    await mount(); root().querySelector("img")!.dispatchEvent(new Event("error")); await flush();
    expect(root().querySelector("img")).toBeNull();
    expect(root().textContent).toContain("Drizzle");
    await vi.advanceTimersByTimeAsync(3 * 3_600_000); await flush();
    expect(root().textContent).toContain("out of date");
    expect(root().querySelector(".temperature")).toBeNull();
    card.hass.states["weather.metoffice_direct"]!.state = "unavailable";
    card.hass = { ...card.hass }; await flush();
    expect(root().textContent).toContain("Weather data is unavailable");
  });
  it("rechecks freshness immediately when a hidden dashboard becomes visible", async () => {
    await mount();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(3 * 3_600_000); await flush();
    expect(root().querySelector(".temperature")).not.toBeNull();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange")); await flush();
    expect(root().querySelector(".temperature")).toBeNull();
    expect(root().textContent).toContain("out of date");
  });
  it("limits compact forecast periods and rejects excessive daily/hourly limits", async () => {
    expect(() => card.setConfig({ entity: "weather.metoffice_direct", mode: "daily", limit: 11 })).toThrow();
    expect(() => card.setConfig({ entity: "weather.metoffice_direct", mode: "hourly", limit: 73 })).toThrow();
    card.setConfig({ entity: "weather.metoffice_direct", mode: "hourly", limit: 1 }); await mount();
    calls[0].callback({ forecast: [period(), period(10, "2026-10-28T14:00:00Z")] }); await flush();
    expect(root().querySelectorAll("thead th")).toHaveLength(2);
    expect(root().querySelectorAll("img")).toHaveLength(1);
  });
  it("uses official numeric colours with readable text and emphasizes strong gusts", async () => {
    Object.assign(card.hass.states["weather.metoffice_direct"]!.attributes, { temperature: 50, temperature_unit: "°F", wind_gust_speed: 29, wind_speed_unit: "mph", uv_index: 8 });
    await mount();
    const temperature = root().querySelector<HTMLElement>(".temperature .temp-band")!;
    expect(temperature.textContent).toBe("50°F");
    expect(temperature.style.backgroundColor).toBe("rgb(255, 215, 101)");
    expect(temperature.style.color).toBe("rgb(0, 0, 0)");
    expect(root().querySelector(".uv-band")?.textContent).toBe("8 · Very high");
    expect(root().querySelector("strong")?.textContent).toContain("29 mph");
    expect(root().querySelector("strong")?.textContent).toContain("strong gust");
  });
  it("explains Global Spot API periods instead of applying website forecast periods", async () => {
    await mount();
    expect(root().querySelector(".period-note")?.textContent).toContain("hour centred on the estimate time");
    expect(root().textContent).toContain("Gust · previous 10 min");
    card.setConfig({ entity: "weather.metoffice_direct", mode: "hourly" }); await flush();
    calls[0].callback({ forecast: [period()] }); await flush();
    const labels = [...root().querySelectorAll("tbody th")].map(item => item.textContent);
    expect(labels).toContain("Precipitation · previous hour");
    expect(labels).toContain("Gust · previous 10 min");
    expect(labels).not.toContain("Maximum gust");
    expect(root().textContent).toContain("chance covers the hour centred on that time");
    expect(root().textContent).toContain("3-second maximum over the previous 10 minutes");
    expect(root().textContent).not.toContain("period starting");
    card.setConfig({ entity: "weather.metoffice_direct", mode: "daily" }); await flush();
    calls[1].callback({ forecast: [{ ...period(3, "2026-10-28T00:00:00Z"), templow: -2 }] }); await flush();
    expect(root().textContent).toContain("local dawn to dusk");
    expect(root().textContent).toContain("Midday gust covers the preceding 10 minutes");
    expect(root().textContent).not.toContain("hour centred");
  });
  it("renders configured text as text and refuses unsafe entity or mode values", async () => {
    expect(() => card.setConfig({ entity: "https://example.test", mode: "current" })).toThrow();
    expect(() => card.setConfig({ entity: "weather.metoffice_direct", limit: 0 })).toThrow();
    card.setConfig({ entity: "weather.metoffice_direct", title: '<img src=x onerror="alert(1)">' }); await mount();
    expect(root().querySelector("h2")!.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(root().querySelector("h2 img")).toBeNull();
  });
  it("supplies nine meaningful native grid sizes and safely validates layout/background choices", () => {
    for (const [layout, preset] of Object.entries(WEATHER_LAYOUTS)) {
      card.setConfig({ entity: "weather.metoffice_direct", layout: layout as keyof typeof WEATHER_LAYOUTS });
      expect(card.getGridOptions()).toMatchObject({ columns: preset.columns, rows: preset.rows });
      expect(card.getCardSize()).toBe(preset.rows === "auto" ? 7 : preset.rows);
    }
    expect(() => card.setConfig({ entity: "weather.metoffice_direct", layout: "bogus" as never })).toThrow("layout");
    expect(() => card.setConfig({ entity: "weather.metoffice_direct", surface: "bogus" as never })).toThrow("background");
  });
  it("uses existing settings for glass, responds to saved changes, and respects card overrides", async () => {
    document.documentElement.dataset.skyWeatherSurface = "glass";
    card.setConfig({ entity: "weather.metoffice_direct", surface: "default", layout: "now" }); await mount();
    expect(root().querySelector("ha-card")?.classList.contains("glass")).toBe(true);
    window.dispatchEvent(new CustomEvent("ha-sky-canvas-appearance", { detail: { weatherCardSurface: "solid" } })); await flush();
    expect(root().querySelector("ha-card")?.classList.contains("solid")).toBe(true);
    card.setConfig({ entity: "weather.metoffice_direct", surface: "glass", layout: "now" }); await flush();
    window.dispatchEvent(new CustomEvent("ha-sky-canvas-appearance", { detail: { weatherCardSurface: "solid" } })); await flush();
    expect(root().querySelector("ha-card")?.classList.contains("glass")).toBe(true);
    expect(card.hass.callWS).not.toHaveBeenCalled(); expect(card.hass.fetchWithAuth).not.toHaveBeenCalled();
  });
  it("combines current conditions with a real forecast subscription for overview and keeps missing data explicit", async () => {
    card.setConfig({ entity: "weather.metoffice_direct", mode: "current", layout: "overview" }); await mount();
    expect(calls[0].request.forecast_type).toBe("hourly");
    expect(root().querySelector(".temperature")?.textContent).toContain("0°C");
    expect(root().textContent).toContain("Loading forecast");
    calls[0].callback({ forecast: [period(), period(10, "2026-10-28T14:00:00Z")] }); await flush();
    expect(root().querySelectorAll(".period")).toHaveLength(2);
    expect(root().querySelector(".period time")?.getAttribute("datetime")).toBe("2026-10-28T13:00:00.000Z");
    calls[0].callback({ forecast: null }); await flush();
    expect(root().querySelectorAll(".period")).toHaveLength(0);
    expect(root().querySelector(".temperature")?.textContent).toContain("0°C");
    expect(root().textContent).toContain("Forecast unavailable");
  });
  it("keeps current-only YAML layouts coherent even when an old forecast mode remains", async () => {
    card.hass.states["weather.metoffice_direct"]!.attributes.metoffice_daily_model_run = "2026-10-27T00:00:00Z";
    card.setConfig({ entity: "weather.metoffice_direct", mode: "daily", layout: "glance" }); await mount();
    expect(root().querySelector(".temperature")?.textContent).toBe("0°");
    expect(root().querySelector(".current-action")?.getAttribute("aria-label")).toContain("0°C");
    expect(subscribe).not.toHaveBeenCalled();
    expect(root().textContent).not.toContain("Loading forecast");
    card.hass.states["weather.metoffice_direct"]!.attributes.current_time = "2026-10-27T00:00:00Z";
    card.hass = { ...card.hass }; await flush();
    expect(root().querySelector(".temperature")).toBeNull();
    expect(root().textContent).toContain("Weather out of date");
  });
  it("publishes editor changes without saving independently, preserves custom config and resets the native grid for a preset", async () => {
    const editor = SkyCanvasWeatherCard.getConfigElement() as SkyCanvasWeatherEditor;
    editor.hass = card.hass;
    editor.setConfig({ type: "custom:ha-sky-canvas-weather-card", entity: "weather.metoffice_direct", mode: "hourly", limit: 48, visibility: [{ condition: "screen", media_query: "(min-width: 300px)" }], grid_options: { columns: 24, rows: "auto" } });
    document.body.append(editor); await editor.updateComplete;
    const changed = vi.fn(); editor.addEventListener("config-changed", changed);
    const selects = editor.shadowRoot!.querySelectorAll("select");
    selects[1].value = "tile"; selects[1].dispatchEvent(new Event("change")); await editor.updateComplete;
    const next = (changed.mock.calls[0][0] as CustomEvent<{ config: WeatherCardConfig }>).detail.config;
    expect(next).toMatchObject({ mode: "current", layout: "tile", grid_options: { columns: 6, rows: 1 }, visibility: [{ condition: "screen", media_query: "(min-width: 300px)" }] });
    expect(selects[2].disabled).toBe(true);
    selects[1].value = "forecast"; selects[1].dispatchEvent(new Event("change")); await editor.updateComplete;
    expect(selects[2].disabled).toBe(false);
    selects[2].value = "daily"; selects[2].dispatchEvent(new Event("change")); await editor.updateComplete;
    expect((changed.mock.calls[2][0] as CustomEvent<{ config: WeatherCardConfig }>).detail.config.limit).toBe(7);
    expect(card.hass.callWS).not.toHaveBeenCalled();
    editor.remove();
  });
});
