import { cap } from "../../helpers.js";
import { CleanupController } from "../../shared/cleanup.js";
import { escapeHtml, escapeHtmlAttribute } from "../../shared/html.js";
import {
  CARD_VIEW_MEDIA_DRAWER_TYPES,
  normalizeCardViewMediaDrawerType,
} from "./config.js";

const DRAWER_ITEM_LIMIT = 200;
const DRAWER_ITEM_GAP_PX = 6;

const POPUP_MEDIA_TYPES = Object.freeze({
  [CARD_VIEW_MEDIA_DRAWER_TYPES.alerts]: "alert",
  [CARD_VIEW_MEDIA_DRAWER_TYPES.clips]: "clip",
  [CARD_VIEW_MEDIA_DRAWER_TYPES.snapshots]: "snapshot",
});

const DRAWER_LABELS = Object.freeze({
  [CARD_VIEW_MEDIA_DRAWER_TYPES.alerts]: "Alerts",
  [CARD_VIEW_MEDIA_DRAWER_TYPES.clips]: "Clips",
  [CARD_VIEW_MEDIA_DRAWER_TYPES.snapshots]: "Snapshots",
});

export const resolveCardViewMediaDrawerPopupType = (value) =>
  POPUP_MEDIA_TYPES[normalizeCardViewMediaDrawerType(value)];

export const buildCardViewMediaDrawerContentKey = ({
  mediaType = "",
  events = [],
  limit = DRAWER_ITEM_LIMIT,
} = {}) =>
  JSON.stringify([
    resolveCardViewMediaDrawerPopupType(mediaType),
    ...(events || []).slice(0, Math.max(0, Number(limit) || 0)).map((event) => [
      String(event?.id || ""),
      String(event?.camera || ""),
      Number(event?.start_time) || 0,
      String(event?.label || ""),
    ]),
  ]);

export const buildCardViewMediaDrawerItemMarkup = ({
  event = null,
  mediaType = "",
  thumbnailUrl = "",
  title = "",
  label = "",
  time = "",
  placeholderIcon = "",
} = {}) => {
  const eventId = String(event?.id || "");
  if (!eventId) return "";
  const popupMediaType = resolveCardViewMediaDrawerPopupType(mediaType);
  return `<button class="card-view-media-drawer-item" type="button" data-card-view-media-event="${escapeHtmlAttribute(eventId)}" data-card-view-media-type="${popupMediaType}" title="${escapeHtmlAttribute(title)}">
    <span class="card-view-media-drawer-thumbnail">
      <span class="card-view-media-drawer-placeholder" aria-hidden="true">${placeholderIcon}</span>
      <img src="${escapeHtmlAttribute(thumbnailUrl)}" alt="" loading="lazy" decoding="async" data-card-view-media-thumbnail>
    </span>
    <span class="card-view-media-drawer-meta"><span>${escapeHtml(label)}</span><span>${escapeHtml(time)}</span></span>
  </button>`;
};

export const resolveCardViewMediaDrawerNavigationState = ({
  scrollTop = 0,
  scrollHeight = 0,
  clientHeight = 0,
  tolerance = 1,
} = {}) => {
  const viewport = Math.max(0, Number(clientHeight) || 0);
  const maxScrollTop = Math.max(0, (Number(scrollHeight) || 0) - viewport);
  const current = Math.min(maxScrollTop, Math.max(0, Number(scrollTop) || 0));
  const edgeTolerance = Math.max(0, Number(tolerance) || 0);
  const hasOverflow = maxScrollTop > edgeTolerance;
  return {
    canScrollUp: hasOverflow && current > edgeTolerance,
    canScrollDown: hasOverflow && current < maxScrollTop - edgeTolerance,
  };
};

export const buildCardViewMediaDrawerScrollPlan = ({
  itemHeight = 0,
  viewportHeight = 0,
  direction = 1,
  gap = DRAWER_ITEM_GAP_PX,
  fallbackHeight = 96,
} = {}) => {
  const height = Number(itemHeight) || Number(fallbackHeight) || 0;
  const spacing = Math.max(0, Number(gap) || 0);
  const step = Math.max(1, height + spacing);
  const visibleItems = Math.max(
    1,
    Math.floor((Math.max(0, Number(viewportHeight) || 0) + spacing) / step),
  );
  return {
    top: step * visibleItems * (Number(direction) < 0 ? -1 : 1),
    behavior: "smooth",
  };
};

export class CardViewMediaDrawerController {
  constructor({
    query = () => null,
    isEnabled = () => false,
    getConfiguredType = () => CARD_VIEW_MEDIA_DRAWER_TYPES.alerts,
    getEvents = () => [],
    mediaUrl = () => "",
    formatDateTime = () => "",
    formatTime = () => "",
    onSelectEvent = () => {},
    icons = {},
    resizeObserverCtor = globalThis.ResizeObserver,
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) ||
      ((callback) => globalThis.setTimeout(callback, 0)),
  } = {}) {
    this._query = query;
    this._isEnabled = isEnabled;
    this._getConfiguredType = getConfiguredType;
    this._getEvents = getEvents;
    this._mediaUrl = mediaUrl;
    this._formatDateTime = formatDateTime;
    this._formatTime = formatTime;
    this._onSelectEvent = onSelectEvent;
    this._icons = icons;
    this._ResizeObserver = resizeObserverCtor;
    this._requestFrame = requestFrame;
    this._cleanup = new CleanupController();
    this._resizeObserver = null;
    this._scroller = null;
    this._open = false;
    this._selectedDrawerType = "";
    this._configuredDrawerType = "";
    this._contentKey = "";
    this._popupMediaType = "";
    this._navigationToken = 0;
  }

  bind() {
    this._disposeBindings();
    const scroller = this._query(
      "[data-card-view-media-drawer-scroller]",
    );
    this._scroller = scroller;
    if (scroller) {
      this._cleanup.addEventListener(scroller, "scroll", () => {
        this.syncNavigation();
      });
      if (typeof this._ResizeObserver === "function") {
        this._resizeObserver = new this._ResizeObserver(() => {
          this.syncNavigation();
        });
        this._resizeObserver.observe(scroller);
      }
    }
    this.syncState();
    this.render();
  }

  dispose() {
    this._disposeBindings();
    this._open = false;
    this._selectedDrawerType = "";
    this._configuredDrawerType = "";
    this._contentKey = "";
    this._popupMediaType = "";
  }

  _disposeBindings() {
    this._navigationToken += 1;
    this._cleanup.dispose();
    this._cleanup = new CleanupController();
    this._resizeObserver?.disconnect?.();
    this._resizeObserver = null;
    this._scroller = null;
  }

  isOpen() {
    return this._open && this._isEnabled() === true;
  }

  setOpen(open) {
    this._open = open === true && this._isEnabled() === true;
    this.syncState();
    if (this._open) this.render();
    return this._open;
  }

  toggle() {
    return this.setOpen(!this.isOpen());
  }

  syncState() {
    const root = this._query("[data-card-view-media-drawer]");
    if (!root) return;
    const enabled = this._isEnabled() === true;
    if (!enabled) this._open = false;
    const open = enabled && this._open;
    root.hidden = !enabled;
    root.classList?.toggle?.("is-open", open);
    root.classList?.toggle?.("is-closed", !open);
    const panel = this._query("[data-card-view-media-drawer-panel]");
    panel?.setAttribute?.("aria-hidden", String(!open));
    const tabs = this._query("[data-card-view-media-drawer-tabs]");
    if (tabs) {
      tabs.hidden = false;
      tabs.setAttribute?.("aria-hidden", String(!open));
    }
    const handle = this._query("[data-card-view-media-drawer-toggle]");
    if (handle) {
      const label = open ? "Close media drawer" : "Open media drawer";
      handle.setAttribute?.("aria-expanded", String(open));
      handle.setAttribute?.("aria-label", label);
      handle.setAttribute?.("title", label);
    }
  }

  render({ force = false } = {}) {
    this.syncState();
    const scroller = this._query(
      "[data-card-view-media-drawer-scroller]",
    );
    if (!scroller) return null;
    if (this._isEnabled() !== true) {
      this._resetContent(scroller);
      return null;
    }

    const drawerType = this._syncSelectedDrawerType();
    const popupMediaType = resolveCardViewMediaDrawerPopupType(drawerType);
    this._syncTabs(drawerType);

    if (!this._open) {
      if (this._popupMediaType && this._popupMediaType !== popupMediaType) {
        this._resetContent(scroller);
      }
      this._popupMediaType = popupMediaType;
      this.syncNavigation();
      return { drawerType, popupMediaType, count: 0, deferred: true };
    }

    const events = (this._getEvents(popupMediaType) || [])
      .filter((event) => event?.id)
      .slice(0, DRAWER_ITEM_LIMIT);
    const contentKey = buildCardViewMediaDrawerContentKey({
      mediaType: drawerType,
      events,
    });
    const typeChanged = this._popupMediaType !== popupMediaType;
    if (force || contentKey !== this._contentKey) {
      const previousScrollTop = typeChanged ? 0 : scroller.scrollTop;
      scroller.innerHTML = events.length
        ? events.map((event) => this._eventMarkup(event, drawerType)).join("")
        : `<div class="card-view-media-drawer-empty">No ${DRAWER_LABELS[drawerType].toLowerCase()} available</div>`;
      scroller.scrollTop = previousScrollTop;
      for (const image of scroller.querySelectorAll?.(
        "[data-card-view-media-thumbnail]",
      ) || []) {
        image.addEventListener?.("error", () => {
          image.hidden = true;
        }, { once: true });
      }
      this._contentKey = contentKey;
      this._popupMediaType = popupMediaType;
    }
    this._scheduleNavigationSync();
    return {
      drawerType,
      popupMediaType,
      count: events.length,
      deferred: false,
    };
  }

  selectType(value) {
    const drawerType = normalizeCardViewMediaDrawerType(value);
    if (drawerType === this._selectedDrawerType) return false;
    this._selectedDrawerType = drawerType;
    this._resetContent();
    this.render({ force: true });
    return true;
  }

  _syncSelectedDrawerType() {
    const configuredType = normalizeCardViewMediaDrawerType(
      this._getConfiguredType(),
    );
    if (
      !this._selectedDrawerType ||
      configuredType !== this._configuredDrawerType
    ) {
      this._selectedDrawerType = configuredType;
      this._configuredDrawerType = configuredType;
    }
    return this._selectedDrawerType;
  }

  _syncTabs(activeType) {
    const tabs = this._query("[data-card-view-media-drawer-tabs]");
    for (const tab of tabs?.querySelectorAll?.(
      "[data-card-view-media-drawer-type]",
    ) || []) {
      const active = tab.dataset.cardViewMediaDrawerType === activeType;
      tab.classList?.toggle?.("active", active);
      tab.setAttribute?.("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
  }

  _eventMarkup(event, drawerType) {
    return buildCardViewMediaDrawerItemMarkup({
      event,
      mediaType: drawerType,
      thumbnailUrl: this._mediaUrl(
        event.id,
        "thumbnail.jpg",
        event.camera || "",
      ),
      title: this._formatDateTime(event.start_time || 0),
      label: cap(event.label || "event"),
      time: this._formatTime(event.start_time || 0),
      placeholderIcon: this._icons.person || "",
    });
  }

  _resetContent(scroller = this._scroller) {
    if (scroller) {
      scroller.innerHTML = "";
      scroller.scrollTop = 0;
    }
    this._contentKey = "";
    this._popupMediaType = "";
    this.syncNavigation(scroller);
  }

  _scheduleNavigationSync() {
    const token = ++this._navigationToken;
    this._requestFrame(() => {
      if (token !== this._navigationToken) return;
      this.syncNavigation();
    });
  }

  syncNavigation(
    scroller = this._query("[data-card-view-media-drawer-scroller]"),
  ) {
    const up = this._query('[data-card-view-media-drawer-scroll="-1"]');
    const down = this._query('[data-card-view-media-drawer-scroll="1"]');
    if (!scroller) {
      if (up) up.hidden = true;
      if (down) down.hidden = true;
      return;
    }
    const state = resolveCardViewMediaDrawerNavigationState({
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    });
    if (up) up.hidden = !state.canScrollUp;
    if (down) down.hidden = !state.canScrollDown;
  }

  scroll(direction = 1) {
    const scroller = this._query(
      "[data-card-view-media-drawer-scroller]",
    );
    if (!scroller) return false;
    const item = scroller.querySelector?.(".card-view-media-drawer-item");
    scroller.scrollBy?.(
      buildCardViewMediaDrawerScrollPlan({
        itemHeight: item?.getBoundingClientRect?.().height,
        viewportHeight: scroller.clientHeight,
        direction,
      }),
    );
    return true;
  }

  handleClick(event, target) {
    if (!target?.closest) return false;
    if (target.closest("[data-card-view-media-drawer-toggle]")) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      this.toggle();
      return true;
    }
    const typeTab = target.closest("[data-card-view-media-drawer-type]");
    if (typeTab) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      this.selectType(typeTab.dataset.cardViewMediaDrawerType);
      return true;
    }
    const navigation = target.closest(
      "[data-card-view-media-drawer-scroll]",
    );
    if (navigation) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      this.scroll(Number(navigation.dataset.cardViewMediaDrawerScroll));
      return true;
    }
    const item = target.closest("[data-card-view-media-event]");
    const eventId = String(item?.dataset?.cardViewMediaEvent || "");
    if (!eventId) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    this._onSelectEvent(
      eventId,
      String(item.dataset.cardViewMediaType || this._popupMediaType),
    );
    return true;
  }
}
