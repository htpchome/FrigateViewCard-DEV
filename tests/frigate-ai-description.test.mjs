import test from "node:test";
import assert from "node:assert/strict";

import { resolveFrigateAiDescription } from "../src/integrations/frigate/ai-description.js";
import {
  buildEventListItemHtml,
  buildEventListItemModel,
} from "../src/data/event-list.model.js";
import {
  buildReviewListItemHtml,
  buildReviewListItemModel,
} from "../src/data/review-list.model.js";

const ICONS = {
  calendar: "<calendar />",
  clips: "<clips />",
  clock: "<clock />",
  creation: "<creation />",
  download: "<download />",
  person: "<person />",
  pin: "<pin />",
  snapshot: "<snapshot />",
  star: "<star />",
  starO: "<star-o />",
};

const deps = {
  cap: (value) => String(value || ""),
  icons: ICONS,
  labelColor: () => "#fff",
  media: () => "/thumbnail.jpg",
  durationLabel: () => 10,
  formatTime: () => "1:00 pm",
  formatDay: () => "Fri Nov 28",
  resolveSourceEvent: () => null,
  resolveSourceEventId: () => "event-1",
  findEventById: () => ({
    id: "event-1",
    label: "person",
    has_clip: true,
    has_snapshot: true,
  }),
  t: (_key, values = {}) =>
    values.title ? `View AI analysis: ${values.title}` : "translated",
};

const review = {
  id: "review-1",
  severity: "alert",
  start_time: 1,
  data: {
    detections: ["event-1"],
    objects: ["person"],
    metadata: {
      title: "Person waits near the front door",
      scene: "A person remains beside the front door and looks toward the driveway.",
      confidence: 0.91,
      other_concerns: ["Package remains unattended"],
    },
  },
};

test("normalizes Frigate AI review metadata without inventing a title", () => {
  assert.deepEqual(resolveFrigateAiDescription(review), {
    title: "Person waits near the front door",
    description:
      "A person remains beside the front door and looks toward the driveway.",
    score: 91,
    concerns: ["Package remains unattended"],
  });
  assert.equal(
    resolveFrigateAiDescription({ data: { metadata: { scene: "No title" } } }),
    null,
  );
});

test("review rows render an AI title control only when AI metadata has a title", () => {
  const model = buildReviewListItemModel(review, deps);
  const html = buildReviewListItemHtml(model, { cap: deps.cap, icons: ICONS });

  assert.match(html, /has-ai-description/);
  assert.match(html, /data-ai-description-open/);
  assert.match(html, /Person waits near the front door/);
  assert.match(html, /data-ai-score="91"/);

  const withoutAi = buildReviewListItemModel(
    { ...review, data: { ...review.data, metadata: undefined } },
    deps,
  );
  assert.doesNotMatch(
    buildReviewListItemHtml(withoutAi, { cap: deps.cap, icons: ICONS }),
    /data-ai-description-open|has-ai-description/,
  );
});

test("event rows use the matching review AI analysis without changing event data", () => {
  const model = buildEventListItemModel(
    {
      id: "event-1",
      label: "person",
      start_time: 1,
      has_clip: true,
      has_snapshot: true,
    },
    { ...deps, aiReview: review },
  );
  const html = buildEventListItemHtml(model, {
    icons: ICONS,
    expanded: false,
    compact: false,
  });

  assert.match(html, /has-ai-description/);
  assert.match(html, /data-ai-description-open/);
  assert.match(html, /Package remains unattended/);
});
