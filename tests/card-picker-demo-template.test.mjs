import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildCardPickerDemoAlertsMarkup,
  buildCardPickerDemoLiveMarkup,
} from "../src/features/editor-preview/card-picker-demo.tmpl.js";
import { CARD_NAME } from "../src/constants.js";
import { createLocalizationController } from "../src/features/localization/localization.ctrl.js";
import { CARD_PICKER_DEMO_STYLES } from "../src/features/editor-preview/card-picker-demo.styles.js";

const markedKeys = (markup) => [
  ...markup.matchAll(/data-fvc-i18n(?:-aria-label)?="([^"]+)"/g),
].map((match) => match[1]);

test("card picker live demo uses the centralized product branding", () => {
  const markup = buildCardPickerDemoLiveMarkup();

  assert.ok(markup.includes(`${CARD_NAME} preview branding`));
  assert.match(
    markup,
    new RegExp(`data-fvc-i18n-values="[^\"]*${CARD_NAME}[^\"]*"`),
  );
  assert.match(markup, /card-picker-demo-fvc-brand-logo/);
  assert.ok(markup.includes(CARD_NAME.toUpperCase()));
  assert.match(markup, /For Home Assistant and Frigate/);
  assert.match(markup, /card-picker-demo-fvc-brand-logo-gold/);
  assert.match(markup, /fill="#000000"/);
  assert.doesNotMatch(markup, /https?:\/\//);
  assert.doesNotMatch(markup, /camera\.[a-z0-9_]+/i);
  assert.deepEqual(markedKeys(markup), [
    "runtime.cardPickerDemo.brandLabel",
    "runtime.cardPickerDemo.brandTagline",
  ]);
  const t = createLocalizationController().t;
  for (const key of markedKeys(markup)) {
    assert.notEqual(t(key), key, `Missing English translation: ${key}`);
  }
});

test("card picker alert demo renders two inert synthetic alerts", () => {
  const markup = buildCardPickerDemoAlertsMarkup();

  assert.equal(markup.match(/card-picker-demo-alert"/g)?.length, 2);
  assert.equal(markup.match(/card-picker-demo-alert-badge/g)?.length, 2);
  assert.doesNotMatch(markup, /data-review-open|data-ev|data-dl/);
  assert.doesNotMatch(markup, /https?:\/\//);
  const t = createLocalizationController().t;
  for (const key of markedKeys(markup)) {
    assert.notEqual(t(key), key, `Missing English translation: ${key}`);
  }
});

test("card picker demo styles remain scoped to the active demo card", () => {
  assert.match(CARD_PICKER_DEMO_STYLES, /\.card\.card-picker-demo/);
  assert.match(CARD_PICKER_DEMO_STYLES, /card-picker-demo-alert/);
  assert.doesNotMatch(
    CARD_PICKER_DEMO_STYLES,
    /(^|\})\s*\.list-item\s*\{/,
  );
});
