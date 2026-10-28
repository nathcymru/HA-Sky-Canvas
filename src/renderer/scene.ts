import type { HomeAssistant, SkyConfig } from "../types";
import { canvasSize, resolveScene, type SceneState } from "./model";
import { AnimationRuntime } from "./runtime";
import { WeatherEngine } from "./engine";

export interface SceneOptions {
  seed?: number;
  now?: () => Date;
  /** false renders a single still, including in deterministic visual tests. */
  motion?: boolean;
}

export class SkyScene {
  readonly element: HTMLDivElement;
  private readonly sky = document.createElement("canvas");
  private readonly house = document.createElement("img");
  private readonly weather = document.createElement("canvas");
  private readonly engine: WeatherEngine;
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  private readonly now: () => Date;
  private readonly motion: boolean;
  private config: SkyConfig | null = null;
  private hass: HomeAssistant | null = null;
  private state: SceneState | null = null;
  private width = 1;
  private height = 1;
  private frame: number | null = null;
  private previousFrame: number | null = null;
  private disposed = false;
  private imageId: string | null = null;
  private imageUrl: string | null = null;
  private imageGeneration = 0;
  private request: AbortController | null = null;

  constructor(private host: HTMLElement, options: SceneOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.motion = options.motion !== false;
    this.element = document.createElement("div");
    this.element.className = "ha-sky-canvas-scene";
    this.element.setAttribute("aria-hidden", "true");
    this.element.inert = true;
    Object.assign(this.element.style, { position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none", userSelect: "none", isolation: "isolate" });
    this.house.alt = "";
    this.house.decoding = "async";
    this.house.hidden = true;
    for (const [index, child] of [this.sky, this.house, this.weather].entries()) {
      Object.assign(child.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: String(index) });
      child.dataset.layer = String(3 - index);
    }
    Object.assign(this.house.style, { objectFit: "contain", objectPosition: "center bottom" });
    this.element.append(this.sky, this.house, this.weather);
    const skyContext = this.sky.getContext("2d", { alpha: false });
    const weatherContext = this.weather.getContext("2d");
    if (!skyContext || !weatherContext) throw new Error("Sky Canvas: Canvas 2D is unavailable");
    this.engine = new WeatherEngine(skyContext, weatherContext, new AnimationRuntime(options.seed));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.host.append(this.element);
    this.resizeObserver.observe(this.host);
    this.reducedMotion.addEventListener("change", this.onMotionChange);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.resize();
  }

  update(config: SkyConfig, hass: HomeAssistant): void {
    if (this.disposed) return;
    const qualityChanged = this.config?.quality !== config.quality;
    this.config = config;
    this.hass = hass;
    const scene = resolveScene(config, hass, this.now());
    this.state = scene;
    void this.loadImage(scene.imageId, hass);
    if (qualityChanged) this.resize();
    this.draw(0);
    this.schedule();
  }

  private get staticFrame(): boolean { return !this.motion || this.reducedMotion.matches; }

  private resize(): void {
    if (this.disposed) return;
    const rect = this.host.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    const size = canvasSize(this.width, this.height, devicePixelRatio, this.config?.quality ?? "medium");
    for (const canvas of [this.sky, this.weather]) {
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext("2d")?.setTransform(size.scale, 0, 0, size.scale, 0, 0);
    }
    this.draw(0);
  }

  private draw(delta: number): void {
    if (!this.config || !this.hass || !this.state || this.disposed) return;
    const date = this.now();
    this.engine.runtime.advance(this.staticFrame ? 0 : delta, date);
    // HA updates and the adapter's two-second refresh resolve dates and image/theme
    // selection once. Do not construct timezone formatters at animation frame rate.
    this.engine.draw(this.width, this.height, this.state, this.config, this.hass, this.staticFrame);
  }

  private schedule(): void {
    if (this.disposed || this.staticFrame || document.hidden || this.frame !== null || !this.config) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (timestamp: number): void => {
    this.frame = null;
    if (!this.config || this.disposed || this.staticFrame || document.hidden) return;
    const interval = 1000 / ({ low: 20, medium: 30, high: 60 }[this.config.quality]);
    if (this.previousFrame === null || timestamp - this.previousFrame >= interval - 1) {
      const delta = this.previousFrame === null ? 0 : (timestamp - this.previousFrame) / 1000;
      this.previousFrame = timestamp;
      this.draw(delta);
    }
    this.schedule();
  };

  private cancelFrame(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.previousFrame = null;
  }

  private onMotionChange = (): void => { this.cancelFrame(); this.draw(0); this.schedule(); };
  private onVisibilityChange = (): void => {
    this.cancelFrame();
    if (!document.hidden) { this.draw(0); this.schedule(); }
  };

  private async loadImage(id: string | null, hass: HomeAssistant): Promise<void> {
    if (id === this.imageId) return;
    this.imageId = id;
    const generation = ++this.imageGeneration;
    this.request?.abort();
    this.request = new AbortController();
    if (id === null) { this.clearImage(); return; }
    try {
      const response = await hass.fetchWithAuth(`/api/ha_sky_canvas/image/${encodeURIComponent(id)}`, { signal: this.request.signal });
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new Error("Image unavailable");
      const blob = await response.blob();
      if (this.disposed || generation !== this.imageGeneration) return;
      const url = URL.createObjectURL(blob);
      const nextImage = new Image();
      nextImage.src = url;
      try { await nextImage.decode(); }
      catch { URL.revokeObjectURL(url); throw new Error("Image decode failed"); }
      if (this.disposed || generation !== this.imageGeneration) { URL.revokeObjectURL(url); return; }
      this.clearImage();
      this.imageUrl = url;
      this.house.src = url;
      this.house.hidden = false;
    } catch {
      if (!this.disposed && generation === this.imageGeneration) {
        this.clearImage();
        // Allow a later HA refresh to retry transient download failures.
        this.imageId = null;
      }
    }
  }

  private clearImage(): void {
    this.house.hidden = true;
    this.house.removeAttribute("src");
    if (this.imageUrl !== null) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = null;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.imageGeneration++;
    this.request?.abort();
    this.cancelFrame();
    this.resizeObserver.disconnect();
    this.reducedMotion.removeEventListener("change", this.onMotionChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.clearImage();
    this.element.remove();
    this.sky.width = this.sky.height = this.weather.width = this.weather.height = 1;
  }
}
