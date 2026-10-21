import { SUPPORTED_CARD_TAGS, VERSION } from "../../constants.js";

// Temporary, opt-in HA shell diagnostics. No layout or media corrections belong here.
const PANEL_ID = "fvc-layout-diagnostics";
const round = (value) => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
const parentOf = (element) =>
  element.assignedSlot || element.parentElement || element.getRootNode()?.host;

const findCards = (root, cards = []) => {
  for (const element of root.querySelectorAll("*")) {
    if (SUPPORTED_CARD_TAGS.includes(element.localName)) cards.push(element);
    if (element.shadowRoot && element.id !== PANEL_ID) {
      findCards(element.shadowRoot, cards);
    }
  }
  return cards;
};

const measure = (element, label) => {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return {
    label,
    tag: element.localName,
    top: round(rect.top), bottom: round(rect.bottom), height: round(rect.height),
    client: element.clientHeight, scroll: element.scrollHeight,
    scrollTop: round(element.scrollTop), excess: element.scrollHeight - element.clientHeight,
    width: round(rect.width), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
    css: Object.fromEntries([
      "height", "min-height", "max-height", "overflow-y", "overflow-x",
      "box-sizing", "position", "display", "padding-top", "padding-bottom",
      "margin-top", "margin-bottom", "transform", "contain", "flex",
      "--ha-card-height", "--card-host-height", "--view-height", "--header-height",
      "--safe-area-inset-top", "--safe-area-inset-bottom",
    ].map((name) => [name, style.getPropertyValue(name)])),
  };
};

export const collectLayoutDiagnostics = () => {
  const targets = new Map();
  const add = (element, label) => {
    if (element?.getBoundingClientRect && !targets.has(element)) targets.set(element, label);
  };
  add(document.documentElement, "html");
  add(document.body, "body");
  const cards = findCards(document).map((card, index) => {
    const prefix = `card${index + 1}`;
    add(card, prefix);
    const ancestors = [];
    for (let node = parentOf(card); node && ancestors.length < 40; node = parentOf(node)) {
      const label = `${prefix}/up${ancestors.length + 1}:${node.localName}`;
      add(node, label);
      ancestors.push(targets.get(node));
      // Include HA shell boxes outside the card's direct ancestor chain.
      for (const selector of ["#view", ".header", ".toolbar"]) {
        add(node.shadowRoot?.querySelector(selector), `${label}/${selector}`);
      }
    }
    for (const selector of ["ha-card", ".card", ".layout", ".browse"]) {
      add(card.shadowRoot?.querySelector(selector), `${prefix}/${selector}`);
    }
    const controller = card._cardStyleController;
    return {
      label: prefix, page: card._pageId,
      phone: card._isLikelyPhoneClient?.(), mobile: card._isLikelyMobileClient?.(),
      preview: card._isPreviewContext?.(),
      constrainedPhonePage: controller?.shouldConstrainPhonePageHeight?.(),
      gridMode: controller?.resolveHomeAssistantGridHeightMode?.(),
      panel: controller?.isPanelView?.(),
      tightMargins: card._config?.tight_margins,
      configuredHeight: card._config?.stream_height,
      configuredUnit: card._config?.stream_height_unit,
      bottomNavbar: card._haNavbarController?.isNavbarAtBottom?.(),
      ancestors,
    };
  });
  const viewport = window.visualViewport;
  return {
    targets,
    report: {
      version: VERSION, elapsedMs: Math.round(performance.now()),
      viewport: {
        innerHeight: window.innerHeight, innerWidth: window.innerWidth,
        visualHeight: round(viewport?.height), visualWidth: round(viewport?.width),
        offsetTop: round(viewport?.offsetTop), pageTop: round(viewport?.pageTop),
        scale: round(viewport?.scale), scrollY: round(window.scrollY),
        standalone: window.matchMedia("(display-mode: standalone)").matches,
        documentScroller: targets.get(document.scrollingElement) || document.scrollingElement?.localName,
      },
      cards, boxes: [...targets].map(([element, label]) => measure(element, label)),
    },
  };
};

export const installLayoutDiagnostics = () => {
  if (new URLSearchParams(window.location.search).get("fvc_layout_debug") !== "1") return;
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", installLayoutDiagnostics, { once: true });
    return;
  }
  if (document.getElementById(PANEL_ID)) return;
  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  const root = panel.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all:initial; position:fixed; bottom:6px; left:6px; z-index:2147483647;
        width:calc(100% - 12px); max-width:640px; contain:layout style; }
      section { box-sizing:border-box; background:#111; color:#fff; border:2px solid #f9b000;
        padding:6px; font:12px/1.35 monospace; max-height:45dvh; overflow:auto;
        overscroll-behavior:contain; border-radius:8px; }
      nav { display:flex; flex-wrap:wrap; gap:4px; }
      button { min-height:40px; font:13px sans-serif; background:#333; color:#fff;
        border:1px solid #aaa; border-radius:4px; padding:4px 8px; }
      button:active { background:#555; }
      pre { white-space:pre-wrap; overflow-wrap:anywhere; margin:4px 0; }
      textarea { box-sizing:border-box; width:100%; height:180px; font:12px monospace; }
      [hidden] { display:none!important; }
    </style>
    <section aria-label="Temporary layout diagnostics">
      <strong>Layout diagnostics v${VERSION}</strong>
      <nav>
        <button data-action="freeze">Freeze</button><button data-action="copy">Copy report</button>
        <button data-action="details">Details</button><button data-action="collapse">Minimize</button>
        <button data-action="close">Close</button>
      </nav>
      <pre id="summary" aria-live="off"></pre>
      <pre id="details" hidden></pre>
      <textarea aria-label="Layout report for copying" readonly hidden></textarea>
      <span id="status" role="status"></span>
    </section>`;
  document.body.append(panel);
  const summary = root.querySelector("#summary");
  const details = root.querySelector("#details");
  const status = root.querySelector("#status");
  const textArea = root.querySelector("textarea");
  const state = { frozen: false, latest: null, initial: null, history: [], scrolls: [], labels: new Map() };
  const roots = new Set();
  const onScroll = (event) => {
    if (state.frozen || event.composedPath().includes(panel)) return;
    const target = event.target;
    const label = target === document ? "document" : state.labels.get(target);
    if (!label) return;
    state.scrolls.push({ label, top: round(target.scrollTop ?? window.scrollY), at: Math.round(performance.now()) });
    if (state.scrolls.length > 16) state.scrolls.shift();
  };
  const sample = () => {
    if (state.frozen || document.hidden) return;
    const { report, targets } = collectLayoutDiagnostics();
    state.labels = targets;
    const nextRoots = new Set([document, ...[...targets.keys()].map((element) => element.getRootNode())]);
    for (const previous of roots) {
      if (nextRoots.has(previous)) continue;
      previous.removeEventListener("scroll", onScroll, true);
      roots.delete(previous);
    }
    for (const next of nextRoots) {
      if (roots.has(next)) continue;
      next.addEventListener("scroll", onScroll, { capture: true, passive: true });
      roots.add(next);
    }
    state.latest = report;
    if (!state.initial && report.cards.length) state.initial = report;
    state.history.push(report);
    if (state.history.length > 5) state.history.shift();
    const view = report.viewport;
    summary.textContent = [
      `inner ${view.innerWidth}x${view.innerHeight} visual ${view.visualWidth}x${view.visualHeight}`,
      `offsetTop ${view.offsetTop} pageTop ${view.pageTop} scrollY ${view.scrollY} scale ${view.scale}`,
      ...report.cards.map((card) => `${card.label} ${card.page} phone=${card.phone} constrain=${card.constrainedPhonePage} grid=${card.gridMode} height=${card.configuredHeight}${card.configuredUnit || "%"} bottomNav=${card.bottomNavbar}`),
      `Last scroll: ${state.scrolls.at(-1)?.label || "none observed"}`,
      "box: top/bottom client/scroll scrollTop (CSS overflow-y)",
      ...report.boxes.filter((box) => ["html", "body", "card1"].includes(box.label) ||
        (box.excess > 1 && !box.label.includes("/.") && !box.label.includes("/#")))
        .slice(0, 8).map((box) => `${box.label}: ${box.top}/${box.bottom} ${box.client}/${box.scroll} y=${box.scrollTop} (${box.css["overflow-y"]})`),
    ].join("\n");
    details.textContent = JSON.stringify(report, null, 2);
  };
  const timer = window.setInterval(sample, 1000);
  sample();
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "close") {
      window.clearInterval(timer);
      for (const target of roots) target.removeEventListener("scroll", onScroll, true);
      roots.clear();
      panel.remove();
    } else if (action === "freeze") {
      if (!state.frozen) sample();
      state.frozen = !state.frozen;
      button.textContent = state.frozen ? "Resume" : "Freeze";
      status.textContent = state.frozen ? "Frozen — safe to screenshot or copy." : "";
    } else if (action === "details") {
      details.hidden = !details.hidden;
    } else if (action === "collapse") {
      summary.hidden = !summary.hidden;
      details.hidden = true;
      textArea.hidden = true;
      button.textContent = summary.hidden ? "Expand" : "Minimize";
    } else if (action === "copy") {
      const text = JSON.stringify({ initial: state.initial, latest: state.latest, recent: state.history, scrolls: state.scrolls }, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = "Report copied. Paste it into the conversation.";
      } catch {
        textArea.hidden = false;
        textArea.value = text;
        status.textContent = "Clipboard unavailable. Select and copy the report below.";
      }
    }
  });
};
