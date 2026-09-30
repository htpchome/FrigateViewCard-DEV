# Product Rename Compatibility Plan

This plan separates the future product identity from the Frigate integration.
The new product name is intentionally undecided.

## Compatibility contract

- Existing dashboards using `type: custom:frigate-view-card` must continue to
  work without configuration changes.
- Home Assistant should show one card-picker entry for the current product
  name. The compatibility alias must not create a duplicate picker entry.
- The generated `frigate-view-card*.js`, locale, and license filenames remain
  stable compatibility assets. Existing Home Assistant resource URLs and
  cached main bundles can continue to resolve their lazy-loaded siblings.
- Internal persisted keys, event names, CSS hooks, and browser-global keys may
  retain the `fvc` or `frigate-view-card` prefix when changing them would add
  migration risk without changing user-visible branding.
- Frigate integration terminology remains where it describes the actual
  integration, API paths, entity behavior, or the `frigate_go2rtc` transport.

## Preparation completed before naming

- Product display name, custom-element tag, YAML type, editor tag, accepted
  legacy tags, and HACS update identities are derived from the identity
  contract in `src/product-identity.mjs`.
- Generated bundle, locale, and license filenames are defined once in
  `src/release-artifacts.mjs`. The build, runtime lazy loaders, and development
  deployment scripts consume that contract.
- Runtime registration has a legacy-tag path that uses subclass constructors,
  as required by the Custom Elements registry.
- Dashboard navbar ownership, dashboard swipe ownership, editor-preview
  targeting, and update-entity matching accept all supported identities.
- User-facing localized product references use a product-name placeholder.
- Tests exercise a synthetic future alias without reserving or exposing a
  placeholder product name.

## Decisions required once the name is chosen

Choose and verify the following as one identity set:

- Product name and display name.
- Canonical custom-element tag and YAML type.
- Repository name and public documentation wording.
- HACS display name and update-entity identity.
- Independent wordmark, icon, and card-picker artwork.

Before adopting the name, check relevant product, repository, package, domain,
and trademark uses. Record the selected spelling, capitalization, and slug so
they do not diverge across assets.

## Rename release procedure

1. Change `CARD_NAME` and `CARD_TAG` in `src/product-identity.mjs`.
2. Add `frigate-view-card` to `LEGACY_CARD_TAGS`; keep the new tag canonical.
3. Add the new HACS/repository match term to `CARD_UPDATE_IDENTITIES` while
   retaining `frigateviewcard`.
4. Replace the wordmark in `src/icons.js` and the card-picker artwork in
   `src/features/editor-preview/card-picker-demo.tmpl.js`. Use original product
   artwork and keep “for Frigate NVR” as compatibility text rather than part of
   the product name.
5. Update user-facing product references in HACS metadata, README content,
   screenshots, repository metadata, and documentation. Leave integration
   references to Frigate intact.
6. Keep `hacs.json` pointed at `frigate-view-card.js` and keep all existing
   generated asset filenames. A later cleanup can only remove these after an
   explicit breaking-change policy and cache-compatibility review.
7. Verify that old and new YAML types create the same card, both can open the
   visual editor, only the new card appears in the picker, and mixed-tag
   dashboards resolve navbar and swipe ownership deterministically.
8. Build all release assets and run Node, syntax, Chromium, Firefox, and WebKit
   validation before publishing the rename.

## Release communication

State clearly that existing YAML and resource URLs do not need to change. Show
the new YAML type for new configurations and identify
`custom:frigate-view-card` as a permanent compatibility alias. Describe the
product as compatible with Frigate NVR and Home Assistant without implying
affiliation or endorsement.

If the repository is renamed, verify HACS behavior before the public move and
retain the old repository URL through the hosting provider's redirect. Do not
combine the repository move with removal of any compatibility identifier.
