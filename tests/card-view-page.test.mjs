import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CardViewPageController,
  chunkCardViewItems,
  resolveCardViewDrawerSwipe,
  resolveCardViewColumnCount,
  resolveCardViewPageScrollTarget,
} from "../src/features/card-view/page.ctrl.js";
import {
  applyCardViewPageMarkup,
  buildCardViewMainLayoutShellMarkup,
  buildCardViewStandaloneModeControlsMarkup,
  buildCardViewToolbarMarkup,
} from "../src/features/card-view/page.tmpl.js";
import { CARD_VIEW_PAGE_STYLES } from "../src/features/card-view/page.styles.js";
import {
  CARD_VIEW_START_MODES,
  CARD_VIEW_VIEW_MODES,
} from "../src/features/card-view/config.js";
import { CAMERA_PICKER_STYLES } from "../src/features/navigation/camera-picker.styles.js";
import { GRID_ALERT_HOLD_MS } from "../src/constants.js";

test("Card View uses independent alert and recording page widths", () => {
  assert.equal(resolveCardViewColumnCount({ width: 500, mode: "alerts" }), 1);
  assert.equal(
    resolveCardViewColumnCount({ width: 500, mode: "recordings" }),
    2,
  );
  assert.equal(resolveCardViewColumnCount({ width: 900, mode: "alerts" }), 2);
  assert.equal(
    resolveCardViewColumnCount({ width: 900, mode: "recordings" }),
    3,
  );
});

test("Card View groups tiles into full-width scroll pages", () => {
  assert.deepEqual(chunkCardViewItems([1, 2, 3, 4, 5], 2), [
    [1, 2],
    [3, 4],
    [5],
  ]);
});

test("Card View navigation resolves absolute full-page scroll targets", () => {
  assert.equal(
    resolveCardViewPageScrollTarget({
      scrollLeft: 0,
      clientWidth: 500,
      scrollWidth: 2500,
      direction: 1,
    }),
    500,
  );
  assert.equal(
    resolveCardViewPageScrollTarget({
      scrollLeft: 500,
      clientWidth: 500,
      scrollWidth: 2500,
      direction: 1,
    }),
    1000,
  );
  assert.equal(
    resolveCardViewPageScrollTarget({
      scrollLeft: 1000,
      clientWidth: 500,
      scrollWidth: 1750,
      direction: 1,
    }),
    1250,
  );
  assert.equal(
    resolveCardViewPageScrollTarget({
      scrollLeft: 1000,
      clientWidth: 500,
      scrollWidth: 2500,
      direction: -1,
    }),
    500,
  );
});

test("Card View shell owns live, a collapsible activity drawer, arrows, and footer regions", () => {
  const markup = buildCardViewMainLayoutShellMarkup({
    regions: {
      live: '<div data-fvc-region="live"></div>',
      livePictureInPicture:
        '<button data-fvc-region="live-picture-in-picture"></button>',
      liveFullscreen: '<button data-fvc-region="live-fullscreen"></button>',
      liveTakeSnapshot:
        '<button data-fvc-region="live-take-snapshot"></button>',
      liveMute: '<button data-fvc-region="live-mute"></button>',
      cardViewVideoBackIcon: "back-icon",
      linkedEntitiesLeft: "left-light-control",
      linkedEntitiesRight: "right-light-control",
      pageNavigation:
        '<div data-fvc-region="page-navigation"></div>',
      drawerHandleIcon: "chevron",
      mediaDrawerHandleIcon: "media-chevron",
    },
  });

  assert.match(markup, /data-fvc-region="card-view-activity"/);
  assert.match(markup, /data-card-view-drawer/);
  assert.match(markup, /class="footer-version" hidden><\/div>/);
  assert.equal(
    (markup.match(/data-card-view-drawer-toggle/g) || []).length,
    2,
  );
  assert.match(markup, /card-view-drawer-handle--left/);
  assert.match(markup, /card-view-drawer-handle--right/);
  assert.match(markup, /data-card-view-scroll="-1"/);
  assert.match(markup, /data-card-view-scroll="1"/);
  assert.match(markup, /card-view-footer-end[\s\S]*card-view-calendar-panel/);
  assert.match(markup, /data-card-view-calendar[^>]*hidden/);
  assert.match(markup, /card-view-footer/);
  assert.match(markup, /data-card-view-standalone-mode-controls/);
  assert.match(markup, /data-card-view-live-badge/);
  assert.match(
    markup,
    /card-view-video-only-back[^>]*data-card-view-video-back[^>]*>back-icon</,
  );
  assert.match(markup, /data-card-view-media-drawer/);
  assert.match(markup, /data-card-view-media-drawer-toggle/);
  assert.match(markup, /data-card-view-media-drawer-scroller/);
  assert.match(markup, /data-card-view-media-drawer-scroll="-1"/);
  assert.match(markup, /data-card-view-media-drawer-scroll="1"/);
  assert.match(
    markup,
    /data-card-view-media-drawer-panel[\s\S]*data-card-view-media-drawer-tabs[^>]*aria-hidden="true"[^>]*hidden[\s\S]*card-view-media-drawer-handle/,
  );
  assert.match(markup, /data-card-view-media-drawer-type="alerts"/);
  assert.match(markup, /data-card-view-media-drawer-type="clips"/);
  assert.match(markup, /data-card-view-media-drawer-type="snapshots"/);
  assert.doesNotMatch(markup, /card-view-media-drawer-heading/);
  assert.match(markup, /media-chevron/);
  assert.match(markup, /data-card-view-standalone-linked-overlay/);
  assert.match(markup, /media-linked-controls-overlay/);
  assert.match(markup, /data-card-view-standalone-light-overlay/);
  assert.match(
    markup,
    /data-linked-light-position-slot="left"[^>]*>left-light-control/,
  );
  assert.match(
    markup,
    /data-linked-light-position-slot="right"[^>]*>right-light-control/,
  );
  assert.match(markup, /data-card-view-standalone-talk-overlay/);
});

test("standalone Card View controls expose active Grid and Slideshow states", () => {
  const markup = buildCardViewStandaloneModeControlsMarkup({
    icons: {
      grid: "grid-icon",
      presentationPlay: "slideshow-icon",
      presentationPlayActive: "slideshow-active-icon",
    },
    gridAvailable: true,
    gridActive: true,
    slideshowAvailable: true,
    slideshowActive: true,
    slideshowRemainingSeconds: 7,
  });

  assert.match(markup, /data-card-view-standalone-grid/);
  assert.match(markup, /data-card-view-standalone-grid[^>]*aria-pressed="true"/);
  assert.match(markup, /data-card-view-standalone-slideshow/);
  assert.match(markup, /slideshow-active-icon/);
  assert.match(markup, /data-card-view-slideshow-countdown>7s/);
  assert.ok(
    markup.indexOf("data-card-view-standalone-slideshow") <
      markup.indexOf("data-card-view-standalone-grid"),
  );
});

test("Video Only mode controls are not disabled by Card View alert takeover", () => {
  const container = { innerHTML: "" };
  const host = {
    _pageId: "card-view",
    _viewMode: "single",
    _slideshowActive: false,
    _config: {
      card_view_standalone: true,
      card_view_view_mode: CARD_VIEW_VIEW_MODES.videoOnly,
      card_view_alert_takeover: true,
    },
    shadowRoot: {
      querySelector: (selector) =>
        selector === "[data-card-view-standalone-mode-controls]"
          ? container
          : null,
    },
    _isGridModeAvailable: () => true,
    _isSlideshowRotationAvailable: () => true,
    _toolbarButtonStates: () => ({
      gridDisabled: true,
      slideshowDisabled: true,
    }),
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });

  controller.renderStandaloneModeControls(host._toolbarButtonStates());

  assert.match(container.innerHTML, /data-card-view-standalone-grid/);
  assert.match(container.innerHTML, /data-card-view-standalone-slideshow/);
  assert.doesNotMatch(
    container.innerHTML,
    /data-card-view-standalone-(?:grid|slideshow)[^>]* disabled/,
  );
});

test("active Video Only Grid indicator uses the shared ten-second Grid hold", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const classes = new Set();
  const container = {
    innerHTML: "",
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
  };
  let scheduled = null;
  globalThis.setTimeout = (callback, delay) => {
    scheduled = { callback, delay, unref() {} };
    return scheduled;
  };
  globalThis.clearTimeout = () => {};
  try {
    const host = {
      _pageId: "card-view",
      _viewMode: "grid",
      _slideshowActive: false,
      _config: {
        card_view_standalone: true,
        card_view_view_mode: CARD_VIEW_VIEW_MODES.videoOnly,
      },
      shadowRoot: {
        querySelector: (selector) =>
          selector === "[data-card-view-standalone-mode-controls]"
            ? container
            : null,
      },
      _isGridModeAvailable: () => true,
      _isSlideshowRotationAvailable: () => true,
      _twoWayTalkActiveForCurrentCamera: () => false,
    };
    const controller = new CardViewPageController(host, {
      PAGE_IDS: { cardView: "card-view" },
    });

    controller.renderStandaloneModeControls();

    assert.equal(classes.has("card-view-grid-indicator-visible"), true);
    assert.equal(scheduled?.delay, GRID_ALERT_HOLD_MS);
    scheduled.callback();
    assert.equal(classes.has("card-view-grid-indicator-visible"), false);

    controller.renderStandaloneModeControls();
    assert.equal(classes.has("card-view-grid-indicator-visible"), false);

    host._viewMode = "single";
    controller.renderStandaloneModeControls();
    host._viewMode = "grid";
    controller.renderStandaloneModeControls();
    assert.equal(classes.has("card-view-grid-indicator-visible"), true);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("Video Only reuses the shared two-way-talk controls on its overlay", () => {
  const container = { innerHTML: "" };
  let talkOptions = null;
  let lightSyncs = 0;
  const host = {
    _pageId: "card-view",
    _viewMode: "single",
    _config: {
      card_view_standalone: true,
      card_view_view_mode: CARD_VIEW_VIEW_MODES.videoOnly,
    },
    shadowRoot: {
      querySelector: (selector) =>
        selector === "[data-card-view-standalone-talk-overlay]"
          ? container
          : null,
    },
    _shouldRenderTwoWayTalkButtonForActiveCamera: () => true,
    _buildTwoWayTalkControlRowMarkup: (options) => {
      talkOptions = options;
      return "shared-talk-controls";
    },
    _syncTwoWayTalkSoundwaveSurface: () => {},
    _linkedLightController: {
      sync: () => {
        lightSyncs += 1;
      },
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });

  controller.renderStandaloneLinkedControls();

  assert.deepEqual(talkOptions, { includeIncomingAudioMute: true });
  assert.equal(container.innerHTML, "shared-talk-controls");
  assert.equal(lightSyncs, 1);
});

test("non-standalone Video Only renders picker and center controls as overlays", () => {
  const modeControls = { innerHTML: "" };
  const talkControls = { innerHTML: "" };
  const host = {
    _pageId: "card-view",
    _viewMode: "single",
    _slideshowActive: false,
    _activeCamIdx: 0,
    _activeCam: { entity: "camera.doorbell", name: "Doorbell" },
    _config: {
      card_view_standalone: false,
      card_view_view_mode: CARD_VIEW_VIEW_MODES.videoOnly,
      cameras: [{ entity: "camera.doorbell", name: "Doorbell" }],
    },
    _hass: {
      states: { "camera.doorbell": { state: "streaming" } },
    },
    shadowRoot: {
      querySelector: (selector) => {
        if (selector === "[data-card-view-standalone-mode-controls]") {
          return modeControls;
        }
        if (selector === "[data-card-view-standalone-talk-overlay]") {
          return talkControls;
        }
        return null;
      },
    },
    _isGridModeAvailable: () => true,
    _isSlideshowRotationAvailable: () => true,
    _shouldRenderTwoWayTalkButtonForActiveCamera: () => true,
    _buildTwoWayTalkControlRowMarkup: () => "overlay-microphone",
    _syncTwoWayTalkSoundwaveSurface: () => {},
    _linkedLightController: { sync: () => {} },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });

  assert.equal(controller.usesOverlayPresentation(), true);
  assert.doesNotMatch(
    controller.camSwitcherMarkup(),
    /mobile-cam-picker__status/,
  );
  controller.renderStandaloneModeControls();
  controller.renderStandaloneLinkedControls();
  assert.match(modeControls.innerHTML, /data-card-view-standalone-grid/);
  assert.match(modeControls.innerHTML, /data-card-view-standalone-slideshow/);
  assert.equal(talkControls.innerHTML, "overlay-microphone");
});

test("View Mode alone determines whether Card View uses the video overlay presentation", () => {
  for (const standalone of [false, true]) {
    for (const viewMode of Object.values(CARD_VIEW_VIEW_MODES)) {
      const cardClasses = new Set();
      const host = {
        _pageId: "card-view",
        _viewMode: "single",
        _slideshowActive: false,
        _activeCamIdx: 0,
        _activeCam: { entity: "camera.doorbell", name: "Doorbell" },
        _config: {
          card_view_standalone: standalone,
          card_view_view_mode: viewMode,
          card_view_hide_camera_name: true,
          card_view_media_drawer_enabled: true,
          cameras: [{ entity: "camera.doorbell", name: "Doorbell" }],
        },
        _hass: {
          states: { "camera.doorbell": { state: "streaming" } },
        },
        classList: { toggle: () => {} },
        _$: (selector) =>
          selector === "#card"
            ? {
                classList: {
                  toggle: (name, enabled) => {
                    if (enabled) cardClasses.add(name);
                    else cardClasses.delete(name);
                  },
                },
              }
            : null,
      };
      const controller = new CardViewPageController(host, {
        PAGE_IDS: { cardView: "card-view" },
      });
      const videoOnly = viewMode === CARD_VIEW_VIEW_MODES.videoOnly;

      applyCardViewPageMarkup({
        host,
        pageIds: { cardView: "card-view" },
      });

      assert.equal(controller.usesOverlayPresentation(), videoOnly);
      assert.equal(
        cardClasses.has("card-view-overlay-presentation"),
        videoOnly,
      );
      assert.equal(cardClasses.has("card-view-video-panel-only"), videoOnly);
      assert.equal(cardClasses.has("card-view-standalone"), standalone);
      assert.equal(
        controller.camSwitcherMarkup().includes("mobile-cam-picker__status"),
        !videoOnly,
      );
    }
  }
});

test("standalone Card View markup reflects video-only, hidden-name, and active mode state", () => {
  const hostClasses = new Set();
  const cardClasses = new Set();
  const classList = (classes) => ({
    toggle: (name, enabled) => {
      if (enabled) classes.add(name);
      else classes.delete(name);
    },
  });
  const host = {
    _pageId: "card-view",
    _viewMode: "grid",
    _slideshowActive: false,
    _config: {
      card_view_standalone: true,
      card_view_media_drawer_enabled: true,
      card_view_view_mode: CARD_VIEW_VIEW_MODES.videoOnly,
      card_view_hide_camera_name: true,
    },
    classList: classList(hostClasses),
    _$: (selector) =>
      selector === "#card" ? { classList: classList(cardClasses) } : null,
  };

  applyCardViewPageMarkup({
    host,
    pageIds: { cardView: "card-view" },
  });

  assert.equal(hostClasses.has("card-view-natural-height"), true);
  assert.equal(cardClasses.has("card-view-standalone"), true);
  assert.equal(cardClasses.has("card-view-overlay-presentation"), true);
  assert.equal(cardClasses.has("card-view-video-panel-only"), true);
  assert.equal(cardClasses.has("card-view-hide-camera-name"), true);
  assert.equal(cardClasses.has("card-view-media-drawer-enabled"), true);
  assert.equal(cardClasses.has("card-view-grid-mode"), true);
  assert.equal(cardClasses.has("card-view-slideshow-mode"), false);
});

test("non-standalone Video Only uses the complete in-video overlay presentation", () => {
  const cardClasses = new Set();
  const host = {
    _pageId: "card-view",
    _viewMode: "grid",
    _slideshowActive: false,
    _config: {
      card_view_standalone: false,
      card_view_media_drawer_enabled: true,
      card_view_view_mode: CARD_VIEW_VIEW_MODES.videoOnly,
      card_view_hide_camera_name: true,
    },
    classList: { toggle: () => {} },
    _$: (selector) =>
      selector === "#card"
        ? {
            classList: {
              toggle: (name, enabled) => {
                if (enabled) cardClasses.add(name);
                else cardClasses.delete(name);
              },
            },
          }
        : null,
  };

  applyCardViewPageMarkup({
    host,
    pageIds: { cardView: "card-view" },
  });

  assert.equal(cardClasses.has("card-view-standalone"), false);
  assert.equal(cardClasses.has("card-view-overlay-presentation"), true);
  assert.equal(cardClasses.has("card-view-video-panel-only"), true);
  assert.equal(cardClasses.has("card-view-hide-camera-name"), true);
  assert.equal(cardClasses.has("card-view-media-drawer-enabled"), true);
  assert.equal(cardClasses.has("card-view-grid-mode"), true);
});

test("Card View toolbar swaps alert and recording controls without a day heading", () => {
  const markup = buildCardViewToolbarMarkup({
    mode: "recordings",
    icons: { alerts: "alerts", calendar: "calendar" },
    showMicrophone: true,
    microphoneMarkup: "microphone",
    linkedLightRightMarkup: "light",
  });
  assert.match(markup, />Recordings</);
  assert.match(markup, /card-view-mode-switch-label">Goto Alerts</);
  assert.match(markup, /card-view-toolbar-center/);
  assert.match(markup, /data-fvc-region="two-way-talk">microphone/);
  assert.match(
    markup,
    /data-linked-light-position-slot="right"[^>]*>light/,
  );
  assert.doesNotMatch(markup, /data-card-view-calendar/);
  assert.doesNotMatch(markup, /Day\/Date/);
  assert.ok(
    markup.indexOf("card-view-toolbar-start") <
      markup.indexOf("card-view-toolbar-center"),
  );
  assert.ok(
    markup.indexOf("card-view-toolbar-center") <
      markup.indexOf("card-view-activity-actions"),
  );

  const alertsMarkup = buildCardViewToolbarMarkup({
    mode: "alerts",
    icons: { recordings: "recordings" },
    activeCameraName: "Doorbell",
  });
  assert.match(alertsMarkup, /card-view-activity-heading">Alerts</);
  assert.doesNotMatch(alertsMarkup, /Recent Alerts/);
  assert.match(
    alertsMarkup,
    /card-view-mode-switch-label">Goto Recordings</,
  );
  assert.match(alertsMarkup, /data-card-view-alert-scope/);
  assert.match(alertsMarkup, />Show Doorbell Alerts</);
  assert.doesNotMatch(markup, /data-card-view-alert-scope/);
});

test("Card View toolbar progressively stacks then hides both compact labels", () => {
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /@container card-view-activity \(max-width:560px\)[\s\S]*?:is\(\.card-view-mode-switch,\.card-view-alert-scope-switch\)[\s\S]*?flex-direction:column/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /@container card-view-activity \(max-width:400px\)[\s\S]*?\.card-view-mode-switch-label \{display:none;\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /\.card-view-toolbar-center \{[^}]*gap:12px/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /\.card-view-toolbar-center \{[^}]*display:grid;[^}]*grid-template-columns:minmax\(36px,1fr\) auto minmax\(36px,1fr\)/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /\.card-view-toolbar-center > \.card-view-microphone-slot \{grid-column:2;grid-row:1;\}/,
  );
});

test("Card View overlay presentation keeps controls on the rounded video stage", () => {
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation \.card-view-live-stage[\s\S]*?border-radius:var\(--fvc-border-radius,0px\)/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-video-panel-only \.card-view-drawer,[\s\S]*?card-view-video-panel-only \.card-view-footer \{display:none;\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-grid-mode \.live-playback-controls \{display:none !important;\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation \.slideshow-next-chip \{display:none !important;\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation \.card-view-camera-row \{[\s\S]*?grid-template-columns:minmax\(0,1fr\) clamp\(112px,38%,200px\) minmax\(0,1fr\)/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation \.mobile-cam-picker \{[\s\S]*?grid-column:2;grid-row:1;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation \.card-view-camera-row \{[\s\S]*?pointer-events:none;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation \.mobile-cam-picker \{[\s\S]*?z-index:2;[\s\S]*?pointer-events:auto;touch-action:manipulation;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation \.card-view-standalone-mode-controls \{[\s\S]*?z-index:1;[\s\S]*?pointer-events:none;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation \.card-view-standalone-slideshow-button \{grid-column:1;justify-self:end;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation \[data-card-view-standalone-grid\] \{grid-column:3;justify-self:start;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-hide-camera-name \.mobile-cam-picker \{opacity:0;pointer-events:none;/,
  );
  assert.doesNotMatch(
    CARD_VIEW_PAGE_STYLES,
    /card-view-grid-mode \.mobile-cam-picker/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /mobile-cam-picker__panel \{[\s\S]*?overflow-y:auto;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-standalone-linked-overlay \{[\s\S]*?grid-template-columns:minmax\(36px,1fr\) auto minmax\(36px,1fr\)/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /data-linked-light-position-slot="left"\] \{grid-column:1;justify-self:end;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /data-linked-light-position-slot="right"\] \{grid-column:3;justify-self:start;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-standalone-talk-overlay \{[\s\S]*?grid-column:2;grid-row:1;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-standalone-linked-overlay:has\(#two-way-talk-btn\.active\)[^{]*\{opacity:1;pointer-events:auto;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /two-way-talk-active \.card-view-standalone-linked-overlay,/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /two-way-talk-active \.card-view-standalone-light-controls,[\s\S]*?card-view-standalone-linked-overlay:has\(#two-way-talk-btn\.active\) \.card-view-standalone-light-controls \{display:none;\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /two-way-talk-active\.card-view-overlays-visible \.card-view-standalone-light-controls \{display:contents;\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /two-way-talk-active \.card-view-standalone-linked-overlay:has\(\[data-linked-light-dimmer\]:not\(\[hidden\]\)\) \.card-view-standalone-light-controls,[\s\S]*?\{display:contents;\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /two-way-talk-active \.card-view-live-panel:hover \.card-view-standalone-light-controls \{display:contents;\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-standalone-talk-overlay \.two-way-talk-control-row :is\(\.two-way-talk-microphone-mute-btn,\.two-way-talk-inline-mute-btn\)[\s\S]*?background:transparent;[\s\S]*?box-shadow:none;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /@keyframes card-view-slideshow-button-settle \{[\s\S]*?0%,72% \{opacity:1;\}[\s\S]*?100% \{opacity:\.68;\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-standalone-slideshow-button\.active \{[\s\S]*?opacity:\.68;pointer-events:auto;animation:card-view-slideshow-button-settle 3\.2s ease-out forwards;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /\[data-card-view-standalone-grid\]\.active \{[\s\S]*?opacity:\.68;pointer-events:auto;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlays-visible \.card-view-standalone-slideshow-button\.active \{animation:none;\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-grid-indicator-visible \[data-card-view-standalone-grid\]\.active,[\s\S]*?opacity:1;pointer-events:auto;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-video-panel-only:not\(\.card-view-standalone\) \.card-view-video-only-back \{[\s\S]*?position:absolute;z-index:25;top:8px;left:8px;[\s\S]*?border-radius:50%;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-video-only-back \{[\s\S]*?background:var\(--fvc-media-overlay-bg\);background-image:none;[\s\S]*?opacity:1;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-video-only-back svg \{[^}]*color:currentColor;fill:currentColor;opacity:1;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation \.two-way-talk-result-bubble \{top:50%;bottom:auto;transform:translate\(-50%,-50%\);\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-live-stage:has\(#stream-loading:not\(\[hidden\]\)\) \.card-view-live-badge \{display:none;\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-media-drawer-enabled \.card-view-media-drawer:not\(\[hidden\]\) \{[\s\S]*?z-index:40;[\s\S]*?width:clamp\(118px,30%,156px\)/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-media-drawer-panel \{[\s\S]*?overflow:visible;transform:translateX\(calc\(-100% - 2px\)\);[\s\S]*?background:var\(--fvc-media-overlay-bg-strong\)/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-media-drawer-scroller \{[\s\S]*?overflow-y:auto;[\s\S]*?touch-action:pan-y/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-media-drawer-nav \{[\s\S]*?left:50%;[\s\S]*?width:min\(72px,58%\);[\s\S]*?transform:translateX\(-50%\)/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-media-drawer-tabs \{[\s\S]*?top:8px;left:calc\(100% - 1px\);[\s\S]*?flex-direction:column;[\s\S]*?width:68px;[\s\S]*?visibility:hidden;pointer-events:none;transition:visibility 0s linear 180ms;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-media-drawer\.is-open \.card-view-media-drawer-tabs \{[\s\S]*?visibility:visible;pointer-events:auto;transition-delay:0s;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-media-drawer-tab \{[\s\S]*?border-left:0;border-radius:0 7px 7px 0;[\s\S]*?background:var\(--fvc-media-overlay-bg\);/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-media-drawer-nav--up \{top:5px;\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-live-panel \{[^}]*container-name:card-view-live;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation \.card-view-live-panel \{[\s\S]*?min-height:var\(--popup-card-view-media-height,0px\);/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation \.linked-light-dimmer-panel \{width:80px;gap:4px;padding:6px 5px;\}[\s\S]*?linked-light-brightness-track \{width:44px;height:92px;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation:is\(\.mobile-rotate-live,\.mobile-rotate-live-exit\) \.card-view-camera-row \{[\s\S]*?position:fixed;z-index:1500;[\s\S]*?safe-area-inset-left/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation:is\(\.mobile-rotate-live,\.mobile-rotate-live-exit\) \.card-view-media-drawer:not\(\.is-open\) \.card-view-media-drawer-handle \{[\s\S]*?top:auto;bottom:max\(8px,env\(safe-area-inset-bottom,0px\)\);left:50%;width:56px;height:30px;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-media-drawer\.is-open \.card-view-media-drawer-handle \{left:calc\(100% - 1px\);\}/,
  );
  assert.equal((CARD_VIEW_PAGE_STYLES.match(/top:45px/g) || []).length, 0);
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-live-panel:hover \.card-view-standalone-mode-button[^{]*\{[\s\S]*?opacity:1;pointer-events:auto;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-live-panel:hover \.card-view-standalone-linked-overlay \{opacity:1;pointer-events:auto;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-video-zoomed \.mobile-cam-picker\[data-mobile-cam-picker\],[\s\S]*?card-view-video-zoomed \.card-view-standalone-mode-button,[\s\S]*?\{opacity:0;pointer-events:none;/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-video-zoomed \.card-view-camera-row,[\s\S]*?\.fvc-video-zoomed\) \.card-view-camera-row \{pointer-events:none;\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-overlay-presentation \.mobile-cam-picker \{[\s\S]*?transition:opacity \.16s ease;/,
  );
  assert.doesNotMatch(CARD_VIEW_PAGE_STYLES, /translateY\(-3px\)/);
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-video-zoomed \.card-view-standalone-linked-overlay:not\(:has\(#two-way-talk-btn\.active\)\),[\s\S]*?\{opacity:0;pointer-events:none;/,
  );
  const openMediaDrawerRule = CARD_VIEW_PAGE_STYLES.match(
    /card-view-overlay-presentation:has\(\.card-view-media-drawer\.is-open\) \.card-view-camera-row,[\s\S]*?\{[^}]*visibility:hidden;[^}]*\}/,
  )?.[0];
  assert.ok(openMediaDrawerRule);
  assert.match(openMediaDrawerRule, /card-view-standalone-linked-overlay/);
  assert.doesNotMatch(openMediaDrawerRule, /live-playback-controls/);
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /\.card\.firefox-client\.card-view-active\.card-view-overlay-presentation :is\([\s\S]*?\.mobile-cam-picker__trigger,[\s\S]*?\.card-view-live-badge,[\s\S]*?\) \{[\s\S]*?backdrop-filter:none;[\s\S]*?-webkit-backdrop-filter:none;/,
  );
});

test("Card View toolbar exposes shared Grid and Slideshow mode states", () => {
  const markup = buildCardViewToolbarMarkup({
    icons: {
      alerts: "alerts",
      grid: "grid",
      presentationPlay: "slideshow",
      ptz: "ptz",
    },
    showPtz: true,
    ptzDisabled: true,
    gridAvailable: true,
    gridActive: true,
    slideshowAvailable: true,
    slideshowDisabled: true,
    alertTakeoverDisabled: true,
  });

  assert.match(markup, /class="icon-btn active" id="grid-btn"/);
  assert.doesNotMatch(markup, /id="grid-btn"[^>]* disabled/);
  assert.match(markup, /id="slideshow-btn"[^>]* disabled/);
  assert.match(markup, /data-card-view-takeover[^>]* disabled/);
  assert.match(markup, /data-card-view-ptz[^>]* disabled/);

  const standaloneMarkup = buildCardViewToolbarMarkup({
    showMicrophone: true,
    microphoneMarkup: "duplicate-talk-control",
    linkedLightRightMarkup: "duplicate-light-control",
    showCenterControls: false,
  });
  assert.doesNotMatch(standaloneMarkup, /duplicate-talk-control/);
  assert.doesNotMatch(standaloneMarkup, /duplicate-light-control/);
});

test("Card View shares the Mobile View camera picker and uses a two-state drawer", () => {
  assert.match(CAMERA_PICKER_STYLES, /\.card\.mobile-view-active/);
  assert.match(CAMERA_PICKER_STYLES, /\.card\.card-view-active/);
  assert.match(CAMERA_PICKER_STYLES, /background:rgba\(255,255,255,\.2\)/);
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-calendar-panel[\s\S]*top:auto;[^}]*bottom:calc\(100% \+ 7px\)/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-drawer\.is-open \+ \.card-view-footer \.card-view-drawer-handle svg \{transform:rotate\(180deg\);\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-drawer\.is-closed \+ \.card-view-footer \.card-view-drawer-handle svg \{transform:rotate\(0deg\);\}/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-drawer\.is-closed[\s\S]*grid-template-rows:minmax\(0,0fr\)/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card\.card-view-active[\s\S]*overflow:hidden !important/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /@container card-view-activity \(max-width:440px\)[\s\S]*grid-template-areas:"start start start" "\. center actions"/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /@container card-view-activity \(max-width:400px\)[\s\S]*grid-template-areas:"start start start" "\. center \." "actions actions actions";/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-footer \{[^}]*align-items:center;[^}]*height:var\(--fvc-footer-height\);[^}]*min-height:var\(--fvc-footer-height\)/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /grid-template-columns:auto minmax\(44px,1fr\) auto minmax\(44px,1fr\) auto/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-drawer-handle \{[^}]*width:min\(100%,80px\);[^}]*min-width:44px/,
  );
});

test("Video Only Grid labels the camera picker Grid", () => {
  const host = {
    _pageId: "card-view",
    _viewMode: "grid",
    _activeCamIdx: 0,
    _activeCam: { entity: "camera.doorbell", name: "Doorbell" },
    _activeStreamType: "grid",
    _config: {
      card_view_standalone: true,
      card_view_view_mode: CARD_VIEW_VIEW_MODES.videoOnly,
      cameras: [
        { entity: "camera.doorbell", name: "Doorbell" },
        { entity: "camera.driveway", name: "Driveway" },
      ],
    },
    _hass: {
      states: {
        "camera.doorbell": { state: "streaming" },
        "camera.driveway": { state: "streaming" },
      },
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  const markup = controller.camSwitcherMarkup();

  assert.match(markup, /mobile-cam-picker__label">Grid</);
  assert.match(markup, /data-mobile-camidx="0"/);
  assert.match(markup, /data-mobile-camidx="1"/);
  assert.doesNotMatch(markup, /mobile-cam-picker__status/);
});

test("Video Only camera picker panel stays within the live stage", () => {
  const panel = { style: {} };
  const host = {
    _pageId: "card-view",
    _config: {
      card_view_standalone: true,
      card_view_view_mode: CARD_VIEW_VIEW_MODES.videoOnly,
    },
    shadowRoot: {
      querySelector: (selector) =>
        selector === ".card-view-camera-row .mobile-cam-picker__panel"
          ? panel
          : null,
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  controller._standaloneStageHeight = 280;

  controller.syncStandalonePickerPanelSize();

  assert.equal(panel.style.maxHeight, "224px");
});

test("Card View drawer swipes settle fully open or closed", () => {
  assert.equal(
    resolveCardViewDrawerSwipe({ deltaX: 2, deltaY: -40 }),
    true,
  );
  assert.equal(
    resolveCardViewDrawerSwipe({ deltaX: 2, deltaY: 40 }),
    false,
  );
  assert.equal(
    resolveCardViewDrawerSwipe({ deltaX: 40, deltaY: 10 }),
    null,
  );
  assert.equal(
    resolveCardViewDrawerSwipe({ deltaX: 0, deltaY: 20 }),
    null,
  );
});

test("Card View drawer follows its configured starting state and toggles without rerendering", () => {
  const classes = new Set(["is-open"]);
  const attributes = new Map();
  const drawer = {
    dataset: {},
    classList: {
      toggle: (name, enabled) => {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const handles = [new Map(), new Map()].map((values) => ({
    setAttribute: (name, value) => values.set(name, value),
    values,
  }));
  const shadowRoot = {
    querySelector: (selector) =>
      selector === "[data-card-view-drawer]" ? drawer : null,
    querySelectorAll: (selector) =>
      selector === "[data-card-view-drawer-toggle]" ? handles : [],
  };
  const controller = new CardViewPageController(
    {
      _pageId: "card-view",
      _config: {
        card_view_view_mode: CARD_VIEW_VIEW_MODES.bottomPanelClosed,
      },
      shadowRoot,
    },
    { PAGE_IDS: { cardView: "card-view" } },
  );
  controller.syncDrawerState();
  assert.equal(classes.has("is-closed"), true);
  assert.equal(classes.has("is-open"), false);
  assert.equal(drawer.dataset.drawerState, "closed");
  assert.equal(attributes.get("aria-hidden"), "true");
  assert.equal(handles[0].values.get("aria-expanded"), "false");

  assert.equal(controller.toggleDrawer(), true);
  assert.equal(classes.has("is-open"), true);
  assert.equal(attributes.get("aria-hidden"), "false");
  assert.equal(handles[1].values.get("aria-expanded"), "true");
});

test("Card View footer calendar follows the open Alerts and Recordings drawer", () => {
  const classes = new Set();
  const attributes = new Map();
  const calendar = {
    hidden: true,
    disabled: false,
    classList: {
      toggle: (name, enabled) => {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const host = {
    _pageId: "card-view",
    shadowRoot: {
      querySelector: (selector) =>
        selector === "[data-card-view-calendar]" ? calendar : null,
    },
    _toolbarButtonStates: () => ({}),
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });

  controller._mode = "alerts";
  controller.syncFooterControls();
  assert.equal(calendar.hidden, false);

  controller._mode = "recordings";
  controller._calendarOpen = true;
  controller.syncFooterControls();
  assert.equal(calendar.hidden, false);
  assert.equal(classes.has("active"), true);
  assert.equal(attributes.get("aria-pressed"), "true");

  controller.renderCalendar = () => {};
  controller._drawerOpen = false;
  controller._mode = "alerts";
  controller.syncFooterControls();
  assert.equal(calendar.hidden, true);
  assert.equal(controller._calendarOpen, false);

  controller._drawerOpen = true;
  controller._mode = "ptz";
  controller.syncFooterControls();
  assert.equal(calendar.hidden, true);
  assert.equal(controller._calendarOpen, false);
});

test("Card View calendar passes the timezone-aware current day to shared markup", () => {
  const panel = { hidden: true, innerHTML: "" };
  const host = {
    _pageShellRegion: (regionKey) =>
      regionKey === "calendarPanel" ? panel : null,
    _tzParts: () => ({ year: 2026, month: 9, day: 2 }),
    _tz: () => "America/Chicago",
    _calendarMonthLabel: () => "September 2026",
    _daysWithActivity: new Set(),
  };
  const controller = new CardViewPageController(host, {
    buildCalendarPanelMarkup: (state) => JSON.stringify(state),
  });
  controller._calendarOpen = true;
  controller._calendarMonth = new Date(Date.UTC(2026, 8, 15, 12, 0, 0));

  controller.renderCalendar();

  const state = JSON.parse(panel.innerHTML);
  assert.equal(panel.hidden, false);
  assert.equal(state.todayDateString, "2026-09-02");
  assert.equal(state.activeDayDateString, "");
});

test("Card View alert takeover yields to active shared modes", () => {
  let toolbarSyncs = 0;
  const host = {
    _pageId: "card-view",
    _config: { card_view_alert_takeover: true },
    _toolbarButtonStates: () => ({ wideAlertTakeoverDisabled: true }),
    _syncToolbarButtons: () => {
      toolbarSyncs += 1;
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });

  assert.equal(controller._yieldAlertTakeoverToActiveMode(), true);
  assert.equal(controller.alertTakeoverEnabled(), false);
  assert.equal(controller.toggleAlertTakeover(), false);
  assert.equal(toolbarSyncs, 1);
});

test("Video Only Card View applies its configured starting mode", () => {
  const modeChanges = [];
  const host = {
    _pageId: "card-view",
    _viewMode: "single",
    _slideshowActive: false,
    _config: {
      card_view_page_enabled: true,
      card_view_standalone: true,
      card_view_view_mode: CARD_VIEW_VIEW_MODES.videoOnly,
      card_view_alert_takeover: true,
      card_view_start_mode: CARD_VIEW_START_MODES.grid,
    },
    _isGridModeAvailable: () => true,
    _isSlideshowRotationAvailable: () => true,
    _setViewMode: (mode) => {
      modeChanges.push(mode);
      host._viewMode = mode;
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });

  assert.equal(controller.applyConfiguredStartMode(), true);
  assert.deepEqual(modeChanges, ["grid"]);
  assert.equal(controller.alertTakeoverEnabled(), false);

  host._config.card_view_start_mode = CARD_VIEW_START_MODES.slideshow;
  host._viewMode = "grid";
  let slideshowStarts = 0;
  host._startSlideshowRotation = () => {
    slideshowStarts += 1;
    host._slideshowActive = true;
  };
  controller.applyConfiguredStartMode({ force: true });
  assert.deepEqual(modeChanges, ["grid", "single"]);
  assert.equal(slideshowStarts, 1);

  host._config.card_view_start_mode = CARD_VIEW_START_MODES.grid;
  host._viewMode = "single";
  host._slideshowActive = true;
  let slideshowStops = 0;
  host._stopSlideshowRotation = () => {
    slideshowStops += 1;
    host._slideshowActive = false;
  };
  controller.applyConfiguredStartMode({ force: true });
  assert.equal(slideshowStops, 1);
  assert.deepEqual(modeChanges, ["grid", "single", "grid"]);
});

test("standalone Card View mode buttons use the existing Grid and Slideshow controllers", () => {
  let gridToggles = 0;
  let slideshowToggles = 0;
  let slideshowStops = 0;
  const viewModeChanges = [];
  let prevented = 0;
  const host = {
    _pageId: "card-view",
    _viewMode: "single",
    _slideshowActive: true,
    _config: {
      card_view_standalone: true,
      card_view_alert_takeover: true,
    },
    _stopSlideshowRotation: () => {
      slideshowStops += 1;
      host._slideshowActive = false;
    },
    _toggleGridMode: () => {
      gridToggles += 1;
    },
    _setViewMode: (mode) => {
      viewModeChanges.push(mode);
      host._viewMode = mode;
    },
    _toggleSlideshowRotation: () => {
      slideshowToggles += 1;
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  const event = {
    preventDefault: () => {
      prevented += 1;
    },
  };

  controller.handleClick(event, {
    closest: (selector) =>
      selector === "[data-card-view-standalone-grid]"
        ? { disabled: false }
        : null,
  });
  host._viewMode = "grid";
  controller.handleClick(event, {
    closest: (selector) =>
      selector === "[data-card-view-standalone-slideshow]"
        ? { disabled: false }
        : null,
  });

  assert.equal(gridToggles, 1);
  assert.equal(slideshowStops, 1);
  assert.equal(slideshowToggles, 1);
  assert.deepEqual(viewModeChanges, ["single"]);
  assert.equal(controller.alertTakeoverEnabled(), false);
  assert.equal(prevented, 2);
});

test("non-standalone Video Only back prefers Preview and falls back to Single View", () => {
  const navigations = [];
  const host = {
    _pageId: "card-view",
    _config: {
      card_view_standalone: false,
      card_view_view_mode: CARD_VIEW_VIEW_MODES.videoOnly,
      preview_page_enabled: true,
    },
    _pageNavigationController: {
      isPageRouteAvailable: (pageId) => pageId === "preview",
      navigateToPageRoute: (...args) => navigations.push(args),
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: {
      cardView: "card-view",
      preview: "preview",
      singleView: "single-view",
    },
  });
  const target = {
    closest: (selector) =>
      selector === "[data-card-view-video-back]" ? {} : null,
  };

  assert.equal(controller.handleClick(null, target), true);
  assert.deepEqual(navigations, [
    ["preview", { source: "card-view-video-back" }],
  ]);

  host._config.preview_page_enabled = false;
  assert.equal(controller.handleClick(null, target), true);
  assert.deepEqual(navigations.at(-1), [
    "single-view",
    { source: "card-view-video-back" },
  ]);

  host._config.card_view_standalone = true;
  assert.equal(controller.handleClick(null, target), true);
  assert.equal(navigations.length, 2);
});

test("standalone presentation-only config changes do not reload activity data", () => {
  const host = {
    _pageId: "card-view",
    _config: { card_view_standalone: true },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  let refreshes = 0;
  controller.syncCardViewPageMarkup = () => {};
  controller.renderCamSwitcher = () => {};
  controller.renderToolbar = () => {};
  controller.refreshActiveContent = async () => {
    refreshes += 1;
  };

  controller.applyConfigUpdate({
    viewModeChanged: true,
    hideCameraNameChanged: true,
  });

  assert.equal(refreshes, 0);
});

test("switching non-standalone Card View to Video Only applies its overlay and configured Grid start", () => {
  const modeChanges = [];
  let overlayRebinds = 0;
  const host = {
    _pageId: "card-view",
    _viewMode: "single",
    _slideshowActive: false,
    _config: {
      card_view_standalone: false,
      card_view_start_mode: CARD_VIEW_START_MODES.grid,
      card_view_view_mode: CARD_VIEW_VIEW_MODES.videoOnly,
    },
    _isGridModeAvailable: () => true,
    _isSlideshowRotationAvailable: () => false,
    _setViewMode: (mode) => {
      modeChanges.push(mode);
      host._viewMode = mode;
    },
    _initLiveOverlayControls: () => {
      overlayRebinds += 1;
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  controller.syncCardViewPageMarkup = () => {};
  controller.renderCamSwitcher = () => {};
  controller.renderToolbar = () => {};

  controller.applyConfigUpdate({ viewModeChanged: true });
  assert.deepEqual(modeChanges, ["grid"]);
  assert.equal(overlayRebinds, 1);

  host._config.card_view_view_mode = CARD_VIEW_VIEW_MODES.bottomPanelOpen;
  host._viewMode = "single";
  controller.applyConfigUpdate({ viewModeChanged: true });
  assert.deepEqual(modeChanges, ["grid"]);
  assert.equal(overlayRebinds, 2);
});

test("Card View alert tiles retain media actions but omit favorite actions", () => {
  const content = { innerHTML: "" };
  let reviewOptions = null;
  const host = {
    _pageId: "card-view",
    _pageShellRegion: (region) =>
      region === "cardViewActivity" ? content : null,
    _reviewListItemHTML: (_review, options) => {
      reviewOptions = options;
      return '<div class="list-item">alert</div>';
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  controller._alerts = [{ id: "review-1" }];
  controller._bindScroller = () => {};

  controller.renderActivity();

  assert.deepEqual(reviewOptions, {
    cameraAware: true,
    showDownloadButtons: true,
    showFavoriteButton: false,
  });
});

test("Card View preserves alert tile DOM when repeated entry renders are identical", () => {
  let writes = 0;
  let markup = "";
  const content = {};
  Object.defineProperty(content, "innerHTML", {
    get: () => markup,
    set: (value) => {
      writes += 1;
      markup = value;
    },
  });
  const host = {
    _pageId: "card-view",
    _pageShellRegion: (region) =>
      region === "cardViewActivity" ? content : null,
    _reviewListItemHTML: () => '<div class="list-item">alert</div>',
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  controller._alerts = [{ id: "review-1" }];
  controller._bindScroller = () => {};

  controller.renderActivity();
  controller.renderActivity();

  assert.equal(writes, 1);
});

test("Card View preserves toolbar DOM when repeated renders are identical", () => {
  let writes = 0;
  let markup = "";
  const toolbar = {};
  Object.defineProperty(toolbar, "innerHTML", {
    get: () => markup,
    set: (value) => {
      writes += 1;
      markup = value;
    },
  });
  const host = {
    _pageId: "card-view",
    _config: {},
    _activeCam: { name: "Doorbell", entity: "camera.doorbell" },
    _viewMode: "single",
    _toolbarButtonStates: () => ({}),
    _isGridModeAvailable: () => false,
    _isSlideshowRotationAvailable: () => false,
    _shouldRenderTwoWayTalkButtonForActiveCamera: () => false,
    shadowRoot: {
      querySelector: (selector) =>
        selector === "[data-card-view-toolbar]" ? toolbar : null,
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });

  controller.renderToolbar();
  controller.renderToolbar();

  assert.equal(writes, 1);
});

test("Card View coalesces initial scroller measurement until after paint", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const callbacks = [];
  const scroller = {
    addEventListener() {},
    removeEventListener() {},
  };
  const host = {
    _pageId: "card-view",
    shadowRoot: {
      querySelector: (selector) =>
        selector === "[data-card-view-scroller]" ? scroller : null,
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  let syncs = 0;
  controller.syncScrollControls = () => {
    syncs += 1;
  };
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  try {
    controller._bindScroller();
    controller._bindScroller();

    assert.equal(callbacks.length, 1);
    callbacks.shift()();
    assert.equal(syncs, 0);
    assert.equal(callbacks.length, 1);
    callbacks.shift()();
    assert.equal(syncs, 1);
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

test("Card View switches alert scope between all and the active camera", () => {
  const reviews = [
    { id: "front", camera: "front", start_time: 2 },
    { id: "back", camera: "back", start_time: 1 },
  ];
  const host = {
    _pageId: "card-view",
    _activeCam: { entity: "camera.front" },
    _allGridReviews: () => reviews,
    _cameraEntityForIncomingCamera: (camera) => `camera.${camera}`,
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  controller.renderToolbar = () => {};
  controller.renderActivity = () => {};

  controller._syncAlertsFromCache();
  assert.deepEqual(controller._alerts.map(({ id }) => id), ["front", "back"]);

  assert.equal(controller.toggleAlertScope(), false);
  assert.deepEqual(controller._alerts.map(({ id }) => id), ["front"]);

  assert.equal(controller.toggleAlertScope(), true);
  assert.deepEqual(controller._alerts.map(({ id }) => id), ["front", "back"]);
});

test("Card View recordings use a flat responsive carousel", () => {
  const content = { innerHTML: "", dataset: {} };
  const host = {
    _pageId: "card-view",
    _pageShellRegion: (region) =>
      region === "cardViewActivity" ? content : null,
    _dateTimeLabel: () => "Today",
    _time: () => "1:00 pm",
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  controller._mode = "recordings";
  controller._recordings = [
    { start_time: 100, end_time: 160 },
    { start_time: 200, end_time: 260 },
  ];
  controller._bindScroller = () => {};

  controller.renderActivity();

  assert.match(content.innerHTML, /card-view-scroller--recordings/);
  assert.equal(
    content.innerHTML.match(/card-view-recording-slot/g)?.length,
    2,
  );
  assert.doesNotMatch(content.innerHTML, /card-view-page/);
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /data-card-view-columns="3"[^}]*flex-basis:33\.333333%/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-recording-tile \{[^}]*width:100%;[^}]*flex:1 1 auto/,
  );
  assert.match(
    CARD_VIEW_PAGE_STYLES,
    /card-view-recording-slot \{[^}]*scroll-snap-stop:normal/,
  );
});

test("Card View recording breakpoints update sizing without repainting tiles", () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  let resizeCallback = null;
  let width = 500;
  const content = {
    dataset: {},
    clientWidth: width,
    getBoundingClientRect: () => ({ width }),
  };
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resizeCallback = callback;
    }
    observe() {}
    disconnect() {}
  };
  try {
    const host = {
      _pageId: "card-view",
      _pageShellRegion: (region) =>
        region === "cardViewActivity" ? content : null,
      ownerDocument: { addEventListener() {}, removeEventListener() {} },
    };
    const controller = new CardViewPageController(host, {
      PAGE_IDS: { cardView: "card-view" },
    });
    controller._mode = "recordings";
    controller._bindScroller = () => {};
    controller.syncScrollControls = () => {};
    let renders = 0;
    controller.renderActivity = () => {
      renders += 1;
    };

    controller.bind();
    assert.equal(content.dataset.cardViewColumns, "2");
    assert.equal(renders, 0);

    width = 900;
    resizeCallback();
    assert.equal(content.dataset.cardViewColumns, "3");
    assert.equal(renders, 0);
  } finally {
    globalThis.ResizeObserver = originalResizeObserver;
  }
});

test("Card View shows a loading state before its first recordings request", () => {
  const host = {
    _pageId: "card-view",
    _pageShellRegion: () => ({ clientWidth: 500 }),
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  controller.renderToolbar = () => {};
  let loadingAtRender = false;
  controller.renderActivity = () => {
    loadingAtRender = controller._recordingsLoading;
  };
  let recordingLoads = 0;
  controller.loadRecordings = async () => {
    recordingLoads += 1;
  };

  controller.toggleMode();

  assert.equal(controller._mode, "recordings");
  assert.equal(loadingAtRender, true);
  assert.equal(recordingLoads, 1);
});

test("Card View re-entry refreshes the mode that remains visible", async () => {
  const host = {
    _pageId: "card-view",
    _allGridReviews: () => [],
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  controller._mode = "recordings";
  controller._returnMode = "recordings";
  controller.renderToolbar = () => {};
  controller.renderActivity = () => {};
  let alertLoads = 0;
  let recordingLoads = 0;
  controller.loadAlerts = async () => {
    alertLoads += 1;
  };
  controller.loadRecordings = async () => {
    recordingLoads += 1;
  };

  await controller.start();

  assert.equal(recordingLoads, 1);
  assert.equal(alertLoads, 0);
});

test("Card View resolves alert columns before bind returns", () => {
  const content = {
    clientWidth: 900,
    getBoundingClientRect: () => ({ width: 900 }),
  };
  const host = {
    _pageId: "card-view",
    _pageShellRegion: (region) =>
      region === "cardViewActivity" ? content : null,
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  let activityRenders = 0;
  controller.renderActivity = () => {
    activityRenders += 1;
  };
  controller._bindScroller = () => {};

  controller.bind();

  assert.equal(controller._columns, 2);
  assert.equal(activityRenders, 1);
});

test("Card View progressively paints only the first non-empty alert batch", async () => {
  let cachedReviews = [];
  let activityRenders = 0;
  const progressRenderCounts = [];
  const host = {
    _pageId: "card-view",
    _config: { window_days: 3 },
    _allGridReviews: () => cachedReviews,
    _loadGridMixedTabData: async (_tab, { onProgress }) => {
      for (let index = 1; index <= 3; index += 1) {
        cachedReviews = [
          ...cachedReviews,
          { id: `review-${index}`, start_time: index },
        ];
        onProgress();
        progressRenderCounts.push(activityRenders);
      }
    },
    _browseWindowLoaderController: {
      warmOtherCamerasEvents: async () => {},
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  controller.renderActivity = () => {
    activityRenders += 1;
  };

  await controller.loadAlerts({ force: true });

  assert.deepEqual(progressRenderCounts, [2, 2, 2]);
  assert.equal(controller._alerts.length, 3);
});

test("Card View maps realtime Frigate camera names before alert takeover", () => {
  let switchedTo = -1;
  let refreshes = 0;
  const host = {
    _pageId: "card-view",
    _activeCamIdx: 0,
    _config: { card_view_alert_takeover: true },
    _extractRealtimeMessageCamera: () => "front_door",
    _cameraEntityForIncomingCamera: (camera) =>
      camera === "front_door" ? "camera.front_door" : "",
    _extractRealtimeMessageSeverity: () => "alert",
    _shouldHandleSlideshowReview: () => true,
    _cameraIndexByEntity: (entity) =>
      entity === "camera.front_door" ? 2 : -1,
    _switchCamera: (index) => {
      switchedTo = index;
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  controller._scheduleAlertRefresh = () => {
    refreshes += 1;
  };

  controller.handleRealtimeMessage({ type: "review", camera: "front_door" });

  assert.equal(refreshes, 1);
  assert.equal(switchedTo, 2);
});

test("Card View opens media in the standard full-width popup", async () => {
  const calls = [];
  const event = { id: "event-1", camera: "front" };
  const host = {
    _pageId: "card-view",
    _popupMediaLoaderController: {
      showClip: (...args) => calls.push(["clip", ...args]),
      showCarouselEventById: (...args) => calls.push(["carousel", ...args]),
      showRecording: (...args) => calls.push(["recording", ...args]),
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });
  controller._ensureReviewEvent = async () => event;

  await controller._openReview({ camera: "front" }, event.id);
  controller.handleClick(
    { stopPropagation: () => {} },
    {
      closest: (selector) =>
        selector === "[data-popup-media-target]"
          ? {
              dataset: {
                popupEventId: event.id,
                popupMediaTarget: "snapshot",
              },
            }
          : null,
    },
  );
  controller.handleClick(null, {
    closest: (selector) =>
      selector === "[data-rs]"
        ? { dataset: { rs: "100", re: "200" } }
        : null,
  });

  assert.deepEqual(calls, [
    ["clip", event, { mediaType: "alert" }],
    ["carousel", event.id, "snapshot"],
    ["recording", 100, 200],
  ]);
});

test("standalone media drawer opens the focused Card View popup", () => {
  const calls = [];
  const host = {
    _pageId: "card-view",
    _config: {
      card_view_standalone: true,
      card_view_media_drawer_enabled: true,
    },
    _pauseSlideshowForInteraction: () => calls.push(["pause"]),
    _popupMediaLoaderController: {
      showCarouselEventById: (...args) => calls.push(["popup", ...args]),
    },
  };
  const controller = new CardViewPageController(host, {
    PAGE_IDS: { cardView: "card-view" },
  });

  controller._mediaDrawerController._onSelectEvent("event-1", "clip");

  assert.deepEqual(calls, [
    ["pause"],
    [
      "popup",
      "event-1",
      "clip",
      { presentation: "card-view-drawer" },
    ],
  ]);
});
