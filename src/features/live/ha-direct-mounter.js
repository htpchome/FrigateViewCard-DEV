import {
  buildHaCameraStreamState,
  createHaCameraStreamElement,
  findActiveHaCameraStreamPlayer,
  findActiveHaCameraStreamVideo,
} from "../../integrations/home-assistant/playback.js";
import {
  buildHaDirectMountPlan,
  resolveHaDirectMountUnavailableState,
  resolveHaDirectReadyState,
  resolveHaDirectStabilizedState,
} from "./startup-policy.js";

export function createHaDirectMounter({
  getHass,
  getPreferredStreamType,
  getStreamMuted,
  getRotateOverlayActive,
  isCurrentEngine,
  waitForStreamStart,
  assignCommittedEngine,
  onCommittedMediaReady,
  applyResolvedStreamUiState,
  setLiveNativeControls,
}) {
  const mediaBindings = new WeakMap();

  const release = (streamEl) => {
    const binding = mediaBindings.get(streamEl);
    if (!binding) return;
    binding.disposed = true;
    binding.revision += 1;
    streamEl.removeEventListener?.("load", binding.reconcile, true);
    streamEl.removeEventListener?.("streams", binding.reconcile, true);
    mediaBindings.delete(streamEl);
  };

  const awaitUpdate = async (element) => {
    try {
      await element?.updateComplete;
    } catch (_) {}
  };

  const bindActiveMedia = (streamEl) => {
    release(streamEl);
    const binding = {
      disposed: false,
      revision: 0,
      reconcile: null,
    };
    binding.reconcile = () => {
      const revision = ++binding.revision;
      void (async () => {
        // Let HA schedule the player switch before awaiting its update.
        await Promise.resolve();
        await awaitUpdate(streamEl);
        if (
          binding.disposed ||
          revision !== binding.revision ||
          !isCurrentEngine(streamEl)
        ) {
          return;
        }
        const player = findActiveHaCameraStreamPlayer(streamEl);
        if (!player) return;
        await awaitUpdate(player);
        if (
          binding.disposed ||
          revision !== binding.revision ||
          !isCurrentEngine(streamEl)
        ) {
          return;
        }
        const video = findActiveHaCameraStreamVideo(streamEl);
        if (video) {
          onCommittedMediaReady?.(streamEl, video);
        }
      })();
    };
    mediaBindings.set(streamEl, binding);
    streamEl.addEventListener?.("load", binding.reconcile, true);
    streamEl.addEventListener?.("streams", binding.reconcile, true);
    binding.reconcile();
  };

  const scheduleFollowUp = (streamEl, haDirectPlan) => {
    void (async () => {
      const ok = await waitForStreamStart(
        streamEl,
        haDirectPlan.waitMs,
        haDirectPlan.waitOptions,
      );
      const readyState = resolveHaDirectReadyState({
        rotateOverlayActive: getRotateOverlayActive(),
        isCurrentEngine: isCurrentEngine(streamEl),
        waitSucceeded: ok,
      });
      if (readyState.shouldApply) {
        applyResolvedStreamUiState(readyState);
      }
    })();

    setTimeout(() => {
      const stabilizedState = resolveHaDirectStabilizedState({
        rotateOverlayActive: getRotateOverlayActive(),
        isCurrentEngine: isCurrentEngine(streamEl),
      });
      if (stabilizedState.shouldApply) {
        applyResolvedStreamUiState(stabilizedState);
      }
    }, 1200);
  };

  const tryMount = async (slot, startup = null, options = {}) => {
    const preferredStreamType = getPreferredStreamType();
    const haDirectPlan = buildHaDirectMountPlan({
      startup: startup || {},
      preferredStreamType,
    });
    const commit = options.commit !== false;
    const entity = String(options.entity || "").trim();
    if (!entity) return false;

    const stateObj = buildHaCameraStreamState(
      getHass(),
      entity,
      haDirectPlan.streamType,
      preferredStreamType,
    );
    if (!stateObj) {
      if (commit) {
        applyResolvedStreamUiState(resolveHaDirectMountUnavailableState());
      }
      return false;
    }

    const streamEl = createHaCameraStreamElement({
      hass: getHass(),
      stateObj,
      controls: false,
      muted: options?.muted ?? getStreamMuted(),
      defaultMuted: options.defaultMuted,
      fitMode: "contain",
      styleText:
        options.styleText ||
        "width:100%;height:100%;display:block;background:var(--c-bg-deep)",
    });
    if (!streamEl) return false;

    slot.innerHTML = "";
    slot.appendChild(streamEl);

    const engine = streamEl;
    if (!commit) {
      return {
        ok: true,
        type: haDirectPlan.streamType,
        engine,
        slot,
      };
    }

    assignCommittedEngine(engine);
    bindActiveMedia(streamEl);
    if (getRotateOverlayActive()) {
      setLiveNativeControls(true);
    }
    scheduleFollowUp(streamEl, haDirectPlan);
    return {
      ok: true,
      type: haDirectPlan.streamType,
      engine,
      slot,
    };
  };

  return {
    release,
    tryMount,
  };
}
