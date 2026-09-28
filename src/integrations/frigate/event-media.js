import { EVENT_PRE_POST_ROLL_SECONDS } from "../../constants.js";

export const FRIGATE_REVIEW_EVENT_MATCH_TOLERANCE_SECONDS = 5 * 60;

export const frigateReviewDetectionIds = (review = null) => [
  ...new Set(
    (Array.isArray(review?.data?.detections)
      ? review.data.detections
      : []
    )
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  ),
];

const frigateEventIdStartTime = (id = "") => {
  const match = String(id || "").match(/^(\d+(?:\.\d+)?)-/);
  if (!match) return null;
  const timestamp = Number(match[1]);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const intervalDistance = (start, end, targetStart, targetEnd) => {
  if (end < targetStart) return targetStart - end;
  if (start > targetEnd) return start - targetEnd;
  return 0;
};

const reviewEventDistance = (review, event, eventId = "") => {
  const reviewStart = Number(review?.start_time);
  if (!Number.isFinite(reviewStart)) return 0;
  const reviewEndValue = Number(review?.end_time);
  const reviewEnd = Number.isFinite(reviewEndValue)
    ? Math.max(reviewStart, reviewEndValue)
    : reviewStart;
  const eventStartValue = Number(event?.start_time);
  const eventStart = Number.isFinite(eventStartValue)
    ? eventStartValue
    : frigateEventIdStartTime(eventId);
  if (!Number.isFinite(eventStart)) return null;
  const eventEndValue = Number(event?.end_time);
  const eventEnd = Number.isFinite(eventEndValue)
    ? Math.max(eventStart, eventEndValue)
    : eventStart;
  return intervalDistance(eventStart, eventEnd, reviewStart, reviewEnd);
};

const reviewEventMediaScore = (event = null) =>
  (event?.has_clip === true ? 2 : 0) +
  (event?.has_snapshot === true ? 1 : 0);

export const resolveFrigateReviewMediaEvent = ({
  review = null,
  findEventById = () => null,
  toleranceSeconds = FRIGATE_REVIEW_EVENT_MATCH_TOLERANCE_SECONDS,
} = {}) => {
  const detectionIds = frigateReviewDetectionIds(review);
  if (!detectionIds.length) return { eventId: "", event: null };

  const reviewCamera = String(review?.camera || "").trim();
  const tolerance = Math.max(0, Number(toleranceSeconds) || 0);
  const candidates = detectionIds.map((eventId, index) => {
    const event = findEventById(eventId) || null;
    const eventCamera = String(event?.camera || "").trim();
    const cameraMatches =
      !reviewCamera || !eventCamera || reviewCamera === eventCamera;
    return {
      eventId,
      event,
      index,
      cameraMatches,
      distance: reviewEventDistance(review, event, eventId),
      mediaScore: reviewEventMediaScore(event),
    };
  });
  const timed = candidates
    .filter(
      (candidate) =>
        candidate.cameraMatches &&
        candidate.distance != null &&
        candidate.distance <= tolerance,
    )
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        right.mediaScore - left.mediaScore ||
        left.index - right.index,
    );
  const resolved = timed[0];
  if (resolved) {
    return { eventId: resolved.eventId, event: resolved.event };
  }

  const reviewStart = Number(review?.start_time);
  const hasParseableDetectionTime = candidates.some(
    (candidate) => candidate.distance != null,
  );
  if (Number.isFinite(reviewStart) && hasParseableDetectionTime) {
    return { eventId: "", event: null };
  }

  const fallback =
    candidates.find(
      (candidate) => candidate.event && candidate.cameraMatches,
    ) || candidates[0];
  return { eventId: fallback.eventId, event: fallback.event };
};

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

export const resolveFrigateEventDuration = (
  event,
  nowSeconds = Date.now() / 1000,
) =>
  Math.max(
    1,
    Math.round((event.end_time || nowSeconds) - event.start_time),
  );

export const resolveFrigateEventMediaDuration = (
  event,
  enabled = false,
) =>
  resolveFrigateEventPrePostRollRange({ event, enabled })?.durationSec ??
  resolveFrigateEventDuration(event);
