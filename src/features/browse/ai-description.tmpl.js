import { escapeHtml, escapeHtmlAttribute } from "../../shared/html.js";

const localizedText = (t, key, fallback, values = {}) =>
  typeof t === "function" ? t(`runtime.browse.ai.${key}`, values) : fallback;

export const buildBrowseAiTitleButtonMarkup = ({
  analysis,
  icons,
  t,
  className = "list-ai-title",
  iconClassName = "list-ai-title-icon",
  textClassName = "list-ai-title-text",
  showIcon = true,
}) => {
  if (!analysis?.title) return "";
  const label = localizedText(
    t,
    "viewAnalysis",
    `View AI analysis: ${analysis.title}`,
    { title: analysis.title },
  );
  const values = escapeHtmlAttribute(
    JSON.stringify({ title: analysis.title }),
  );
  const icon = showIcon
    ? `<span class="${escapeHtmlAttribute(iconClassName)}" aria-hidden="true">${icons.creation || ""}</span>`
    : "";
  return `<button class="${escapeHtmlAttribute(className)}" type="button" data-ai-description-open data-ai-title="${escapeHtmlAttribute(analysis.title)}" data-ai-description="${escapeHtmlAttribute(analysis.description || "")}" data-ai-score="${escapeHtmlAttribute(analysis.score ?? "")}" data-ai-concerns="${escapeHtmlAttribute((analysis.concerns || []).join("\n"))}" title="${escapeHtmlAttribute(label)}" aria-label="${escapeHtmlAttribute(label)}" data-fvc-i18n-title="runtime.browse.ai.viewAnalysis" data-fvc-i18n-aria-label="runtime.browse.ai.viewAnalysis" data-fvc-i18n-values="${values}">${icon}<span class="${escapeHtmlAttribute(textClassName)}">${escapeHtml(analysis.title)}</span></button>`;
};

export const buildBrowseAiDescriptionDialogMarkup = ({ icons }) => `
  <div class="browse-ai-modal" data-browse-ai-modal hidden>
    <button class="browse-ai-backdrop" type="button" data-ai-description-close aria-label="Close AI analysis" data-fvc-i18n-aria-label="runtime.browse.ai.close"></button>
    <section class="browse-ai-dialog" role="dialog" aria-modal="true" aria-labelledby="browse-ai-dialog-heading" tabindex="-1">
      <div class="browse-ai-drag-handle" data-ai-description-drag-handle aria-hidden="true"></div>
      <header class="browse-ai-dialog-head" data-ai-description-drag-handle>
        <button class="browse-ai-dialog-close" type="button" data-ai-description-close aria-label="Close AI analysis" data-fvc-i18n-aria-label="runtime.browse.ai.close">${icons.close || ""}</button>
        <strong id="browse-ai-dialog-heading" data-fvc-i18n="runtime.browse.ai.heading">AI Analysis</strong>
      </header>
      <div class="browse-ai-dialog-body">
        <section class="browse-ai-field" data-ai-field="title">
          <span data-fvc-i18n="runtime.browse.ai.title">Title</span>
          <p data-ai-value="title"></p>
        </section>
        <section class="browse-ai-field" data-ai-field="description">
          <span data-fvc-i18n="runtime.browse.ai.description">Description</span>
          <p data-ai-value="description"></p>
        </section>
        <section class="browse-ai-field" data-ai-field="score">
          <span data-fvc-i18n="runtime.browse.ai.score">Score</span>
          <p data-ai-value="score"></p>
        </section>
        <section class="browse-ai-field" data-ai-field="concerns">
          <span data-fvc-i18n="runtime.browse.ai.concerns">Concerns</span>
          <p data-ai-value="concerns"></p>
        </section>
      </div>
    </section>
  </div>`;
