import assert from "node:assert/strict";
import test from "node:test";

import { EDITOR_ICONS, ICONS } from "../src/icons.js";

const EDITOR_ICON_NAMES = [
  "cameraAdd",
  "cardView",
  "chevron",
  "close",
  "frigate",
  "gridExclude",
  "gridInclude",
  "homeAssistant",
  "lightAdd",
  "packageCheck",
  "singleView",
];

test("editor icon registry contains only editor presentation assets", () => {
  assert.deepEqual(Object.keys(EDITOR_ICONS).sort(), EDITOR_ICON_NAMES.sort());
  assert.equal(Object.hasOwn(EDITOR_ICONS, "airplayVideo"), false);
  for (const icon of Object.values(EDITOR_ICONS)) {
    assert.match(icon, /^<svg[\s\S]*<\/svg>$/);
  }
});

test("runtime icon registry excludes editor-only assets", () => {
  for (const name of [
    "cameraAdd",
    "frigate",
    "gridExclude",
    "gridInclude",
    "homeAssistant",
    "lightAdd",
    "packageCheck",
  ]) {
    assert.equal(Object.hasOwn(ICONS, name), false, name);
  }
  for (const name of ["cardView", "chevron", "close", "singleView"]) {
    assert.equal(Object.hasOwn(ICONS, name), true, name);
  }
});
