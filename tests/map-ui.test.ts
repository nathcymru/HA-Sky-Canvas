// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HassEntity, HomeAssistant } from "../src/types";
import { SkyCanvasForecastMap } from "../src/map/index";

const now = new Date("2026-10-28T12:00:00Z");
const id = (value: number) => value.toString(16).padStart(64, "0");
const entity = (count = 3, offset = 0): HassEntity => ({ state: "ready", attributes: {
  fetched_at: now.toISOString(), model_run: "2026-10-28T11:00:00Z", region: "Wales",
  frames: Array.from({ length: count }, (_, i) => ({ id: id(offset + i), valid_time: new Date(now.getTime() + i * 3_600_000).toISOString(), model_run: "2026-10-28T11:00:00Z" })),
} });
const png = () => new Response(new Blob(["png test bytes"], { type: "image/png" }), { headers: { "Content-Type": "image/png" } });
let card: SkyCanvasForecastMap;
let fetcher: ReturnType<typeof vi.fn<HomeAssistant["fetchWithAuth"]>>;
let hidden = false;
let reduced = false;
let motionChange: (() => void) | undefined;
let removeMotion: ReturnType<typeof vi.fn>;
const root = () => card.shadowRoot!;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await card.updateComplete; };
const click = async (selector: string) => { root().querySelector<HTMLButtonElement>(selector)!.click(); await flush(); };

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  hidden = false;
  reduced = false;
  removeMotion = vi.fn();
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener(_event: string, callback: () => void) { motionChange = callback; }, removeEventListener: removeMotion }));
  let serial = 0;
  URL.createObjectURL = vi.fn(() => `blob:forecast-${++serial}`);
  URL.revokeObjectURL = vi.fn();
  fetcher = vi.fn(async () => png());
  card = document.createElement("ha-sky-canvas-forecast-map") as SkyCanvasForecastMap;
  card.hass = { states: { "sensor.metoffice_direct_forecast_map": entity() }, config: { time_zone: "Europe/London" }, callWS: vi.fn(), fetchWithAuth: fetcher };
});
afterEach(() => { card.remove(); delete document.documentElement.dataset.skyWeatherSurface; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() { document.body.append(card); await flush(); }

describe("authenticated forecast map card", () => {
  it("uses the shared surface preference without refetching maps, and fits the native full-width grid", async () => {
    document.documentElement.dataset.skyWeatherSurface = "glass";
    await mount();
    expect(root().querySelector("ha-card")?.classList.contains("glass")).toBe(true);
    expect(card.getGridOptions()).toEqual({ columns: 12, rows: "auto", min_columns: 6, min_rows: 1 });
    const requests = fetcher.mock.calls.length;
    window.dispatchEvent(new CustomEvent("ha-sky-canvas-appearance", { detail: { weatherCardSurface: "solid" } }));
    await flush();
    expect(root().querySelector("ha-card")?.classList.contains("solid")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(requests);
    const removed = vi.spyOn(window, "removeEventListener");
    card.remove();
    expect(removed.mock.calls.some(([name]) => name === "ha-sky-canvas-appearance")).toBe(true);
  });

  it("requests only opaque local cache URLs, loads with bounded concurrency and never autoplays", async () => {
    const pending: ((response: Response) => void)[] = [];
    fetcher.mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
    card.hass.states["sensor.metoffice_direct_forecast_map"] = entity(5);
    await mount();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.every(([path, options]) => /^\/api\/metoffice_direct\/map\/[a-f0-9]{64}$/.test(path) && options?.signal instanceof AbortSignal)).toBe(true);
    pending[0](png()); await flush();
    expect(fetcher).toHaveBeenCalledTimes(4);
    pending[1](png()); pending[2](png()); await flush();
    pending[3](png()); pending[4](png()); await flush();
    expect(root().textContent).toContain("5 / 5 frames");
    expect(root().querySelector("img")?.getAttribute("src")).toMatch(/^blob:/);
    expect(vi.getTimerCount()).toBe(0);
    expect(card.hass.callWS).not.toHaveBeenCalled();
  });

  it("plays and pauses, stops in hidden tabs, and tears down listeners and image URLs", async () => {
    await mount();
    const first = root().querySelector("img")!.getAttribute("src");
    await click(".play");
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(800); await flush();
    expect(root().querySelector("img")!.getAttribute("src")).not.toBe(first);
    await click(".play");
    expect(vi.getTimerCount()).toBe(0);
    await click(".play");
    hidden = true; document.dispatchEvent(new Event("visibilitychange")); await flush();
    expect(vi.getTimerCount()).toBe(0);
    hidden = false; document.dispatchEvent(new Event("visibilitychange")); await flush();
    expect(vi.getTimerCount()).toBe(0);
    card.remove();
    expect(removeMotion).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  });

  it("stops on a reduced-motion change and uses slower frames only after explicit Play", async () => {
    await mount(); await click(".play");
    reduced = true; motionChange!(); await flush();
    expect(vi.getTimerCount()).toBe(0);
    const previous = root().querySelector("img")!.getAttribute("src");
    await click(".play");
    await vi.advanceTimersByTimeAsync(1999); await flush();
    expect(root().querySelector("img")!.getAttribute("src")).toBe(previous);
    await vi.advanceTimersByTimeAsync(1); await flush();
    expect(root().querySelector("img")!.getAttribute("src")).not.toBe(previous);
  });

  it("aborts an old forecast and ignores its late responses when a new run arrives", async () => {
    const pending: ((response: Response) => void)[] = [];
    fetcher.mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
    await mount();
    const oldSignals = fetcher.mock.calls.map(([, options]) => options!.signal!);
    card.hass = { ...card.hass, states: { "sensor.metoffice_direct_forecast_map": entity(2, 10) } };
    await flush();
    expect(oldSignals.every(signal => signal.aborted)).toBe(true);
    pending.slice(0, 3).forEach(resolve => resolve(png())); await flush();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    pending.slice(3).forEach(resolve => resolve(png())); await flush();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(root().textContent).toContain("2 / 2 frames");
  });

  it("aborts when detached and fetches again when the same card reconnects", async () => {
    let firstResponse!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { firstResponse = resolve; }));
    await mount();
    const signal = fetcher.mock.calls[0][1]!.signal!;
    card.remove();
    expect(signal.aborted).toBe(true);
    firstResponse(png()); await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    const createdBeforeReconnect = vi.mocked(URL.createObjectURL).mock.calls.length;
    await mount();
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(vi.mocked(URL.createObjectURL).mock.calls.length).toBe(createdBeforeReconnect + 3);
    expect(root().textContent).toContain("3 / 3 frames");
  });

  it("reports failures, retries and stops playback if too few decoded images remain", async () => {
    fetcher.mockImplementationOnce(async () => new Response("forbidden", { status: 403 }));
    await mount();
    expect(root().textContent).toContain("could not be loaded");
    expect(root().textContent).toContain("Retry frames");
    const retry = [...root().querySelectorAll("button")].find(button => button.textContent === "Retry frames")!;
    retry.click(); await flush();
    expect(root().textContent).toContain("3 / 3 frames");
    await click(".play");
    root().querySelector("img")!.dispatchEvent(new Event("error")); await flush();
    await vi.advanceTimersByTimeAsync(800); await flush();
    root().querySelector("img")!.dispatchEvent(new Event("error")); await flush();
    expect(vi.getTimerCount()).toBe(0);
    expect(root().querySelector<HTMLButtonElement>(".play")!.disabled).toBe(true);
  });

  it("renders stale data as stale and disables playback", async () => {
    const item = entity(); item.attributes.fetched_at = "2026-10-28T08:00:00Z";
    card.hass.states["sensor.metoffice_direct_forecast_map"] = item;
    await mount();
    expect(root().textContent).toContain("out of date");
    expect(root().querySelector<HTMLButtonElement>(".play")!.disabled).toBe(true);
    await click(".play");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores an error dispatched by a replaced image after a retry finishes", async () => {
    fetcher.mockImplementationOnce(async () => new Response("forbidden", { status: 403 }));
    await mount();
    await click('[aria-label="Next forecast hour"]');
    const oldImage = root().querySelector("img")!;
    const retry = [...root().querySelectorAll("button")].find(button => button.textContent === "Retry frames")!;
    retry.click(); await flush();
    const revocations = vi.mocked(URL.revokeObjectURL).mock.calls.length;
    oldImage.dispatchEvent(new Event("error")); await flush();
    expect(root().textContent).toContain("3 / 3 frames");
    expect(root().textContent).not.toContain("Retry frames");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(revocations);
  });

  it("enforces the total compressed-image memory budget across concurrent workers", async () => {
    fetcher.mockImplementation(async () => {
      const response = png();
      response.blob = async () => ({ size: 8 * 1024 * 1024 }) as Blob;
      return response;
    });
    card.hass.states["sensor.metoffice_direct_forecast_map"] = entity(9);
    await mount(); await flush();
    expect(root().textContent).toContain("8 / 9 frames");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(8);
    expect(root().textContent).toContain("Retry frames");
  });

  it("fails closed for untrusted frame IDs and rejects oversized declared frames", async () => {
    const bad = entity();
    (bad.attributes.frames as { id: string }[])[0].id = "https://example.test/track";
    card.hass.states["sensor.metoffice_direct_forecast_map"] = bad;
    await mount();
    expect(fetcher).not.toHaveBeenCalled();
    expect(root().textContent).toContain("No current forecast can be inferred");
    fetcher.mockImplementation(async () => new Response("png", { headers: { "Content-Type": "image/png", "Content-Length": String(8 * 1024 * 1024 + 1) } }));
    card.hass = { ...card.hass, states: { "sensor.metoffice_direct_forecast_map": entity() } };
    await flush();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(root().textContent).toContain("0 / 3 frames");
  });
});
