#!/bin/bash
# Watch for card builds and auto-sync all dist assets to HA
# Usage: bash .devcontainer/watch-card.sh

WORKSPACE_DIR=$(cd "$(dirname "$0")/.." && pwd)
CARD_FILE="$WORKSPACE_DIR/dist/frigate-view-card.js"
EDITOR_FILE="$WORKSPACE_DIR/dist/frigate-view-card-editor.js"
CIRCLE_PAD_FILE="$WORKSPACE_DIR/dist/frigate-view-card-circle-pad.js"
DASHBOARD_SWIPE_FILE="$WORKSPACE_DIR/dist/frigate-view-card-dashboard-swipe-navigation.js"
NAVBAR_FILE="$WORKSPACE_DIR/dist/frigate-view-card-navbar.js"
RECORDING_SCRUB_FILE="$WORKSPACE_DIR/dist/frigate-view-card-recording-scrub.js"
FRAME_CAPTURE_FILE="$WORKSPACE_DIR/dist/frigate-view-card-frame-capture.js"
LINKED_LIGHT_FILE="$WORKSPACE_DIR/dist/frigate-view-card-linked-light.js"
CARD_VIEW_FILE="$WORKSPACE_DIR/dist/frigate-view-card-card-view.js"
GRID_FILE="$WORKSPACE_DIR/dist/frigate-view-card-grid.js"
SLIDESHOW_FILE="$WORKSPACE_DIR/dist/frigate-view-card-slideshow.js"
PREVIEW_FILE="$WORKSPACE_DIR/dist/frigate-view-card-preview.js"
RECORDINGS_FILE="$WORKSPACE_DIR/dist/frigate-view-card-recordings.js"
PTZ_FILE="$WORKSPACE_DIR/dist/frigate-view-card-ptz.js"
PICTURE_IN_PICTURE_FILE="$WORKSPACE_DIR/dist/frigate-view-card-picture-in-picture.js"
CARD_PICKER_DEMO_FILE="$WORKSPACE_DIR/dist/frigate-view-card-card-picker-demo.js"
WIDE_VIEW_FILE="$WORKSPACE_DIR/dist/frigate-view-card-wide-view.js"
WIDE_COMPANION_FILE="$WORKSPACE_DIR/dist/frigate-view-card-wide-companion.js"
WIDE_TIMELINE_FILE="$WORKSPACE_DIR/dist/frigate-view-card-wide-timeline.js"
HLS_FILE="$WORKSPACE_DIR/dist/frigate-view-card-hls-1.5.17.js"
HLS_LICENSE_FILE="$WORKSPACE_DIR/dist/frigate-view-card-hls-1.5.17.LICENSE.txt"
ASSET_FILES=(
  "$CARD_FILE"
  "$EDITOR_FILE"
  "$CIRCLE_PAD_FILE"
  "$DASHBOARD_SWIPE_FILE"
  "$NAVBAR_FILE"
  "$RECORDING_SCRUB_FILE"
  "$FRAME_CAPTURE_FILE"
  "$LINKED_LIGHT_FILE"
  "$CARD_VIEW_FILE"
  "$GRID_FILE"
  "$SLIDESHOW_FILE"
  "$PREVIEW_FILE"
  "$RECORDINGS_FILE"
  "$PTZ_FILE"
  "$PICTURE_IN_PICTURE_FILE"
  "$CARD_PICKER_DEMO_FILE"
  "$WIDE_VIEW_FILE"
  "$WIDE_COMPANION_FILE"
  "$WIDE_TIMELINE_FILE"
  "$HLS_FILE"
  "$HLS_LICENSE_FILE"
)

for ASSET_FILE in "${ASSET_FILES[@]}"; do
  if [ ! -f "$ASSET_FILE" ]; then
    echo "Error: $(basename "$ASSET_FILE") not found"
    exit 1
  fi
done

sync_card_assets() {
  cp "${ASSET_FILES[@]}" /config/www/
}

echo "Watching for changes to dist/frigate-view-card.js..."
echo "Press Ctrl+C to stop"
echo ""

# Initial sync
sync_card_assets 2>/dev/null && echo "✓ Initial sync complete" || echo "⚠ /config/www not available yet"

# Watch loop using inotifywait if available, otherwise polling
if command -v inotifywait &> /dev/null; then
  while inotifywait -e modify "$CARD_FILE" 2>/dev/null; do
    sync_card_assets
    echo "✓ $(date +%H:%M:%S) - Card synced"
  done
else
  LAST_MOD=""
  while true; do
    CURRENT_MOD=$(stat -c %Y "$CARD_FILE" 2>/dev/null || stat -f %m "$CARD_FILE" 2>/dev/null)
    if [ "$CURRENT_MOD" != "$LAST_MOD" ] && [ -n "$LAST_MOD" ]; then
      sync_card_assets 2>/dev/null && echo "✓ $(date +%H:%M:%S) - Card synced"
    fi
    LAST_MOD="$CURRENT_MOD"
    sleep 2
  done
fi
