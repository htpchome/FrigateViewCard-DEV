export const CARD_NAME = "FrigateView";
export const CARD_DISPLAY_NAME = `${CARD_NAME} Card`;
export const CARD_TAG = "frigate-view-card";
export const LEGACY_CARD_TAGS = Object.freeze([]);
export const SUPPORTED_CARD_TAGS = Object.freeze([
  CARD_TAG,
  ...LEGACY_CARD_TAGS,
]);
export const CARD_TYPE = `custom:${CARD_TAG}`;
export const SUPPORTED_CARD_TYPES = Object.freeze(
  SUPPORTED_CARD_TAGS.map((tag) => `custom:${tag}`),
);
export const CARD_EDITOR_TAG = `${CARD_TAG}-editor`;
export const SUPPORTED_CARD_EDITOR_TAGS = Object.freeze(
  SUPPORTED_CARD_TAGS.map((tag) => `${tag}-editor`),
);
export const CARD_UPDATE_IDENTITIES = Object.freeze(["frigateviewcard"]);
export const CARD_PREVIEW_DRAFT_EVENT = "frigate-view-card-preview-draft";
export const CARD_EDITOR_DIRTY_STATE_KEY = "frigate-view-card-editor";

export const normalizeCardTag = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^custom:/, "");

export const normalizeCardTags = (values = SUPPORTED_CARD_TAGS) => {
  const candidates = Array.isArray(values) ? values : [values];
  return [...new Set(candidates.map(normalizeCardTag).filter(Boolean))];
};

export const isSupportedCardTag = (
  value,
  supportedTags = SUPPORTED_CARD_TAGS,
) => normalizeCardTags(supportedTags).includes(normalizeCardTag(value));
