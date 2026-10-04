import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.HTMLElement ??= class {};
const { FrigateLiveStreamElement } = await import("../src/features/live/stream.element.js");
const flush = () => new Promise((resolve) => queueMicrotask(resolve));
const orchestrator = () => ({ stops: 0, async stop() { this.stops += 1; } });

test("a synchronous layout move preserves the pending Frigate race", async () => {
  const host = new FrigateLiveStreamElement();
  const race = orchestrator();
  host.attachOrchestrator(race);
  host.isConnected = false;
  host.disconnectedCallback();
  host.isConnected = true;
  await flush();
  assert.equal(race.stops, 0);
  assert.equal(host._orchestrator, race);
});

test("permanent removal stops the pending Frigate race exactly once", async () => {
  const host = new FrigateLiveStreamElement();
  const race = orchestrator();
  host.attachOrchestrator(race);
  host.isConnected = false;
  host.disconnectedCallback();
  host.disconnectedCallback();
  await flush();
  assert.equal(race.stops, 1);
  assert.equal(host._orchestrator, null);
});

test("a queued disconnect cannot stop a replacement race", async () => {
  const host = new FrigateLiveStreamElement();
  const previous = orchestrator();
  const replacement = orchestrator();
  host.attachOrchestrator(previous);
  host.disconnectedCallback();
  host.attachOrchestrator(replacement);
  await flush();
  assert.equal(previous.stops, 1);
  assert.equal(replacement.stops, 0);
  assert.equal(host._orchestrator, replacement);
});

test("a settled race is no longer owned by a queued host disconnect", async () => {
  const host = new FrigateLiveStreamElement();
  const race = orchestrator();
  host.attachOrchestrator(race);
  host.disconnectedCallback();
  host.clearOrchestrator(race);
  await flush();
  assert.equal(race.stops, 0);
});
