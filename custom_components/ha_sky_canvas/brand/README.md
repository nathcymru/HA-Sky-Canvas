# Sky Canvas icon

Original house, sun and sky artwork, copyright (c) 2026 Nathan, licensed under the
integration's MIT licence. The SVG is the editable source. It does not use or
modify the bundled house photographs or any Home Assistant or Met Office logo.

`icon.png` is 256 × 256 pixels and `icon@2x.png` is 512 × 512 pixels, matching the
[Home Assistant brand dimensions](https://contributors.home-assistant.io/core/integrations/brands/).
The filled icon works on light and dark backgrounds, so the optional separate
dark variant is unnecessary. Both PNGs retain transparent rounded corners.

The PNGs were rendered from `icon.svg` with `@resvg/resvg-js` 2.6.2. For each size,
use `new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng()`.
This renderer is a development tool only; no extra runtime dependency is needed.
