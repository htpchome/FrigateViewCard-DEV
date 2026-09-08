export function isLeavingPreviewPage(context = {}, previewPageId) {
  return context.previousPageId === previewPageId;
}

export function handlePreviewExit(host, leavingPreview) {
  if (!leavingPreview) return;

  host._stopPreviewMode();
  if (host._$("#myPopup")?.classList.contains("is-open")) {
    host._popupLifecycleController?.close();
  }
  if (host._mountInProgress === true) {
    host._cancelPendingMount(`page-route-${host._pageId}`);
  }
}

export function activateStartupRoute(host, context = {}) {
  if (context.startInGrid === true) {
    host._setViewMode("grid");
    return;
  }

  host._mountEngine();
  host._renderAll({ renderWideTimeline: false });
}

export function mountEngineQuietly(host) {
  host._mountEngine(null, { quiet: true });
}

export function syncStandardRouteShell(host) {
  if (typeof host?._renderShellPreserveLive === "function") {
    host._renderShellPreserveLive();
  }
  host._syncTabsShell();
  host._renderAll({ renderWideTimeline: false });
}

export function activateStandardPageRouteLifecycle({
  host,
  context = {},
  previewPageId,
  applyRouteFrame,
} = {}) {
  const leavingPreview = isLeavingPreviewPage(context, previewPageId);
  const useRetainedPreviewCamera =
    leavingPreview &&
    context.startup !== true &&
    context.deferCameraSwitch !== true;

  handlePreviewExit(host, leavingPreview);
  if (useRetainedPreviewCamera) {
    host._previewPageController?.prepareRetainedCameraExit?.();
  }
  if (context.startup === true) {
    applyRouteFrame?.();
    activateStartupRoute(host, context);
    return;
  }

  // A non-startup route replaces and binds its page layout immediately below.
  // Styling the outgoing layout first forces the browser to recalculate a DOM
  // tree that is about to be discarded, especially when it contains a long
  // browse list.
  if (context.deferCameraSwitch === true) {
    syncStandardRouteShell(host);
    return;
  }

  syncStandardRouteShell(host);
  if (useRetainedPreviewCamera) {
    host._previewPageController?.resumeRetainedCameraAfterExit?.();
  }
}
