import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  LANGUAGE_ASSET_NAMES,
  LANGUAGE_ASSET_PREFIX,
} from "../src/features/localization/catalogs.mjs";
import { CARD_DISPLAY_NAME } from "../src/product-identity.mjs";
import {
  CARD_LICENSE_ASSET_NAME,
  CARD_PICKER_DEMO_ASSET_NAME,
  CARD_VIEW_ASSET_NAME,
  COMPATIBILITY_ASSET_PREFIX,
  EDITOR_ASSET_NAME,
  EDITOR_PREVIEW_DRAFT_ASSET_NAME,
  FRAME_CAPTURE_ASSET_NAME,
  GRID_RUNTIME_ASSET_NAME,
  LINKED_LIGHT_ASSET_NAME,
  MAIN_CARD_ASSET_NAME,
  NAVBAR_ASSET_NAME,
  PICTURE_IN_PICTURE_ASSET_NAME,
  PREVIEW_PAGE_ASSET_NAME,
  PTZ_RUNTIME_ASSET_NAME,
  RECORDINGS_RUNTIME_ASSET_NAME,
  RECORDING_HLS_JS_ASSET_NAME,
  RECORDING_SCRUB_ASSET_NAME,
  RELEASE_ASSET_NAMES,
  SLIDESHOW_RUNTIME_ASSET_NAME,
  WIDE_COMPANION_ASSET_NAME,
  WIDE_TIMELINE_ASSET_NAME,
  WIDE_VIEW_PAGE_ASSET_NAME,
} from "../src/release-artifacts.mjs";

const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);
const distAsset = (assetName) => repositoryFile(`dist/${assetName}`);

test("release filenames remain on the permanent compatibility prefix", () => {
  assert.equal(COMPATIBILITY_ASSET_PREFIX, "frigate-view-card");
  assert.equal(MAIN_CARD_ASSET_NAME, "frigate-view-card.js");
  assert.deepEqual(RELEASE_ASSET_NAMES, [
    "frigate-view-card.js",
    "frigate-view-card-editor.js",
    "frigate-view-card-circle-pad.js",
    "frigate-view-card-dashboard-swipe-navigation.js",
    "frigate-view-card-navbar.js",
    "frigate-view-card-recording-scrub.js",
    "frigate-view-card-frame-capture.js",
    "frigate-view-card-linked-light.js",
    "frigate-view-card-card-view.js",
    "frigate-view-card-grid.js",
    "frigate-view-card-slideshow.js",
    "frigate-view-card-preview.js",
    "frigate-view-card-recordings.js",
    "frigate-view-card-ptz.js",
    "frigate-view-card-picture-in-picture.js",
    "frigate-view-card-card-picker-demo.js",
    "frigate-view-card-editor-preview-draft.js",
    "frigate-view-card-wide-view.js",
    "frigate-view-card-wide-companion.js",
    "frigate-view-card-wide-timeline.js",
    "frigate-view-card-hls-1.5.17.js",
    "frigate-view-card-hls-1.5.17.LICENSE.txt",
    "frigate-view-card.LICENSE.txt",
  ]);
  assert.equal(new Set(RELEASE_ASSET_NAMES).size, RELEASE_ASSET_NAMES.length);
  for (const assetName of RELEASE_ASSET_NAMES) {
    assert.match(assetName, /^frigate-view-card(?:[.-])/);
  }
});

test("HACS release artifact is generated under dist", () => {
  const manifest = JSON.parse(
    fs.readFileSync(repositoryFile("hacs.json"), "utf8"),
  );
  const packageJson = JSON.parse(
    fs.readFileSync(repositoryFile("package.json"), "utf8"),
  );

  assert.equal(manifest.filename, MAIN_CARD_ASSET_NAME);
  assert.equal(manifest.content_in_root, false);
  assert.match(packageJson.scripts.check, /dist\/frigate-view-card\.js/);
  for (const assetName of RELEASE_ASSET_NAMES) {
    assert.equal(
      fs.existsSync(distAsset(assetName)),
      true,
      `Missing release asset ${assetName}`,
    );
  }
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
    fs.readFileSync(distAsset(CARD_LICENSE_ASSET_NAME), "utf8"),
    fs.readFileSync(repositoryFile("LICENSE"), "utf8"),
  );
  assert.equal(fs.existsSync(repositoryFile(MAIN_CARD_ASSET_NAME)), false);
});

test("HACS release artifact is production-minified", () => {
  const bundle = fs.readFileSync(
    distAsset(MAIN_CARD_ASSET_NAME),
    "utf8",
  );
  const navbarBundle = fs.readFileSync(
    distAsset(NAVBAR_ASSET_NAME),
    "utf8",
  );
  const cardViewBundle = fs.readFileSync(
    distAsset(CARD_VIEW_ASSET_NAME),
    "utf8",
  );
  const gridBundle = fs.readFileSync(
    distAsset(GRID_RUNTIME_ASSET_NAME),
    "utf8",
  );
  const slideshowBundle = fs.readFileSync(
    distAsset(SLIDESHOW_RUNTIME_ASSET_NAME),
    "utf8",
  );
  const previewBundle = fs.readFileSync(
    distAsset(PREVIEW_PAGE_ASSET_NAME),
    "utf8",
  );
  const recordingsBundle = fs.readFileSync(
    distAsset(RECORDINGS_RUNTIME_ASSET_NAME),
    "utf8",
  );
  const ptzBundle = fs.readFileSync(
    distAsset(PTZ_RUNTIME_ASSET_NAME),
    "utf8",
  );
  const pictureInPictureBundle = fs.readFileSync(
    distAsset(PICTURE_IN_PICTURE_ASSET_NAME),
    "utf8",
  );
  const cardPickerDemoBundle = fs.readFileSync(
    distAsset(CARD_PICKER_DEMO_ASSET_NAME),
    "utf8",
  );
  const editorPreviewDraftBundle = fs.readFileSync(
    distAsset(EDITOR_PREVIEW_DRAFT_ASSET_NAME),
    "utf8",
  );
  const recordingScrubBundle = fs.readFileSync(
    distAsset(RECORDING_SCRUB_ASSET_NAME),
    "utf8",
  );
  const frameCaptureBundle = fs.readFileSync(
    distAsset(FRAME_CAPTURE_ASSET_NAME),
    "utf8",
  );
  const linkedLightBundle = fs.readFileSync(
    distAsset(LINKED_LIGHT_ASSET_NAME),
    "utf8",
  );
  const wideTimelineBundle = fs.readFileSync(
    distAsset(WIDE_TIMELINE_ASSET_NAME),
    "utf8",
  );
  const wideCompanionBundle = fs.readFileSync(
    distAsset(WIDE_COMPANION_ASSET_NAME),
    "utf8",
  );
  const wideViewBundle = fs.readFileSync(
    distAsset(WIDE_VIEW_PAGE_ASSET_NAME),
    "utf8",
  );
  const [banner] = bundle.split("\n", 1);

  assert.match(
    banner,
    new RegExp(`^/\\*\\* ${CARD_DISPLAY_NAME} - generated file\\.`),
  );
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
  assert.match(bundle, /frigate-view-card-picture-in-picture\.js/);
  assert.doesNotMatch(bundle, /enterpictureinpicture/);
  assert.match(pictureInPictureBundle, /enterpictureinpicture/);
  assert.match(bundle, /frigate-view-card-card-picker-demo\.js/);
  assert.doesNotMatch(bundle, /card-picker-demo-fvc-brand-logo-gold/);
  assert.match(cardPickerDemoBundle, /card-picker-demo-fvc-brand-logo-gold/);
  assert.match(bundle, /frigate-view-card-editor-preview-draft\.js/);
  assert.doesNotMatch(bundle, /editor-preview-page-disabled/);
  assert.match(editorPreviewDraftBundle, /editor-preview-page-disabled/);
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
    ".devcontainer/post-start.sh",
  ]) {
    const source = fs.readFileSync(repositoryFile(path), "utf8");
    assert.match(source, /scripts\/list-release-assets\.mjs/);
    assert.doesNotMatch(source, /frigate-view-card-card-view\.js/);
  }
  const releaseAssetScript = fs.readFileSync(
    repositoryFile("scripts/list-release-assets.mjs"),
    "utf8",
  );
  assert.match(releaseAssetScript, /RELEASE_ASSET_NAMES/);
  assert.match(releaseAssetScript, /LANGUAGE_ASSET_NAMES/);

  const readme = fs.readFileSync(repositoryFile("README.md"), "utf8");
  for (const assetName of [
    CARD_VIEW_ASSET_NAME,
    GRID_RUNTIME_ASSET_NAME,
    WIDE_VIEW_PAGE_ASSET_NAME,
    WIDE_COMPANION_ASSET_NAME,
  ]) {
    assert.match(readme, new RegExp(assetName.replaceAll(".", "\\.")));
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
    distAsset(MAIN_CARD_ASSET_NAME),
    "utf8",
  );
  const editorBundle = fs.readFileSync(
    distAsset(EDITOR_ASSET_NAME),
    "utf8",
  );

  assert.match(buildScript, /treeShaking:\s*true/);
  assert.doesNotMatch(buildScript, /treeShaking:\s*false/);
  assert.match(runtimeBundle, /M6 22h12l-6-6-6 6/);
  assert.doesNotMatch(editorBundle, /M6 22h12l-6-6-6 6/);
});

test("lazy HLS release asset matches the pinned integrity hash", () => {
  const hlsAsset = fs.readFileSync(
    distAsset(RECORDING_HLS_JS_ASSET_NAME),
  );
  const integrity = createHash("sha384").update(hlsAsset).digest("base64");

  assert.equal(
    integrity,
    "9v3HcdYrO3D+OPDTjZ40RXocgE4GtXVCd3/mCS62JsM93JXgI1afJVuwjFvsu6ni",
  );
});
