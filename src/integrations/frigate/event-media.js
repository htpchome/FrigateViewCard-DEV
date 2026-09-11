import { EVENT_PRE_POST_ROLL_SECONDS } from "../../constants.js";

export const resolveFrigateEventRecordingRange = ({
  event = null,
  paddingSeconds = 0,
} = {}) => {
  if (!event) return null;
  if (event.start_time == null || event.end_time == null) return null;

  const eventStart = Number(event.start_time);
  const eventEnd = Number(event.end_time);
  const padding = Math.max(0, Number(paddingSeconds) || 0);
  if (
    !Number.isFinite(eventStart) ||
    !Number.isFinite(eventEnd) ||
    eventEnd <= eventStart
  ) {
    return null;
  }

  const start = Math.max(0, Math.floor(eventStart - padding));
  const end = Math.ceil(eventEnd + padding);
  if (end <= start) return null;

  return {
    start,
    end,
    durationSec: end - start,
  };
};

export const resolveFrigateEventPrePostRollRange = ({
  event = null,
  enabled = false,
  rollSeconds = EVENT_PRE_POST_ROLL_SECONDS,
} = {}) => {
  if (!enabled || !event) return null;
  const padding = Math.max(0, Number(rollSeconds) || 0);
  if (padding <= 0) return null;
  return resolveFrigateEventRecordingRange({
    event,
    paddingSeconds: padding,
  });
};
