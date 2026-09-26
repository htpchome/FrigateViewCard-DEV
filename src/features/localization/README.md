# Localization

The card reads the Home Assistant user's language from `hass.locale.language`,
falling back to `hass.language` and then English. It tries an exact locale,
successively shorter locale codes, and finally `en`. Missing keys also use
their English value.

Home Assistant does not automatically load a custom card's language files.
English (`en`) is embedded in the runtime and editor bundles so fallback text
is always immediately available. The build emits the other registered
languages as versioned companion JSON assets, and the card loads only the
catalog needed by the current user: British English (`en-GB`), German (`de`),
Spanish (`es`), Latin American Spanish (`es-419`), French (`fr`), European
Portuguese (`pt`), Brazilian Portuguese (`pt-BR`), Italian (`it`), Polish
(`pl`), Catalan (`ca`), and Greek (`el`). Regional locales inherit their base
language before falling back to English; for example, `fr-CA` inherits `fr`.
If a companion asset is unavailable, the card remains usable in English.
The `en-GB`, `es-419`, and `pt-BR` files contain only regional wording differences
and inherit all other entries from `en`, `es`, and `pt`, respectively. `pt-PT`
uses the complete `pt` catalog while retaining its regional date/time formatting.
British English uses day/month dates and a 24-hour time format by default;
an explicit Home Assistant time preference still takes precedence.

To add a translation, put a JSON file in `languages/` using its HA locale code
(for example, `pt-BR.json`), then add its locale-to-asset entry in
`catalogs.mjs`. The build minifies and copies every unique registered catalog
to `dist/` as `frigate-view-card-locale-<locale>.json`; release packaging must
ship these files beside the runtime and editor artifacts.

`en.json` is the source of truth for keys and named placeholders. Plain-text
nodes and attributes can use `data-fvc-i18n` and the attribute variants in
`localized-dom.js`; changing status and validation text can use
`setLocalizedText()` so its key and placeholder values survive a language
change. Attribute markers can share `data-fvc-i18n-values` for named values.
For formatted help text, keep placeholders in one translated sentence and
insert the formatted elements as DOM nodes, so translations can reorder them
without treating dictionary text as HTML.
Camera names, user-configured text, and Frigate-provided labels are data, not
UI translations.

Displayed dates use the resolved card language and Home Assistant's configured
time zone. The English fallback keeps the card's existing month/day, ordinal,
and 12-hour presentation. An explicit Home Assistant 12/24-hour preference
overrides the default time style. Internal day keys and time-zone arithmetic
remain locale-independent.
