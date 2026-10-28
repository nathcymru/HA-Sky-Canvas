# Frontend startup boundary

Sky Canvas uses the same versioned module URL for Home Assistant's global extra module, its settings panel, and the ordinary Lovelace resource. The global module is needed for scenes and alerts when the first visited panel is Energy or Map.

The public entry waits for `customElements.whenDefined("home-assistant")` before dynamically importing **all** components and the renderer. There are no eager Lit/component imports in that entry. Esbuild includes the deferred module in the single output file, so this boundary does not add a network chunk.

Home Assistant frontend 20260930.5 starts its app and extra-module imports independently. Its app first installs the scoped custom-element registry polyfill, then defines `home-assistant`. An extra module that registers elements earlier can put its definitions in the original native registry. After replacement, Lovelace's current registry cannot find those definitions, even though the script executed successfully. A later import of the same module URL is cached and cannot register them again.

This explains the observed first-load failure: the current registry knew `home-assistant` but none of Sky Canvas's four elements, while `window.customCards` contained both Sky Canvas cards. A reload changed the ordering and made all four definitions visible. Increasing a timeout or hiding error cards would not fix that registry mismatch.

The readiness promise also works when captured from the early native registry: the polyfill defines a native stand-in when it registers `home-assistant`. Only then can the deferred component imports run against the final registry. A window-level singleton still prevents duplicate renderer lifecycles if different resource query strings are loaded.

Regression tests cover a simulated registry replacement and the actual esbuild output, plus separate module instances. The standalone preview supplies a minimal `home-assistant` definition to represent this boundary. Live acceptance must still check fresh direct dashboard entry, navigation, and Energy/Map first entry without a reload workaround.

Primary source references:

- [HA app entry](https://github.com/home-assistant/frontend/blob/20260930.5/src/entrypoints/app.ts)
- [HA initial HTML imports](https://github.com/home-assistant/frontend/blob/20260930.5/src/html/index.html.template)
- [Pinned polyfill dependency](https://github.com/home-assistant/frontend/blob/20260930.5/package.json)
- [Polyfill global registry implementation](https://github.com/webcomponents/polyfills/blob/master/packages/scoped-custom-element-registry/src/scoped-custom-element-registry.ts)
- [HA custom-element lookup and rebuild](https://github.com/home-assistant/frontend/blob/20260930.5/src/panels/lovelace/create-element/create-element-base.ts)
