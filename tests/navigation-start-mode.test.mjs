import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PAGE_START_MODES,
  normalizePageStartMode,
  pageStartModeOptions,
  synchronizePageStartModesWithGridDefault,
} from "../src/features/navigation/start-mode.js";

test("page start modes normalize unsupported values to Live", () => {
  assert.equal(normalizePageStartMode("GRID"), PAGE_START_MODES.grid);
  assert.equal(
    normalizePageStartMode("slideshow"),
    PAGE_START_MODES.slideshow,
  );
  assert.equal(normalizePageStartMode("unsupported"), PAGE_START_MODES.live);
});

test("page start-mode availability is shared by every editor control", () => {
  assert.deepEqual(
    pageStartModeOptions({ gridEnabled: false, slideshowEnabled: true }).map(
      ({ value, disabled }) => [value, disabled],
    ),
    [
      [PAGE_START_MODES.live, false],
      [PAGE_START_MODES.grid, true],
      [PAGE_START_MODES.slideshow, false],
    ],
  );
  const disabledGrid = pageStartModeOptions().find(
    ({ value }) => value === PAGE_START_MODES.grid,
  );
  assert.match(disabledGrid.disabledReason, /Enable Grid Mode/);
});

test("Start In Grid Mode synchronizes every page start mode", () => {
  const source = {
    grid_start_in_grid_enabled: true,
    single_view_start_mode: PAGE_START_MODES.live,
    wide_view_start_mode: PAGE_START_MODES.slideshow,
    card_view_start_mode: PAGE_START_MODES.live,
  };
  const synchronized = synchronizePageStartModesWithGridDefault(source);

  assert.notEqual(synchronized, source);
  assert.equal(synchronized.single_view_start_mode, PAGE_START_MODES.grid);
  assert.equal(synchronized.wide_view_start_mode, PAGE_START_MODES.grid);
  assert.equal(synchronized.card_view_start_mode, PAGE_START_MODES.grid);
  assert.equal(
    synchronizePageStartModesWithGridDefault({
      ...source,
      grid_start_in_grid_enabled: false,
    }).wide_view_start_mode,
    PAGE_START_MODES.slideshow,
  );
});
