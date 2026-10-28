import type { HomeAssistant, SkyConfig } from "../types";
import { dashboardSelected } from "./model";
import { SkyScene } from "./scene";
import { createWeatherAlerts } from "../alerts";

type HassRoot = HTMLElement & { hass?: HomeAssistant };
export interface RendererHandle { destroy(): void; }

/**
 * One compatibility boundary, using the existing decorative Lovelace background.
 * Unknown layouts return null: no global CSS, card mutation, or history monkey patch.
 */
export function locateDashboardBackground(documentRoot: Document = document): HTMLElement | null {
  const app = documentRoot.querySelector("home-assistant");
  const main = app?.shadowRoot?.querySelector("home-assistant-main");
  const resolver = main?.shadowRoot?.querySelector("partial-panel-resolver");
  const panel = main?.shadowRoot?.querySelector("ha-panel-lovelace")
    ?? resolver?.shadowRoot?.querySelector("ha-panel-lovelace");
  const root = panel?.shadowRoot?.querySelector("hui-root");
  const background = root?.shadowRoot?.querySelector<HTMLElement>("hui-view-container#view > hui-view-background");
  return background?.shadowRoot && background.isConnected ? background : null;
}

export function bootstrapSkyCanvas(): RendererHandle {
  const alerts = createWeatherAlerts();
  let disposed = false;
  let config: SkyConfig | null = null;
  let connection: HomeAssistant["connection"] | null = null;
  let requestInFlight = false;
  let connectionGeneration = 0;
  let unsubscribe: (() => void) | null = null;
  let background: HTMLElement | null = null;
  let mount: HTMLDivElement | null = null;
  let scene: SkyScene | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let originalOpacity: { value: string; priority: string } | null = null;
  let warned = false;
  let failedAt = 0;
  let weatherCardSurface: "solid" | "glass" | null = null;

  const publishAppearance = (): void => {
    if (!config) return;
    const next = config.weatherCardSurface === "glass" ? "glass" : "solid";
    if (next === weatherCardSurface) return;
    weatherCardSurface = next;
    document.documentElement.dataset.skyWeatherSurface = next;
    window.dispatchEvent(new CustomEvent("ha-sky-canvas-appearance", { detail: { weatherCardSurface: next } }));
  };

  const unmount = (): void => {
    scene?.destroy();
    scene = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    mount?.remove();
    mount = null;
    if (background && originalOpacity) {
      if (originalOpacity.value) background.style.setProperty("opacity", originalOpacity.value, originalOpacity.priority);
      else background.style.removeProperty("opacity");
    }
    background = null;
    originalOpacity = null;
  };

  const align = (): void => {
    if (!background || !mount) return;
    const rect = background.getBoundingClientRect();
    // Fixed within the dashboard's horizontal bounds; scene stays behind the HA header.
    mount.style.left = `${rect.left}px`;
    mount.style.width = `${rect.width}px`;
    mount.style.height = `${window.innerHeight}px`;
  };

  const fetchConfig = async (hass: HomeAssistant): Promise<void> => {
    if (requestInFlight || disposed || (failedAt && Date.now() - failedAt < 10_000)) return;
    requestInFlight = true;
    const generation = ++connectionGeneration;
    unsubscribe?.();
    unsubscribe = null;
    connection = hass.connection;
    try {
      // Subscribe first so a save during the initial GET cannot be missed.
      if (hass.connection) {
        const stop = await hass.connection.subscribeMessage<SkyConfig>((next) => {
          if (!disposed && generation === connectionGeneration && (!config || next.revision >= config.revision)) {
            config = next;
            refresh();
          }
        }, { type: "ha_sky_canvas/subscribe" });
        if (disposed || generation !== connectionGeneration) { stop(); return; }
        unsubscribe = stop;
      }
      const next = await hass.callWS<SkyConfig>({ type: "ha_sky_canvas/config" });
      if (!disposed && generation === connectionGeneration && (!config || next.revision >= config.revision)) config = next;
      failedAt = 0;
    } catch {
      failedAt = Date.now();
      unsubscribe?.();
      unsubscribe = null;
      connection = null;
      if (!warned) {
        console.warn("HA Sky Canvas could not load settings; dashboard controls remain available.");
        warned = true;
      }
    } finally {
      requestInFlight = false;
      if (!disposed && config) refresh();
    }
  };

  const refresh = (): void => {
    if (disposed) return;
    // Saved appearance applies to cards even when this dashboard has no scene.
    publishAppearance();
    if (document.hidden) return;
    const hass = document.querySelector<HassRoot>("home-assistant")?.hass;
    // Warnings apply to every supported dashboard/view independently of whether
    // the decorative scene is selected. A missing HA session clears the banner.
    alerts.update(config, hass ?? null);
    if (!hass) { unmount(); return; }
    if (!config || connection !== hass.connection) void fetchConfig(hass);
    const target = config && dashboardSelected(location.pathname, config) ? locateDashboardBackground() : null;
    if (!target) { unmount(); return; }
    if (background !== target || !mount?.isConnected) {
      unmount();
      background = target;
      originalOpacity = { value: target.style.getPropertyValue("opacity"), priority: target.style.getPropertyPriority("opacity") };
      target.style.setProperty("opacity", "1");
      mount = document.createElement("div");
      mount.dataset.haSkyCanvas = "";
      mount.setAttribute("aria-hidden", "true");
      mount.inert = true;
      Object.assign(mount.style, { position: "fixed", top: "0", pointerEvents: "none", overflow: "hidden", display: "block" });
      target.shadowRoot!.append(mount);
      align();
      try {
        scene = new SkyScene(mount);
        resizeObserver = new ResizeObserver(align);
        resizeObserver.observe(target);
      } catch {
        unmount();
        return;
      }
    }
    if (config) scene?.update(config, hass);
    if (mount && scene) {
      // Native headings sit directly on the decorative background in Light mode.
      // Composite all three layers together over the theme's own background; do
      // not recolor cards, modify image assets, or add a fourth visual layer.
      if (hass.themes?.darkMode === false) {
        mount.style.backgroundColor = "var(--primary-background-color, #fafafa)";
        scene.element.style.opacity = "0.15";
      } else {
        mount.style.removeProperty("background-color");
        scene.element.style.removeProperty("opacity");
      }
    }
  };

  // HA does not expose a global supported renderer lifecycle. A small poll recovers
  // delayed panel mounting, reconnects and seasonal date changes without patching HA.
  const timer = window.setInterval(refresh, 2000);
  const onPageHide = (event: PageTransitionEvent): void => { if (!event.persisted) handle.destroy(); };
  const handle: RendererHandle = {
    destroy(): void {
      if (disposed) return;
      disposed = true;
      connectionGeneration++;
      window.clearInterval(timer);
      unsubscribe?.();
      unsubscribe = null;
      window.removeEventListener("location-changed", refresh);
      window.removeEventListener("popstate", refresh);
      window.removeEventListener("resize", align);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refresh);
      alerts.destroy();
      unmount();
      if (weatherCardSurface !== null && document.documentElement.dataset.skyWeatherSurface === weatherCardSurface) {
        delete document.documentElement.dataset.skyWeatherSurface;
        if (weatherCardSurface === "glass") window.dispatchEvent(new CustomEvent("ha-sky-canvas-appearance", { detail: { weatherCardSurface: "solid" } }));
      }
      weatherCardSurface = null;
    },
  };
  window.addEventListener("location-changed", refresh);
  window.addEventListener("popstate", refresh);
  window.addEventListener("resize", align);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", refresh);
  document.addEventListener("visibilitychange", refresh);
  refresh();
  return handle;
}
