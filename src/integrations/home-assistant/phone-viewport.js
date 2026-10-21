import { findHomeAssistantLovelaceRoot } from "./lovelace-dom.js";

const shellOwners = new WeakMap();
const shellTags = new Set(["HUI-ROOT", "HUI-VIEW", "HUI-PANEL-VIEW", "HUI-SECTIONS-VIEW"]);
const parentElement = (node) =>
  node.assignedSlot || node.parentElement || node.getRootNode?.()?.host || null;
const pixels = (value) => Number.parseFloat(value) || 0;

const hasOtherCard = (root, ancestors, host) => {
  for (const element of root?.querySelectorAll?.("*") || []) {
    if (element === host) continue;
    if (element.localName === "hui-card" && !ancestors.has(element) &&
      element.getBoundingClientRect().height > 0) return true;
    if (element.shadowRoot && hasOtherCard(element.shadowRoot, ancestors, host)) return true;
  }
  return false;
};

// Owns only the standalone phone browser's full-height HA page geometry.
export class HomeAssistantPhoneViewport {
  constructor(host) {
    this.host = host;
    this.originals = new Map();
    this.root = null;
  }

  release() {
    for (const [element, properties] of this.originals) {
      for (const [name, { value, priority, applied }] of properties) {
        if (element.style.getPropertyValue(name) !== applied ||
          element.style.getPropertyPriority(name) !== "important") continue;
        if (value) element.style.setProperty(name, value, priority);
        else element.style.removeProperty(name);
      }
    }
    this.originals.clear();
    if (this.root && shellOwners.get(this.root) === this) shellOwners.delete(this.root);
    this.root = null;
  }

  setShellNaturalHeight(element) {
    if (!this.originals.has(element)) this.originals.set(element, new Map());
    const properties = this.originals.get(element);
    for (const [name, applied] of [["height", "auto"], ["min-height", "0px"]]) {
      if (!properties.has(name)) properties.set(name, {
        value: element.style.getPropertyValue(name),
        priority: element.style.getPropertyPriority(name), applied,
      });
      element.style.setProperty(name, applied, "important");
    }
  }

  resolveHeight(enabled) {
    const ua = globalThis.navigator?.userAgent || "";
    const safariPhone = /iphone/i.test(ua) && /safari/i.test(ua) &&
      !/crios|fxios|edgios|opios|homeassistant|home assistant/i.test(ua) &&
      globalThis.navigator?.standalone !== true &&
      !window.matchMedia?.("(display-mode: standalone)")?.matches;
    if (!enabled || !safariPhone) {
      this.release();
      return null;
    }
    const viewport = window.visualViewport;
    const height = Number(viewport?.height) || window.innerHeight;
    // Leave pinch-zoom geometry alone; it is not a page-layout resize.
    if (!(height > 0) || (viewport?.scale && viewport.scale !== 1)) {
      this.release();
      return null;
    }
    const ancestors = [];
    for (let node = parentElement(this.host); node && ancestors.length < 40; node = parentElement(node)) {
      ancestors.push(node);
    }
    const root = findHomeAssistantLovelaceRoot(this.host);
    if (root !== this.root) this.release();
    const view = root?.shadowRoot?.querySelector("#view");
    const ownShell = view && !hasOtherCard(view, new Set(ancestors), this.host);
    if (ownShell) {
      const previous = shellOwners.get(root);
      if (previous && previous !== this) previous.release();
      this.root = root;
      shellOwners.set(root, this);
      // Let this sole full-page card, plus HA's padding, determine shell height.
      // Do not hide overflow or lock scrolling on the document/application.
      for (const element of ancestors) {
        if (shellTags.has(element.tagName) || element === view) this.setShellNaturalHeight(element);
        if (element === root) break;
      }
    } else {
      shellOwners.get(root)?.release();
      this.release();
    }
    const scrollingElement = document.scrollingElement;
    const scroll = ancestors.reduce((sum, element) =>
      sum + (element === scrollingElement || element === document.body || element === document.documentElement
        ? 0 : Number(element.scrollTop) || 0), Number(window.scrollY) || 0);
    // Scrolling must not manufacture available height. Use the unscrolled origin.
    const top = Math.max(0, this.host.getBoundingClientRect().top + scroll);
    const bottom = [this.host, ...ancestors].reduce((sum, element) => {
      const style = getComputedStyle(element);
      return sum + pixels(style.marginBottom) +
        (element === this.host ? 0 : pixels(style.paddingBottom) + pixels(style.borderBottomWidth));
    }, 0);
    return Math.max(1, height - top - bottom);
  }
}
