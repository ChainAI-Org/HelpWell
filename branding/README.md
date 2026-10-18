# HelpWell — final logo package

Primary purple: **#7A3BEB** (RGB 122, 59, 235).
Charcoal: **#34363B** (RGB 52, 54, 59).

The primary wordmark colors the whole word “Help” purple and “Well” charcoal. The custom p becomes a chat bubble. The wordmark has no face. The standalone widget has two straight, level eyes taken from the exact same vector path as the inner opening of the e, uniformly scaled to 36%. No rotation or vertical distortion is applied.

## Files to use

- `svg/helpwell-wordmark-primary.svg`: default website and product logo.
- `svg/helpwell-widget-purple.svg`: default support widget icon, with a white face area.
- `svg/helpwell-wordmark-dark-background.svg`: purple Help and white Well, for dark surfaces.
- `svg/helpwell-wordmark-purple.svg`: one-color purple wordmark.
- `svg/helpwell-wordmark-charcoal.svg`, `black.svg`, `white.svg`: monochrome options (full filenames begin with `helpwell-wordmark-`).
- `svg/helpwell-widget-white.svg`: reversed white widget, with a transparent inner face area so the background shows through.
- `svg/helpwell-mark-purple.svg`: plain p symbol without eyes, useful at very small sizes.
- `HelpWell-preview.png`: visual overview.

All logo SVGs are scalable vector artwork, not embedded raster images. Lettering is custom path artwork reconstructed from the approved concept; it does not require a font installation. Do not retype the name to recreate the wordmark. The source script retains editable geometry, colors, and the shared counter/eye path.

## Export sizes

Transparent wordmark PNGs: **256, 512, 1024, 2048, 4096 pixels wide**, proportional height. The canvas includes clear space.

Transparent widget and plain-mark PNGs: **16, 24, 32, 48, 64, 128, 256, 512, 1024 pixels square**. Extra transparent padding preserves the full tail.

Favicons: SVG, multi-size ICO (16/32/48), plus 16, 32, 48, 180, 192, and 512 px PNGs. The 16px favicon uses the plain p symbol for clarity. Larger favicon sizes include the face. These PNGs are transparent, not maskable app icons.

## Usage

Prefer SVG for web use. For raster displays, choose a PNG at twice the displayed width for 2× screens. A 64px PNG is suitable for a 32px displayed widget icon.

Keep the wordmark at least about **160px wide** and the face widget at least **32px square** where possible. Use the plain p at 16px. Keep at least one letter-stroke width of clear space around artwork. The included canvases provide this by default; do not stretch the artwork or independently rescale its eyes.

The wordmark counters are transparent. The primary colored widget uses an explicit white face area to preserve its appearance over customer websites. The white reversed widget has a transparent face area and is intended for a dark solid background.

SVGs and PNGs use sRGB. No CMYK profile is embedded; for physical printing, have your printer convert the vector master using the intended output profile.

## Geometry and source

`source/build.py` generates SVG files. `source/export.cjs` renders PNGs with Sharp. `source/geometry.json` records the exact colors and shared paths. The p's loop is 26 units thick on all four cardinal sides. The e opening and widget eyes share a 48 × 18 unit source shape (8:3 aspect ratio).

The SVG master includes accessible labels. When embedding the logo as an image, use alt text `HelpWell`; for an interactive chat control use a functional label such as `Open support chat`.
