// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { RendererHandle } from "../src/renderer/index";

const key = Symbol.for("ha-sky-canvas.renderer");
const page = window as unknown as { [key: symbol]: RendererHandle | undefined };

afterEach(() => {
  page[key]?.destroy();
  delete page[key];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("defers all component imports until HA replaces its early registry and defines its app", async () => {
  const nativeRegistry = customElements;
  let ready!: (value: CustomElementConstructor) => void;
  const promise = new Promise<CustomElementConstructor>(resolve => { ready = resolve; });
  const early = {
    whenDefined: vi.fn(() => promise),
    get: nativeRegistry.get.bind(nativeRegistry),
    define: vi.fn(nativeRegistry.define.bind(nativeRegistry)),
  };
  vi.stubGlobal("customElements", early);
  const loading = import("../src/index");
  await vi.waitFor(() => expect(early.whenDefined).toHaveBeenCalledWith("home-assistant"));
  expect(early.define).not.toHaveBeenCalled();
  expect(page[key]).toBeUndefined();
  expect(nativeRegistry.get("ha-sky-canvas-weather-card")).toBeUndefined();

  const settled = {
    whenDefined: nativeRegistry.whenDefined.bind(nativeRegistry),
    get: nativeRegistry.get.bind(nativeRegistry),
    define: vi.fn(nativeRegistry.define.bind(nativeRegistry)),
  };
  vi.stubGlobal("customElements", settled);
  class HomeAssistantApp extends HTMLElement {}
  settled.define("home-assistant", HomeAssistantApp);
  // HA's registry polyfill also defines a native stand-in, resolving the
  // earlier native registry's whenDefined promise after replacement.
  ready(HomeAssistantApp);
  await loading;
  expect(early.define).not.toHaveBeenCalled();
  for (const tag of ["ha-sky-canvas-weather-card", "ha-sky-canvas-weather-alerts", "ha-sky-canvas-forecast-map", "ha-sky-canvas-settings"]) {
    expect(settled.define.mock.calls.some(([name]) => name === tag)).toBe(true);
    expect(settled.get(tag)).toBeDefined();
  }
  expect(page[key]).toBeDefined();
});

it("keeps one real renderer lifecycle when separate module instances load on one page", async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const interval = vi.spyOn(window, "setInterval");
  const listener = vi.spyOn(window, "addEventListener");
  await import("../src/index");
  const handle = page[key];
  expect(handle).toBeDefined();

  // Separate query URLs execute modules again while sharing the same window.
  vi.resetModules();
  await import("../src/index");
  expect(page[key]).toBe(handle);
  expect(interval).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls.filter(([name]) => name === "location-changed")).toHaveLength(1);

  handle!.destroy();
  expect(vi.getTimerCount()).toBe(0);
});
