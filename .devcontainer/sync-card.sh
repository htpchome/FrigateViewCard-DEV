#!/bin/bash
# Sync the card assets to Home Assistant's www directory
# Run this after building the dist assets

WORKSPACE_DIR=$(cd "$(dirname "$0")/.." && pwd)
mapfile -t ASSET_FILES < <(
  node "$WORKSPACE_DIR/scripts/list-release-assets.mjs" "$WORKSPACE_DIR/dist"
)

for ASSET_FILE in "${ASSET_FILES[@]}"; do
  if [ ! -f "$ASSET_FILE" ]; then
    echo "Error: $(basename "$ASSET_FILE") not found in $WORKSPACE_DIR/dist"
    exit 1
  fi
done

# Copy to HA www directory
if [ -d "/config/www" ]; then
  cp "${ASSET_FILES[@]}" /config/www/
  echo "✓ Card assets synced to /config/www"
  echo "  Refresh Home Assistant browser cache (Ctrl+Shift+R) to see changes"
else
  echo "Error: /config/www not found. Is Home Assistant running?"
  exit 1
fi
