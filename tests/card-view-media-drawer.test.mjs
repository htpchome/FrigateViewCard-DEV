import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCardViewMediaDrawerItemMarkup,
  buildCardViewMediaDrawerRecordingMarkup,
  buildCardViewMediaDrawerScrollPlan,
  CardViewMediaDrawerController,
  resolveCardViewMediaDrawerNavigationState,
  resolveCardViewMediaDrawerPopupType,
} from "../src/features/card-view/media-drawer.ctrl.js";
import {
  CARD_VIEW_MEDIA_DRAWER_TYPES,
  normalizeCardViewMediaDrawerType,
  resolveCardViewMediaDrawerTypes,
} from "../src/features/card-view/config.js";

const createClassList = () => {
  const classes = new Set();
  return {
    classes,
    toggle: (name, enabled) => {
      if (enabled) classes.add(name);
      else classes.delete(name);
    },
  };
};

const createElement = () => {
  const attributes = new Map();
  const properties = new Map();
  return {
    attributes,
    classList: createClassList(),
    hidden: false,
    style: {
      setProperty: (name, value) => properties.set(name, String(value)),
    },
    styleProperties: properties,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    addEventListener() {},
    removeEventListener() {},
  };
};

test("Card View media drawer normalizes choices to existing popup media types", () => {
  assert.equal(normalizeCardViewMediaDrawerType("snapshot"), "snapshots");
  assert.equal(normalizeCardViewMediaDrawerType("CLIP"), "clips");
  assert.equal(normalizeCardViewMediaDrawerType("unknown"), "alerts");
  assert.equal(resolveCardViewMediaDrawerPopupType("alerts"), "alert");
  assert.equal(resolveCardViewMediaDrawerPopupType("clips"), "clip");
  assert.equal(resolveCardViewMediaDrawerPopupType("snapshots"), "snapshot");
  assert.equal(normalizeCardViewMediaDrawerType("recording"), "recordings");
  assert.equal(resolveCardViewMediaDrawerPopupType("recordings"), "recording");
  assert.equal(normalizeCardViewMediaDrawerType("favorites"), "kept");
  assert.equal(resolveCardViewMediaDrawerPopupType("kept"), "kept");
});

test("Card View media drawer choices follow the configured active tabs", () => {
  assert.deepEqual(resolveCardViewMediaDrawerTypes([]), [
    "alerts",
    "clips",
    "snapshots",
    "recordings",
    "kept",
  ]);
  assert.deepEqual(
    resolveCardViewMediaDrawerTypes(["alerts", "snapshot", "kept"]),
    ["clips", "recordings"],
  );
});

test("Card View media drawer recording markup identifies a popup range", () => {
  const markup = buildCardViewMediaDrawerRecordingMarkup({
    recording: {
      start_time: 100,
      end_time: 160,
      _fvc_camera_entity: 'camera.front_"door',
    },
    title: "Today at 12:00",
    label: "Recording A",
    time: "12:00",
    placeholderIcon: "recording-icon",
  });

  assert.match(markup, /data-card-view-media-recording-start="100"/);
  assert.match(markup, /data-card-view-media-recording-end="160"/);
  assert.match(
    markup,
    /data-card-view-media-recording-entity="camera.front_&quot;door"/,
  );
  assert.match(markup, /Recording A/);
  assert.match(markup, /recording-icon/);
  assert.doesNotMatch(markup, /<img/);
});

test("Card View media drawer item markup escapes event content", () => {
  const markup = buildCardViewMediaDrawerItemMarkup({
    event: { id: 'event-"1' },
    mediaType: CARD_VIEW_MEDIA_DRAWER_TYPES.snapshots,
    thumbnailUrl: '/thumb?value="unsafe"',
    title: 'Door "alert"',
    label: "Person <visitor>",
    time: "12:00",
    placeholderIcon: "icon",
  });

  assert.match(markup, /data-card-view-media-event="event-&quot;1"/);
  assert.match(markup, /data-card-view-media-type="snapshot"/);
  assert.match(markup, /Person &lt;visitor&gt;/);
  assert.doesNotMatch(markup, /Person <visitor>/);
});

test("Card View media drawer uses vertical page navigation", () => {
  assert.deepEqual(
    resolveCardViewMediaDrawerNavigationState({
      scrollTop: 0,
      scrollHeight: 500,
      clientHeight: 200,
    }),
    { canScrollUp: false, canScrollDown: true },
  );
  assert.deepEqual(
    resolveCardViewMediaDrawerNavigationState({
      scrollTop: 300,
      scrollHeight: 500,
      clientHeight: 200,
    }),
    { canScrollUp: true, canScrollDown: false },
  );
  assert.deepEqual(
    buildCardViewMediaDrawerScrollPlan({
      itemHeight: 94,
      viewportHeight: 205,
      direction: -1,
    }),
    { top: -200, behavior: "smooth" },
  );
});

test("closed Card View media drawer hides navigation without layout reads", () => {
  const root = createElement();
  const panel = createElement();
  const handle = createElement();
  const tabs = { ...createElement(), querySelectorAll: () => [] };
  const up = createElement();
  const down = createElement();
  const scroller = {
    ...createElement(),
    get scrollTop() {
      throw new Error("closed drawer read scrollTop");
    },
    get scrollHeight() {
      throw new Error("closed drawer read scrollHeight");
    },
    get clientHeight() {
      throw new Error("closed drawer read clientHeight");
    },
  };
  const elements = new Map([
    ["[data-card-view-media-drawer]", root],
    ["[data-card-view-media-drawer-panel]", panel],
    ["[data-card-view-media-drawer-toggle]", handle],
    ["[data-card-view-media-drawer-tabs]", tabs],
    ["[data-card-view-media-drawer-scroller]", scroller],
    ['[data-card-view-media-drawer-scroll="-1"]', up],
    ['[data-card-view-media-drawer-scroll="1"]', down],
  ]);
  const controller = new CardViewMediaDrawerController({
    query: (selector) => elements.get(selector) || null,
    isEnabled: () => true,
    resizeObserverCtor: null,
  });

  assert.doesNotThrow(() => controller.bind());
  assert.equal(up.hidden, true);
  assert.equal(down.hidden, true);
});

test("resetting Card View media drawer content does not write scroll position", () => {
  const root = createElement();
  const up = createElement();
  const down = createElement();
  const scroller = {
    ...createElement(),
    firstChild: {},
    replaceChildren() {
      this.firstChild = null;
    },
    set scrollTop(_) {
      throw new Error("drawer reset wrote scrollTop");
    },
  };
  const elements = new Map([
    ["[data-card-view-media-drawer]", root],
    ["[data-card-view-media-drawer-scroller]", scroller],
    ['[data-card-view-media-drawer-scroll="-1"]', up],
    ['[data-card-view-media-drawer-scroll="1"]', down],
  ]);
  const controller = new CardViewMediaDrawerController({
    query: (selector) => elements.get(selector) || null,
    isEnabled: () => false,
    resizeObserverCtor: null,
  });

  assert.doesNotThrow(() => controller.bind());
  assert.equal(scroller.firstChild, null);
});

test("Card View media drawer defers thumbnails until opened and reuses popup selection", () => {
  const root = createElement();
  const panel = createElement();
  const handle = createElement();
  const typeTabs = [
    CARD_VIEW_MEDIA_DRAWER_TYPES.alerts,
    CARD_VIEW_MEDIA_DRAWER_TYPES.clips,
    CARD_VIEW_MEDIA_DRAWER_TYPES.snapshots,
    CARD_VIEW_MEDIA_DRAWER_TYPES.recordings,
    CARD_VIEW_MEDIA_DRAWER_TYPES.favorites,
  ].map((mediaType) => ({
    ...createElement(),
    dataset: { cardViewMediaDrawerType: mediaType },
    tabIndex: 0,
  }));
  const tabs = {
    ...createElement(),
    querySelectorAll: () => typeTabs,
  };
  const up = createElement();
  const down = createElement();
  const scrollCalls = [];
  const scroller = {
    ...createElement(),
    _innerHTML: "",
    scrollTop: 0,
    scrollHeight: 420,
    clientHeight: 200,
    set innerHTML(value) {
      this._innerHTML = value;
    },
    get innerHTML() {
      return this._innerHTML;
    },
    querySelector: (selector) =>
      selector === ".card-view-media-drawer-item"
        ? { getBoundingClientRect: () => ({ height: 94 }) }
        : null,
    querySelectorAll: () => [],
    scrollBy: (options) => scrollCalls.push(options),
  };
  const elements = new Map([
    ["[data-card-view-media-drawer]", root],
    ["[data-card-view-media-drawer-panel]", panel],
    ["[data-card-view-media-drawer-toggle]", handle],
    ["[data-card-view-media-drawer-tabs]", tabs],
    ["[data-card-view-media-drawer-scroller]", scroller],
    ['[data-card-view-media-drawer-scroll="-1"]', up],
    ['[data-card-view-media-drawer-scroll="1"]', down],
  ]);
  let enabled = true;
  let configuredType = CARD_VIEW_MEDIA_DRAWER_TYPES.snapshots;
  let eventReads = 0;
  const eventTypes = [];
  const selections = [];
  const controller = new CardViewMediaDrawerController({
    query: (selector) => elements.get(selector) || null,
    isEnabled: () => enabled,
    getConfiguredType: () => configuredType,
    getEvents: (mediaType) => {
      eventReads += 1;
      eventTypes.push(mediaType);
      return [
        {
          id: "event-1",
          camera: "front_door",
          label: "person",
          start_time: 100,
        },
      ];
    },
    mediaUrl: (id, file, camera) => `/${camera}/${id}/${file}`,
    formatDateTime: () => "Full date",
    formatTime: () => "12:00",
    onSelectEvent: (...args) => selections.push(args),
    icons: { person: "person-icon" },
    resizeObserverCtor: null,
    requestFrame: (callback) => callback(),
  });

  controller.bind();

  assert.equal(eventReads, 0);
  assert.equal(root.hidden, false);
  assert.equal(controller.isOpen(), false);
  assert.equal(tabs.hidden, false);
  assert.equal(tabs.attributes.get("aria-hidden"), "true");
  assert.equal(scroller.innerHTML, "");

  const interactionEvent = {
    preventDefault() {},
    stopPropagation() {},
  };
  controller.handleClick(interactionEvent, {
    closest: (selector) =>
      selector === "[data-card-view-media-drawer-toggle]" ? handle : null,
  });

  assert.equal(eventReads, 1);
  assert.equal(controller.isOpen(), true);
  assert.equal(root.classList.classes.has("is-open"), true);
  assert.equal(handle.attributes.get("aria-expanded"), "true");
  assert.equal(tabs.hidden, false);
  assert.equal(tabs.attributes.get("aria-hidden"), "false");
  assert.deepEqual(
    typeTabs.map((tab) => tab.attributes.get("aria-selected")),
    ["false", "false", "true", "false", "false"],
  );
  assert.match(scroller.innerHTML, /data-card-view-media-event="event-1"/);
  assert.match(scroller.innerHTML, /src="\/front_door\/event-1\/thumbnail.jpg"/);
  assert.equal(up.hidden, true);
  assert.equal(down.hidden, false);

  const item = {
    dataset: {
      cardViewMediaEvent: "event-1",
      cardViewMediaType: "snapshot",
    },
  };
  controller.handleClick(interactionEvent, {
    closest: (selector) =>
      selector === "[data-card-view-media-event]" ? item : null,
  });

  assert.deepEqual(selections, [["event-1", "snapshot"]]);
  assert.equal(controller.isOpen(), true);

  const clipsTab = typeTabs[1];
  controller.handleClick(interactionEvent, {
    closest: (selector) =>
      selector === "[data-card-view-media-drawer-type]" ? clipsTab : null,
  });
  assert.deepEqual(eventTypes, ["snapshot", "clip"]);
  assert.match(scroller.innerHTML, /data-card-view-media-type="clip"/);
  assert.deepEqual(
    typeTabs.map((tab) => tab.attributes.get("aria-selected")),
    ["false", "true", "false", "false", "false"],
  );

  controller.scroll(1);
  assert.deepEqual(scrollCalls, [{ top: 200, behavior: "smooth" }]);

  configuredType = CARD_VIEW_MEDIA_DRAWER_TYPES.alerts;
  controller.setOpen(false);
  assert.equal(tabs.attributes.get("aria-hidden"), "true");
  controller.render();
  assert.equal(scroller.innerHTML, "");
  assert.equal(eventReads, 2);

  enabled = false;
  controller.syncState();
  assert.equal(root.hidden, true);
  assert.equal(controller.isOpen(), false);
});

test("Card View media drawer hides inactive tabs and rejects their selection", () => {
  const root = createElement();
  const panel = createElement();
  const handle = createElement();
  const typeTabs = [
    CARD_VIEW_MEDIA_DRAWER_TYPES.alerts,
    CARD_VIEW_MEDIA_DRAWER_TYPES.clips,
    CARD_VIEW_MEDIA_DRAWER_TYPES.snapshots,
    CARD_VIEW_MEDIA_DRAWER_TYPES.recordings,
    CARD_VIEW_MEDIA_DRAWER_TYPES.favorites,
  ].map((mediaType) => ({
    ...createElement(),
    dataset: { cardViewMediaDrawerType: mediaType },
    tabIndex: 0,
  }));
  const tabs = {
    ...createElement(),
    querySelectorAll: () => typeTabs,
  };
  const scroller = {
    ...createElement(),
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    innerHTML: "",
    querySelectorAll: () => [],
  };
  const elements = new Map([
    ["[data-card-view-media-drawer]", root],
    ["[data-card-view-media-drawer-panel]", panel],
    ["[data-card-view-media-drawer-toggle]", handle],
    ["[data-card-view-media-drawer-tabs]", tabs],
    ["[data-card-view-media-drawer-scroller]", scroller],
  ]);
  const controller = new CardViewMediaDrawerController({
    query: (selector) => elements.get(selector) || null,
    isEnabled: () => true,
    getAvailableTypes: () => [
      CARD_VIEW_MEDIA_DRAWER_TYPES.clips,
      CARD_VIEW_MEDIA_DRAWER_TYPES.favorites,
    ],
    resizeObserverCtor: null,
    requestFrame: (callback) => callback(),
  });

  controller.bind();

  assert.equal(controller.selectedType(), CARD_VIEW_MEDIA_DRAWER_TYPES.clips);
  assert.equal(root.attributes.get("data-card-view-media-tab-count"), "2");
  assert.equal(
    tabs.styleProperties.get("--card-view-media-drawer-tab-count"),
    "2",
  );
  assert.deepEqual(
    typeTabs.map((tab) => tab.hidden),
    [true, false, true, true, false],
  );
  assert.equal(
    controller.selectType(CARD_VIEW_MEDIA_DRAWER_TYPES.alerts),
    false,
  );
  assert.equal(
    controller.selectType(CARD_VIEW_MEDIA_DRAWER_TYPES.favorites),
    true,
  );
});

test("Card View media drawer loads recordings and opens their existing popup path", () => {
  const root = createElement();
  const panel = createElement();
  const handle = createElement();
  const tabs = { ...createElement(), querySelectorAll: () => [] };
  const scroller = {
    ...createElement(),
    scrollTop: 0,
    scrollHeight: 100,
    clientHeight: 100,
    innerHTML: "",
    querySelectorAll: () => [],
  };
  const elements = new Map([
    ["[data-card-view-media-drawer]", root],
    ["[data-card-view-media-drawer-panel]", panel],
    ["[data-card-view-media-drawer-toggle]", handle],
    ["[data-card-view-media-drawer-tabs]", tabs],
    ["[data-card-view-media-drawer-scroller]", scroller],
  ]);
  const selectedTypes = [];
  const selectedRecordings = [];
  const controller = new CardViewMediaDrawerController({
    query: (selector) => elements.get(selector) || null,
    isEnabled: () => true,
    getRecordings: () => [
      {
        start_time: 100,
        end_time: 160,
        _fvc_camera_entity: "camera.front",
        _fvc_group_member: "A",
      },
    ],
    onSelectType: (mediaType) => selectedTypes.push(mediaType),
    onSelectRecording: (recording) => selectedRecordings.push(recording),
    formatDateTime: () => "Today at 12:00",
    formatTime: () => "12:00",
    icons: { recordings: "recording-icon" },
    resizeObserverCtor: null,
    requestFrame: (callback) => callback(),
  });

  controller.bind();
  controller.setOpen(true);
  controller.selectType(CARD_VIEW_MEDIA_DRAWER_TYPES.recordings);

  assert.deepEqual(selectedTypes, [CARD_VIEW_MEDIA_DRAWER_TYPES.recordings]);
  assert.match(scroller.innerHTML, /data-card-view-media-recording-start="100"/);
  assert.match(scroller.innerHTML, /Recording A/);

  const recording = {
    dataset: {
      cardViewMediaRecordingStart: "100",
      cardViewMediaRecordingEnd: "160",
      cardViewMediaRecordingEntity: "camera.front",
    },
  };
  controller.handleClick(
    { preventDefault() {}, stopPropagation() {} },
    {
      closest: (selector) =>
        selector === "[data-card-view-media-recording-start]"
          ? recording
          : null,
    },
  );

  assert.deepEqual(selectedRecordings, [
    {
      start_time: 100,
      end_time: 160,
      _fvc_camera_entity: "camera.front",
    },
  ]);
});

test("Card View media drawer action tabs mirror open state and disable filters for recordings", () => {
  const root = createElement();
  const panel = createElement();
  const handle = createElement();
  const actions = createElement();
  const calendar = createElement();
  const filter = createElement();
  const tabs = { ...createElement(), querySelectorAll: () => [] };
  const scroller = {
    ...createElement(),
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    innerHTML: "",
    querySelectorAll: () => [],
  };
  const elements = new Map([
    ["[data-card-view-media-drawer]", root],
    ["[data-card-view-media-drawer-panel]", panel],
    ["[data-card-view-media-drawer-toggle]", handle],
    ["[data-card-view-media-drawer-tabs]", tabs],
    ["[data-card-view-media-drawer-actions]", actions],
    ["[data-card-view-media-drawer-calendar]", calendar],
    ["[data-card-view-media-drawer-filter]", filter],
    ["[data-card-view-media-drawer-scroller]", scroller],
  ]);
  let calendarOpen = false;
  let filterOpen = false;
  const controller = new CardViewMediaDrawerController({
    query: (selector) => elements.get(selector) || null,
    isEnabled: () => true,
    onToggleCalendar: () => {
      calendarOpen = !calendarOpen;
    },
    onToggleFilter: () => {
      filterOpen = !filterOpen;
    },
    isCalendarOpen: () => calendarOpen,
    isFilterOpen: () => filterOpen,
    resizeObserverCtor: null,
    requestFrame: (callback) => callback(),
  });

  controller.bind();
  controller.setOpen(true);
  assert.equal(actions.attributes.get("aria-hidden"), "false");

  const interactionEvent = { preventDefault() {}, stopPropagation() {} };
  controller.handleClick(interactionEvent, {
    closest: (selector) =>
      selector === "[data-card-view-media-drawer-calendar]"
        ? calendar
        : null,
  });
  assert.equal(calendar.attributes.get("aria-pressed"), "true");
  assert.equal(calendar.classList.classes.has("active"), true);

  controller.selectType(CARD_VIEW_MEDIA_DRAWER_TYPES.recordings);
  assert.equal(filter.disabled, true);
  assert.equal(filter.attributes.get("aria-pressed"), "false");
});
