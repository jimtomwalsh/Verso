#!/bin/bash
# Optional local static server (clean http:// origin instead of file://).
# Double-clickable in Finder. The app also works opened directly as file://.
cd "$(dirname "$0")" || exit 1
echo "Serving DIY Authoring Tool at http://localhost:8123  (Ctrl-C to stop)"
python3 -m http.server 8123
