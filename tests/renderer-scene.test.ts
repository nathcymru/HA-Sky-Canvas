// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeAssistant, ImageMap, SkyConfig } from "../src/types";
import { SkyScene } from "../src/renderer/scene";
import { bootstrapSkyCanvas, locateDashboardBackground, type RendererHandle } from "../src/renderer/adapter";

const config = (): SkyConfig => ({ revision: 1, weatherEntity: "weather.met_office", frostEntity: null, applyToAll: false, dashboards: ["dashboard-overview"], priority: [], quality: "medium", lightning: false, themes: [{ id: "default", name: "Default", enabled: true, schedule: null, images: { clear_day: null } as ImageMap }] });
const hass = (): HomeAssistant => ({ states: { "weather.met_office": { state: "unavailable", attributes: {} } }, config: { time_zone: "Europe/London" }, callWS: async <T>() => undefined as T, fetchWithAuth: vi.fn() });
let frames: Map<number, FrameRequestCallback>;
let hidden = false;
let reduced = false;
let cancel: ReturnType<typeof vi.fn>;
let scenes: SkyScene[];
let adapters: RendererHandle[];

beforeEach(() => {
  frames = new Map(); scenes = []; adapters = []; hidden = false; reduced = false;
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  cancel = vi.fn((id: number) => { frames.delete(id); });
  vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const gradient = { addColorStop: vi.fn() };
  const context = { clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn(), createLinearGradient: () => gradient, createRadialGradient: () => gradient };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context as unknown as CanvasRenderingContext2D);
});

afterEach(() => { adapters.forEach((adapter) => adapter.destroy()); scenes.forEach((scene) => scene.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function createScene(options = {}): SkyScene {
  const host = document.createElement("div"); document.body.append(host);
  const scene = new SkyScene(host, options); scenes.push(scene); return scene;
}

describe("scene lifecycle", () => {
  it("resolves timezone schedules on HA refresh instead of every animation frame", () => {
    const formatter = vi.spyOn(Intl, "DateTimeFormat");
    const scene = createScene();
    scene.update(config(), hass());
    const initialCalls = formatter.mock.calls.length;
    for (const timestamp of [0, 50, 100, 150]) {
      const [id, callback] = frames.entries().next().value!;
      frames.delete(id);
      callback(timestamp);
    }
    expect(formatter).toHaveBeenCalledTimes(initialCalls);
    scene.update(config(), hass());
    expect(formatter).toHaveBeenCalledTimes(initialCalls + 1);
  });

  it("keeps three layers noninteractive, sizes the full image without stretching, and removes everything on teardown", () => {
    const scene = createScene();
    scene.update(config(), hass());
    const layers = Array.from(scene.element.children) as HTMLElement[];
    expect(layers.map((layer) => layer.dataset.layer)).toEqual(["3", "2", "1"]);
    expect(layers[1].style.objectFit).toBe("contain");
    expect(layers[1].style.objectPosition).toBe("center bottom");
    expect(scene.element.getAttribute("aria-hidden")).toBe("true");
    expect(layers.every((layer) => layer.style.pointerEvents === "none")).toBe(true);
    expect(frames.size).toBe(1);
    scene.destroy();
    expect(frames.size).toBe(0);
    expect(scene.element.isConnected).toBe(false);
  });
  it("reduced motion keeps a static scene without animation frames", () => {
    reduced = true;
    const scene = createScene(); scene.update(config(), hass());
    expect(frames.size).toBe(0);
  });
  it("pauses while hidden, resumes once visible, and never duplicates RAF loops", () => {
    const scene = createScene();
    scene.update(config(), hass()); scene.update(config(), hass());
    expect(frames.size).toBe(1);
    hidden = true; document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    hidden = false; document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(1);
    scene.destroy();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
  });
  it("cancels authenticated image requests when the scene is destroyed", () => {
    const c = config(); c.themes[0].images.clear_day = "bundled_clear_day";
    let signal: AbortSignal | null | undefined;
    const h = hass(); h.fetchWithAuth = vi.fn((_path, options) => { signal = options?.signal; return new Promise<Response>(() => {}); });
    const scene = createScene(); scene.update(c, h);
    expect(h.fetchWithAuth).toHaveBeenCalledWith("/api/ha_sky_canvas/image/bundled_clear_day", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    scene.destroy();
    expect(signal?.aborted).toBe(true);
  });
});

describe("isolated HA compatibility boundary", () => {
  it("softens the whole Light scene to preserve native heading contrast, then restores Dark without remounting", async () => {
    history.replaceState(null, "", "/dashboard-overview/home");
    const state = hass();
    state.themes = { darkMode: false };
    state.callWS = async <T>() => config() as T;
    const app = document.createElement("home-assistant") as HTMLElement & { hass: HomeAssistant };
    app.hass = state; document.body.append(app);
    const main = document.createElement("home-assistant-main"); app.attachShadow({ mode: "open" }).append(main);
    const panel = document.createElement("ha-panel-lovelace"); main.attachShadow({ mode: "open" }).append(panel);
    const root = document.createElement("hui-root"); panel.attachShadow({ mode: "open" }).append(root);
    const view = document.createElement("hui-view-container"); view.id = "view";
    root.attachShadow({ mode: "open" }).append(view);
    const background = document.createElement("hui-view-background");
    background.style.setProperty("opacity", "0.7", "important");
    background.attachShadow({ mode: "open" });
    const heading = document.createElement("h2"); heading.style.color = "var(--primary-text-color)";
    const card = document.createElement("ha-card"); card.style.backgroundColor = "var(--card-background-color)";
    view.append(background, heading, card);
    const nativeStyles = [heading.style.cssText, card.style.cssText];

    const adapter = bootstrapSkyCanvas(); adapters.push(adapter);
    await vi.waitFor(() => expect(background.shadowRoot!.querySelector(".ha-sky-canvas-scene")).not.toBeNull());
    const mount = background.shadowRoot!.querySelector<HTMLElement>("[data-ha-sky-canvas]")!;
    const scene = mount.querySelector<HTMLElement>(".ha-sky-canvas-scene")!;
    expect(mount.style.backgroundColor).toBe("var(--primary-background-color, #fafafa)");
    expect(scene.style.opacity).toBe("0.15");
    expect(Array.from(scene.children, layer => (layer as HTMLElement).dataset.layer)).toEqual(["3", "2", "1"]);

    // Measured live Light palette. Black is the darkest possible scene pixel;
    // every brighter pixel increases contrast with these dark native headings.
    const luminance = (rgb: number[]) => rgb.map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const darkest = [230, 233, 239].map(channel => channel * (1 - Number(scene.style.opacity)));
    const contrast = (text: number[]) => (luminance(darkest) + 0.05) / (luminance(text) + 0.05);
    expect(contrast([76, 79, 105])).toBeGreaterThanOrEqual(4.5);
    expect(contrast([92, 95, 119])).toBeGreaterThanOrEqual(3.5);

    state.themes.darkMode = true;
    window.dispatchEvent(new Event("location-changed"));
    expect(scene.style.opacity).toBe("");
    expect(mount.style.backgroundColor).toBe("");
    expect(mount.querySelector(".ha-sky-canvas-scene")).toBe(scene);
    expect([heading.style.cssText, card.style.cssText]).toEqual(nativeStyles);
    state.themes.darkMode = false;
    window.dispatchEvent(new Event("location-changed"));
    expect(scene.style.opacity).toBe("0.15");
    expect(frames.size).toBe(1);

    adapter.destroy();
    expect(background.shadowRoot!.childElementCount).toBe(0);
    expect(background.style.getPropertyValue("opacity")).toBe("0.7");
    expect(background.style.getPropertyPriority("opacity")).toBe("important");
    expect(frames.size).toBe(0);
  });

  it("ignores arbitrary pages and only finds the known Lovelace decorative host", () => {
    document.body.innerHTML = "<hui-view-background></hui-view-background>";
    expect(locateDashboardBackground()).toBeNull();
    const app = document.createElement("home-assistant"); document.body.append(app);
    const main = document.createElement("home-assistant-main"); app.attachShadow({ mode: "open" }).append(main);
    const panel = document.createElement("ha-panel-lovelace"); main.attachShadow({ mode: "open" }).append(panel);
    const root = document.createElement("hui-root"); panel.attachShadow({ mode: "open" }).append(root);
    const view = document.createElement("hui-view-container"); view.id = "view";
    root.attachShadow({ mode: "open" }).append(view);
    const background = document.createElement("hui-view-background"); view.append(background);
    expect(locateDashboardBackground()).toBeNull();
    background.attachShadow({ mode: "open" });
    expect(locateDashboardBackground()).toBe(background);
    panel.remove();
    expect(locateDashboardBackground()).toBeNull();
  });
});
