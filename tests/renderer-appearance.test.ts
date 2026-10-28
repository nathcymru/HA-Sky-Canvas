// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bootstrapSkyCanvas, type RendererHandle } from "../src/renderer/adapter";
import type { HomeAssistant, SkyConfig } from "../src/types";
import { configFixture } from "./settings-fixtures";

vi.mock("../src/alerts", () => ({ createWeatherAlerts: () => ({ update() {}, destroy() {} }) }));
let handle: RendererHandle | undefined;
let hidden = false;
const events: string[] = [];
const receiveAppearance = (event: Event): void => { events.push((event as CustomEvent<{ weatherCardSurface: string }>).detail.weatherCardSurface); };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => {
  events.length = 0;
  hidden = false;
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  history.replaceState(null, "", "/dashboard-another/home");
  window.addEventListener("ha-sky-canvas-appearance", receiveAppearance);
});
afterEach(() => {
  handle?.destroy(); handle = undefined;
  window.removeEventListener("ha-sky-canvas-appearance", receiveAppearance);
  delete document.documentElement.dataset.skyWeatherSurface;
  document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks();
});

function fixture(initial: SkyConfig = configFixture()) {
  const app = document.createElement("home-assistant") as HTMLElement & { hass: HomeAssistant };
  let receive: (config: SkyConfig) => void = () => {};
  const stop = vi.fn();
  app.hass = {
    states: {}, config: { time_zone: "Europe/London" }, fetchWithAuth: vi.fn(),
    callWS: vi.fn(async () => initial) as HomeAssistant["callWS"],
    connection: { subscribeMessage: vi.fn(async callback => { receive = callback as (config: SkyConfig) => void; return stop; }) },
  };
  document.body.append(app);
  return { initial, stop, save(next: SkyConfig) { receive(next); } };
}

it("publishes saved appearance on excluded dashboards and only dispatches changes", async () => {
  const f = fixture(); handle = bootstrapSkyCanvas(); await flush();
  expect(document.documentElement.dataset.skyWeatherSurface).toBe("solid");
  expect(events).toEqual(["solid"]);
  f.save({ ...f.initial, revision: 5, weatherCardSurface: "glass" });
  expect(document.documentElement.dataset.skyWeatherSurface).toBe("glass");
  await vi.advanceTimersByTimeAsync(6000);
  f.save({ ...f.initial, revision: 6, weatherCardSurface: "glass", quality: "high" });
  f.save({ ...f.initial, revision: 4, weatherCardSurface: "solid" });
  expect(events).toEqual(["solid", "glass"]);
  expect(document.querySelector("[data-ha-sky-canvas]")).toBeNull();
  hidden = true;
  f.save({ ...f.initial, revision: 7, weatherCardSurface: "solid" });
  expect(document.documentElement.dataset.skyWeatherSurface).toBe("solid");
  expect(events).toEqual(["solid", "glass", "solid"]);
});

it("cleans up glass appearance once and ignores saved updates after teardown", async () => {
  const f = fixture({ ...configFixture(), weatherCardSurface: "glass" });
  handle = bootstrapSkyCanvas(); await flush();
  expect(events).toEqual(["glass"]);
  handle.destroy(); handle.destroy();
  f.save({ ...f.initial, revision: 10, weatherCardSurface: "glass" });
  expect(document.documentElement.dataset.skyWeatherSurface).toBeUndefined();
  expect(events).toEqual(["glass", "solid"]);
  expect(f.stop).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
