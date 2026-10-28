// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeAssistant, SkyConfig } from "../src/types";
import { WeatherEngine } from "../src/renderer/engine";
import { AnimationRuntime } from "../src/renderer/runtime";
import { resolveScene } from "../src/renderer/model";

type Call = { method: string; args: unknown[] };
function context(): { context: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const properties: Record<string, unknown> = {};
  const ctx = new Proxy(properties, {
    get(target, name: string) {
      if (name in target) return target[name];
      if (name === "getTransform") return () => ({ a: 1 });
      if (name === "createLinearGradient" || name === "createRadialGradient") return () => ({ addColorStop() {} });
      return (...args: unknown[]) => { calls.push({ method: name, args }); };
    },
    set(target, name: string, value) { target[name] = value; return true; },
  });
  return { context: ctx as unknown as CanvasRenderingContext2D, calls };
}

const cfg: SkyConfig = { revision: 1, weatherEntity: "weather.met_office", frostEntity: null, applyToAll: false, dashboards: [], priority: [], quality: "medium", lightning: false, themes: [] };
function h(condition: string, night = false): HomeAssistant {
  return { states: { "weather.met_office": { state: condition, attributes: {} }, "sun.sun": { state: night ? "below_horizon" : "above_horizon", attributes: {} } }, config: { time_zone: "Europe/London" }, callWS: async <T>() => undefined as T, fetchWithAuth: async () => new Response() };
}

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context().context); });
afterEach(() => vi.restoreAllMocks());

describe("refactored upstream animation engine", () => {
  it.each(["sunny", "clear-night", "partlycloudy", "cloudy", "rainy", "pouring", "snowy", "snowy-rainy", "hail", "fog", "windy", "lightning", "lightning-rainy", "unavailable"])("renders %s using the injected clock", (condition) => {
    const sky = context(), front = context();
    const runtime = new AnimationRuntime(123);
    runtime.advance(0, new Date("2026-12-24T21:00Z"));
    const engine = new WeatherEngine(sky.context, front.context, runtime);
    const hass = h(condition, condition === "clear-night");
    expect(() => engine.draw(1024, 768, resolveScene(cfg, hass), cfg, hass, false)).not.toThrow();
    expect(sky.calls.some((call) => call.method === "fillRect")).toBe(true);
    expect(front.calls[0].method).toBe("clearRect");
  });

  it("produces the same precipitation geometry for a fixed seed and time", () => {
    function rainCoordinates(seed: number): unknown[] {
      const front = context();
      const runtime = new AnimationRuntime(seed); runtime.advance(0, new Date(0));
      const engine = new WeatherEngine(context().context, front.context, runtime);
      engine.draw(640, 480, resolveScene(cfg, h("rainy")), cfg, h("rainy"), false);
      return front.calls.filter((call) => ["moveTo", "lineTo"].includes(call.method)).map((call) => call.args);
    }
    expect(rainCoordinates(44)).toEqual(rainCoordinates(44));
    expect(rainCoordinates(44)).not.toEqual(rainCoordinates(45));
  });

  it("bounds rain particles on an enormous display", () => {
    const front = context();
    const engine = new WeatherEngine(context().context, front.context);
    engine.draw(16000, 9000, resolveScene(cfg, h("pouring")), cfg, h("pouring"), false);
    // Three depth layers, each capped at 110 particles in medium quality.
    expect(front.calls.filter((call) => call.method === "lineTo").length).toBeLessThanOrEqual(330);
  });

  it("disabled lightning and reduced motion both suppress full-screen flashes", () => {
    for (const [lightning, still] of [[false, false], [true, true]]) {
      const front = context();
      const engine = new WeatherEngine(context().context, front.context);
      const config = { ...cfg, lightning };
      engine.draw(640, 480, resolveScene(config, h("lightning")), config, h("lightning"), still);
      expect(front.calls.some((call) => call.method === "fillRect")).toBe(false);
    }
  });
});
