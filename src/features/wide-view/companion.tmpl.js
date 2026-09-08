import { escapeHtml, escapeHtmlAttribute } from "../../shared/html.js";

const companionSeverityClass = (severity) => {
  if (severity === "alert") return "grid-alert";
  if (severity === "detection") return "grid-detection";
  return "";
};

export function buildWideCompanionStatusMarkup(online) {
  const status = online ? "Online" : "Offline";
  return `<span class="dot" style="color:var(${online ? "--c-on" : "--c-off"})" title="${status}" aria-label="${status}">●</span>`;
}

export function buildWideCompanionMetaMarkup({
  name,
  online,
}) {
  return `<div class="preview-meta wide-companion-meta">
            <div class="preview-meta-name wide-companion-meta-name">${escapeHtml(name)}</div>
            <div class="preview-meta-status wide-companion-meta-status">${buildWideCompanionStatusMarkup(online)}</div>
          </div>`;
}

export function buildWideCompanionCellMarkup({
  index,
  entity,
  severity,
  useLive,
  metaMarkup,
}) {
  return `<div class="preview-cell wide-companion-cell shadow-medium" data-wide-companion-camidx="${index}">
            <div class="preview-media-host wide-companion-media-host ${companionSeverityClass(severity)}" data-wide-companion-media-entity="${escapeHtmlAttribute(entity)}" data-wide-companion-use-live="${useLive ? "1" : "0"}"></div>
            ${metaMarkup}
          </div>`;
}

export function buildWideCompanionRegionMarkup() {
  return `<section class="wide-companion-panel" id="wide-companion-panel" aria-label="Companion Cameras">
            <div class="wide-companion-surface">
              <div class="wide-companion-resize-handle" data-wide-companion-resize-handle role="separator" tabindex="0" aria-label="Resize Companion Cameras" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-controls="wide-companion-grid" title="Drag up to expand Companion Cameras">
                <div class="wide-companion-title">Companion Cameras</div>
                <span class="wide-companion-resize-grip" aria-hidden="true"></span>
              </div>
              <div class="preview-grid wide-companion-grid" id="wide-companion-grid"></div>
            </div>
          </section>`;
}
