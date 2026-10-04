import { ensureHaCameraPlaybackElements } from "../../integrations/home-assistant/playback.js";
import { findHaCameraContextHost } from "../../integrations/home-assistant/camera-provider.js";
import { acquireHaDirectSession } from "./ha-direct-session.js";
import { resolveHaDirectFailedState, resolveHaDirectReadyState } from "./startup-policy.js";

// A card is a presentation client. It never owns, moves or destroys individual
// HA player subtrees; the session owns those and its sequential startup queue.
export function createHaDirectProviderMounter({
  scopeKey: card,
  getHass,
  getStreamMuted,
  setStreamMuted,
  getRotateOverlayActive,
  getSelectedEntity,
  getPreloadEntities,
  getContext = () => "dashboard",
  getIdentity,
  shouldPreload,
  isSelectedExternalReady = () => false,
  isMountAttemptCurrent = () => true,
  assignCommittedEngine,
  onCommittedMediaReady,
  onCommittedStream,
  onPendingStream,
  onPresentationLost,
  applyResolvedStreamUiState,
  startLoadingFallbackRefresh,
  stopLoadingFallbackRefresh,
  setLiveNativeControls,
  preparePlaybackElements = ensureHaCameraPlaybackElements,
  acquireSession = acquireHaDirectSession,
}) {
  let session = null;
  let observer = null;
  let target = null;
  let presenting = false;
  let disposed = false;
  let preparing = null;
  let stopFallback = () => {};
  let lastPresentation = null;
  let foregroundRequested = false;
  const tiles = new Set();
  let tileSequence = 0;
  const tileFor = (entity) => [...tiles].find((tile) =>
    tile.entity === entity && tile.slot.isConnected &&
    !tile.slot.closest('[hidden],[aria-hidden="true"]'));
  const stopLoading = () => {
    stopFallback();
    stopFallback = () => {};
    stopLoadingFallbackRefresh?.();
  };
  const client = {
    host: card,
    hass: getHass,
    entities: getPreloadEntities,
    selected: getSelectedEntity,
    context: getContext,
    identity: getIdentity,
    muted: (entity) => tileFor(entity) ? true : getStreamMuted?.(),
    setMuted: setStreamMuted,
    target: (entity) => tileFor(entity)?.slot || card.shadowRoot?.querySelector('slot[name="fvc-ha-direct-provider-deck"]'),
    visible: (entity) => Boolean(tileFor(entity)) || (presenting && entity === getSelectedEntity?.()),
    canStart: () => tiles.size > 0 || (shouldPreload?.() === true && (foregroundRequested || isSelectedExternalReady())),
    onPresentationChange(active) {
      lastPresentation = null;
      if (!active) {
        stopLoading();
        onPresentationLost?.();
      }
    },
    onState(record, active) {
      if (!active || disposed) return;
      const tile = tileFor(record.entity);
      if (tile) {
        const state = [record.provider, record.status, record.video, record.streamType];
        if (!tile.lastState?.every((value, index) => value === state[index])) {
          tile.lastState = state;
          tile.onState?.(record);
        }
        return;
      }
      if (!presenting || record.entity !== getSelectedEntity?.()) return;
      const identity = [record.provider, record.status, record.video, client.target()];
      if (lastPresentation?.every((value, index) => value === identity[index])) return;
      lastPresentation = identity;
      if (record.provider) assignCommittedEngine?.(record.provider, { retainPrevious: true });
      if (record.status === "ready") {
        stopLoading();
        onCommittedMediaReady?.(record.provider, record.video);
        onCommittedStream?.(record.streamType);
        applyResolvedStreamUiState?.(resolveHaDirectReadyState({
          rotateOverlayActive: getRotateOverlayActive?.() === true,
          isCurrentEngine: true, waitSucceeded: true,
        }));
        if (getRotateOverlayActive?.()) setLiveNativeControls?.(true);
      } else if (record.status === "failed") {
        stopLoading();
        onPendingStream?.();
        applyResolvedStreamUiState?.(resolveHaDirectFailedState());
      } else {
        onPendingStream?.();
        applyResolvedStreamUiState?.({ loading: true, fallbackVisible: true, refreshFallbackImage: true });
      }
    },
  };
  const prepare = () => preparePlaybackElements?.() ?? false;
  const sync = () => {
    if (disposed || !session) return;
    session.rememberIdentity?.(getIdentity());
    session.sync(client);
  };
  const ensureSession = async () => {
    if (disposed) return null;
    if (session) return session;
    if (preparing) return preparing;
    preparing = (async () => {
      if (!(await prepare()) || disposed) return null;
      const anchor = findHaCameraContextHost(card);
      if (!anchor) return null;
      session = acquireSession({ anchor, client, identity: getIdentity(), connection: getHass()?.connection });
      target = client.target();
      observer = new MutationObserver(() => {
        const nextTarget = client.target();
        if (target === nextTarget && !tiles.size) return;
        if (target !== nextTarget) lastPresentation = null;
        target = nextTarget;
        sync();
      });
      observer.observe(card.shadowRoot, {
        childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-hidden"],
      });
      return session;
    })();
    try { return await preparing; } finally { preparing = null; }
  };
  const tryMount = async (_slot, _startup, { entity, mountToken } = {}) => {
    disposed = false;
    if (!entity || !(await ensureSession())) return false;
    if (mountToken != null && !isMountAttemptCurrent(mountToken, entity)) return false;
    foregroundRequested = true;
    presenting = true;
    lastPresentation = null;
    stopFallback();
    stopFallback = startLoadingFallbackRefresh?.() || (() => {});
    session.sync(client, { activate: true });
    return { ok: true, engine: session.get(entity)?.provider || null };
  };
  const release = (provider) => {
    if (provider?.haDirectSession !== session || provider?.haDirectProvider !== true) return false;
    presenting = false;
    lastPresentation = null;
    stopLoading();
    session.refresh();
    return true;
  };
  const schedulePreloadDeckAfterPaint = async () => {
    if (shouldPreload?.() !== true || !getPreloadEntities?.().length) return;
    // The foreground mount follows the initial browse load. Do not let shell
    // paint start a second, earlier live-startup path.
    if (!session && !isSelectedExternalReady()) return;
    await ensureSession();
    sync();
  };
  const mountTile = (host, { entity, onState } = {}) => {
    disposed = false;
    const slot = host.ownerDocument.createElement("slot");
    slot.name = `fvc-ha-tile-${++tileSequence}`;
    host.appendChild(slot);
    const tile = { entity, slot, onState, lastState: null };
    tiles.add(tile);
    void (async () => {
      if (!(await ensureSession()) || !tiles.has(tile)) return;
      sync();
    })();
    return () => {
      tiles.delete(tile);
      slot.remove();
      session?.refresh();
    };
  };
  return {
    prepare,
    tryMount,
    release,
    mountTile,
    syncProviderStates: sync,
    schedulePreloadDeckAfterPaint,
    cancelPreloads: sync,
    disconnect: () => { lastPresentation = null; session?.refresh(); },
    isRetainableProvider: (provider) => Boolean(provider?.haDirectSession === session && provider?.isConnected),
    evictEntity: (entity) => session?.remove(entity),
    dispose: () => {
      disposed = true;
      presenting = false;
      stopLoading();
      observer?.disconnect();
      observer = null;
      for (const tile of tiles) tile.slot.remove();
      tiles.clear();
      session?.detach(client);
      session = null;
      foregroundRequested = false;
      lastPresentation = null;
    },
  };
}
