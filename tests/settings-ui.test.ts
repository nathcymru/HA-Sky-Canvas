// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeAssistant, SkyConfig } from "../src/types";
import { SkyCanvasSettings } from "../src/settings/index";
import { configFixture } from "./settings-fixtures";

let element: SkyCanvasSettings;
let config: SkyConfig;
let calls: Record<string, unknown>[];
let fetcher: ReturnType<typeof vi.fn>;
let unsubscribe = vi.fn<() => void>();
let onConfig: (config: SkyConfig) => void;
const root = () => element.shadowRoot!;
const query = <T extends Element = HTMLButtonElement>(selector: string): T => root().querySelector<T>(selector)!;
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await element.updateComplete; };
const click = async (selector: string) => { query<HTMLButtonElement>(selector).click(); await flush(); };

beforeEach(async () => {
  config = configFixture();
  calls = [];
  fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "uploaded_scene" }), { status: 200, headers: { "Content-Type": "application/json" } }));
  unsubscribe = vi.fn();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  URL.createObjectURL = vi.fn(() => "blob:test-preview");
  URL.revokeObjectURL = vi.fn();
  const hass: HomeAssistant = {
    config: { time_zone: "Europe/London" },
    states: { "weather.met_office": { state: "cloudy", attributes: { friendly_name: "Met Office" } } },
    panels: { lovelace: { component_name: "lovelace", title: "Home" }, energy: { component_name: "energy", title: "Energy" } },
    callWS: (async (message: Record<string, unknown>) => {
      calls.push(message);
      if (message.type === "lovelace/dashboards/list") return [{ url_path: "dashboard-overview", title: "Overview" }];
      if (message.type === "ha_sky_canvas/save_theme") {
        config = structuredClone(config);
        const theme = message.theme as SkyConfig["themes"][number];
        config.themes = config.themes.map(item => item.id === theme.id ? theme : item);
        config.revision++;
      }
      if (message.type === "ha_sky_canvas/save_settings") {
        config = { ...config, ...message.settings as Partial<SkyConfig>, revision: config.revision + 1 };
      }
      return structuredClone(config);
    }) as HomeAssistant["callWS"],
    fetchWithAuth: fetcher as HomeAssistant["fetchWithAuth"],
    connection: { subscribeMessage: vi.fn(async callback => { onConfig = callback as (config: SkyConfig) => void; return unsubscribe; }) },
  };
  element = document.createElement("ha-sky-canvas-settings") as SkyCanvasSettings;
  element.hass = hass;
  document.body.append(element);
  await flush();
});
afterEach(() => { element.remove(); vi.restoreAllMocks(); });

describe("settings panel interaction", () => {
  it("selects saved weather and frost entities after dynamic options are first rendered", async () => {
    const next = structuredClone(config);
    next.revision++;
    next.frostEntity = "binary_sensor.current_frost";
    element.hass = { ...element.hass, states: { ...element.hass.states, "binary_sensor.current_frost": { state: "off", attributes: {} } } };
    onConfig(next);
    await flush();
    await click("#tab-settings");
    const selects = root().querySelectorAll<HTMLSelectElement>("select");
    expect(selects[0].value).toBe("weather.met_office");
    expect(selects[1].value).toBe("binary_sensor.current_frost");
  });
  it("subscribes before loading and retains a newer push received during the initial read", async () => {
    const hass = element.hass;
    element.remove();
    let resolveConfig!: (config: SkyConfig) => void;
    const original = hass.callWS;
    hass.callWS = (async (message: Record<string, unknown>) => {
      if (message.type === "ha_sky_canvas/config") {
        expect(hass.connection!.subscribeMessage).toHaveBeenCalledTimes(2);
        return new Promise<SkyConfig>(resolve => { resolveConfig = resolve; });
      }
      return original(message);
    }) as HomeAssistant["callWS"];
    element = document.createElement("ha-sky-canvas-settings") as SkyCanvasSettings;
    element.hass = hass;
    document.body.append(element);
    await flush();
    const newer = structuredClone(config);
    newer.revision++;
    newer.themes[1].enabled = false;
    onConfig(newer);
    resolveConfig(structuredClone(config));
    await flush();
    await click("#tab-christmas");
    expect(query<HTMLInputElement>("#theme-enabled").checked).toBe(false);
  });

  it("renders eight truly blank slots with named upload controls and real dashboard choices", async () => {
    expect(root().querySelectorAll(".preview")).toHaveLength(8);
    expect([...root().querySelectorAll(".preview")].every(box => box.textContent?.trim() === "")).toBe(true);
    expect(query("#upload-clear_day").getAttribute("aria-label")).toContain("Default, Clear, Day");
    await click("#tab-dashboards");
    const labels = [...root().querySelectorAll(".dashboard")].map(label => label.textContent);
    expect(labels.some(label => label?.includes("Overview"))).toBe(true);
    expect(labels.some(label => label?.includes("Home"))).toBe(true);
    expect(labels.some(label => label?.includes("Energy"))).toBe(false);
  });

  it("requires Save or Discard to leave a changed theme and Stay preserves the draft", async () => {
    await click("#tab-christmas");
    await click("#theme-enabled");
    await click("#tab-default");
    expect(query<HTMLDialogElement>("#unsaved-dialog").open).toBe(true);
    expect(query("#tab-christmas").getAttribute("aria-selected")).toBe("true");
    await click("#unsaved-dialog .actions button:first-child");
    expect(query<HTMLInputElement>("#theme-enabled").checked).toBe(false);
    expect(calls.some(message => message.type === "ha_sky_canvas/save_theme")).toBe(false);
    await click("#tab-default");
    await click("#unsaved-dialog .actions button:nth-child(2)");
    expect(query("#tab-default").getAttribute("aria-selected")).toBe("true");
    await click("#tab-christmas");
    expect(query<HTMLInputElement>("#theme-enabled").checked).toBe(true);
  });

  it("saves the edited theme with its revision before navigating", async () => {
    await click("#tab-christmas");
    await click("#theme-enabled");
    await click("#tab-default");
    await click("#unsaved-dialog .primary");
    const save = calls.find(message => message.type === "ha_sky_canvas/save_theme");
    expect(save?.revision).toBe(4);
    expect((save?.theme as { enabled: boolean }).enabled).toBe(false);
    expect(query("#tab-default").getAttribute("aria-selected")).toBe("true");
    expect(query<HTMLDialogElement>("#unsaved-dialog").open).toBe(false);
  });

  it("stages uploaded images until the theme's Save Changes is clicked", async () => {
    const upload = query<HTMLInputElement>("#upload-clear_day");
    Object.defineProperty(upload, "files", { value: [new File(["test image"], "house.png", { type: "image/png" })] });
    upload.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(fetcher.mock.calls[0][0]).toBe("/api/ha_sky_canvas/upload");
    expect(calls.some(message => message.type === "ha_sky_canvas/save_theme")).toBe(false);
    await click(".savebar .primary");
    const save = calls.find(message => message.type === "ha_sky_canvas/save_theme");
    expect((save?.theme as SkyConfig["themes"][number]).images.clear_day).toBe("uploaded_scene");
  });

  it("reloads authenticated thumbnails after an existing preview is detached and reconnected", async () => {
    const preview = document.createElement("ha-sky-canvas-image-preview") as HTMLElement & { hass: HomeAssistant; imageId: string };
    preview.hass = element.hass;
    preview.imageId = "default_clear_day";
    element.append(preview);
    await flush();
    expect(preview.shadowRoot?.querySelector("img")).not.toBeNull();
    const initialRequests = fetcher.mock.calls.length;
    preview.remove();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    element.append(preview);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(initialRequests + 1);
    expect(preview.shadowRoot?.querySelector("img")).not.toBeNull();
  });

  it("keeps an in-flight upload and its original conflict revision when another device edits the theme", async () => {
    let finishUpload!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finishUpload = resolve; }));
    const upload = query<HTMLInputElement>("#upload-clear_day");
    Object.defineProperty(upload, "files", { value: [new File(["test image"], "house.png", { type: "image/png" })] });
    upload.dispatchEvent(new Event("change", { bubbles: true }));
    const remote = structuredClone(config);
    remote.revision++;
    remote.themes[0].images.clear_day = "uploaded_other_device";
    onConfig(remote);
    finishUpload(new Response(JSON.stringify({ id: "uploaded_ours" }), { status: 200 }));
    await flush();
    expect(query<HTMLButtonElement>(".savebar .primary").disabled).toBe(false);
    await click(".savebar .primary");
    const save = calls.find(message => message.type === "ha_sky_canvas/save_theme");
    expect(save?.revision).toBe(4);
    expect((save?.theme as SkyConfig["themes"][number]).images.clear_day).toBe("uploaded_ours");
  });

  it("only hides the Dashboards tab when the all-dashboards draft is enabled and unsubscribes on removal", async () => {
    await click("#tab-settings");
    await click("#all-dashboards");
    expect(root().querySelector("#tab-dashboards")).toBeNull();
    expect(calls.some(message => message.type === "ha_sky_canvas/save_settings")).toBe(false);
    await click(".savebar .primary");
    expect(calls.find(message => message.type === "ha_sky_canvas/save_settings")?.settings).toMatchObject({ applyToAll: true });
    element.remove();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("keeps a failed save visible in its tab and allows a retry without losing the edit", async () => {
    await click("#tab-christmas");
    await click("#theme-enabled");
    const original = element.hass.callWS.bind(element.hass);
    let rejectOnce = true;
    element.hass.callWS = (async (message: Record<string, unknown>) => {
      if (message.type === "ha_sky_canvas/save_theme" && rejectOnce) {
        rejectOnce = false;
        throw new Error("Connection interrupted. Try again.");
      }
      return original(message);
    }) as HomeAssistant["callWS"];
    await click(".savebar .primary");
    expect(root().textContent).toContain("Connection interrupted");
    expect(query<HTMLInputElement>("#theme-enabled").checked).toBe(false);
    expect(query<HTMLButtonElement>(".savebar .primary").disabled).toBe(false);
    await click(".savebar .primary");
    expect(config.themes[1].enabled).toBe(false);
    expect(query<HTMLButtonElement>(".savebar .primary").disabled).toBe(true);
  });

  it("supports keyboard tab movement without activating or discarding the current draft", async () => {
    await click("#tab-christmas");
    await click("#theme-enabled");
    query("#tab-christmas").focus();
    query("#tab-christmas").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flush();
    expect(root().activeElement?.id).toBe("tab-halloween");
    expect(query("#tab-christmas").getAttribute("aria-selected")).toBe("true");
    expect(query<HTMLDialogElement>("#unsaved-dialog").open).toBe(false);
  });

  it("creates a blank custom draft and never submits it before Save Changes", async () => {
    await click(".add");
    const name = query<HTMLInputElement>("#new-theme-dialog input");
    name.value = "Summer";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    query<HTMLFormElement>("#new-theme-dialog form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(query(".tab[aria-selected=true]").textContent).toContain("Summer");
    expect(root().querySelectorAll(".preview")).toHaveLength(8);
    expect(calls.some(message => message.type === "ha_sky_canvas/save_theme")).toBe(false);
    expect(query<HTMLInputElement>("#theme-enabled").checked).toBe(false);
  });
});
