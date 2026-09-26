export const LANGUAGE_ASSET_PREFIX = "frigate-view-card-locale";

export const LANGUAGE_ASSETS = Object.freeze({
  "en-GB": "en-GB",
  de: "de",
  es: "es",
  "es-419": "es-419",
  fr: "fr",
  pt: "pt",
  "pt-PT": "pt",
  "pt-BR": "pt-BR",
  it: "it",
  pl: "pl",
  ca: "ca",
  el: "el",
});

export const LANGUAGE_ASSET_NAMES = Object.freeze([
  ...new Set(Object.values(LANGUAGE_ASSETS)),
]);
