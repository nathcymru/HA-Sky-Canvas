// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { RendererHandle } from "../src/renderer/index";

const key = Symbol.for("ha-sky-canvas.renderer");
const page = window as unknown as { [key: symbol]: RendererHandle | undefined };

afterEach(() => {
  page[key]?.destroy();
  delete page[key];
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("keeps one real renderer lifecycle when separate module instances load on one page", async () => {
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
