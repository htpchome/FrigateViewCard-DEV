import { buildLiveAttemptPlan } from "./attempt-planner.js";
import {
  createPendingMountDestroyers,
  filterPendingDestroyersForWinner,
} from "./pending-destroyers.js";
import { createStrategyForType } from "./stream.strategies.js";
import { StreamOrchestrator } from "./stream.orchestrator.js";
import {
  cleanupStaleWinnerResult,
  destroyLoserAttemptResults,
} from "./mount-result.js";

const WEBRTC_INITIAL_COOLDOWN_MS = 120000;
const WEBRTC_REPEAT_COOLDOWN_MS = 300000;
const STRATEGY_HINT_MAX_ENTRIES = 64;
const DEFERRED_WEBRTC_MAX_HOLD_MS = 4000;
const PREFERRED_WEBRTC_WAIT_MS = 500;
const MOBILE_FALLBACK_HEDGE_MS = 1250;
const MOBILE_DEFERRED_WEBRTC_MAX_HOLD_MS = 8500;
const WEBRTC_RETRY_BACKOFF_MS = 2000;

const waitForAttemptDelay = async (delayMs = 0, abortSignal = null) => {
  const waitMs = Math.max(0, Number(delayMs) || 0);
  if (abortSignal?.aborted) return false;
  if (!waitMs) return true;

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener?.("abort", onAbort);
      resolve(ready);
    };
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(true), waitMs);
    abortSignal?.addEventListener?.("abort", onAbort, { once: true });
  });
};

export function createGo2RtcRaceMounter({
  mounter,
  isMobile = false,
  resolveConnectionType,
  getPendingMountDestroyers,
  setPendingMountDestroyers,
  isMountTokenCurrent,
  adoptMountedAttempt,
  waitForStreamStart,
  isCurrentWinnerEngine,
  getPendingWebRtcTakeoverTimer,
  setPendingWebRtcTakeoverTimer,
  deferredWebRtcMaxHoldMs = DEFERRED_WEBRTC_MAX_HOLD_MS,
  mobileDeferredWebRtcMaxHoldMs = MOBILE_DEFERRED_WEBRTC_MAX_HOLD_MS,
  preferredWebRtcWaitMs = PREFERRED_WEBRTC_WAIT_MS,
  mobileFallbackHedgeMs = MOBILE_FALLBACK_HEDGE_MS,
  webRtcRetryBackoffMs = WEBRTC_RETRY_BACKOFF_MS,
  getNowMs = () => Date.now(),
}) {
  const strategyHintsByEntity = new Map();
  const pendingWebRtcMounts = new Set();
  let webRtcRetryAfterMs = 0;

  const normalizeEntityKey = (entity = "") => String(entity || "").trim();

  const replaceOwnedPendingMountDestroyers = (
    ownedDestroyers,
    replacementDestroyers = [],
  ) => {
    const owned = new Set(ownedDestroyers || []);
    const current = getPendingMountDestroyers?.() || [];
    if (!current.some((destroyer) => owned.has(destroyer))) return false;
    setPendingMountDestroyers?.([
      ...current.filter((destroyer) => !owned.has(destroyer)),
      ...(replacementDestroyers || []),
    ]);
    return true;
  };

  const trackPendingWebRtcMount = ({ entity, mountToken, strategies, probe }) => {
    const strategy = (strategies || []).find(
      (candidate) => candidate?.type === "webrtc",
    );
    if (!strategy) return null;
    const entry = { entity, mountToken, strategy, probe };
    pendingWebRtcMounts.add(entry);
    return entry;
  };

  const releasePendingWebRtcMount = (entry) => {
    if (entry) pendingWebRtcMounts.delete(entry);
  };

  const deferWebRtcRetry = () => {
    webRtcRetryAfterMs = Math.max(
      webRtcRetryAfterMs,
      getNowMs() + Math.max(0, Number(webRtcRetryBackoffMs) || 0),
    );
  };

  const clearWebRtcRetryDelay = () => {
    webRtcRetryAfterMs = 0;
  };

  const resolveWebRtcRetryDelayMs = () =>
    Math.max(0, Number(webRtcRetryAfterMs) - getNowMs());

  const cancelPendingWebRtcAttempts = () => {
    if (pendingWebRtcMounts.size) deferWebRtcRetry();
    for (const entry of [...pendingWebRtcMounts]) {
      pendingWebRtcMounts.delete(entry);
      // Avoid replacing an incomplete WebRTC probe on every rapid switch.
      entry.probe.cancelled = true;
      void entry.strategy?.disconnect?.();
    }
  };

  const setHintState = (entity = "", nextState = null) => {
    const key = normalizeEntityKey(entity);
    if (!key || !nextState) return;
    // Refresh insertion order so this map works as an LRU cache.
    if (strategyHintsByEntity.has(key)) {
      strategyHintsByEntity.delete(key);
    }
    strategyHintsByEntity.set(key, nextState);
    while (strategyHintsByEntity.size > STRATEGY_HINT_MAX_ENTRIES) {
      const oldestKey = strategyHintsByEntity.keys().next().value;
      if (!oldestKey) break;
      strategyHintsByEntity.delete(oldestKey);
    }
  };

  const getHintState = (entity = "") => {
    const key = normalizeEntityKey(entity);
    if (!key) return null;
    return strategyHintsByEntity.get(key) || null;
  };

  const markHintSuccess = (entity = "", type = "") => {
    const key = normalizeEntityKey(entity);
    const nextType = String(type || "")
      .trim()
      .toLowerCase();
    if (!key || !nextType) return;
    const current = getHintState(key);
    const webRtcSucceeded = nextType === "webrtc";
    setHintState(key, {
      type: nextType,
      webRtcSucceeded: webRtcSucceeded || current?.webRtcSucceeded === true,
      failureCount: webRtcSucceeded ? 0 : current?.failureCount || 0,
      cooldownUntilMs: webRtcSucceeded ? 0 : current?.cooldownUntilMs || 0,
    });
  };

  const recordWebRtcFailure = (probe) => {
    if (
      !probe.failed || probe.recorded || probe.cancelled ||
      !probe.mseEngine || !isMountTokenCurrent(probe.mountToken) ||
      !isCurrentWinnerEngine(probe.mseEngine)
    ) return;
    probe.recorded = true;
    const current = getHintState(probe.entity);
    const failureCount = (Number(current?.failureCount) || 0) + 1;
    // A previously working camera gets one fresh retry before suppression.
    const cooldownStage = failureCount - (current?.webRtcSucceeded ? 1 : 0);
    const cooldownMs = cooldownStage <= 0
      ? 0
      : cooldownStage === 1
        ? WEBRTC_INITIAL_COOLDOWN_MS
        : WEBRTC_REPEAT_COOLDOWN_MS;
    setHintState(probe.entity, {
      ...current,
      failureCount,
      cooldownUntilMs: cooldownMs ? probe.failedAtMs + cooldownMs : 0,
    });
  };

  const failWebRtcProbe = (probe) => {
    if (
      probe.failed || probe.cancelled || probe.signal?.aborted ||
      !isMountTokenCurrent(probe.mountToken)
    ) return;
    probe.failed = true;
    probe.failedAtMs = getNowMs();
    recordWebRtcFailure(probe);
  };

  const resolveHintedType = (entity = "", attempts = [], forcedType = null) => {
    if (forcedType) return null;
    const hint = getHintState(entity);
    if (!hint?.type) return null;
    setHintState(entity, hint);
    return attempts.some((attempt) => attempt.type === hint.type)
      ? hint.type
      : null;
  };

  const resolveMobileAttemptDelays = (attempts = [], hintedType = null) => {
    const availableTypes = new Set(attempts.map((attempt) => attempt.type));
    const delays = {};
    if (availableTypes.has("webrtc")) delays.webrtc = 0;
    if (availableTypes.has("mse")) {
      delays.mse = hintedType === "mse" ? 0 : mobileFallbackHedgeMs;
    }
    return delays;
  };

  const mountWithOrchestrator = async ({
    slot,
    entity,
    mountToken,
    attempts,
    preferredType = "webrtc",
    preferredWaitMs = preferredWebRtcWaitMs,
    attemptDelayByType = {},
    applyWebRtcRetryBackoff = true,
    probe,
  }) => {
    const webRtcAttemptDelayMs = attempts.some(
      (attempt) => attempt?.type === "webrtc",
    )
      ? Math.max(
          Math.max(0, Number(attemptDelayByType.webrtc) || 0),
          applyWebRtcRetryBackoff ? resolveWebRtcRetryDelayMs() : 0,
        )
      : 0;
    const resolvedAttemptDelayByType = {
      ...attemptDelayByType,
      webrtc: webRtcAttemptDelayMs,
    };
    const strategies = attempts.map((attempt) =>
      createStrategyForType({
        type: attempt.type,
        connect: async ({ abortSignal }) => {
          if (attempt.type === "webrtc") probe.signal = abortSignal;
          try {
            const ready = await waitForAttemptDelay(
              resolvedAttemptDelayByType[attempt.type],
              abortSignal,
            );
            if (!ready) return false;
            const result = await attempt.start({ abortSignal, entity });
            if (attempt.type === "webrtc" && !result?.ok) failWebRtcProbe(probe);
            return result;
          } catch (_) {
            if (attempt.type === "webrtc") failWebRtcProbe(probe);
            return false;
          }
        },
      }),
    );

    const orchestrator = new StreamOrchestrator({
      strategies,
      preferredType,
      preferredWaitMs: Math.max(0, Number(preferredWaitMs) || 0),
      retainPreferredOnFallback: true,
    });
    slot?.attachOrchestrator?.(orchestrator);

    const activeAttempts = strategies.map((strategy) => ({
      type: strategy.type,
      strategy,
      promise: strategy.connect().catch(() => null),
    }));

    const ownedPendingDestroyers = createPendingMountDestroyers({
      activeAttempts,
      targetEntity: entity,
    });
    const pendingWebRtcMount = trackPendingWebRtcMount({
      entity,
      mountToken,
      strategies,
      probe,
    });
    setPendingMountDestroyers(ownedPendingDestroyers);

    const winner = await orchestrator.start();
    const deferredPreferredAttempt = orchestrator.deferredPreferredAttempt;
    const deferredPreferredType = deferredPreferredAttempt?.type || "";

    if (!isMountTokenCurrent(mountToken)) {
      await deferredPreferredAttempt?.strategy?.disconnect?.();
      cleanupStaleWinnerResult(winner);
      releasePendingWebRtcMount(pendingWebRtcMount);
      replaceOwnedPendingMountDestroyers(ownedPendingDestroyers);
      slot?.clearOrchestrator?.(orchestrator);
      return false;
    }

    const destroyLosers = async () => {
      await destroyLoserAttemptResults({
        activeAttempts: activeAttempts.filter(
          (attempt) => attempt?.type !== deferredPreferredType,
        ),
        winnerType: winner?.type,
      });
      replaceOwnedPendingMountDestroyers(
        ownedPendingDestroyers,
        ownedPendingDestroyers.filter(
          (destroyer) => destroyer?.type === deferredPreferredType,
        ),
      );
      if (deferredPreferredType !== "webrtc") {
        releasePendingWebRtcMount(pendingWebRtcMount);
      }
      slot?.clearOrchestrator?.(orchestrator);
    };

    if (winner?.ok) {
      if (winner.type === "webrtc") {
        clearWebRtcRetryDelay();
        releasePendingWebRtcMount(pendingWebRtcMount);
      }
      replaceOwnedPendingMountDestroyers(
        ownedPendingDestroyers,
        filterPendingDestroyersForWinner({
          pendingDestroyers: ownedPendingDestroyers,
          winnerType: winner.type,
        }),
      );
      adoptMountedAttempt(slot, winner, {
        preservePendingSlots: deferredPreferredType === "webrtc",
      });
      markHintSuccess(entity, winner.type);
      if (winner.type === "mse") {
        probe.mseEngine = winner.engine;
        recordWebRtcFailure(probe);
      }
      void destroyLosers();
      scheduleDeferredWebRtcTakeover({
        entity,
        slot,
        deferredAttempt: deferredPreferredAttempt,
        mountToken,
        winnerEngine: winner.engine,
        winnerType: winner.type,
        pendingDestroyers: ownedPendingDestroyers.filter(
          (destroyer) => destroyer?.type === "webrtc",
        ),
        pendingWebRtcMount,
        webRtcAttemptDelayMs,
        probe,
      });
      return true;
    }

    await destroyLosers();
    return false;
  };

  const buildAttempts = (
    entity = "",
    forcedType = null,
    hostSlot = null,
    webRtcOptions = null,
  ) => {
    const targetEntity = String(entity || "").trim();
    const connectionType = resolveConnectionType(targetEntity);
    const hiddenSlot = () => createAttemptSlot(hostSlot);
    const builders = {
      webrtc: (attemptOptions = {}) =>
        mounter.tryMountWebRtc(
          hiddenSlot(),
          { waitMs: 7000 },
          {
            ...(webRtcOptions || {}),
            commit: false,
            ...attemptOptions,
          },
        ),
      mse: (attemptOptions = {}) =>
        mounter.tryMountMse(
          hiddenSlot(),
          {
            waitMs: 4000,
            minCurrentTime: 0.05,
            minDecodedFrames: 1,
            requireReadyState: 2,
            strict: true,
          },
          { commit: false, ...attemptOptions },
        ),
      hls: (attemptOptions = {}) =>
        mounter.tryMountHls(
          hiddenSlot(),
          { waitMs: 5000 },
          {
            commit: false,
            ...attemptOptions,
          },
        ),
    };

    return buildLiveAttemptPlan({
      connectionType,
      forcedType,
      builders,
    });
  };

  const mountWithRace = async ({
    slot,
    entity,
    forcedType = null,
    mountToken,
    webRtcOptions = null,
  }) => {
    const probe = {
      entity, mountToken, signal: null, cancelled: false,
      failed: false, recorded: false, failedAtMs: 0, mseEngine: null,
    };
    const attempts = buildAttempts(
      entity,
      forcedType,
      slot,
      webRtcOptions,
    );
    const hintedType = resolveHintedType(entity, attempts, forcedType);
    const mseAttempt = attempts.find((attempt) => attempt.type === "mse");
    if (!forcedType && mseAttempt && getHintState(entity)?.cooldownUntilMs > getNowMs()) {
      const mounted = await mountWithOrchestrator({
        slot, entity, mountToken, probe, attempts: [mseAttempt],
      });
      if (mounted || !isMountTokenCurrent(mountToken)) return mounted;
      // A failed MSE connection must not leave WebRTC blocked by old history.
      return await mountWithOrchestrator({
        slot, entity, mountToken, probe,
        attempts: attempts.filter((attempt) => attempt.type === "webrtc"),
        applyWebRtcRetryBackoff: false,
      });
    }
    if (isMobile && !forcedType) {
      return await mountWithOrchestrator({
        slot,
        entity,
        mountToken,
        probe,
        attempts,
        preferredType: "webrtc",
        preferredWaitMs: 0,
        attemptDelayByType: resolveMobileAttemptDelays(attempts, hintedType),
      });
    }
    // Only a working WebRTC winner gets the existing single-transport shortcut.
    if (hintedType === "webrtc") {
      const preferredAttempt = attempts.find(
        (attempt) => attempt.type === hintedType,
      );
      if (preferredAttempt) {
        const preferredMounted = await mountWithOrchestrator({
          slot,
          entity,
          mountToken,
          probe,
          attempts: [preferredAttempt],
          preferredType: hintedType,
          preferredWaitMs: 0,
        });
        if (preferredMounted) {
          return true;
        }
        if (!isMountTokenCurrent(mountToken)) return false;

        const fallbackAttempts = attempts.filter(
          (attempt) => attempt.type !== hintedType,
        );
        if (!fallbackAttempts.length) return false;
        return await mountWithOrchestrator({
          slot,
          entity,
          mountToken,
          probe,
          attempts: fallbackAttempts,
          preferredType: "webrtc",
        });
      }
    }

    return await mountWithOrchestrator({
      slot,
      entity,
      mountToken,
      probe,
      attempts,
      preferredType: "webrtc",
      applyWebRtcRetryBackoff: forcedType !== "webrtc",
    });
  };

  return {
    buildAttempts,
    cancelPendingWebRtcAttempts,
    mountWithRace,
  };

  function createAttemptSlot(host = null) {
    const slot = document.createElement("div");
    slot.style.cssText =
      "position:absolute;inset:0;opacity:0;pointer-events:none;overflow:hidden;";
    if (host) host.appendChild(slot);
    return slot;
  }

  function scheduleDeferredWebRtcTakeover({
    entity,
    slot,
    deferredAttempt,
    mountToken,
    winnerEngine,
    winnerType,
    pendingDestroyers = [],
    pendingWebRtcMount = null,
    webRtcAttemptDelayMs = 0,
    probe,
  }) {
    if (!slot || !deferredAttempt || deferredAttempt.type !== "webrtc") return;
    if (winnerType !== "mse" && winnerType !== "hls") return;
    const pendingTimer = getPendingWebRtcTakeoverTimer?.();
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      setPendingWebRtcTakeoverTimer(null);
    }
    let settled = false;
    let holdTimer = null;
    const canTakeOver = () =>
      !settled && !probe.cancelled && !probe.signal?.aborted &&
      isMountTokenCurrent(mountToken) && isCurrentWinnerEngine(winnerEngine);
    const settleDeferredState = () => {
      if (settled) return;
      settled = true;
      if (holdTimer) {
        clearTimeout(holdTimer);
      }
      replaceOwnedPendingMountDestroyers(pendingDestroyers);
      releasePendingWebRtcMount(pendingWebRtcMount);
      if (getPendingWebRtcTakeoverTimer?.() === holdTimer) {
        setPendingWebRtcTakeoverTimer(null);
      }
      holdTimer = null;
    };

    holdTimer = setTimeout(
      () => {
        if (canTakeOver()) {
          failWebRtcProbe(probe);
          deferWebRtcRetry();
        }
        settleDeferredState();
        void (async () => {
          await deferredAttempt.strategy?.disconnect?.();
          const result = await deferredAttempt.promise.catch(() => null);
          cleanupStaleWinnerResult(result);
        })();
      },
      Math.max(
        1,
        (Number(
          isMobile
            ? mobileDeferredWebRtcMaxHoldMs
            : deferredWebRtcMaxHoldMs,
        ) || 0) + Math.max(0, Number(webRtcAttemptDelayMs) || 0),
      ),
    );
    setPendingWebRtcTakeoverTimer(holdTimer);

    void (async () => {
      try {
        const result = await deferredAttempt.promise.catch(() => null);
        if (!canTakeOver()) {
          cleanupStaleWinnerResult(result);
          return;
        }
        if (!result?.ok || result.type !== "webrtc") {
          failWebRtcProbe(probe);
          deferWebRtcRetry();
          return;
        }
        const takeoverStable = await waitForStreamStart(result.slot, 1500, {
          minCurrentTime: 0.1,
          minDecodedFrames: 2,
          requireReadyState: 2,
          strict: true,
        });
        if (!canTakeOver()) {
          cleanupStaleWinnerResult(result);
          return;
        }
        if (!takeoverStable) {
          failWebRtcProbe(probe);
          deferWebRtcRetry();
          cleanupStaleWinnerResult(result);
          return;
        }
        adoptMountedAttempt(slot, result);
        clearWebRtcRetryDelay();
        try {
          winnerEngine?.destroy?.();
        } catch (_) {}
        markHintSuccess(entity, "webrtc");
      } finally {
        settleDeferredState();
      }
    })();
  }
}
