import { cameraMemberEntities } from "../camera-groups/model.js";

const normalizeCameraHintToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^camera\./, "")
    .replace(/[^a-z0-9]+/g, "");

export class DeepLinkController {
  constructor(host) {
    this._host = host;
    this._onNavigation = () => this.handleNavigation();
    this._navigationPath = null;
    this._pendingNavigationUrl = null;
  }

  connect() {
    if (
      typeof window === "undefined" ||
      !this._host._started ||
      !this._host.isConnected
    ) {
      return;
    }
    if (this._navigationPath === null) {
      this._navigationPath = window.location.pathname;
      for (const event of ["location-changed", "popstate", "hashchange"]) {
        window.addEventListener(event, this._onNavigation);
      }
    }
    this.handleNavigation();
  }

  disconnect() {
    if (typeof window !== "undefined") {
      for (const event of ["location-changed", "popstate", "hashchange"]) {
        window.removeEventListener(event, this._onNavigation);
      }
    }
    this._navigationPath = null;
    this._pendingNavigationUrl = null;
  }

  handleNavigation() {
    if (
      typeof window === "undefined" ||
      !this._host._started ||
      !this._host.isConnected ||
      !this.isDeepLinkHandlingEnabled() ||
      window.location.pathname !== this._navigationPath
    ) {
      return;
    }
    const params = this.mergedUrlSearchParams();
    const hasTarget = [
      "event",
      "event_id",
      "frigate_event",
      "frigate_event_id",
      "review",
      "review_id",
      "frigate_review",
      "frigate_review_id",
    ].some((key) => String(params.get(key) || "").trim());
    if (!hasTarget || this._pendingNavigationUrl === window.location.href) {
      return;
    }

    this.initDeepLinkFromUrl();
    if (!this.isDeepLinkCandidateForCard()) return;
    const navigationUrl = window.location.href;
    this._pendingNavigationUrl = navigationUrl;
    void this._handlePendingNavigation(navigationUrl);
  }

  _isPendingNavigation(navigationUrl) {
    return (
      this._pendingNavigationUrl === navigationUrl &&
      this._host.isConnected &&
      window.location.href === navigationUrl
    );
  }

  _consumePendingNavigationTarget() {
    let cameraChanged = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const previousCameraIndex = this._host._activeCamIdx;
      this.consumeDeepLinkReviewOpen({ skipCameraBrowseLoad: true });
      this.consumeDeepLinkEventOpen({ skipCameraBrowseLoad: true });
      const changed = previousCameraIndex !== this._host._activeCamIdx;
      cameraChanged ||= changed;
      if (this._host._deepLinkApplied || !changed) break;
    }
    return cameraChanged;
  }

  async _handlePendingNavigation(navigationUrl) {
    const loader = this._host._browseWindowLoaderController;
    let cameraChanged = false;
    try {
      const hintedCameraIndex = this.deepLinkCameraHintIndex();
      if (
        hintedCameraIndex >= 0 &&
        hintedCameraIndex !== this._host._activeCamIdx
      ) {
        await this._host._switchCamera(hintedCameraIndex, {
          skipBrowseLoad: true,
        });
        cameraChanged = true;
      }
      if (!this._isPendingNavigation(navigationUrl)) return;

      cameraChanged =
        this._consumePendingNavigationTarget() || cameraChanged;
      if (this._host._deepLinkApplied) {
        if (cameraChanged) {
          void loader?.loadWindow?.(true, {
            supersede: true,
            reuseRecentCache: true,
          });
        }
        return;
      }

      loader?.invalidateActiveWindowCaches?.();
      await loader?.loadWindow?.(true, { supersede: true });
      if (!this._isPendingNavigation(navigationUrl)) return;
      this._consumePendingNavigationTarget();
    } catch (_) {
      // Keep navigation failures isolated from the mounted card lifecycle.
    } finally {
      if (
        this._pendingNavigationUrl === navigationUrl &&
        !this._host._deepLinkApplied
      ) {
        this._pendingNavigationUrl = null;
      }
    }
  }

  isDeepLinkHandlingEnabled() {
    return this._host._config?.deep_link_enabled !== false;
  }

  mergedUrlSearchParams() {
    const params = new URLSearchParams(window.location?.search || "");
    const hash = String(window.location?.hash || "");
    const queryIndex = hash.indexOf("?");
    if (queryIndex >= 0) {
      const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
      for (const [key, value] of hashParams.entries()) {
        if (value != null && value !== "") params.set(key, value);
      }
    }
    return params;
  }

  clearDeepLinkParamsFromUrl() {
    if (!this.isDeepLinkHandlingEnabled()) return;
    const deepLinkKeys = new Set([
      "event",
      "event_id",
      "frigate_event",
      "frigate_event_id",
      "review",
      "review_id",
      "frigate_review",
      "frigate_review_id",
      "media",
      "view",
      "open",
      "camera",
      "cam",
      "camera_entity",
    ]);

    try {
      const url = new URL(window.location.href);
      for (const key of [...url.searchParams.keys()]) {
        if (deepLinkKeys.has(key)) url.searchParams.delete(key);
      }

      const rawHash = String(url.hash || "");
      const queryIndex = rawHash.indexOf("?");
      if (queryIndex >= 0) {
        const hashPath = rawHash.slice(0, queryIndex);
        const hashQuery = new URLSearchParams(rawHash.slice(queryIndex + 1));
        for (const key of [...hashQuery.keys()]) {
          if (deepLinkKeys.has(key)) hashQuery.delete(key);
        }
        const nextHashQuery = hashQuery.toString();
        url.hash = nextHashQuery ? `${hashPath}?${nextHashQuery}` : hashPath;
      }

      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState(window.history.state, "", nextUrl);
      this._pendingNavigationUrl = null;
    } catch (_) {}
  }

  initDeepLinkFromUrl() {
    const params = this.mergedUrlSearchParams();
    const eventId = String(
      params.get("event") ||
        params.get("event_id") ||
        params.get("frigate_event") ||
        params.get("frigate_event_id") ||
        "",
    ).trim();
    const reviewId = String(
      params.get("review") ||
        params.get("review_id") ||
        params.get("frigate_review") ||
        params.get("frigate_review_id") ||
        "",
    ).trim();
    const cameraHint = String(
      params.get("camera") ||
        params.get("cam") ||
        params.get("camera_entity") ||
        "",
    )
      .trim()
      .toLowerCase();
    const mediaHint = String(
      params.get("media") || params.get("view") || params.get("open") || "",
    )
      .trim()
      .toLowerCase();
    this._host._deepLinkEventId = eventId;
    this._host._deepLinkReviewId = reviewId;
    this._host._deepLinkMediaHint = String(mediaHint || "")
      .trim()
      .toLowerCase();
    this._host._deepLinkCameraHint = eventId || reviewId ? cameraHint : "";
    this._host._deepLinkApplied = false;
    this._host._deepLinkEventLookupTried = false;
    this._host._deepLinkReviewLookupTried = false;
  }

  deepLinkCameraHintIndex() {
    if (!this._host._deepLinkCameraHint) return -1;
    const normalizedHint = normalizeCameraHintToken(
      this._host._deepLinkCameraHint,
    );
    if (!normalizedHint) return -1;
    return this._host._config.cameras.findIndex((camera) => {
      const cameraTokens = [camera.name];
      for (const entity of cameraMemberEntities(camera)) {
        cameraTokens.push(entity, this._host._camCache[entity]?.cam);
      }
      return cameraTokens.some(
        (token) => normalizeCameraHintToken(token) === normalizedHint,
      );
    });
  }

  applyDeepLinkCameraHint() {
    if (!this._host._deepLinkCameraHint) return;
    const idx = this.deepLinkCameraHintIndex();
    if (idx >= 0) this._host._activeCamIdx = idx;
  }

  isDeepLinkCandidateForCard() {
    if (!this.isDeepLinkHandlingEnabled()) return false;
    if (!this._host._deepLinkCameraHint) return true;
    return this.deepLinkCameraHintIndex() >= 0;
  }

  consumeDeepLinkEventOpen({ skipCameraBrowseLoad = false } = {}) {
    if (!this.isDeepLinkHandlingEnabled()) return;
    if (!this.isDeepLinkCandidateForCard()) return;
    if (!this._host._deepLinkEventId || this._host._deepLinkApplied) return;
    const event = this._host._findEventById(this._host._deepLinkEventId);
    if (!event) {
      this._host._deepLinkEventLookupTried = true;
      this.consumeDeepLinkReviewOpen();
      return;
    }
    this._host._deepLinkEventLookupTried = true;

    const eventCam = String(event.camera || "").toLowerCase();
    if (eventCam) {
      const idx = this._host._config.cameras.findIndex((camera) =>
        cameraMemberEntities(camera).some(
          (entity) =>
            String(this._host._camCache[entity]?.cam || "").toLowerCase() ===
            eventCam,
        ),
      );
      if (idx >= 0 && idx !== this._host._activeCamIdx) {
        if (skipCameraBrowseLoad) {
          this._host._switchCamera(idx, { skipBrowseLoad: true });
        } else {
          this._host._switchCamera(idx);
        }
        return;
      }
    }

    this._host._deepLinkApplied = true;
    if (this._host._deepLinkMediaHint === "snapshot") {
      this._host._popupMediaLoaderController?.showSnapshot?.(event) ??
        this._host._showSnapshot?.(event);
      this.clearDeepLinkParamsFromUrl();
      return;
    }
    if (this._host._deepLinkMediaHint === "clip" && event.has_clip) {
      this._host._popupMediaLoaderController?.showClip?.(event, {
        mediaType: "clip",
      }) ?? this._host._showClip?.(event, { mediaType: "clip" });
      this.clearDeepLinkParamsFromUrl();
      return;
    }
    this._host._open(this._host._deepLinkEventId);
    this.clearDeepLinkParamsFromUrl();
  }

  consumeDeepLinkReviewOpen({ skipCameraBrowseLoad = false } = {}) {
    if (!this.isDeepLinkHandlingEnabled()) return;
    if (!this.isDeepLinkCandidateForCard()) return;
    if (this._host._deepLinkApplied) return;
    if (this._host._deepLinkEventId && !this._host._deepLinkEventLookupTried)
      return;
    if (!this._host._deepLinkReviewId) return;

    const review = (this._host._reviews || []).find(
      (item) => String(item?.id || "") === this._host._deepLinkReviewId,
    );
    const reviewEventId = String(review?.data?.detections?.[0] || "");
    if (reviewEventId) {
      this._host._deepLinkEventId = reviewEventId;
      this._host._deepLinkEventLookupTried = false;
      this.consumeDeepLinkEventOpen({ skipCameraBrowseLoad });
      return;
    }

    if (this._host._deepLinkReviewLookupTried) return;
    this._host._deepLinkReviewLookupTried = true;
    void this._host
      ._loadReviews()
      .catch(() => {})
      .finally(() => {
        this.consumeDeepLinkReviewOpen({ skipCameraBrowseLoad });
        this.consumeDeepLinkEventOpen({ skipCameraBrowseLoad });
      });
  }

  hasPendingDeepLinkTarget() {
    if (!this.isDeepLinkCandidateForCard()) return false;
    return this.hasParsedDeepLinkTarget();
  }

  hasParsedDeepLinkTarget() {
    if (!this.isDeepLinkHandlingEnabled()) return false;
    return !!(this._host._deepLinkEventId || this._host._deepLinkReviewId);
  }
}
