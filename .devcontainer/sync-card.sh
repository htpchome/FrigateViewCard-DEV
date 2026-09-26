#!/bin/bash
# Sync the card assets to Home Assistant's www directory
# Run this after building the dist assets

WORKSPACE_DIR=$(cd "$(dirname "$0")/.." && pwd)
CARD_FILE="$WORKSPACE_DIR/dist/frigate-view-card.js"
EDITOR_FILE="$WORKSPACE_DIR/dist/frigate-view-card-editor.js"
CIRCLE_PAD_FILE="$WORKSPACE_DIR/dist/frigate-view-card-circle-pad.js"
DASHBOARD_SWIPE_FILE="$WORKSPACE_DIR/dist/frigate-view-card-dashboard-swipe-navigation.js"
HLS_FILE="$WORKSPACE_DIR/dist/frigate-view-card-hls-1.5.17.js"
HLS_LICENSE_FILE="$WORKSPACE_DIR/dist/frigate-view-card-hls-1.5.17.LICENSE.txt"
ASSET_FILES=(
  "$CARD_FILE"
  "$EDITOR_FILE"
  "$CIRCLE_PAD_FILE"
  "$DASHBOARD_SWIPE_FILE"
  "$HLS_FILE"
  "$HLS_LICENSE_FILE"
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
