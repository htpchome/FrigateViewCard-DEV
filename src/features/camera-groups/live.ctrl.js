import { buildHaCameraStreamState } from "../../integrations/home-assistant/playback.js";
import { attachVideoZoom } from "../../shared/media/video-zoom.ctrl.js";
import {
  CAMERA_GROUP_LAYOUTS,
  cameraGroupSecondaryEntity,
  isCameraGroup,
  normalizeCameraGroupLayout,
} from "./model.js";

const GROUP_CLASS_NAMES = [
  "camera-group-live",
  "camera-group-live--side-by-side",
  "camera-group-live--stacked",
  "camera-group-live--focus-a",
  "camera-group-live--focus-b",
  "camera-group-mobile-member",
];

export class CameraGroupLiveController {
  constructor(
    host,
    {
      icons = {},
      attachZoom = attachVideoZoom,
      captureDisplayedFrame = null,
    } = {},
  ) {
    this._host = host;
    this._icons = icons;
    this._attachZoom = attachZoom;
    this._captureDisplayedFrame = captureDisplayedFrame;
    this._mediaState = null;
    this._signature = "";
    this._secondaryZoom = null;
    this._resizeZoomScale = 1;
    this._activeAudioMember = "A";
    this._focusedMember = "";
  }

  get activeAudioMember() {
    return this._activeAudioMember;
  }

  get focusedMember() {
    return this._focusedMember;
  }

  isActive() {
    const camera = this._host._activeCam;
    return (
      isCameraGroup(camera) &&
      this._host._viewMode === "single" &&
      this._host._isPreviewPageActive?.() !== true &&
      this._host._isLikelyPhoneClient?.() !== true &&
      !this._host._activeGroupMemberOverride
    );
  }

  isMobileMemberMode() {
    return (
      isCameraGroup(this._host._activeCam) &&
      this._host._viewMode === "single" &&
      this._host._isPreviewPageActive?.() !== true &&
      this._host._isLikelyPhoneClient?.() === true
    );
  }

  secondaryEntity() {
    return cameraGroupSecondaryEntity(this._host._activeCam);
  }

  activeVideo() {
    if (this.isActive() && this._activeAudioMember === "B") {
      return (
        this._secondaryZoom?.video ||
        this._host._findVideoDeep?.(
          this._host._$("#camera-group-secondary-engine"),
        ) || null
      );
    }
    return (
      this._host._engine?.video ||
      this._host._findVideoDeep?.(this._host._engine) ||
      this._host._liveVideoZoomController?.video ||
      this._host._findVideoDeep?.(this._host._$("#engine")) ||
      null
    );
  }

  async captureDisplayedFrame(options = {}) {
    if (typeof this._captureDisplayedFrame !== "function") return null;
    return this._captureDisplayedFrame(this, options);
  }

  setActiveAudioMember(member) {
    const next = member === "B" && this.isActive() ? "B" : "A";
    if (next === this._activeAudioMember) {
      this.syncAudio();
      return;
    }
    this._activeAudioMember = next;
    this.syncAudio();
    this._host._syncPictureInPictureButtons?.();
  }

  toggleFocusedMember(member) {
    if (!this.isActive()) return false;
    const normalizedMember = member === "B" ? "B" : "A";
    this._focusedMember =
      this._focusedMember === normalizedMember ? "" : normalizedMember;
    if (this._focusedMember) {
      this.setActiveAudioMember(normalizedMember);
    }
    this._syncFocusedMember();
    this._refreshZoomGeometry();
    return true;
  }

  toggleMobileMember() {
    if (!this.isMobileMemberMode()) return false;
    const secondaryEntity = this.secondaryEntity();
    if (!secondaryEntity) return false;
    const showingSecondary =
      this._host._activeGroupMemberOverride === secondaryEntity;
    void this._host._switchCamera?.(this._host._activeCamIdx, {
      source: "manual",
      groupMemberEntity: showingSecondary ? "" : secondaryEntity,
    });
    return true;
  }

  setResizeZoomScale(scale = 1) {
    if (!this.isActive()) {
      this._resizeZoomScale = 1;
      return false;
    }
    const numericScale = Number(scale);
    this._resizeZoomScale =
      Number.isFinite(numericScale) && numericScale > 0
        ? Math.max(1, numericScale)
        : 1;
    this._secondaryZoom?.zoomToCenter?.(this._resizeZoomScale);
    return true;
  }

  syncAudio() {
    const active = this.isActive() ? this._activeAudioMember : "A";
    const muted = this._host._streamMuted === true;
    const primaryPane = this._host._$(
      '.camera-group-live-pane[data-camera-group-member="A"]',
    );
    const secondaryPane = this._host._$(
      '.camera-group-live-pane[data-camera-group-member="B"]',
    );
    const primaryVideo =
      this._host._findVideoDeep?.(this._host._$("#engine")) || null;
    const secondaryVideo =
      this._host._findVideoDeep?.(
        this._host._$("#camera-group-secondary-engine"),
      ) || null;
    this._applyVideoMuted(primaryVideo, muted || active !== "A");
    this._applyVideoMuted(secondaryVideo, muted || active !== "B");
    [
      [primaryPane, "A"],
      [secondaryPane, "B"],
    ].forEach(([pane, member]) => {
      pane?.classList?.toggle("is-audio-active", active === member);
      const button = pane?.querySelector?.("[data-camera-group-audio]");
      if (!button) return;
      const selected = active === member;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      const svg = selected ? this._icons.volOn : this._icons.volOff;
      const label = button.querySelector("span")?.textContent || member;
      if (svg) button.innerHTML = `${svg}<span>${label}</span>`;
    });
  }

  syncAlertState() {
    const entities = [
      this._host._activeCam?.entity || "",
      this.secondaryEntity(),
    ];
    entities.forEach((entity, index) => {
      const pane = this._host._$(
        `.camera-group-live-pane[data-camera-group-member="${index === 0 ? "A" : "B"}"]`,
      );
      if (!pane) return;
      pane.classList.remove("grid-alert", "grid-detection");
      const severities = [
        this._host._gridCellSeverity?.(entity) || "",
        this._host._previewAlertController?.previewCellSeverity?.(entity) || "",
        this._host._wideViewCompanionController?.cellSeverity?.(entity) || "",
      ];
      const severity = severities.includes("alert")
        ? "alert"
        : severities.includes("detection")
          ? "detection"
          : "";
      if (severity === "alert") pane.classList.add("grid-alert");
      if (severity === "detection") pane.classList.add("grid-detection");
    });
  }

  sync({ force = false } = {}) {
    const wrap = this._host._$("#eng-wrap");
    const secondaryPane = this._host._$(
      '.camera-group-live-pane[data-camera-group-member="B"]',
    );
    if (!wrap || !secondaryPane) return;
    if (!this.isActive()) {
      const mobileMemberMode = this.isMobileMemberMode();
      this.teardown();
      wrap.classList.remove(...GROUP_CLASS_NAMES);
      if (mobileMemberMode) wrap.classList.add("camera-group-mobile-member");
      secondaryPane.hidden = true;
      this._activeAudioMember = "A";
      this._syncMobileMemberButton();
      this.syncAudio();
      return;
    }

    const secondaryEntity = this.secondaryEntity();
    const layout = normalizeCameraGroupLayout(
      this._host._activeCam?.group?.layout,
    );
    wrap.classList.remove(...GROUP_CLASS_NAMES);
    wrap.classList.add(
      "camera-group-live",
      layout === CAMERA_GROUP_LAYOUTS.stacked
        ? "camera-group-live--stacked"
        : "camera-group-live--side-by-side",
    );
    secondaryPane.hidden = false;
    this.syncAlertState();
    const signature = [
      this._host._activeCam?.entity || "",
      secondaryEntity,
      layout,
      this._host._livePlaybackConnectionType?.(secondaryEntity) ||
        this._host._cameraConnectionType?.(secondaryEntity) ||
        "",
      this._host._currentLiveStreamHint?.() || "",
    ].join("|");
    if (this._signature && this._signature !== signature) {
      this._activeAudioMember = "A";
    }
    if (!force && signature === this._signature && this._mediaState) {
      this._syncFocusedMember();
      this.syncAudio();
      return;
    }
    this._syncFocusedMember();
    this._mountSecondary(secondaryEntity, signature);
  }

  teardown({ resetFocus = true } = {}) {
    this._secondaryZoom?.dispose?.();
    this._secondaryZoom = null;
    if (this._mediaState) {
      this._mediaState.destroyed = true;
      for (const cleanup of this._mediaState.cleanup || []) {
        try {
          cleanup();
        } catch (_) {}
      }
    }
    this._mediaState = null;
    this._signature = "";
    if (resetFocus) {
      this._focusedMember = "";
      this._resizeZoomScale = 1;
    }
    const target = this._host._$("#camera-group-secondary-engine");
    if (target) target.innerHTML = "";
    this._host
      ._$('.camera-group-live-pane[data-camera-group-member="B"]')
      ?.classList?.remove("is-ready", "grid-alert", "grid-detection");
    this._syncFocusedMember();
  }

  _mountSecondary(entity, signature) {
    this.teardown({ resetFocus: false });
    if (!entity || !this.isActive()) return;
    const target = this._host._$("#camera-group-secondary-engine");
    const pane = this._host._$(
      '.camera-group-live-pane[data-camera-group-member="B"]',
    );
    if (!target || !pane) return;
    pane.classList.remove("is-ready");
    const stateObj =
      buildHaCameraStreamState(
        this._host._hass,
        entity,
        this._host._currentLiveStreamHint?.(),
        this._host._preferredStreamType?.(),
      ) || this._host._hass?.states?.[entity] || null;
    const mediaState = { destroyed: false, cleanup: [] };
    this._mediaState = mediaState;
    this._signature = signature;
    this._host._gridMediaController?.mountCameraCellMedia?.(target, {
      entity,
      stateObj,
      useLive: true,
      liveStreamHint: this._host._currentLiveStreamHint?.(),
      gridState: mediaState,
      fallbackOnLiveError: true,
      snapshotPlaceholderWhileLive: true,
      onLiveReady: (engine) => {
        if (mediaState.destroyed || this._mediaState !== mediaState) return;
        pane.classList.add("is-ready");
        this._attachSecondaryZoom(engine, mediaState);
        this.syncAudio();
      },
    });
  }

  _attachSecondaryZoom(engine, mediaState, retries = 12) {
    if (
      !engine ||
      !mediaState ||
      mediaState.destroyed ||
      this._mediaState !== mediaState
    ) {
      return;
    }
    const target = this._host._$("#camera-group-secondary-engine");
    const video =
      engine?.video ||
      this._host._findVideoDeep?.(engine) ||
      this._host._findVideoDeep?.(target) ||
      null;
    if (video) {
      this._secondaryZoom?.dispose?.();
      this._secondaryZoom = this._attachZoom(video, {
        onInteractionStart: () =>
          this._host._dismissLinkedLightDimmers?.(),
      });
      this._secondaryZoom?.zoomToCenter?.(this._resizeZoomScale);
      this._mediaState.cleanup.push(() => {
        this._secondaryZoom?.dispose?.();
        this._secondaryZoom = null;
      });
      return;
    }
    if (retries <= 0) return;
    const retry = setTimeout(
      () => this._attachSecondaryZoom(engine, mediaState, retries - 1),
      160,
    );
    mediaState.cleanup.push(() => clearTimeout(retry));
  }

  _applyVideoMuted(video, muted) {
    if (!video) return;
    video.muted = muted;
    video.defaultMuted = muted;
    if (!muted) {
      video.volume = 1;
      video.play?.()?.catch?.(() => {});
    }
  }

  _syncFocusedMember() {
    const wrap = this._host._$("#eng-wrap");
    if (!wrap) return;
    wrap.classList.toggle(
      "camera-group-live--focus-a",
      this._focusedMember === "A",
    );
    wrap.classList.toggle(
      "camera-group-live--focus-b",
      this._focusedMember === "B",
    );
    for (const member of ["A", "B"]) {
      const pane = this._host._$(
        `.camera-group-live-pane[data-camera-group-member="${member}"]`,
      );
      const focused = this._focusedMember === member;
      const obscured = Boolean(this._focusedMember) && !focused;
      pane?.setAttribute?.("aria-hidden", obscured ? "true" : "false");
      const button = pane?.querySelector?.("[data-camera-group-focus]");
      if (!button) continue;
      const key = focused
        ? "runtime.cameraGroup.showBoth"
        : member === "B"
          ? "runtime.cameraGroup.focusSecond"
          : "runtime.cameraGroup.focusMain";
      const fallback = focused
        ? "Show both cameras"
        : member === "B"
          ? "Focus second camera"
          : "Focus main camera";
      const title = this._host._localization?.t?.(key) || fallback;
      button.setAttribute("aria-pressed", focused ? "true" : "false");
      button.setAttribute("data-fvc-i18n-aria-label", key);
      button.setAttribute("data-fvc-i18n-title", key);
      button.setAttribute("aria-label", title);
      button.setAttribute("title", title);
      button.innerHTML = focused
        ? this._icons.cameraGroupSplit || this._icons.grid || ""
        : this._icons.singleView || "";
    }
  }

  _syncMobileMemberButton() {
    const showingSecondary =
      this._host._activeGroupMemberOverride === this.secondaryEntity();
    const currentMember = showingSecondary ? "B" : "A";
    const targetMember = showingSecondary ? "A" : "B";
    const key = "runtime.cameraGroup.showCamera";
    const values = { member: targetMember };
    const title =
      this._host._localization?.t?.(key, values) ||
      `Show camera ${targetMember}`;
    const buttons = [
      ...(this._host.shadowRoot?.querySelectorAll?.(
        "[data-camera-group-mobile-toggle]",
      ) || []),
    ];
    for (const button of buttons) {
      button.setAttribute("aria-pressed", showingSecondary ? "true" : "false");
      button.setAttribute("data-fvc-i18n-aria-label", key);
      button.setAttribute("data-fvc-i18n-title", key);
      button.setAttribute("data-fvc-i18n-values", JSON.stringify(values));
      button.setAttribute("aria-label", title);
      button.setAttribute("title", title);
      button.setAttribute("data-camera-group-current-member", currentMember);
      button.setAttribute("data-camera-group-target-member", targetMember);
      button.innerHTML = `${this._icons.singleView || ""}<span aria-hidden="true">${currentMember}</span>`;
    }
  }

  _refreshZoomGeometry() {
    const refresh = () => {
      this._host._liveVideoZoomController?.refresh?.();
      this._secondaryZoom?.refresh?.();
    };
    const frame = globalThis.requestAnimationFrame?.(refresh);
    if (!frame) queueMicrotask(refresh);
  }
}
