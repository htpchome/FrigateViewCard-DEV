// TEMPORARY HA TALK TIMING: remove this file and its named hooks after testing.
// Removal checklist: docs/live-transport-baseline.md, Temporary talk diagnostics.
const STARTUP_STAGES = new Set([
  "microphone-requested", "microphone-ready", "config-requested", "config-ready",
  "peer-created", "offer-created", "offer-sent", "session-received",
  "answer-received", "answer-applied", "local-candidate", "candidate-sent",
  "candidate-acknowledged", "candidate-queue-flushed", "remote-candidate",
  "ice-connected", "peer-connected", "audio-track", "video-track",
  "audio-started", "video-started", "media-ready",
]);

// Opt-in, per-attempt timestamps only. Never retain signaling or camera data.
export const createTwoWayTalkStartupTiming = ({
  enabled = globalThis.FVC_TALK_TIMING === true,
  now = () => globalThis.performance.now(),
  report = (result) => console.info("[FrigateView HA talk timing]", result),
} = {}) => {
  if (!enabled) return null;
  const startedAt = now();
  const stages = [];
  const seen = new Set();
  let finished = false;
  const elapsed = () => Math.max(0, Math.round(now() - startedAt));

  return {
    mark: (stage) => {
      if (finished || seen.has(stage) || !STARTUP_STAGES.has(stage)) return;
      seen.add(stage);
      stages.push({ stage, elapsedMs: elapsed() });
    },
    finish: (outcome) => {
      if (finished) return;
      finished = true;
      try {
        report({
          outcome: ["connected", "cancelled", "failed"].includes(outcome)
            ? outcome : "failed",
          totalMs: elapsed(),
          stages,
        });
      } catch (_) {}
    },
  };
};
