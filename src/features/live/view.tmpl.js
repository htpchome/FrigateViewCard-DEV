export function buildLiveEngineWrapMarkup({ icons }) {
  return `<div id="eng-wrap" data-fvc-region="live">
                <div class="camera-group-live-layout" id="camera-group-live-layout">
                  <div class="camera-group-live-pane camera-group-live-pane--primary is-audio-active" data-camera-group-member="A">
                    <frigate-live-stream id="engine">
                      <div class="ph">${icons.live}<span data-fvc-i18n="runtime.live.connecting">Connecting…</span></div>
                    </frigate-live-stream>
                    <div id="stream-fallback" hidden>
                      <img id="stream-fallback-img" alt="Camera snapshot" data-fvc-i18n-alt="runtime.live.cameraSnapshot" loading="eager" decoding="async" fetchpriority="high">
                    </div>
                    <div class="stream-fallback-status" id="stream-fallback-status" data-fvc-i18n="runtime.live.snapshotUnavailable" hidden>Snapshot unavailable</div>
                    <div class="camera-suspended-placeholder" id="camera-suspended-placeholder" hidden>
                      <span class="camera-suspended-placeholder__icon">${icons.cameraOff || icons.power || ""}</span>
                      <strong data-fvc-i18n="runtime.live.cameraSuspended">Camera suspended</strong>
                      <span data-fvc-i18n="runtime.live.cameraSuspendedDetail">Resume this camera to restore live video.</span>
                    </div>
                    <div class="camera-group-pane-controls">
                      <button class="camera-group-pane-button camera-group-audio-select" type="button" data-media-overlay-ignore data-camera-group-audio="A" title="Use main camera audio" aria-label="Use main camera audio" data-fvc-i18n-title="runtime.cameraGroup.useMainAudio" data-fvc-i18n-aria-label="runtime.cameraGroup.useMainAudio" aria-pressed="true">${icons.volOn}<span>A</span></button>
                      <button class="camera-group-pane-button camera-group-focus-toggle" type="button" data-media-overlay-ignore data-camera-group-focus="A" title="Focus main camera" aria-label="Focus main camera" data-fvc-i18n-title="runtime.cameraGroup.focusMain" data-fvc-i18n-aria-label="runtime.cameraGroup.focusMain" aria-pressed="false">${icons.singleView}</button>
                      <button class="camera-group-pane-button camera-group-mobile-toggle" type="button" data-media-overlay-ignore data-camera-group-mobile-toggle data-camera-group-current-member="A" data-camera-group-target-member="B" title="Show camera B" aria-label="Show camera B" data-fvc-i18n-title="runtime.cameraGroup.showCamera" data-fvc-i18n-aria-label="runtime.cameraGroup.showCamera" data-fvc-i18n-values='{"member":"B"}' aria-pressed="false">${icons.singleView}<span aria-hidden="true">A</span></button>
                    </div>
                  </div>
                  <div class="camera-group-live-pane camera-group-live-pane--secondary" data-camera-group-member="B" hidden>
                    <div id="camera-group-secondary-engine"></div>
                    <div class="camera-group-member-loading"><span class="dot"></span><span data-fvc-i18n="runtime.live.loading">Loading…</span></div>
                    <div class="camera-group-pane-controls">
                      <button class="camera-group-pane-button camera-group-audio-select" type="button" data-media-overlay-ignore data-camera-group-audio="B" title="Use second camera audio" aria-label="Use second camera audio" data-fvc-i18n-title="runtime.cameraGroup.useSecondAudio" data-fvc-i18n-aria-label="runtime.cameraGroup.useSecondAudio" aria-pressed="false">${icons.volOff}<span>B</span></button>
                      <button class="camera-group-pane-button camera-group-focus-toggle" type="button" data-media-overlay-ignore data-camera-group-focus="B" title="Focus second camera" aria-label="Focus second camera" data-fvc-i18n-title="runtime.cameraGroup.focusSecond" data-fvc-i18n-aria-label="runtime.cameraGroup.focusSecond" aria-pressed="false">${icons.singleView}</button>
                    </div>
                  </div>
                  </div>
                  <div id="grid-engine" aria-hidden="true" hidden></div>
                  <div class="slideshow-next-chip" id="slideshow-next-chip" data-fvc-i18n="runtime.live.nextSlide" data-fvc-i18n-values='{"seconds":0}' hidden>Next Slide: 0s</div>
                  <div class="stream-loading" id="stream-loading" hidden>
                    <span class="dot"></span><span class="label" data-fvc-i18n="runtime.live.loading">Loading…</span>
                  </div>
                  <button class="live-resize-grip" id="live-resize-grip" type="button" role="slider" aria-orientation="vertical" aria-label="Resize live view height" title="Drag to resize live view; double-click or double-tap to reset" data-no-swipe data-fvc-i18n-aria-label="runtime.live.resizeHeight" data-fvc-i18n-title="runtime.live.resizeHint" hidden>
                    ${icons.chevron}
                  </button>
              </div>`;
}

export function buildLiveCameraRuntimeConfirmationMarkup({ icons = {} } = {}) {
  const localizationValues = escapeHtmlAttribute(
    JSON.stringify({ cardName: CARD_DISPLAY_NAME }),
  );
  return `<div class="camera-runtime-confirmation-modal" id="camera-runtime-confirmation-modal" hidden>
            <button class="camera-runtime-confirmation-backdrop" type="button" data-camera-runtime-confirm-cancel aria-label="Cancel camera state change" data-fvc-i18n-aria-label="runtime.live.cancelCameraStateChange"></button>
            <section class="camera-runtime-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="camera-runtime-confirmation-title" aria-describedby="camera-runtime-confirmation-detail camera-runtime-confirmation-warning">
              <div class="camera-runtime-confirmation-icon" aria-hidden="true">${icons.power || ""}</div>
              <strong id="camera-runtime-confirmation-title" data-fvc-i18n="runtime.live.cameraSuspendDialogTitle">Suspend camera?</strong>
              <p id="camera-runtime-confirmation-detail" data-fvc-i18n="runtime.live.cameraSuspendDialogDetail">Suspending this camera in Frigate stops live video, recordings, and detections. Existing alerts, clips, snapshots, and recordings remain available in the card. If Frigate restarts, Frigate will lift this suspension automatically.</p>
              <p class="camera-runtime-confirmation-warning" id="camera-runtime-confirmation-warning" data-fvc-i18n="runtime.live.cameraSuspendDialogWarning" data-fvc-i18n-values="${localizationValues}">Warning: Suspending this camera disables live view and recording in Frigate, Home Assistant, and ${CARD_DISPLAY_NAME}. It does not stop recording to the camera’s SD card or prevent direct live connections through go2rtc.</p>
              <footer class="camera-runtime-confirmation-actions">
                <button class="camera-runtime-confirmation-cancel" type="button" data-camera-runtime-confirm-cancel data-fvc-i18n="runtime.live.cancelCameraStateChange">Cancel</button>
                <button class="camera-runtime-confirmation-submit" id="camera-runtime-confirmation-submit" type="button" data-camera-runtime-confirm data-fvc-i18n="runtime.live.suspendCamera" data-fvc-i18n-title="runtime.live.suspendCamera" data-fvc-i18n-aria-label="runtime.live.suspendCamera">Suspend camera</button>
              </footer>
            </section>
          </div>`;
}

export function buildRotateOverlayDismissButtonMarkup({ icons = {} } = {}) {
  return `<button class="rotate-overlay-dismiss" type="button" data-rotate-overlay-dismiss data-media-overlay-ignore title="Close rotated fullscreen view" aria-label="Close rotated fullscreen view" data-fvc-i18n-title="runtime.live.closeRotatedFullscreen" data-fvc-i18n-aria-label="runtime.live.closeRotatedFullscreen">${icons.close || ""}</button>`;
}

const resolveLiveControlButtonClass = (buttonClass) =>
  String(buttonClass || "square-btn").trim() || "square-btn";

export function buildLiveFullscreenControlMarkup({
  icons,
  buttonClass = "square-btn",
}) {
  const visualButtonClass = resolveLiveControlButtonClass(buttonClass);
  return `<button class="${visualButtonClass} live-fs-btn" id="live-fs-btn" data-fvc-region="live-fullscreen" title="Fullscreen live" aria-label="Fullscreen live" data-fvc-i18n-title="runtime.live.fullscreen" data-fvc-i18n-aria-label="runtime.live.fullscreen">${icons.expand}</button>`;
}

export function buildLivePictureInPictureControlMarkup({
  icons,
  buttonClass = "square-btn",
}) {
  const visualButtonClass = resolveLiveControlButtonClass(buttonClass);
  return `<button class="${visualButtonClass} live-pip-btn" id="live-pip-btn" data-fvc-region="live-picture-in-picture" type="button" title="Picture-in-Picture live" aria-label="Picture-in-Picture live" data-fvc-i18n-title="runtime.live.pictureInPicture" data-fvc-i18n-aria-label="runtime.live.pictureInPicture" aria-pressed="false" hidden>${icons.pipPopOut}</button>`;
}

export function buildLiveTakeSnapshotControlMarkup({
  icons,
  buttonClass = "square-btn",
}) {
  const visualButtonClass = resolveLiveControlButtonClass(buttonClass);
  return `<button class="${visualButtonClass} live-take-snapshot-btn" id="live-take-snapshot-btn" data-fvc-region="live-take-snapshot" type="button" title="Take Snapshot" aria-label="Take Snapshot" data-fvc-i18n-title="runtime.live.takeSnapshot" data-fvc-i18n-aria-label="runtime.live.takeSnapshot">${icons.takeSnapshot}</button>`;
}

export function buildLiveCameraPowerControlMarkup({
  icons,
  buttonClass = "square-btn",
  suspended = false,
  hidden = false,
}) {
  const visualButtonClass = resolveLiveControlButtonClass(buttonClass);
  const label = suspended ? "Resume camera" : "Suspend camera";
  const labelKey = suspended
    ? "runtime.live.resumeCamera"
    : "runtime.live.suspendCamera";
  return `<button class="${visualButtonClass} live-camera-power-btn${suspended ? " is-camera-suspended" : ""}" id="live-camera-power-btn" data-fvc-region="live-camera-power" type="button" title="${label}" aria-label="${label}" aria-pressed="${suspended ? "true" : "false"}" data-fvc-i18n-title="${labelKey}" data-fvc-i18n-aria-label="${labelKey}"${hidden ? " hidden" : ""}>${icons.power || ""}</button>`;
}

export function buildLiveMuteControlMarkup({
  icons,
  streamMuted,
  buttonClass = "square-btn",
  buttonId = "mute-btn",
  region = "live-mute",
  extraClass = "",
  pressed = null,
  hidden = false,
}) {
  const label = streamMuted ? "Unmute live view" : "Mute live view";
  const labelKey = streamMuted ? "runtime.live.unmute" : "runtime.live.mute";
  const icon = streamMuted ? icons.volOff : icons.volOn;
  const visualButtonClass = resolveLiveControlButtonClass(buttonClass);
  const className = [
    visualButtonClass,
    "mute-btn",
    extraClass,
    pressed === true ? "active" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const regionAttribute = region ? ` data-fvc-region="${region}"` : "";
  const pressedAttribute =
    typeof pressed === "boolean" ? ` aria-pressed="${pressed}"` : "";
  const hiddenAttribute = hidden ? " hidden" : "";
  return `<button class="${className}" id="${buttonId}"${regionAttribute}${pressedAttribute}${hiddenAttribute} title="${label}" aria-label="${label}" data-fvc-i18n-title="${labelKey}" data-fvc-i18n-aria-label="${labelKey}">${icon}</button>`;
}

export function buildLivePlaybackControlsMarkup(regions = {}) {
  return `<div class="live-playback-controls overlay-controls" id="live-playback-controls">
              ${regions.liveCameraPower || ""}
              ${regions.livePictureInPicture || ""}
              ${regions.liveTakeSnapshot || ""}
              ${regions.liveFullscreen || ""}
              ${regions.liveMute || ""}
            </div>`;
}
import { CARD_DISPLAY_NAME } from "../../constants.js";
import { escapeHtmlAttribute } from "../../shared/html.js";
