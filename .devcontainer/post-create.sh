#!/bin/bash
# ── Post-Create Script ─────────────────────────────────────────
# Runs once after the devcontainer is first created.

set -e

WORKSPACE_DIR=$(cd "$(dirname "$0")/.." && pwd)

# The named volume keeps Codex login and conversation history across rebuilds.
sudo mkdir -p /home/node/.codex
sudo chown -R node:node /home/node/.codex
sudo mkdir -p /home/node/.cache/ms-playwright
sudo chown -R node:node /home/node/.cache/ms-playwright

echo "═══════════════════════════════════════════════════════════"
echo "  FrigateViewCard DevContainer - Initial Setup"
echo "═══════════════════════════════════════════════════════════"

# ── Copy Home Assistant config files ──────────────────────────
echo ""
echo "→ Setting up Home Assistant configuration..."
if [ -d "/config" ]; then
  # Use sudo because /config is owned by root (shared volume with HA container)
  sudo cp -rn "$WORKSPACE_DIR/.devcontainer/homeassistant/"* /config/ 2>/dev/null || true
  # Create themes directory if it doesn't exist
  sudo mkdir -p /config/themes
  # Create www directory for custom cards
  sudo mkdir -p /config/www
  # Ensure the node user can access these directories going forward
  sudo chown -R node:node /config/themes /config/www 2>/dev/null || true
  echo "  ✓ Home Assistant config copied"
else
  echo "  ⚠ /config not available yet (will be set up on first HA start)"
fi

# ── Install Node.js dependencies (if package.json exists) ─────
echo ""
echo "→ Checking for Node.js dependencies..."
if [ -f "$WORKSPACE_DIR/package.json" ]; then
  cd "$WORKSPACE_DIR"
  npm ci --silent
  echo "  ✓ Node.js dependencies installed"

  echo ""
  echo "→ Installing Playwright browsers and system dependencies..."
  "$WORKSPACE_DIR/node_modules/.bin/playwright" install --with-deps chromium firefox webkit
  echo "  ✓ Playwright browsers installed"
else
  echo "  ✓ No package.json found (standalone card - no build step needed)"
fi

# ── Prepare helper scripts ────────────────────────────────────
echo ""
echo "→ Preparing helper scripts..."

if [ -n "$WORKSPACE_DIR" ]; then
  chmod +x "$WORKSPACE_DIR/.devcontainer/sync-card.sh"
  chmod +x "$WORKSPACE_DIR/.devcontainer/watch-card.sh"

  echo "  ✓ sync-card.sh ready"
  echo "  ✓ watch-card.sh ready"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Setup Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Wait for Home Assistant and Frigate to start (~1-2 minutes)"
echo "  2. Open Home Assistant at http://localhost:8123"
echo "  3. Create your HA user account on first visit"
echo "  4. Run: bash .devcontainer/sync-card.sh to deploy the card"
echo "  5. Add the FrigateViewCard to a dashboard"
echo ""
