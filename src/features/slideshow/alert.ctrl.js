import {
  isSlideshowReviewFresh,
  rememberHandledSlideshowReview,
  slideshowReviewWatchIntervalMs,
} from "./utils.js";
import {
  findFirstReviewCandidateForEntity,
  findNewestReviewCandidateAcrossCameras,
} from "../../data/review-candidate.js";
import { parseRealtimeAlertMessage } from "../../data/realtime-alert.js";
import { DEFAULT_ALERTS_REVIEWS_DAYS } from "../../constants.js";
import {
  cameraMemberEntities,
  flattenCameraMembers,
} from "../camera-groups/model.js";

export class SlideshowAlertController {
  constructor(host, constants) {
    this._host = host;
    this._constants = constants;
    this._presentedAlertEntities = new Set();
    this._presentedAlertSeverityByEntity = new Map();
    this._activeHaAlertEntities = new Set();
    this._activeRealtimeAlertEntities = new Set();
  }

  startSession() {
    this._presentedAlertEntities.clear();
    this._presentedAlertSeverityByEntity.clear();
    this._activeHaAlertEntities.clear();
    this._activeRealtimeAlertEntities.clear();
  }

  stopSession() {
    this.startSession();
  }

  _activeLiveEntity() {
    return (
      this._host._activeGroupMemberOverride ||
      this._host._activeCam?.entity ||
      ""
    );
  }

  _alertTakeoverEnabled() {
    const enabled = this._host._alertCameraTakeoverEnabled?.();
    return enabled == null ? true : enabled === true;
  }

  _showActiveAlertWithoutTakeover(entity, severity) {
    if (entity !== this._activeLiveEntity()) return;
    this._host._setSlideshowAlertState(severity || "alert");
  }

  _switchToCameraEntity(entity) {
    const idx = this._host._cameraIndexByEntity(entity);
    if (idx < 0) return false;
    const camera = this._host._config?.cameras?.[idx];
    const grouped = cameraMemberEntities(camera).length > 1;
    void this._host._switchCamera(idx, {
      source: "alert",
      ...(grouped ? { groupMemberEntity: entity } : {}),
    });
    return true;
  }

  releaseAlertPresentation(entity) {
    const targetEntity = String(entity || "").trim();
    if (!targetEntity) return false;
    this._presentedAlertSeverityByEntity.delete(targetEntity);
    return this._presentedAlertEntities.delete(targetEntity);
  }

  completeAlertPresentation(entity) {
    const targetEntity = String(entity || "").trim();
    if (
      !targetEntity ||
      this._activeHaAlertEntities.has(targetEntity) ||
      this._activeRealtimeAlertEntities.has(targetEntity)
    ) {
      return false;
    }
    return this.releaseAlertPresentation(targetEntity);
  }

  resetPresentations() {
    this._presentedAlertEntities.clear();
    this._presentedAlertSeverityByEntity.clear();
  }

  _presentAlert(
    entity,
    severity = "alert",
    {
      activeReason = "active-alert",
      switchReason = "alert-switch",
    } = {},
  ) {
    if (
      !this._host._slideshowActive ||
      !this._host._isSlideshowRotationAvailable() ||
      !entity
    ) {
      return false;
    }
    const normalizedSeverity = String(severity || "")
      .trim()
      .toLowerCase();
    if (
      !this._host._shouldHandleSlideshowReview(
        entity,
        normalizedSeverity,
      )
    ) {
      return false;
    }
    if (!this._alertTakeoverEnabled()) {
      this._showActiveAlertWithoutTakeover(entity, normalizedSeverity);
      return false;
    }
    if (this._presentedAlertEntities.has(entity)) {
      const previousSeverity = this._presentedAlertSeverityByEntity.get(entity);
      if (
        previousSeverity !== normalizedSeverity &&
        entity === this._activeLiveEntity()
      ) {
        this._presentedAlertSeverityByEntity.set(entity, normalizedSeverity);
        this._host._setSlideshowAlertState(normalizedSeverity || "alert");
      }
      return false;
    }
    if (this._host._cameraIndexByEntity(entity) < 0) return false;

    this._presentedAlertEntities.add(entity);
    this._presentedAlertSeverityByEntity.set(entity, normalizedSeverity);
    if (this._host._slideshowPopupPaused) {
      this._host._slideshowPendingAlertCam = entity;
      this._host._slideshowPendingAlertType =
        normalizedSeverity || "alert";
      this._host._setSlideshowAlertState(normalizedSeverity || "alert");
      return true;
    }

    const now = Date.now();
    this._host._slideshowLastAlertAt = now;
    this._host._slideshowLastAlertCam = entity;
    this._host._slideshowPausedUntil = now + this.alertHoldMs();
    this._host._slideshowPendingAlertCam = "";
    this._host._slideshowPendingAlertType = "";
    this._host._setSlideshowAlertState(normalizedSeverity || "alert");

    if (entity === this._activeLiveEntity()) {
      this._host._scheduleSlideshowRotation(activeReason);
      return true;
    }

    this._switchToCameraEntity(entity);
    this._host._scheduleSlideshowRotation(switchReason);
    return true;
  }

  alertHoldMs() {
    const holdMs = this._host._slideshowAlertHoldMs?.();
    return Math.max(
      1000,
      Number(holdMs) || Number(this._constants.SLIDESHOW_ALERT_HOLD_MS) || 0,
    );
  }

  isReviewFresh(review) {
    return isSlideshowReviewFresh({
      slideshowStartedAtSec: this._host._slideshowStartedAtSec,
      reviewStartSec: this._host._reviewStartTimeSec(review),
      graceSec: this._constants.SLIDESHOW_REVIEW_FRESHNESS_GRACE_SEC,
    });
  }

  rememberHandledReview(reviewId) {
    rememberHandledSlideshowReview(
      this._host._slideshowHandledReviewIds,
      reviewId,
    );
  }

  handleReviewsUpdated(entity, reviews, source = "reviews-update") {
    if (
      !this._host._slideshowActive ||
      !this._host._isSlideshowRotationAvailable()
    ) {
      return;
    }
    if (!entity || !Array.isArray(reviews) || !reviews.length) return;

    const nextReview = findFirstReviewCandidateForEntity({
      reviews,
      entity,
      isReviewFresh: (review) => this.isReviewFresh(review),
      normalizeSeverity: (review) =>
        this._host._normalizeReviewSeverity(review),
      shouldHandleSeverity: (targetEntity, severity) =>
        this._host._shouldHandleSlideshowReview(targetEntity, severity),
      isHandledReviewId: (reviewId) =>
        this._host._slideshowHandledReviewIds.has(reviewId),
      reviewStartTime: (review) => this._host._reviewStartTimeSec(review),
    });
    if (!nextReview) return;
    if (nextReview.reviewId) this.rememberHandledReview(nextReview.reviewId);

    this._presentAlert(nextReview.entity, nextReview.severity, {
      activeReason: `${source}-active`,
      switchReason: `${source}-switch`,
    });
  }

  async probeLatestReview() {
    if (
      !this._host._slideshowActive ||
      !this._host._isSlideshowRotationAvailable() ||
      this._host._slideshowReviewProbeInFlight
    ) {
      return;
    }
    this._host._slideshowReviewProbeInFlight = true;
    try {
      const before = Math.floor(Date.now() / 1000);
      const after = Math.max(
        0,
        Math.floor(
          before -
            (this._host._config?.alerts_reviews_days ||
              DEFAULT_ALERTS_REVIEWS_DAYS) *
              this._constants.DAY,
        ),
      );
      const next = await findNewestReviewCandidateAcrossCameras({
        cameras: flattenCameraMembers(this._host._config?.cameras),
        getEntity: (camera) => camera?.entity,
        getCache: (entity) => this._host._camCache[entity],
        fetchReviews: async ({ cache }) =>
          this._host._ws({
            type: "frigate/reviews/get",
            instance_id: cache.clientId,
            cameras: [cache.cam],
            after,
            before,
            limit: 5,
          }),
        buildCandidate: ({ entity, reviews }) =>
          findFirstReviewCandidateForEntity({
            reviews,
            entity,
            isReviewFresh: (review) => this.isReviewFresh(review),
            normalizeSeverity: (review) =>
              this._host._normalizeReviewSeverity(review),
            shouldHandleSeverity: (targetEntity, severity) =>
              this._host._shouldHandleSlideshowReview(targetEntity, severity),
            isHandledReviewId: (reviewId) =>
              this._host._slideshowHandledReviewIds.has(reviewId),
            reviewStartTime: (review) => this._host._reviewStartTimeSec(review),
          }),
      });
      if (!next?.entity) return;
      if (next.reviewId) this.rememberHandledReview(next.reviewId);

      this._presentAlert(next.entity, next.severity, {
        activeReason: "probe-active-review",
        switchReason: "probe-review-switch",
      });
    } finally {
      this._host._slideshowReviewProbeInFlight = false;
    }
  }

  scheduleReviewProbe(delayMs = 180) {
    if (
      !this._host._slideshowActive ||
      !this._host._isSlideshowRotationAvailable()
    ) {
      return;
    }
    if (this._host._slideshowReviewProbeT) {
      clearTimeout(this._host._slideshowReviewProbeT);
    }
    this._host._slideshowReviewProbeT = setTimeout(
      () => {
        this._host._slideshowReviewProbeT = null;
        void this.probeLatestReview();
      },
      Math.max(0, Number(delayMs) || 0),
    );
  }

  reviewWatchIntervalMs() {
    return slideshowReviewWatchIntervalMs({
      realtimePollSeconds: this._host._effectiveRealtimePollSeconds(),
      minMs: this._constants.SLIDESHOW_REVIEW_WATCH_MIN_MS,
      maxMs: this._constants.SLIDESHOW_REVIEW_WATCH_MAX_MS,
    });
  }

  handleHaStatusCandidate(cam, severity = "alert") {
    return this._presentAlert(cam, severity, {
      activeReason: "ha-active-alert",
      switchReason: "ha-alert-switch",
    });
  }

  syncHaAlertState({ reportedEntities, candidates } = {}) {
    const reported =
      reportedEntities instanceof Set ? reportedEntities : new Set();
    const normalizedCandidates = (Array.isArray(candidates) ? candidates : [])
      .map((candidate) => ({
        entity: String(candidate?.entity || "").trim(),
        severity: String(candidate?.severity || "").trim().toLowerCase(),
      }))
      .filter(({ entity, severity }) => entity && severity);
    const activeEntities = new Set(
      normalizedCandidates.map(({ entity }) => entity),
    );
    const newlyActiveCandidates = normalizedCandidates.filter(
      ({ entity }) => !this._activeHaAlertEntities.has(entity),
    );
    this._activeHaAlertEntities = activeEntities;

    for (const entity of reported) {
      if (
        !activeEntities.has(entity) &&
        !this._activeRealtimeAlertEntities.has(entity)
      ) {
        this.releaseAlertPresentation(entity);
      }
    }

    if (
      !this._host._slideshowActive ||
      !this._host._isSlideshowRotationAvailable()
    ) {
      return false;
    }

    if (!this._alertTakeoverEnabled()) {
      normalizedCandidates.forEach(({ entity, severity }) => {
        this._showActiveAlertWithoutTakeover(entity, severity);
      });
      return false;
    }

    for (const { entity, severity } of normalizedCandidates) {
      if (!this._presentedAlertEntities.has(entity)) continue;
      this._presentAlert(entity, severity, {
        activeReason: "ha-active-alert",
        switchReason: "ha-alert-switch",
      });
    }

    for (const { entity, severity } of newlyActiveCandidates) {
      if (this._presentedAlertEntities.has(entity)) continue;
      if (
        this._presentAlert(entity, severity, {
          activeReason: "ha-active-alert",
          switchReason: "ha-alert-switch",
        })
      ) {
        return true;
      }
    }
    return false;
  }

  scheduleReviewWatch(delayMs = null) {
    if (
      !this._host._slideshowActive ||
      !this._host._isSlideshowRotationAvailable()
    ) {
      return;
    }
    if (this._host._slideshowReviewWatchT) {
      clearTimeout(this._host._slideshowReviewWatchT);
    }
    const wait =
      delayMs == null
        ? this.reviewWatchIntervalMs()
        : Math.max(0, Number(delayMs) || 0);
    this._host._slideshowReviewWatchT = setTimeout(() => {
      this._host._slideshowReviewWatchT = null;
      void this.probeLatestReview().finally(() => {
        this.scheduleReviewWatch();
      });
    }, wait);
  }

  handleRealtimeMessage(msg) {
    if (
      !this._host._slideshowActive ||
      !this._host._isSlideshowRotationAvailable()
    ) {
      return;
    }
    this.scheduleReviewProbe();
    const parsed = parseRealtimeAlertMessage({
      host: this._host,
      msg,
      checkSeverity: false,
    });
    if (!parsed) return;
    const { cam, severity, type } = parsed;
    if (type === "end") {
      this._activeRealtimeAlertEntities.delete(cam);
      if (!this._activeHaAlertEntities.has(cam)) {
        this.releaseAlertPresentation(cam);
      }
      return;
    }
    const normalizedSeverity = String(severity || "").trim().toLowerCase();
    if (!normalizedSeverity) return;
    if (!this._host._shouldHandleSlideshowReview(cam, normalizedSeverity)) {
      return;
    }
    this._activeRealtimeAlertEntities.add(cam);
    this._presentAlert(cam, normalizedSeverity);
  }
}
