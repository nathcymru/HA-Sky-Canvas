import "./settings/index";
import "./map/index";
import "./weather/index";
import { bootstrapSkyCanvas, type RendererHandle } from "./renderer/index";

// Different resource query strings create separate module instances. Keep one
// renderer lifecycle per page even when both HA and Lovelace load the bundle.
const rendererKey = Symbol.for("ha-sky-canvas.renderer");
const page = window as unknown as { [key: symbol]: RendererHandle | undefined };
page[rendererKey] ??= bootstrapSkyCanvas();
