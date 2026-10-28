import assert from "node:assert/strict";
import { SourceTextModule } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// Compile without writing the shared deployment artifact. This runs the actual
// output in an independent browser realm rather than transforming it in Vitest.
const result = await build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", target: "es2022", minify: true, write: false });
const dom = new JSDOM("<!doctype html><body></body>", { url: "https://home-assistant.test/", runScripts: "outside-only" });
const { window } = dom;
const key = Symbol.for("ha-sky-canvas.renderer");
try {
  const nativeRegistry = window.customElements;
  let ready;
  const promise = new Promise(resolve => { ready = resolve; });
  let waiting = false, earlyDefinitions = 0, finalDefinitions = 0;
  const early = {
    whenDefined(tag) { assert.equal(tag, "home-assistant");waiting = true;return promise; },
    get: nativeRegistry.get.bind(nativeRegistry),
    define() { earlyDefinitions++; },
  };
  Object.defineProperty(window, "customElements", { value: early, configurable: true });
  const module = new SourceTextModule(result.outputFiles[0].text, { context: dom.getInternalVMContext() });
  await module.link(() => { throw Error("Bundle must not require external imports"); });
  const loading = module.evaluate();
  await setImmediate();
  assert.equal(waiting, true);assert.equal(earlyDefinitions, 0);assert.equal(window[key], undefined);
  const settled = {
    whenDefined: nativeRegistry.whenDefined.bind(nativeRegistry),
    get: nativeRegistry.get.bind(nativeRegistry),
    define(...args) { finalDefinitions++;nativeRegistry.define(...args); },
  };
  Object.defineProperty(window, "customElements", { value: settled, configurable: true });
  class HomeAssistantApp extends window.HTMLElement {}
  settled.define("home-assistant", HomeAssistantApp);ready(HomeAssistantApp);
  await loading;
  assert.equal(earlyDefinitions, 0);
  for (const tag of ["ha-sky-canvas-weather-card", "ha-sky-canvas-weather-alerts", "ha-sky-canvas-forecast-map", "ha-sky-canvas-settings"]) assert.ok(settled.get(tag));
  const handle = window[key], count = finalDefinitions;assert.ok(handle);
  const duplicate = new SourceTextModule(result.outputFiles[0].text, { context: dom.getInternalVMContext() });
  await duplicate.link(() => { throw Error("Bundle must not require external imports"); });
  await duplicate.evaluate();
  assert.equal(finalDefinitions, count);assert.equal(window[key], handle);
  console.log("Deferred production bundle: passed");
} finally {
  window[key]?.destroy();dom.window.close();
}
