#!/bin/bash
# Sync the card assets to Home Assistant's www directory
# Run this after building the dist assets

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
