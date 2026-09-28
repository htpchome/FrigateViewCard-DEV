import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  LANGUAGE_ASSET_NAMES,
  LANGUAGE_ASSET_PREFIX,
} from "../src/features/localization/catalogs.mjs";

const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);

test("HACS release artifact is generated under dist", () => {
  const manifest = JSON.parse(
    fs.readFileSync(repositoryFile("hacs.json"), "utf8"),
  );
  const packageJson = JSON.parse(
    fs.readFileSync(repositoryFile("package.json"), "utf8"),
  );

  assert.equal(manifest.filename, "frigate-view-card.js");
  assert.equal(manifest.content_in_root, false);
  assert.match(packageJson.scripts.check, /dist\/frigate-view-card\.js/);
  assert.equal(fs.existsSync(repositoryFile("dist/frigate-view-card.js")), true);
  assert.equal(
    fs.existsSync(repositoryFile("dist/frigate-view-card-editor.js")),
    true,
  );
  assert.equal(
    fs.existsSync(repositoryFile("dist/frigate-view-card-circle-pad.js")),
    true,
  );
  assert.equal(
    fs.existsSync(
      repositoryFile(
        "dist/frigate-view-card-dashboard-swipe-navigation.js",
      ),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(repositoryFile("dist/frigate-view-card-navbar.js")),
    true,
  );
  assert.equal(
    fs.existsSync(repositoryFile("dist/frigate-view-card-card-view.js")),
    true,
  );
  assert.equal(
    fs.existsSync(repositoryFile("dist/frigate-view-card-grid.js")),
    true,
  );
  assert.equal(
    fs.existsSync(repositoryFile("dist/frigate-view-card-slideshow.js")),
    true,
  );
  assert.equal(
    fs.existsSync(repositoryFile("dist/frigate-view-card-preview.js")),
    true,
  );
  assert.equal(
    fs.existsSync(repositoryFile("dist/frigate-view-card-recordings.js")),
    true,
  );
  assert.equal(
    fs.existsSync(repositoryFile("dist/frigate-view-card-ptz.js")),
    true,
  );
  assert.equal(
    fs.existsSync(repositoryFile("dist/frigate-view-card-wide-view.js")),
    true,
  );
  assert.equal(
    fs.existsSync(
      repositoryFile("dist/frigate-view-card-recording-scrub.js"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      repositoryFile("dist/frigate-view-card-frame-capture.js"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      repositoryFile("dist/frigate-view-card-linked-light.js"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      repositoryFile("dist/frigate-view-card-wide-timeline.js"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      repositoryFile("dist/frigate-view-card-wide-companion.js"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      repositoryFile("dist/frigate-view-card-hls-1.5.17.js"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(
      repositoryFile("dist/frigate-view-card-hls-1.5.17.LICENSE.txt"),
    ),
    true,
  );
  assert.equal(
    fs.existsSync(repositoryFile("dist/frigate-view-card.LICENSE.txt")),
    true,
  );
  for (const language of LANGUAGE_ASSET_NAMES) {
    assert.equal(
      fs.existsSync(
        repositoryFile(`dist/${LANGUAGE_ASSET_PREFIX}-${language}.json`),
      ),
      true,
      `Missing lazy ${language} localization asset`,
    );
  }
  assert.equal(
    fs.readFileSync(
      repositoryFile("dist/frigate-view-card.LICENSE.txt"),
      "utf8",
    ),
    fs.readFileSync(repositoryFile("LICENSE"), "utf8"),
  );
  assert.equal(fs.existsSync(repositoryFile("frigate-view-card.js")), false);
});

test("HACS release artifact is production-minified", () => {
  const bundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card.js"),
    "utf8",
  );
  const navbarBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-navbar.js"),
    "utf8",
  );
  const cardViewBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-card-view.js"),
    "utf8",
  );
  const gridBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-grid.js"),
    "utf8",
  );
  const slideshowBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-slideshow.js"),
    "utf8",
  );
  const previewBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-preview.js"),
    "utf8",
  );
  const recordingsBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-recordings.js"),
    "utf8",
  );
  const ptzBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-ptz.js"),
    "utf8",
  );
  const recordingScrubBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-recording-scrub.js"),
    "utf8",
  );
  const frameCaptureBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-frame-capture.js"),
    "utf8",
  );
  const linkedLightBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-linked-light.js"),
    "utf8",
  );
  const wideTimelineBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-wide-timeline.js"),
    "utf8",
  );
  const wideCompanionBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-wide-companion.js"),
    "utf8",
  );
  const wideViewBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-wide-view.js"),
    "utf8",
  );
  const [banner] = bundle.split("\n", 1);

  assert.match(banner, /^\/\*\* FrigateView Card - generated file\./);
  assert.match(banner, /MIT license: frigate-view-card\.LICENSE\.txt/);
  assert.ok(Buffer.byteLength(bundle) < 1_900_000);
  assert.match(bundle, /frigate-view-card-hls-1\.5\.17\.js/);
  assert.match(bundle, /frigate-view-card-editor\.js/);
  assert.doesNotMatch(bundle, /frigate-view-card-circle-pad\.js/);
  assert.match(
    bundle,
    /frigate-view-card-dashboard-swipe-navigation\.js/,
  );
  assert.match(bundle, /frigate-view-card-navbar\.js/);
  assert.match(bundle, /frigate-view-card-card-view\.js/);
  assert.doesNotMatch(bundle, /card-view-page \.list-item/);
  assert.match(cardViewBundle, /data-fvc-card-view-page-styles/);
  assert.match(cardViewBundle, /card-view-page \.list-item/);
  assert.match(cardViewBundle, /card-view-natural-height/);
  assert.match(bundle, /frigate-view-card-grid\.js/);
  assert.doesNotMatch(bundle, /runtime\.grid\.empty/);
  assert.match(gridBundle, /runtime\.grid\.empty/);
  assert.match(bundle, /frigate-view-card-slideshow\.js/);
  assert.doesNotMatch(bundle, /scheduleReviewWatch\(300\)/);
  assert.match(slideshowBundle, /scheduleReviewWatch\(300\)/);
  assert.match(bundle, /frigate-view-card-preview\.js/);
  assert.doesNotMatch(bundle, /preview-grid-empty-slot/);
  assert.match(previewBundle, /data-fvc-preview-page-styles/);
  assert.match(previewBundle, /preview-grid-empty-slot/);
  assert.match(bundle, /frigate-view-card-recordings\.js/);
  assert.doesNotMatch(bundle, /_scheduledBrowseNavKey/);
  assert.match(recordingsBundle, /_scheduledBrowseNavKey/);
  assert.match(bundle, /frigate-view-card-ptz\.js/);
  assert.doesNotMatch(bundle, /\[Frigate\] PTZ motion failed/);
  assert.match(ptzBundle, /\[Frigate\] PTZ motion failed/);
  assert.match(ptzBundle, /frigate-view-card-circle-pad\.js/);
  assert.match(bundle, /frigate-view-card-wide-view\.js/);
  assert.doesNotMatch(bundle, /wide-view-start-grid/);
  assert.doesNotMatch(bundle, /\.card \.wide-view-columns\{position:relative/);
  assert.match(wideViewBundle, /wide-view-start-grid/);
  assert.match(wideViewBundle, /data-fvc-wide-view-page-styles/);
  assert.match(wideViewBundle, /wide-view-columns/);
  assert.doesNotMatch(bundle, /data-frigate-view-ha-navbar-style/);
  assert.match(navbarBundle, /data-frigate-view-ha-navbar-style/);
  assert.match(bundle, /frigate-view-card-recording-scrub\.js/);
  assert.match(bundle, /frigate-view-card-frame-capture\.js/);
  assert.doesNotMatch(bundle, /Displayed media frame is not ready/);
  assert.match(frameCaptureBundle, /Displayed media frame is not ready/);
  assert.match(bundle, /frigate-view-card-linked-light\.js/);
  assert.doesNotMatch(bundle, /data-linked-light-dimmer-dismiss/);
  assert.doesNotMatch(bundle, /data-fvc-linked-light-styles/);
  assert.match(linkedLightBundle, /data-linked-light-dimmer-dismiss/);
  assert.match(linkedLightBundle, /data-fvc-linked-light-styles/);
  assert.doesNotMatch(
    bundle,
    /runtime\.popup\.segment\.previewPlayerUnavailable/,
  );
  assert.match(
    recordingScrubBundle,
    /runtime\.popup\.segment\.previewPlayerUnavailable/,
  );
  assert.match(bundle, /frigate-view-card-wide-timeline\.js/);
  assert.doesNotMatch(bundle, /data-wide-timeline-stack-next/);
  assert.doesNotMatch(bundle, /data-fvc-wide-timeline-styles/);
  assert.match(wideTimelineBundle, /data-wide-timeline-stack-next/);
  assert.match(wideTimelineBundle, /data-fvc-wide-timeline-styles/);
  assert.match(bundle, /frigate-view-card-wide-companion\.js/);
  assert.doesNotMatch(bundle, /wide-companion-camera-select/);
  assert.doesNotMatch(bundle, /data-fvc-wide-companion-styles/);
  assert.match(wideCompanionBundle, /data-wide-companion-resize-handle/);
  assert.match(wideCompanionBundle, /data-fvc-wide-companion-styles/);
  assert.match(bundle, /frigate-view-card-locale/);
  assert.doesNotMatch(bundle, /circle-pad-clean-edges/);
  assert.doesNotMatch(bundle, /Ειδοποιήσεις/);
});

test("development deployment keeps every lazy page asset beside the card", () => {
  for (const path of [
    ".devcontainer/sync-card.sh",
    ".devcontainer/watch-card.sh",
    "README.md",
  ]) {
    const source = fs.readFileSync(repositoryFile(path), "utf8");
    assert.match(source, /frigate-view-card-card-view\.js/);
    assert.match(source, /frigate-view-card-grid\.js/);
    assert.match(source, /frigate-view-card-slideshow\.js/);
    assert.match(source, /frigate-view-card-preview\.js/);
    assert.match(source, /frigate-view-card-recordings\.js/);
    assert.match(source, /frigate-view-card-ptz\.js/);
    assert.match(source, /frigate-view-card-wide-view\.js/);
    assert.match(source, /frigate-view-card-wide-companion\.js/);
  }
  const postCreate = fs.readFileSync(
    repositoryFile(".devcontainer/post-create.sh"),
    "utf8",
  );
  assert.doesNotMatch(postCreate, /cat > .*sync-card\.sh/);
  assert.doesNotMatch(postCreate, /cat > .*watch-card\.sh/);
});

test("production bundles enable tree shaking", () => {
  const buildScript = fs.readFileSync(
    repositoryFile("scripts/build.mjs"),
    "utf8",
  );
  const runtimeBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card.js"),
    "utf8",
  );
  const editorBundle = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-editor.js"),
    "utf8",
  );

  assert.match(buildScript, /treeShaking:\s*true/);
  assert.doesNotMatch(buildScript, /treeShaking:\s*false/);
  assert.match(runtimeBundle, /M6 22h12l-6-6-6 6/);
  assert.doesNotMatch(editorBundle, /M6 22h12l-6-6-6 6/);
});

test("lazy HLS release asset matches the pinned integrity hash", () => {
  const hlsAsset = fs.readFileSync(
    repositoryFile("dist/frigate-view-card-hls-1.5.17.js"),
  );
  const integrity = createHash("sha384").update(hlsAsset).digest("base64");

  assert.equal(
    integrity,
    "9v3HcdYrO3D+OPDTjZ40RXocgE4GtXVCd3/mCS62JsM93JXgI1afJVuwjFvsu6ni",
  );
});
