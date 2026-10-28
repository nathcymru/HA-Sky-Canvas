import { build } from "esbuild";
await build({
  entryPoints: ["src/index.ts"],
  outfile: "custom_components/ha_sky_canvas/frontend/sky-canvas.js",
  bundle: true,
  format: "esm",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
  legalComments: "eof",
});
