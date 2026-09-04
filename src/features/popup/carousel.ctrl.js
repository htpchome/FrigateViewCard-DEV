import { cap } from "../../helpers.js";
import { ICONS } from "../../icons.js";
import {
  buildPopupCarouselContentKey,
  buildPopupCarouselContentPlan,
  buildPopupCarouselEvents,
  buildPopupCarouselItemMarkup,
  buildPopupCarouselScrollPlan,
  PopupCarouselSwipeController,
  resolvePopupCarouselActiveScrollLeft,
  resolvePopupCarouselNavigationState,
} from "./carousel.js";

export class PopupCarouselController {
  constructor({
    query,
    getKept = () => [],
    getReviews = () => [],
    getDisplayEvents = () => [],
    findEventById = () => null,
    mediaUrl = () => "",
    formatDateTime = () => "",
    formatTime = () => "",
    isTouchUi = () => false,
    isMobileDevice = () => false,
    onSelectEvent = () => {},
    resizeObserverCtor = globalThis.ResizeObserver,
    requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) ||
      ((callback) => globalThis.setTimeout(callback, 0)),
    createSwipeController = (options) =>
      new PopupCarouselSwipeController(options),
  } = {}) {
    this._query = query;
    this._getKept = getKept;
    this._getReviews = getReviews;
    this._getDisplayEvents = getDisplayEvents;
    this._findEventById = findEventById;
    this._mediaUrl = mediaUrl;
    this._formatDateTime = formatDateTime;
    this._formatTime = formatTime;
    this._isTouchUi = isTouchUi;
    this._isMobileDevice = isMobileDevice;
    this._onSelectEvent = onSelectEvent;
    this._ResizeObserver = resizeObserverCtor;
    this._requestFrame = requestFrame;
    this._createSwipeController = createSwipeController;
    this._resizeObserver = null;
    this._swipeController = null;
    this._row = null;
    this._mediaType = "";
    this._contentRow = null;
    this._contentKey = "";
    this._activeId = "";
    this._renderToken = 0;
  }

  render(mediaType, activeId = "") {
    const wrap = this._query?.("#popup-carousel-wrap");
    const row = this._query?.("#popup-carousel");
    if (!wrap || !row) return null;

    const isMobileDevice = this._isMobileDevice();
    if (isMobileDevice) {
      this.dispose();
      this._resetContent(row);
      const contentPlan = buildPopupCarouselContentPlan({
        mediaType,
        events: [],
        activeId,
        isTouchUi: this._isTouchUi(),
        isMobileDevice,
      });
      wrap.hidden = true;
      wrap.classList.toggle("touch", false);
      wrap.classList.toggle("mobile-device", true);
      return contentPlan;
    }
    const events = this._events(mediaType);
    const contentKey = buildPopupCarouselContentKey({ mediaType, events });
    const reuseContent =
      this._contentRow === row && this._contentKey === contentKey;
    const contentPlan = buildPopupCarouselContentPlan({
      mediaType,
      events,
      activeId,
      isTouchUi: this._isTouchUi(),
      isMobileDevice,
      reuseContent,
      renderEvent: (event, currentActiveId) =>
        this._eventMarkup(event, currentActiveId),
    });
    wrap.hidden = contentPlan.hidden;
    if (!contentPlan.shouldRender) {
      this.dispose();
      this._resetContent(row);
      return contentPlan;
    }

    const nextActiveId = String(activeId || "");
    const activeChanged = this._activeId !== nextActiveId;
    if (reuseContent && this._row === row && !activeChanged) {
      wrap.classList.toggle("touch", contentPlan.touch);
      wrap.classList.toggle("mobile-device", contentPlan.mobile);
      return contentPlan;
    }
    if (!reuseContent) {
      this.dispose();
      row.innerHTML = contentPlan.html;
      row.scrollLeft = 0;
      this._contentRow = row;
      this._contentKey = contentKey;
    }
    this._mediaType = String(mediaType || "").toLowerCase();
    this._activeId = nextActiveId;
    this._syncActiveItem(row, nextActiveId);
    wrap.classList.toggle("touch", contentPlan.touch);
    wrap.classList.toggle("mobile-device", contentPlan.mobile);
    if (this._row !== row) this._bindRow(row, contentPlan);
    this._scheduleActiveScroll(row);
    return contentPlan;
  }

  clear() {
    this.dispose();
    const wrap = this._query?.("#popup-carousel-wrap");
    const row = this._query?.("#popup-carousel");
    if (wrap) wrap.hidden = true;
    this._resetContent(row);
  }

  dispose() {
    this._renderToken += 1;
    this._resizeObserver?.disconnect?.();
    this._resizeObserver = null;
    this._swipeController?.dispose?.();
    this._swipeController = null;
    if (this._row) {
      this._row.onscroll = null;
      this._row.onclick = null;
    }
    this._row = null;
    this._mediaType = "";
  }

  _resetContent(row = this._contentRow) {
    if (row) {
      row.onscroll = null;
      row.onclick = null;
      row.innerHTML = "";
    }
    this._contentRow = null;
    this._contentKey = "";
    this._activeId = "";
  }

  _syncActiveItem(row, activeId = "") {
    const targetId = String(activeId || "");
    for (const item of row?.querySelectorAll?.(".popup-carousel-item") || []) {
      item.classList?.toggle?.(
        "active",
        String(item.dataset?.ev || "") === targetId,
      );
    }
  }

  _bindRow(row, contentPlan) {
    this._row = row;
    row.onclick = this._onItemClick;
    const syncNavigation = () => this.syncNavigation(row);
    row.onscroll = syncNavigation;
    if (typeof this._ResizeObserver === "function") {
      this._resizeObserver = new this._ResizeObserver(syncNavigation);
      this._resizeObserver.observe(row);
    }
    if (contentPlan.mobile) {
      this._swipeController = this._createSwipeController({
        row,
        getScrollPlan: (dir) => this._scrollPlan(row, dir),
      }).bind();
    }
    syncNavigation();
  }

  _scheduleActiveScroll(row) {
    const renderToken = ++this._renderToken;
    this._requestFrame(() => {
      if (renderToken !== this._renderToken || this._row !== row) return;
      const active = row.querySelector(".popup-carousel-item.active");
      if (active) {
        row.scrollLeft = resolvePopupCarouselActiveScrollLeft({
          activeOffsetLeft: active.offsetLeft,
        });
      }
      this.syncNavigation(row);
    });
  }

  syncNavigation(row = this._query?.("#popup-carousel")) {
    if (!row) return;
    const wrap = this._query?.("#popup-carousel-wrap");
    const leftButton = this._query?.("#popup-carousel-left");
    const rightButton = this._query?.("#popup-carousel-right");
    const item = row.querySelector(".popup-carousel-item");
    const itemHeight = Number(item?.getBoundingClientRect?.().height || 0);
    if (wrap && itemHeight > 0) {
      wrap.style.setProperty(
        "--popup-carousel-item-height",
        `${itemHeight}px`,
      );
    }
    const navigationState = resolvePopupCarouselNavigationState({
      scrollLeft: row.scrollLeft,
      scrollWidth: row.scrollWidth,
      viewportWidth: row.clientWidth,
    });
    if (leftButton) leftButton.hidden = !navigationState.canScrollLeft;
    if (rightButton) rightButton.hidden = !navigationState.canScrollRight;
  }

  scroll(dir = 1) {
    const row = this._query?.("#popup-carousel");
    if (!row) return;
    row.scrollBy(this._scrollPlan(row, dir));
  }

  _events(mediaType) {
    return buildPopupCarouselEvents({
      mediaType,
      kept: this._getKept() || [],
      reviews: this._getReviews() || [],
      displayEvents: this._getDisplayEvents() || [],
      findEventById: this._findEventById,
    });
  }

  _eventMarkup(event, activeId = "") {
    if (!event?.id) return "";
    const thumbnail = `<img src="${this._mediaUrl(event.id, "thumbnail.jpg", event.camera || "")}" loading="lazy" data-thumb-id="${event.id}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="tph" style="display:none">${ICONS.person}</div>`;
    return buildPopupCarouselItemMarkup({
      event,
      activeId,
      thumbnailHtml: thumbnail,
      title: this._formatDateTime(event.start_time || 0),
      label: cap(event.label || "event"),
      time: this._formatTime(event.start_time || 0),
    });
  }

  _scrollPlan(row, dir = 1) {
    const item = row.querySelector(".popup-carousel-item");
    return buildPopupCarouselScrollPlan({
      itemWidth: item?.getBoundingClientRect?.().width,
      viewportWidth: row.clientWidth,
      dir,
    });
  }

  _onItemClick = (event) => {
    const item = event?.target?.closest?.(".popup-carousel-item[data-ev]");
    const eventId = String(item?.dataset?.ev || "");
    if (!eventId) return;
    event.stopPropagation?.();
    event.preventDefault?.();
    this._onSelectEvent(eventId, this._mediaType);
  };
}
