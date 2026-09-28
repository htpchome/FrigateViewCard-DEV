import test from "node:test";
import assert from "node:assert/strict";

import { EVENT_PRE_POST_ROLL_SECONDS } from "../src/constants.js";
import {
  resolveFrigateEventDuration,
  resolveFrigateEventMediaDuration,
  resolveFrigateEventPrePostRollRange,
  resolveFrigateEventRecordingRange,
  resolveFrigateReviewMediaEvent,
} from "../src/integrations/frigate/event-media.js";

test("Frigate event recording range can use the exact event bounds", () => {
  assert.deepEqual(
    resolveFrigateEventRecordingRange({
      event: { start_time: 100.8, end_time: 110.2 },
    }),
    {
      start: 100,
      end: 111,
      durationSec: 11,
    },
  );
});

test("Frigate event playback range adds the configured pre-roll and post-roll", () => {
  assert.equal(EVENT_PRE_POST_ROLL_SECONDS, 5);
  assert.deepEqual(
    resolveFrigateEventPrePostRollRange({
      event: { start_time: 100.8, end_time: 110.2 },
      enabled: true,
    }),
    {
      start: 95,
      end: 116,
      durationSec: 21,
    },
  );
});

test("Frigate event playback range requires the toggle and a completed event", () => {
  assert.equal(
    resolveFrigateEventPrePostRollRange({
      event: { start_time: 100, end_time: 110 },
      enabled: false,
    }),
    null,
  );
  assert.equal(
    resolveFrigateEventPrePostRollRange({
      event: { start_time: 100, end_time: null },
      enabled: true,
    }),
    null,
  );
  assert.equal(
    resolveFrigateEventRecordingRange({
      event: { start_time: null, end_time: 110 },
    }),
    null,
  );
});

test("Frigate event duration uses completed bounds or the current time", () => {
  assert.equal(
    resolveFrigateEventDuration({ start_time: 100.2, end_time: 109.6 }),
    9,
  );
  assert.equal(
    resolveFrigateEventDuration(
      { start_time: 100, end_time: null },
      112.4,
    ),
    12,
  );
});

test("Frigate media duration includes enabled pre-roll and post-roll", () => {
  const event = { start_time: 100, end_time: 112 };
  assert.equal(resolveFrigateEventMediaDuration(event, true), 22);
  assert.equal(resolveFrigateEventMediaDuration(event, false), 12);
});

test("Frigate review media rejects a stale first detection", () => {
  const staleId = "10000.125-stale";
  const currentId = "20005.250-current";
  const events = new Map([
    [
      staleId,
      {
        id: staleId,
        camera: "doorbell",
        start_time: 10000,
        end_time: 10030,
        has_clip: true,
      },
    ],
    [
      currentId,
      {
        id: currentId,
        camera: "doorbell",
        start_time: 20005,
        end_time: 20025,
        has_clip: true,
        has_snapshot: true,
      },
    ],
  ]);

  assert.deepEqual(
    resolveFrigateReviewMediaEvent({
      review: {
        camera: "doorbell",
        start_time: 20000,
        end_time: 20030,
        data: { detections: [staleId, currentId] },
      },
      findEventById: (id) => events.get(id) || null,
    }),
    { eventId: currentId, event: events.get(currentId) },
  );
});

test("Frigate review media can select an unhydrated in-window detection ID", () => {
  const currentId = "20005.250-current";
  assert.deepEqual(
    resolveFrigateReviewMediaEvent({
      review: {
        camera: "doorbell",
        start_time: 20000,
        end_time: 20030,
        data: {
          detections: ["10000.125-stale", currentId],
        },
      },
    }),
    { eventId: currentId, event: null },
  );
});

test("Frigate review media does not fall back to an unrelated stale event", () => {
  assert.deepEqual(
    resolveFrigateReviewMediaEvent({
      review: {
        camera: "doorbell",
        start_time: 20000,
        end_time: 20030,
        data: { detections: ["10000.125-stale"] },
      },
      findEventById: (id) => ({
        id,
        camera: "doorbell",
        start_time: 10000,
        end_time: 10030,
        has_clip: true,
      }),
    }),
    { eventId: "", event: null },
  );
});
