import assert from "node:assert/strict";
import test from "node:test";

import {
  CARD_EDITOR_TAG,
  CARD_TAG,
  CARD_TYPE,
  LEGACY_CARD_TAGS,
  SUPPORTED_CARD_EDITOR_TAGS,
  SUPPORTED_CARD_TAGS,
  SUPPORTED_CARD_TYPES,
  isSupportedCardTag,
  normalizeCardTag,
  normalizeCardTags,
} from "../src/constants.js";

test("card identity constants keep the canonical and compatibility forms aligned", () => {
  assert.equal(CARD_TYPE, `custom:${CARD_TAG}`);
  assert.deepEqual(SUPPORTED_CARD_TAGS, [CARD_TAG, ...LEGACY_CARD_TAGS]);
  assert.deepEqual(
    SUPPORTED_CARD_TYPES,
    SUPPORTED_CARD_TAGS.map((tag) => `custom:${tag}`),
  );
  assert.equal(CARD_EDITOR_TAG, `${CARD_TAG}-editor`);
  assert.deepEqual(
    SUPPORTED_CARD_EDITOR_TAGS,
    SUPPORTED_CARD_TAGS.map((tag) => `${tag}-editor`),
  );
});

test("card tag matching accepts normalized canonical and future alias forms", () => {
  const futureTags = [CARD_TAG, "future-camera-card"];

  assert.equal(normalizeCardTag(` CUSTOM:${CARD_TAG.toUpperCase()} `), CARD_TAG);
  assert.deepEqual(
    normalizeCardTags([CARD_TAG, `custom:${CARD_TAG}`, "future-camera-card"]),
    [CARD_TAG, "future-camera-card"],
  );
  assert.equal(isSupportedCardTag("custom:future-camera-card", futureTags), true);
  assert.equal(isSupportedCardTag("custom:unrelated-card", futureTags), false);
});
