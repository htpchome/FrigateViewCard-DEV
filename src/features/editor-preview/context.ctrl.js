import { normalizePageRoute, PAGE_IDS } from "../navigation/router.js";
import { LazyCardPickerDemoController } from "./card-picker-demo.loader.js";
import { LazyEditorPreviewDraftController } from "./draft.loader.js";

const EDITOR_LIFECYCLE_TRANSITION_GRACE_MS = 2000;
// HA replaces card instances at editor boundaries, so use an ephemeral offer
// instead of retaining media engines in a global registry.
const EDITOR_LIVE_HANDOFF_REQUEST_EVENT =
  "frigate-view-card-editor-live-handoff-request";
export const EDITOR_PREVIEW_ROUTE_INTENTS = Object.freeze({
  enterStandalone: "enter-card-view-standalone",
  revertStandaloneDraft: "revert-card-view-standalone-draft",
  navigate: "navigate",
  commit: "commit",
  reset: "reset",
});

const stableValueSignature = (value, seen = new Set()) => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (seen.has(value)) return '"[circular]"';
  seen.add(value);
  const signature = Array.isArray(value)
    ? `[${value.map((item) => stableValueSignature(item, seen)).join(",")}]`
    : `{${Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${stableValueSignature(value[key], seen)}`,
        )
        .join(",")}}`;
  seen.delete(value);
  return signature;
};

export const buildEditorLiveHandoffKey = ({
  connectionType = "",
  entity = "",
  pathname = "",
} = {}) =>
  stableValueSignature({
    connectionType: String(connectionType || "").trim(),
    entity: String(entity || "").trim(),
    pathname: String(pathname || "").trim(),
  });

export class EditorPreviewContextController {
  constructor(host, options = {}) {
    this._host = host;
    this._watchdogTimer = null;
    this._documentObserver = null;
    this._dialogObserver = null;
    this._dialogHost = null;
    this._dialogRoot = null;
    this._locationTarget = null;
    this._onLocationChange = null;
    this._dialogOpenLast = false;
    this._dashboardEditLast = false;
    this._lastEditorPreviewContext = null;
    this._editorLifecycleTransitionUntil = 0;
    this._documentRef = options.documentRef;
    this._windowRef = options.windowRef;
    this._now = options.nowFn || (() => Date.now());
    this._watchdogIntervalMs = Math.max(
      100,
      Number(options.watchdogIntervalMs) || 600,
    );
    this._setInterval =
      options.setInterval ||
      ((callback, delay) => globalThis.setInterval?.(callback, delay) ?? null);
    this._clearInterval =
      options.clearInterval ||
      ((timer) => globalThis.clearInterval?.(timer));
    this._createMutationObserver =
      options.createMutationObserver ||
      ((callback) => {
        const Observer =
          this._window()?.MutationObserver || globalThis.MutationObserver;
        return typeof Observer === "function" ? new Observer(callback) : null;
      });
    this._cardPickerDemoController =
      options.cardPickerDemoController ||
      new LazyCardPickerDemoController(host);
    this._draftController =
      options.draftController ||
      new LazyEditorPreviewDraftController(host, {
        resolveLandingPage: (pageId) => this.resolveLandingPage(pageId),
      });
    this._standaloneDraftReturnPageId = null;
    this._initialLandingPageSynced = false;
    this._liveHandoffProvider = null;
    this._liveHandoffWindow = null;
    this._onLiveHandoffRequest = null;
  }

  dispose() {
    this._stopEditModeWatchdog();
    this._disconnectDocumentObserver();
    this._disconnectDialogObserver();
    this._unbindLocationListeners();
    this._dialogHost = null;
    this._dialogOpenLast = false;
    this._dashboardEditLast = false;
    this._lastEditorPreviewContext = null;
    this._editorLifecycleTransitionUntil = 0;
    this._cardPickerDemoController.dispose();
    this._draftController.dispose();
    this._standaloneDraftReturnPageId = null;
    this._initialLandingPageSynced = false;
    this.stopLiveHandoffProvider();
  }

  startLiveHandoffProvider(provider) {
    this._liveHandoffProvider =
      typeof provider === "function" ? provider : null;
    if (!this._liveHandoffProvider || this._onLiveHandoffRequest) return;
    const windowRef = this._window();
    if (!windowRef?.addEventListener) return;
    this._onLiveHandoffRequest = (event) => {
      const detail = event?.detail;
      if (
        !detail ||
        detail.requester === this._host ||
        typeof detail.offer !== "function"
      ) {
        return;
      }
      const candidate = this._liveHandoffProvider?.(detail.request || {});
      if (candidate) detail.offer(candidate);
    };
    this._liveHandoffWindow = windowRef;
    windowRef.addEventListener(
      EDITOR_LIVE_HANDOFF_REQUEST_EVENT,
      this._onLiveHandoffRequest,
    );
  }

  stopLiveHandoffProvider() {
    if (this._liveHandoffWindow && this._onLiveHandoffRequest) {
      this._liveHandoffWindow.removeEventListener?.(
        EDITOR_LIVE_HANDOFF_REQUEST_EVENT,
        this._onLiveHandoffRequest,
      );
    }
    this._liveHandoffProvider = null;
    this._liveHandoffWindow = null;
    this._onLiveHandoffRequest = null;
  }

  requestLiveHandoff(request = {}) {
    const windowRef = this._window();
    if (!windowRef?.dispatchEvent) return null;
    const EventCtor = windowRef.CustomEvent || globalThis.CustomEvent;
    if (typeof EventCtor !== "function") return null;
    const candidates = [];
    const providers = new Set();
    const event = new EventCtor(EDITOR_LIVE_HANDOFF_REQUEST_EVENT, {
      detail: {
        requester: this._host,
        request,
        offer: (candidate) => {
          const provider = candidate?.provider;
          if (
            !provider ||
            provider === this ||
            provider === this._host ||
            providers.has(provider)
          ) {
            return;
          }
          providers.add(provider);
          candidates.push(candidate);
        },
      },
    });
    windowRef.dispatchEvent(event);
    return candidates.length === 1 ? candidates[0] : null;
  }

  liveHandoffContext() {
    if (this.isEditorPreviewContext()) return "config";
    if (this.isDashboardEditMode() || this.isCardEditorDialogOpen()) {
      return "preconfig";
    }
    return "dashboard";
  }

  resolveLandingPage(pageId) {
    const targetPageId = normalizePageRoute(pageId);
    if (!this.isEditorPreviewContext()) return targetPageId;
    return targetPageId === PAGE_IDS.wideView
      ? PAGE_IDS.singleView
      : targetPageId;
  }

  syncInitialLandingPage() {
    if (this._initialLandingPageSynced) return null;
    if (!this.isEditorPreviewContext() || !this._host._config) return null;

    const pageNavigation = this._host._pageNavigationController;
    const targetPageId = this.resolveLandingPage(
      pageNavigation?.resolveConfiguredLandingPage?.({
        hasPendingDeepLinkTarget: false,
      }),
    );
    if (!targetPageId) return null;

    this._initialLandingPageSynced = true;
    if (targetPageId === this._host._pageId) return "current";
    if (this._host._started === true) {
      pageNavigation.navigateToPageRoute?.(targetPageId, {
        source: "editor-preview-initial-landing",
      });
      return "navigated";
    }
    pageNavigation.preparePageRouteShell?.(targetPageId);
    return "prepared";
  }

  applyRouteIntent(routeIntent = null) {
    const type = String(routeIntent?.type || "");
    let targetPageId = "";

    if (
      type === EDITOR_PREVIEW_ROUTE_INTENTS.enterStandalone ||
      type === EDITOR_PREVIEW_ROUTE_INTENTS.navigate
    ) {
      if (!this._standaloneDraftReturnPageId) {
        this._standaloneDraftReturnPageId = normalizePageRoute(
          this._host._pageId,
        );
      }
      targetPageId =
        type === EDITOR_PREVIEW_ROUTE_INTENTS.enterStandalone
          ? PAGE_IDS.cardView
          : normalizePageRoute(routeIntent?.pageId);
    } else if (
      type === EDITOR_PREVIEW_ROUTE_INTENTS.revertStandaloneDraft ||
      type === EDITOR_PREVIEW_ROUTE_INTENTS.reset
    ) {
      targetPageId = this._standaloneDraftReturnPageId || "";
      this._standaloneDraftReturnPageId = null;
    } else if (type === EDITOR_PREVIEW_ROUTE_INTENTS.commit) {
      this._standaloneDraftReturnPageId = null;
    }

    if (!targetPageId) return null;
    return (
      this._host._pageNavigationController?.navigateToPageRoute?.(
        targetPageId,
        { source: "editor-preview-route-intent" },
      ) ?? null
    );
  }

  applyConfigDraft(options = {}) {
    return this._draftController.applyConfigDraft(options);
  }

  syncHassPreviewContext() {
    const inEditorPreview = this.isEditorPreviewContext();
    if (this._lastEditorPreviewContext === true && !inEditorPreview) {
      this._markEditorLifecycleTransition();
      this._notifyEditorLayoutChange();
      this._host._scheduleResumeLive("hass-edit-exit");
    }
    this._lastEditorPreviewContext = inEditorPreview;
    this._syncEditModeWatchdog();
    return inEditorPreview;
  }

  startEditModeWatchdog() {
    this._lastEditorPreviewContext = this.isEditorPreviewContext();
    this._dialogOpenLast = this.isCardEditorDialogOpen();
    this._dashboardEditLast = this.isDashboardEditMode();
    this._syncEditModeWatchdog();
  }

  isDashboardEditMode() {
    try {
      const windowRef = this._window();
      const href = String(windowRef?.location?.href || "");
      if (!href) return false;
      const url = new URL(href, windowRef?.location?.origin);
      const edit =
        url.searchParams.get("edit") ||
        url.searchParams.get("dashboard_edit") ||
        "";
      return /^(1|true|yes|on)$/i.test(String(edit));
    } catch (_) {
      return false;
    }
  }

  isEditorLifecycleActive() {
    return (
      this.isEditorPreviewContext() ||
      this.isDashboardEditMode() ||
      this.isCardEditorDialogOpen() ||
      this._lastEditorPreviewContext === true ||
      this._dashboardEditLast === true ||
      this._dialogOpenLast === true ||
      this._now() < this._editorLifecycleTransitionUntil
    );
  }

  _markEditorLifecycleTransition() {
    this._editorLifecycleTransitionUntil =
      this._now() + EDITOR_LIFECYCLE_TRANSITION_GRACE_MS;
  }

  isCardEditorDialogOpen(dialogHostCandidate = null) {
    const windowRef = this._window();
    const dialogHost =
      dialogHostCandidate ||
      this._dialogHost ||
      this._document()?.querySelector?.("hui-dialog-edit-card") ||
      null;
    if (dialogHost?.isConnected === false) return false;
    if (!dialogHost) return false;
    const root = dialogHost.shadowRoot;
    const haDialog =
      root?.querySelector?.("ha-dialog") ||
      dialogHost.querySelector?.("ha-dialog") ||
      null;
    if (haDialog) {
      if (haDialog.opened === true) return true;
      if (haDialog.hasAttribute?.("open")) return true;
      if (haDialog.hasAttribute?.("opened")) return true;
      if (haDialog.getAttribute?.("aria-hidden") === "false") return true;
      if (haDialog.getAttribute?.("aria-hidden") === "true") return false;
      if (haDialog.hidden === true) return false;
      const dialogStyle = windowRef?.getComputedStyle?.(haDialog);
      if (
        dialogStyle?.display === "none" ||
        dialogStyle?.visibility === "hidden"
      ) {
        return false;
      }
      return true;
    }
    const hostStyle = windowRef?.getComputedStyle?.(dialogHost);
    if (hostStyle?.display === "none" || hostStyle?.visibility === "hidden") {
      return false;
    }
    if (dialogHost.hidden === true) return false;
    if (dialogHost.getAttribute?.("aria-hidden") === "true") return false;
    return true;
  }

  startEditorDialogCloseObserver() {
    this._disconnectDocumentObserver();
    this._disconnectDialogObserver();
    this._unbindLocationListeners();
    const documentRef = this._document();
    this._dialogHost =
      documentRef?.querySelector?.("hui-dialog-edit-card") || null;
    this._dialogOpenLast = this.isCardEditorDialogOpen(this._dialogHost);
    this._dashboardEditLast = this.isDashboardEditMode();
    this._lastEditorPreviewContext = this.isEditorPreviewContext();
    if (this._dialogOpenLast) {
      this._observeActiveDialog();
    } else {
      this._dialogHost = null;
      this._startDocumentObserver();
    }
    this._bindLocationListeners();
    this._syncEditModeWatchdog();
  }

  _runEditModeWatchdog() {
    if (this._host.isConnected === false) return;
    this._refreshActiveDialogRoot();
    const inEditorPreview = this.isEditorPreviewContext();
    const dialogOpen = this.isCardEditorDialogOpen(this._dialogHost);
    const dashboardEdit = this.isDashboardEditMode();
    const dialogClosed = this._dialogOpenLast && !dialogOpen;
    if (
      dialogClosed ||
      (this._lastEditorPreviewContext === true && !inEditorPreview) ||
      this._dashboardEditLast !== dashboardEdit
    ) {
      this._markEditorLifecycleTransition();
      this._notifyEditorLayoutChange();
    }
    if (dialogClosed) {
      this._host._scheduleResumeLive("watchdog-dialog-close");
    }
    if (this._lastEditorPreviewContext === true && !inEditorPreview) {
      this._host._scheduleResumeLive("watchdog-edit-exit");
    }
    if (this._dashboardEditLast !== dashboardEdit) {
      this._host._scheduleResumeLive(
        dashboardEdit
          ? "watchdog-dashboard-edit-on"
          : "watchdog-dashboard-edit-off",
      );
    }
    if (dashboardEdit) {
      // Routine edit-mode probes must let an in-flight media mount settle.
      // HA HLS creates its nested video asynchronously, so forced polling can
      // mistake that startup window for a missing stream and remount forever.
      this._host._kickLiveIfStale(false);
    }
    this._dialogOpenLast = dialogOpen;
    this._dashboardEditLast = dashboardEdit;
    this._lastEditorPreviewContext = inEditorPreview;
    if (dialogClosed) {
      this._disconnectDialogObserver();
      this._dialogHost = null;
      this._startDocumentObserver();
      this._syncDialogHostFromDocument();
    }
    this._syncEditModeWatchdog();
  }

  _syncEditModeWatchdog() {
    const editing =
      this._dialogOpenLast ||
      this._dashboardEditLast ||
      this._lastEditorPreviewContext === true;
    if (!editing) {
      this._stopEditModeWatchdog();
      return;
    }
    if (this._watchdogTimer !== null) return;
    this._watchdogTimer = this._setInterval(
      () => this._runEditModeWatchdog(),
      this._watchdogIntervalMs,
    );
  }

  _stopEditModeWatchdog() {
    if (this._watchdogTimer === null) return;
    this._clearInterval(this._watchdogTimer);
    this._watchdogTimer = null;
  }

  _syncDialogHostFromDocument() {
    const dialogHost =
      this._document()?.querySelector?.("hui-dialog-edit-card") || null;
    if (dialogHost === this._dialogHost) {
      this._refreshActiveDialogRoot();
      return;
    }
    const wasOpen = this._dialogOpenLast;
    const openNow = this.isCardEditorDialogOpen(dialogHost);
    if (wasOpen !== openNow) {
      this._markEditorLifecycleTransition();
      this._notifyEditorLayoutChange();
    }
    if (wasOpen && !openNow) {
      this._host._scheduleResumeLive("card-editor-close");
    }
    this._dialogOpenLast = openNow;
    if (openNow) {
      this._disconnectDocumentObserver();
      this._disconnectDialogObserver();
      this._dialogHost = dialogHost;
      this._observeActiveDialog();
    } else {
      this._disconnectDialogObserver();
      this._dialogHost = null;
      this._startDocumentObserver();
    }
    this._syncEditModeWatchdog();
  }

  _observeActiveDialog() {
    if (!this._dialogHost || !this._dialogOpenLast) return;
    this._disconnectDocumentObserver();
    const observer = this._createMutationObserver(() => {
      this._refreshActiveDialogRoot();
      const openNow = this.isCardEditorDialogOpen(this._dialogHost);
      if (this._dialogOpenLast !== openNow) {
        this._markEditorLifecycleTransition();
        this._notifyEditorLayoutChange();
      }
      if (this._dialogOpenLast && !openNow) {
        this._host._scheduleResumeLive("card-editor-close");
      }
      this._dialogOpenLast = openNow;
      if (!openNow) {
        this._disconnectDialogObserver();
        this._dialogHost = null;
        this._startDocumentObserver();
        this._syncDialogHostFromDocument();
      }
      this._syncEditModeWatchdog();
    });
    if (!observer) return;
    this._dialogObserver = observer;
    const options = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "open",
        "opened",
        "hidden",
        "aria-hidden",
        "class",
        "style",
      ],
    };
    observer.observe?.(this._dialogHost, options);
    this._dialogRoot = this._dialogHost.shadowRoot || null;
    if (this._dialogRoot) observer.observe?.(this._dialogRoot, options);
  }

  _refreshActiveDialogRoot() {
    if (!this._dialogHost || !this._dialogObserver) return;
    const root = this._dialogHost.shadowRoot || null;
    if (root === this._dialogRoot) return;
    this._disconnectDialogObserver();
    this._observeActiveDialog();
  }

  _dialogMutationIsRelevant(records) {
    if (!Array.isArray(records)) return true;
    return records.some((record) =>
      [...(record?.addedNodes || []), ...(record?.removedNodes || [])].some(
        (node) =>
          node === this._dialogHost ||
          node?.matches?.("hui-dialog-edit-card") ||
          node?.querySelector?.("hui-dialog-edit-card"),
      ),
    );
  }

  _startDocumentObserver() {
    if (this._documentObserver) return;
    const body = this._document()?.body;
    if (!body) return;
    const observer = this._createMutationObserver((records) => {
      if (!this._dialogMutationIsRelevant(records)) return;
      this._syncDialogHostFromDocument();
    });
    if (!observer) return;
    this._documentObserver = observer;
    observer.observe?.(body, {
      childList: true,
      subtree: true,
    });
  }

  _disconnectDocumentObserver() {
    this._documentObserver?.disconnect?.();
    this._documentObserver = null;
  }

  _disconnectDialogObserver() {
    this._dialogObserver?.disconnect?.();
    this._dialogObserver = null;
    this._dialogRoot = null;
  }

  _bindLocationListeners() {
    const windowRef = this._window();
    if (!windowRef?.addEventListener) return;
    this._locationTarget = windowRef;
    this._onLocationChange = () => {
      const dashboardEdit = this.isDashboardEditMode();
      if (this._dashboardEditLast !== dashboardEdit) {
        this._markEditorLifecycleTransition();
        this._notifyEditorLayoutChange();
        this._host._scheduleResumeLive(
          dashboardEdit
            ? "watchdog-dashboard-edit-on"
            : "watchdog-dashboard-edit-off",
        );
      }
      this._dashboardEditLast = dashboardEdit;
      if (dashboardEdit) this._host._kickLiveIfStale(false);
      this._syncEditModeWatchdog();
    };
    windowRef.addEventListener("location-changed", this._onLocationChange);
    windowRef.addEventListener("popstate", this._onLocationChange);
  }

  _notifyEditorLayoutChange() {
    this._host._scheduleEditorLayoutSync?.();
  }

  _unbindLocationListeners() {
    if (this._locationTarget && this._onLocationChange) {
      this._locationTarget.removeEventListener?.(
        "location-changed",
        this._onLocationChange,
      );
      this._locationTarget.removeEventListener?.(
        "popstate",
        this._onLocationChange,
      );
    }
    this._locationTarget = null;
    this._onLocationChange = null;
  }

  _document() {
    return this._documentRef ?? globalThis.document ?? null;
  }

  _window() {
    return this._windowRef ?? globalThis.window ?? null;
  }

  isEditorPreviewContext() {
    let el = this._host;
    let depth = 0;
    while (el && depth < 48) {
      const tag = String(el.tagName || "").toUpperCase();
      if (tag === "HUI-CARD-PREVIEW" || tag === "HUI-DIALOG-EDIT-CARD") {
        return true;
      }
      const root = el.getRootNode?.();
      if (root?.host && root.host !== el) {
        el = root.host;
        depth += 1;
        continue;
      }
      el = el.parentNode || el.host;
      depth += 1;
    }
    return false;
  }

  isCardPickerPreviewContext() {
    let el = this._host;
    let depth = 0;
    while (el && depth < 64) {
      const tag = String(el.tagName || "").toUpperCase();
      if (
        tag === "HUI-CARD-PICKER" ||
        tag === "HUI-DIALOG-CREATE-CARD" ||
        tag === "HUI-CARD-OPTIONS"
      ) {
        return true;
      }
      const root = el.getRootNode?.();
      if (root?.host && root.host !== el) {
        el = root.host;
        depth += 1;
        continue;
      }
      el = el.parentNode || el.host;
      depth += 1;
    }
    return false;
  }

  renderCardPickerDemo() {
    const active = this.isCardPickerPreviewContext();
    return this._cardPickerDemoController.render(active);
  }

  isPreviewContext() {
    return this.isEditorPreviewContext() || this.isCardPickerPreviewContext();
  }
}
