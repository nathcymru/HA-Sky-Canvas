import { LitElement, css, html, nothing } from "lit";
import type { HomeAssistant } from "../types";
import { forecastTime, frameKey, readForecastMap, type ForecastMap } from "./model";

interface MapConfig { entity: string; title?: string; }

/** Ordinary Lovelace card; the provider owns all remote requests and credentials. */
export class SkyCanvasForecastMap extends LitElement {
  static properties = { hass: { attribute: false }, config: { state: true }, index: { state: true }, playing: { state: true }, loaded: { state: true }, failed: { state: true }, globalSurface: { state: true } };
  static styles = css`
    :host{display:block;min-width:0;--mo-blue:#147bbe;--mo-panel:#114465;--mo-bar:#1d1d1d;--mo-lime:#c4e90c;font-family:var(--ha-font-family,Arial,sans-serif);font-variant-numeric:tabular-nums}
    ha-card{display:block;overflow:hidden;color:#fff;background:var(--mo-blue);border:1px solid rgba(255,255,255,.15);border-radius:var(--ha-card-border-radius,6px)}ha-card.glass{background:rgba(17,68,101,.9);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
    .brand-bar{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:8px 16px;background:var(--mo-bar);font-size:12px;line-height:1.4}.brand{font-weight:700;color:var(--mo-lime)}.source{color:#e3edf3}
    header{padding:20px 20px 12px}h2{font-size:20px;line-height:1.3;font-weight:600;margin:0 0 6px}p{margin:0;line-height:1.5}.sub,.meta{color:#e3edf3;font-size:13px}.map{position:relative;display:grid;place-items:center;min-height:220px;background:var(--mo-panel);aspect-ratio:4/3;overflow:hidden}.map img{display:block;width:100%;height:100%;object-fit:contain;position:absolute;inset:0}.empty{padding:32px;text-align:center;color:#e5edf5;max-width:34em}.controls{padding:16px 20px;background:var(--mo-panel)}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}button{min-height:44px;min-width:44px;padding:8px 12px;border:1px solid #9ab3c4;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid var(--mo-lime);outline-offset:3px}.play{background:var(--mo-lime);color:#1d1d1d;border-color:transparent;min-width:90px;font-weight:650}input{width:100%;min-height:44px;accent-color:var(--mo-lime)}.timestamp{font-size:15px;margin:10px 0 4px}.notice{padding:10px 20px;background:#f4b942;color:#1d2630;font-size:13px}.meta{padding:16px 20px 18px;display:grid;gap:6px}a{color:#fff;text-underline-offset:3px}.frame-count{margin-left:auto;font-size:13px;color:#e3edf3}
    @media(max-width:390px){header{padding:16px 16px 12px}.controls{padding:12px 16px}.meta{padding:12px 16px 16px}.brand-bar{padding:8px 12px}.brand-bar .source{font-size:11px}.frame-count{flex-basis:100%;margin-left:0}.empty{padding:24px}}
    @media(prefers-reduced-transparency:reduce){ha-card.glass{background:var(--mo-panel);backdrop-filter:none;-webkit-backdrop-filter:none}}
  `;
  declare hass: HomeAssistant;
  private config: MapConfig = { entity: "sensor.metoffice_direct_forecast_map" };
  private index = 0;
  private playing = false;
  private loaded = 0;
  private failed = 0;
  private urls = new Map<string, string>();
  private model: ForecastMap | null = null;
  private requested = "";
  private controller?: AbortController;
  private generation = 0;
  private timer?: number;
  private motion?: MediaQueryList;
  private visibility = () => { if (document.hidden) this.stop(); };
  private motionChanged = () => { if (this.motion?.matches) this.stop(); };
  private globalSurface: "solid" | "glass" = "solid";
  private appearance = (event?: Event): void => {
    const detail = (event as CustomEvent<{ weatherCardSurface?: unknown }> | undefined)?.detail;
    this.globalSurface = (detail?.weatherCardSurface ?? document.documentElement.dataset.skyWeatherSurface) === "glass" ? "glass" : "solid";
  };

  setConfig(config: Partial<MapConfig>): void {
    if (config.entity !== undefined && !/^sensor\.[a-z0-9_]+$/.test(config.entity)) throw new Error("Choose a Met Office forecast map sensor.");
    this.config = { entity: config.entity ?? "sensor.metoffice_direct_forecast_map", title: config.title };
  }
  static getStubConfig(): MapConfig { return { entity: "sensor.metoffice_direct_forecast_map" }; }
  getCardSize(): number { return 7; }
  getGridOptions() { return { columns: 12, rows: "auto", min_columns: 6, min_rows: 1 }; }
  connectedCallback(): void {
    super.connectedCallback();
    this.appearance();window.addEventListener("ha-sky-canvas-appearance", this.appearance);
    document.addEventListener("visibilitychange", this.visibility);
    this.motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.motion.addEventListener("change", this.motionChanged);
    this.requested = "";this.requestUpdate();
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop();this.controller?.abort();this.generation++;
    window.removeEventListener("ha-sky-canvas-appearance", this.appearance);
    document.removeEventListener("visibilitychange", this.visibility);
    this.motion?.removeEventListener("change", this.motionChanged);
    this.clearImages();this.requested = "";this.controller = undefined;
  }
  protected updated(): void {
    if (!this.hass || !this.isConnected) return;
    const model = readForecastMap(this.hass.states[this.config.entity]);
    const key = frameKey(model);
    this.model = model;
    if (key !== this.requested || (key && !this.controller)) {
      this.requested = key;void this.load(model);
    } else if (model?.stale || !model) this.stop();
  }
  private clearImages(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();this.loaded = 0;
  }
  private async load(model: ForecastMap | null): Promise<void> {
    if (!this.isConnected) return;
    this.stop();this.controller?.abort();
    const generation = ++this.generation;
    this.controller = new AbortController();
    this.clearImages();this.failed = 0;this.index = 0;
    if (!model) return;
    const signal = this.controller.signal;
    let cursor = 0;
    let totalBytes = 0;
    const worker = async () => {
      while (!signal.aborted && cursor < model.frames.length) {
        const frame = model.frames[cursor++];
        try {
          const response = await this.hass.fetchWithAuth(`/api/metoffice_direct/map/${frame.id}`, { signal });
          if (!response.ok || response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "image/png") throw new Error("Frame unavailable");
          const declaredSize = Number(response.headers.get("Content-Length"));
          if (declaredSize > 8 * 1024 * 1024) throw new Error("Frame cache limit");
          const blob = await response.blob();
          if (blob.size > 8 * 1024 * 1024 || totalBytes + blob.size > 64 * 1024 * 1024) throw new Error("Frame cache limit");
          if (signal.aborted || generation !== this.generation || !this.isConnected) return;
          totalBytes += blob.size;this.urls.set(frame.id, URL.createObjectURL(blob));this.loaded = this.urls.size;
        } catch { if (!signal.aborted && generation === this.generation) this.failed++; }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }
  private stop(): void { if (this.timer !== undefined) window.clearInterval(this.timer);this.timer = undefined;this.playing = false; }
  private failedImage(id: string, url: string): void {
    // A late error from an old <img> must not revoke a newer retry's image.
    if (this.urls.get(id) !== url) return;
    URL.revokeObjectURL(url);
    this.urls.delete(id);
    this.loaded = this.urls.size;
    this.failed++;
    if (this.loaded < 2) this.stop();
  }
  private move(delta: number): void {
    this.stop();const length = this.model?.frames.length ?? 0;
    if (length) this.index = (this.index + delta + length) % length;
  }
  private play(): void {
    if (this.playing) { this.stop();return; }
    if (!this.model || this.model.stale || this.loaded < 2 || document.hidden || !this.isConnected) return;
    this.playing = true;
    this.timer = window.setInterval(() => {
      const frames = this.model?.frames ?? [];
      if (!frames.length || document.hidden || !this.isConnected) { this.stop();return; }
      for (let attempt = 0;attempt < frames.length;attempt++) {
        this.index = (this.index + 1) % frames.length;
        if (this.urls.has(frames[this.index].id)) break;
      }
    }, this.motion?.matches ? 2000 : 800);
  }
  render() {
    const model = this.hass ? readForecastMap(this.hass.states[this.config.entity]) : null;
    const frame = model?.frames[Math.min(this.index, model.frames.length - 1)];
    const url = frame ? this.urls.get(frame.id) : undefined;
    const zone = this.hass?.config.time_zone ?? "UTC";
    return html`<ha-card class=${this.globalSurface}>
      <div class="brand-bar"><span class="brand">Met Office</span><span class="source">Forecast maps · Sky Canvas</span></div>
      <header><h2>${this.config.title ?? "Precipitation forecast"}</h2><p class="sub">Met Office · ${model?.region ?? "Waiting for forecast maps"}</p></header>
      ${model?.stale ? html`<p class="notice" role="status">This forecast is out of date. Playback is paused while fresh data is unavailable.</p>` : nothing}
      <div class="map">${url && frame ? html`<img src=${url} alt=${`Met Office precipitation forecast for ${forecastTime(frame.valid_time, zone)}`} @error=${() => this.failedImage(frame.id, url)}>` : html`<p class="empty" role="status">${!model ? "Forecast maps are unavailable. No current forecast can be inferred." : this.failed && this.loaded + this.failed >= model.frames.length ? "This forecast frame could not be loaded." : "Loading forecast map…"}</p>`}</div>
      ${model && frame ? html`<div class="controls"><div class="row"><button aria-label="Previous forecast hour" @click=${() => this.move(-1)}>←</button><button class="play" ?disabled=${this.loaded < 2 || model.stale} @click=${this.play}>${this.playing ? "Pause" : "Play"}</button><button aria-label="Next forecast hour" @click=${() => this.move(1)}>→</button><span class="frame-count">${this.loaded} / ${model.frames.length} frames</span></div><p class="timestamp">${forecastTime(frame.valid_time, zone)}</p><input type="range" aria-label="Forecast time" aria-valuetext=${forecastTime(frame.valid_time, zone)} min="0" max=${model.frames.length-1} .value=${String(this.index)} @input=${(event: Event) => { this.stop();this.index = Number((event.target as HTMLInputElement).value); }}><p class="sub">Available through ${forecastTime(model.frames.at(-1)!.valid_time, zone)}</p>${this.failed ? html`<button @click=${() => this.load(model)}>Retry frames</button>` : nothing}</div>` : nothing}
      <footer class="meta">${model ? html`<span>Model run: ${forecastTime(model.modelRun, zone)}</span>` : nothing}<span>Forecast imagery, not live radar. Times follow Home Assistant's timezone.</span><a href="https://www.metoffice.gov.uk/" target="_blank" rel="noopener noreferrer">Powered by Met Office data</a></footer>
    </ha-card>`;
  }
}

if (!customElements.get("ha-sky-canvas-forecast-map")) customElements.define("ha-sky-canvas-forecast-map", SkyCanvasForecastMap);
const registry = window as unknown as { customCards?: { type: string; name: string; description: string }[] };
registry.customCards ??= [];
if (!registry.customCards.some(card => card.type === "ha-sky-canvas-forecast-map")) registry.customCards.push({ type: "ha-sky-canvas-forecast-map", name: "Sky Canvas Forecast Map", description: "A rolling Met Office forecast map with local cached frames and playback." });
