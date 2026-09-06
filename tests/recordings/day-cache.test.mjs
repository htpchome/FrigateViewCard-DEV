import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ensureRecordingsDayCache,
  RecordingsDayCache,
  resetRecordingsDayCache,
} from "../../src/features/recordings/day-cache.js";

test("RecordingsDayCache keeps recordings metadata in one coherent entry", () => {
  const cache = new RecordingsDayCache({ maxEntries: 4 });
  const recordings = [{ id: "recording-1" }];

  cache.setRecordings("camera-a|day-1", recordings, { fetchedAt: 1234 });

  assert.deepEqual(cache.getRecordings("camera-a|day-1"), recordings);
  assert.equal(cache.getAvailability("camera-a|day-1"), true);
  assert.equal(cache.getFetchedAt("camera-a|day-1"), 1234);

  cache.setRecordings("camera-a|day-1", []);

  assert.deepEqual(cache.getRecordings("camera-a|day-1"), []);
  assert.equal(cache.getAvailability("camera-a|day-1"), false);
  assert.equal(cache.getFetchedAt("camera-a|day-1"), 1234);
  assert.equal(cache.size, 1);
});

test("RecordingsDayCache evicts the least recently used camera-day entry", () => {
  const cache = new RecordingsDayCache({ maxEntries: 3 });
  cache.setRecordings("day-1", [{ id: 1 }]);
  cache.setRecordings("day-2", [{ id: 2 }]);
  cache.setRecordings("day-3", [{ id: 3 }]);

  assert.deepEqual(cache.getRecordings("day-1"), [{ id: 1 }]);
  cache.setRecordings("day-4", [{ id: 4 }]);

  assert.equal(cache.size, 3);
  assert.equal(cache.hasRecordings("day-2"), false);
  assert.equal(cache.hasRecordings("day-1"), true);
  assert.equal(cache.hasRecordings("day-3"), true);
  assert.equal(cache.hasRecordings("day-4"), true);
});

test("RecordingsDayCache supports availability-only probe results", () => {
  const cache = new RecordingsDayCache({ maxEntries: 2 });

  cache.setAvailability("empty-day", false);

  assert.equal(cache.hasRecordings("empty-day"), false);
  assert.equal(cache.hasAvailability("empty-day"), true);
  assert.equal(cache.getAvailability("empty-day"), false);
  assert.equal(cache.size, 1);
});

test("disposed caches reject late writes and are replaced on next use", () => {
  const host = {
    _recordingsDayCache: new RecordingsDayCache({ maxEntries: 2 }),
    _recordingsDayRequestCache: new Map([["pending", Promise.resolve([])]]),
  };
  const staleCache = host._recordingsDayCache;
  staleCache.setRecordings("before-dispose", [{ id: 1 }]);

  const replacement = resetRecordingsDayCache(host);
  staleCache.setRecordings("late-result", [{ id: 2 }]);

  assert.equal(staleCache.size, 0);
  assert.equal(staleCache.hasRecordings("late-result"), false);
  assert.notEqual(replacement, staleCache);
  assert.equal(replacement.size, 0);
  assert.equal(host._recordingsDayRequestCache.size, 0);
  assert.equal(ensureRecordingsDayCache(host), replacement);
});
