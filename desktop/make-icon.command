#!/bin/bash
# Regenerate AppIcon.icns for Verso from the source artwork.
# Flood-fills the light background to transparent, trims to the squircle,
# squares + pads to the macOS icon grid, then builds a multi-resolution icns.
set -euo pipefail
cd "$(dirname "$0")"

# Source artwork: pass a path as $1, or drop VersoApp.jpeg next to this script.
SRC="${1:-$(dirname "$0")/VersoApp.jpeg}"

# 1. Key out the light background from the 4 corners, keep the white "Vs", trim.
magick "$SRC" -alpha set -fuzz 12% \
  -fill none \
  -draw "alpha 1,1 floodfill" \
  -draw "alpha %[fx:w-2],1 floodfill" \
  -draw "alpha 1,%[fx:h-2] floodfill" \
  -draw "alpha %[fx:w-2],%[fx:h-2] floodfill" \
  -trim +repage icon-trim.png

# 2. Center on a square transparent canvas with ~7% padding, master at 1024.
magick icon-trim.png -background none -gravity center \
  -resize 900x900 -extent 1024x1024 icon-master.png

# 3. Build the .iconset at every size macOS asks for.
ICONSET="Verso.iconset"
rm -rf "$ICONSET"; mkdir "$ICONSET"
gen() { magick icon-master.png -resize "${1}x${1}" "$ICONSET/$2"; }
gen 16   icon_16x16.png
gen 32   icon_16x16@2x.png
gen 32   icon_32x32.png
gen 64   icon_32x32@2x.png
gen 128  icon_128x128.png
gen 256  icon_128x128@2x.png
gen 256  icon_256x256.png
gen 512  icon_256x256@2x.png
gen 512  icon_512x512.png
gen 1024 icon_512x512@2x.png

# 4. Compile to icns.
iconutil -c icns "$ICONSET" -o AppIcon.icns
rm -rf "$ICONSET" icon-trim.png
echo "Built: $(pwd)/AppIcon.icns"
