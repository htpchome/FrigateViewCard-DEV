import assert from "node:assert/strict";
import test from "node:test";

import {
  findFrigateViewCardUpdateEntity,
  resolveFrigateViewCardUpdateStatus,
} from "../src/integrations/home-assistant/card-update-status.js";

test("FrigateView update entity detection ignores unrelated updates", () => {
  const states = {
    "update.home_assistant_core_update": {
      state: "on",
      attributes: { title: "Home Assistant Core" },
    },
    "update.frigateview_card_update": {
      state: "off",
      attributes: { title: "FrigateView Card" },
    },
  };

  assert.equal(
    findFrigateViewCardUpdateEntity(states)?.[0],
    "update.frigateview_card_update",
  );
});

test("FrigateView update status reports current, available, and updating states", () => {
  assert.deepEqual(
    resolveFrigateViewCardUpdateStatus({
      states: {
        "update.frigateview_card_update": {
          state: "off",
          attributes: { friendly_name: "FrigateView Card Update" },
        },
      },
    }),
    {
      entityId: "update.frigateview_card_update",
      status: "current",
      label: "Up to date",
    },
  );

  assert.deepEqual(
    resolveFrigateViewCardUpdateStatus({
      states: {
        "update.frigateview_card_update": {
          state: "on",
          attributes: {
            repository: "htpchome/FrigateViewCard",
            latest_version: "1.2.0",
          },
        },
      },
    }),
    {
      entityId: "update.frigateview_card_update",
      status: "available",
      label: "Update available: v1.2.0",
    },
  );

  assert.deepEqual(
    resolveFrigateViewCardUpdateStatus({
      states: {
        "update.frigateview_card_update": {
          state: "on",
          attributes: {
            title: "FrigateView Card",
            in_progress: true,
            latest_version: "v1.2.0",
          },
        },
      },
    }),
    {
      entityId: "update.frigateview_card_update",
      status: "updating",
      label: "Updating to v1.2.0",
    },
  );
});

test("FrigateView update status degrades cleanly when HACS has no update entity", () => {
  assert.deepEqual(resolveFrigateViewCardUpdateStatus(), {
    entityId: "",
    status: "unavailable",
    label: "Update status unavailable",
  });
});
