import { CARD_NAME } from "../../constants.js";
import { applyLocalizedText } from "../localization/localized-dom.js";
import {
  buildCardPickerDemoAlertsMarkup,
  buildCardPickerDemoLiveMarkup,
} from "./card-picker-demo.tmpl.js";
import { CARD_PICKER_DEMO_STYLES } from "./card-picker-demo.styles.js";

const CARD_PICKER_DEMO_STYLE_ATTRIBUTE =
  "data-fvc-card-picker-demo-styles";

export class CardPickerDemoController {
  constructor(host) {
    this._host = host;
    this._demoEngine = null;
    this._demoList = null;
  }

  render(active = true) {
    this._host.classList?.toggle?.("card-picker-demo-host", active);
    if (!active) {
      this._deactivate();
      return false;
    }

    const root = this._host.shadowRoot;
    const card = root?.querySelector?.("#card");
    const engine = root?.querySelector?.("#engine");
    const fallback = root?.querySelector?.("#stream-fallback");
    const browse = root?.querySelector?.("#browse");
    const browseHeader = root?.querySelector?.("#browse-head");
    const browseHeaderLabel = root?.querySelector?.("#browse-head-label");
    const list = root?.querySelector?.("#list");
    if (!card || !engine || !browse || !browseHeader || !list) return true;

    this._ensureStyles(root);
    const t = this._host._localization?.t;
    card.classList?.add?.("card-picker-demo");
    const demoSurface = fallback || engine;
    if (this._demoEngine !== demoSurface) {
      demoSurface.innerHTML = buildCardPickerDemoLiveMarkup();
      this._demoEngine = demoSurface;
    }
    if (fallback) {
      fallback.hidden = false;
      fallback.removeAttribute?.("hidden");
    }
    browse.style.display = "flex";
    browseHeader.style.display = "flex";
    if (browseHeaderLabel) {
      browseHeaderLabel.textContent =
        t?.("runtime.browse.recentAlerts") || "Recent Alerts";
    }

    const alertsMarkup = buildCardPickerDemoAlertsMarkup();
    if (this._demoList !== list) {
      list.innerHTML = alertsMarkup;
      this._demoList = list;
    }
    if (typeof t === "function") {
      applyLocalizedText(demoSurface, t);
      applyLocalizedText(list, t);
    }
    this._host._lastRenderedListHtml = alertsMarkup;

    const title = root.querySelector?.("#info-title");
    const subtitle = root.querySelector?.("#tl-range");
    const streamType = root.querySelector?.("#stream-type");
    const alertCount = root.querySelector?.("#alert-count");
    const statusLabel = root.querySelector?.("#on-lbl");
    const statusDot = root.querySelector?.("#on-dot");
    if (title) title.textContent = CARD_NAME;
    if (subtitle) {
      subtitle.textContent =
        t?.("runtime.cardPickerDemo.demoCamera") || "Demo Camera";
    }
    if (streamType) {
      streamType.textContent = t?.("runtime.cardPickerDemo.demo") || "Demo";
    }
    if (alertCount) alertCount.textContent = "2";
    if (statusLabel) {
      statusLabel.textContent = t?.("runtime.preview.online") || "Online";
    }
    if (statusDot) statusDot.style.color = "var(--c-on)";
    return true;
  }

  dispose() {
    this.render(false);
    this._host.shadowRoot
      ?.querySelector?.(`style[${CARD_PICKER_DEMO_STYLE_ATTRIBUTE}]`)
      ?.remove?.();
  }

  _deactivate() {
    this._host.shadowRoot
      ?.querySelector?.("#card")
      ?.classList?.remove?.("card-picker-demo");
    this._demoEngine = null;
    this._demoList = null;
  }

  _ensureStyles(root) {
    if (
      root.querySelector?.(`style[${CARD_PICKER_DEMO_STYLE_ATTRIBUTE}]`)
    ) {
      return;
    }
    const documentRef =
      this._host.ownerDocument || globalThis.document || null;
    const style = documentRef?.createElement?.("style");
    if (!style) return;
    style.setAttribute(CARD_PICKER_DEMO_STYLE_ATTRIBUTE, "");
    style.textContent = CARD_PICKER_DEMO_STYLES;
    root.prepend?.(style);
  }
}
