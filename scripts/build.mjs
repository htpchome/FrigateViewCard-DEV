import { build, transform } from "esbuild";
import { Linter } from "eslint";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { minifyStyleModule } from "./minify-style-module.mjs";
import {
  LANGUAGE_ASSET_NAMES,
  LANGUAGE_ASSET_PREFIX,
} from "../src/features/localization/catalogs.mjs";
import { CARD_DISPLAY_NAME } from "../src/product-identity.mjs";
import {
  CARD_LICENSE_ASSET_NAME,
  CARD_PICKER_DEMO_ASSET_NAME,
  CARD_VIEW_ASSET_NAME,
  CIRCLE_PAD_ASSET_NAME,
  DASHBOARD_SWIPE_ASSET_NAME,
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
  RECORDING_HLS_LICENSE_ASSET_NAME,
  RECORDING_SCRUB_ASSET_NAME,
  SLIDESHOW_RUNTIME_ASSET_NAME,
  WIDE_COMPANION_ASSET_NAME,
  WIDE_TIMELINE_ASSET_NAME,
  WIDE_VIEW_PAGE_ASSET_NAME,
} from "../src/release-artifacts.mjs";

const distAssetPath = (assetName) => `dist/${assetName}`;
const outputFile = distAssetPath(MAIN_CARD_ASSET_NAME);
const editorOutputFile = distAssetPath(EDITOR_ASSET_NAME);
const circlePadOutputFile = distAssetPath(CIRCLE_PAD_ASSET_NAME);
const dashboardSwipeOutputFile = distAssetPath(
  DASHBOARD_SWIPE_ASSET_NAME,
);
const navbarOutputFile = distAssetPath(NAVBAR_ASSET_NAME);
const recordingScrubOutputFile = distAssetPath(
  RECORDING_SCRUB_ASSET_NAME,
);
const frameCaptureOutputFile = distAssetPath(FRAME_CAPTURE_ASSET_NAME);
const linkedLightOutputFile = distAssetPath(LINKED_LIGHT_ASSET_NAME);
const cardViewOutputFile = distAssetPath(CARD_VIEW_ASSET_NAME);
const gridOutputFile = distAssetPath(GRID_RUNTIME_ASSET_NAME);
const slideshowOutputFile = distAssetPath(SLIDESHOW_RUNTIME_ASSET_NAME);
const previewOutputFile = distAssetPath(PREVIEW_PAGE_ASSET_NAME);
const recordingsOutputFile = distAssetPath(RECORDINGS_RUNTIME_ASSET_NAME);
const ptzOutputFile = distAssetPath(PTZ_RUNTIME_ASSET_NAME);
const pictureInPictureOutputFile = distAssetPath(
  PICTURE_IN_PICTURE_ASSET_NAME,
);
const cardPickerDemoOutputFile = distAssetPath(
  CARD_PICKER_DEMO_ASSET_NAME,
);
const editorPreviewDraftOutputFile = distAssetPath(
  EDITOR_PREVIEW_DRAFT_ASSET_NAME,
);
const wideViewOutputFile = distAssetPath(WIDE_VIEW_PAGE_ASSET_NAME);
const wideCompanionOutputFile = distAssetPath(WIDE_COMPANION_ASSET_NAME);
const wideTimelineOutputFile = distAssetPath(WIDE_TIMELINE_ASSET_NAME);
const hlsOutputFile = distAssetPath(RECORDING_HLS_JS_ASSET_NAME);
const hlsLicenseOutputFile = distAssetPath(
  RECORDING_HLS_LICENSE_ASSET_NAME,
);
const cardLicenseOutputFile = distAssetPath(CARD_LICENSE_ASSET_NAME);
const languageSourceDirectory = "src/features/localization/languages";
const outputBanner =
  `/** ${CARD_DISPLAY_NAME} - generated file. Edit src/ instead. MIT license: ${CARD_LICENSE_ASSET_NAME}. */`;

const minifyStyleModulesPlugin = {
  name: "minify-style-modules",
  setup(pluginBuild) {
    pluginBuild.onLoad(
      { filter: /(?:styles|circle-pad)\.js$/ },
      async ({ path }) => ({
        contents: await minifyStyleModule(await readFile(path, "utf8"), {
          rootStyleModule: path.endsWith("/src/styles.js"),
        }),
        loader: "js",
      }),
    );
  },
};

const bindingLinter = new Linter();
const buildBundle = async ({ entryPoint, outfile }) => {
  const { outputFiles } = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    target: "es2020",
    treeShaking: true,
    charset: "utf8",
    plugins: [minifyStyleModulesPlugin],
    outfile,
    write: false,
    logLevel: "silent",
  });
  const bundled = outputFiles[0]?.text;
  if (!bundled) throw new Error(`esbuild did not produce ${outfile}`);
  // esbuild lowers module-level let/const to var. Restore modern declarations
  // using scope analysis: reassigned bindings must stay mutable.
  const { output: modernized, messages } = bindingLinter.verifyAndFix(
    bundled.replace(/^var\s+/gm, "let ").replaceAll("/* @__PURE__ */ ", ""),
    [{
      languageOptions: { ecmaVersion: "latest", sourceType: "module" },
      rules: { "no-var": "error", "prefer-const": "warn", "no-const-assign": "error" },
    }],
  );
  const bindingErrors = messages.filter(({ severity }) => severity === 2);
  if (bindingErrors.length) {
    throw new Error(`Unsafe bundle bindings in ${outfile}: ${bindingErrors.map(({ message }) => message).join("; ")}`);
  }
  const { code: minified } = await transform(modernized, {
    loader: "js",
    format: "esm",
    target: "es2020",
    minify: true,
    charset: "utf8",
    legalComments: "none",
  });
  const output = `${outputBanner}\n${minified}`;
  await writeFile(outfile, output, "utf8");
  return output;
};

await mkdir("dist", { recursive: true });
const editorOutput = await buildBundle({
  entryPoint: "src/editor/index.js",
  outfile: editorOutputFile,
});
const circlePadOutput = await buildBundle({
  entryPoint: "src/components/circle-pad/circle-pad.js",
  outfile: circlePadOutputFile,
});
const dashboardSwipeOutput = await buildBundle({
  entryPoint:
    "src/integrations/home-assistant/dashboard-swipe-navigation.ctrl.js",
  outfile: dashboardSwipeOutputFile,
});
const navbarOutput = await buildBundle({
  entryPoint: "src/integrations/home-assistant/navbar.ctrl.js",
  outfile: navbarOutputFile,
});
const recordingScrubOutput = await buildBundle({
  entryPoint: "src/features/popup/recording-scrub.ctrl.js",
  outfile: recordingScrubOutputFile,
});
const frameCaptureOutput = await buildBundle({
  entryPoint: "src/card/frame-capture.companion.js",
  outfile: frameCaptureOutputFile,
});
const linkedLightOutput = await buildBundle({
  entryPoint: "src/features/linked-entities/light.ctrl.js",
  outfile: linkedLightOutputFile,
});
const cardViewOutput = await buildBundle({
  entryPoint: "src/features/card-view/page.companion.js",
  outfile: cardViewOutputFile,
});
const gridOutput = await buildBundle({
  entryPoint: "src/features/grid/runtime.companion.js",
  outfile: gridOutputFile,
});
const slideshowOutput = await buildBundle({
  entryPoint: "src/features/slideshow/runtime.companion.js",
  outfile: slideshowOutputFile,
});
const previewOutput = await buildBundle({
  entryPoint: "src/features/preview/page.companion.js",
  outfile: previewOutputFile,
});
const recordingsOutput = await buildBundle({
  entryPoint: "src/features/recordings/runtime.companion.js",
  outfile: recordingsOutputFile,
});
const ptzOutput = await buildBundle({
  entryPoint: "src/features/ptz/runtime.companion.js",
  outfile: ptzOutputFile,
});
const pictureInPictureOutput = await buildBundle({
  entryPoint: "src/shared/media/picture-in-picture.companion.js",
  outfile: pictureInPictureOutputFile,
});
const cardPickerDemoOutput = await buildBundle({
  entryPoint: "src/features/editor-preview/card-picker-demo.ctrl.js",
  outfile: cardPickerDemoOutputFile,
});
const editorPreviewDraftOutput = await buildBundle({
  entryPoint: "src/features/editor-preview/draft.ctrl.js",
  outfile: editorPreviewDraftOutputFile,
});
const wideViewOutput = await buildBundle({
  entryPoint: "src/features/wide-view/page.companion.js",
  outfile: wideViewOutputFile,
});
const wideCompanionOutput = await buildBundle({
  entryPoint: "src/features/wide-view/companion.ctrl.js",
  outfile: wideCompanionOutputFile,
});
const wideTimelineOutput = await buildBundle({
  entryPoint: "src/features/wide-view/timeline.ctrl.js",
  outfile: wideTimelineOutputFile,
});
// Write the watched runtime artifact last so dev sync never copies a stale
// companion bundle alongside a newly built card.
const output = await buildBundle({
  entryPoint: "src/index.js",
  outfile: outputFile,
});
// Keep HLS.js outside the startup bundle. Runtime loads it only when native HLS
// is unavailable and the selected recording source requires it.
await copyFile("node_modules/hls.js/dist/hls.min.js", hlsOutputFile);
await copyFile("node_modules/hls.js/LICENSE", hlsLicenseOutputFile);
await copyFile("LICENSE", cardLicenseOutputFile);
const languageAssetSizes = await Promise.all(
  LANGUAGE_ASSET_NAMES.map(async (language) => {
    const source = await readFile(
      `${languageSourceDirectory}/${language}.json`,
      "utf8",
    );
    const outputPath = `dist/${LANGUAGE_ASSET_PREFIX}-${language}.json`;
    const output = `${JSON.stringify(JSON.parse(source))}\n`;
    await writeFile(outputPath, output, "utf8");
    await chmod(outputPath, 0o644);
    return Buffer.byteLength(output);
  }),
);
await chmod(hlsOutputFile, 0o644);
await chmod(hlsLicenseOutputFile, 0o644);
await chmod(cardLicenseOutputFile, 0o644);

const outputSizeKib = (Buffer.byteLength(output) / 1024).toFixed(1);
const editorOutputSizeKib = (
  Buffer.byteLength(editorOutput) / 1024
).toFixed(1);
const circlePadOutputSizeKib = (
  Buffer.byteLength(circlePadOutput) / 1024
).toFixed(1);
const dashboardSwipeOutputSizeKib = (
  Buffer.byteLength(dashboardSwipeOutput) / 1024
).toFixed(1);
const navbarOutputSizeKib = (
  Buffer.byteLength(navbarOutput) / 1024
).toFixed(1);
const recordingScrubOutputSizeKib = (
  Buffer.byteLength(recordingScrubOutput) / 1024
).toFixed(1);
const frameCaptureOutputSizeKib = (
  Buffer.byteLength(frameCaptureOutput) / 1024
).toFixed(1);
const linkedLightOutputSizeKib = (
  Buffer.byteLength(linkedLightOutput) / 1024
).toFixed(1);
const cardViewOutputSizeKib = (
  Buffer.byteLength(cardViewOutput) / 1024
).toFixed(1);
const gridOutputSizeKib = (
  Buffer.byteLength(gridOutput) / 1024
).toFixed(1);
const slideshowOutputSizeKib = (
  Buffer.byteLength(slideshowOutput) / 1024
).toFixed(1);
const previewOutputSizeKib = (
  Buffer.byteLength(previewOutput) / 1024
).toFixed(1);
const recordingsOutputSizeKib = (
  Buffer.byteLength(recordingsOutput) / 1024
).toFixed(1);
const ptzOutputSizeKib = (
  Buffer.byteLength(ptzOutput) / 1024
).toFixed(1);
const pictureInPictureOutputSizeKib = (
  Buffer.byteLength(pictureInPictureOutput) / 1024
).toFixed(1);
const cardPickerDemoOutputSizeKib = (
  Buffer.byteLength(cardPickerDemoOutput) / 1024
).toFixed(1);
const editorPreviewDraftOutputSizeKib = (
  Buffer.byteLength(editorPreviewDraftOutput) / 1024
).toFixed(1);
const wideViewOutputSizeKib = (
  Buffer.byteLength(wideViewOutput) / 1024
).toFixed(1);
const wideCompanionOutputSizeKib = (
  Buffer.byteLength(wideCompanionOutput) / 1024
).toFixed(1);
const wideTimelineOutputSizeKib = (
  Buffer.byteLength(wideTimelineOutput) / 1024
).toFixed(1);
const hlsOutputSizeKib = ((await stat(hlsOutputFile)).size / 1024).toFixed(1);
const languageAssetsSizeKib = (
  languageAssetSizes.reduce((total, size) => total + size, 0) / 1024
).toFixed(1);
console.info(`  ${outputFile}  ${outputSizeKib} KiB (minified)`);
console.info(`  ${editorOutputFile}  ${editorOutputSizeKib} KiB (lazy)`);
console.info(`  ${circlePadOutputFile}  ${circlePadOutputSizeKib} KiB (lazy)`);
console.info(
  `  ${dashboardSwipeOutputFile}  ${dashboardSwipeOutputSizeKib} KiB (lazy)`,
);
console.info(`  ${navbarOutputFile}  ${navbarOutputSizeKib} KiB (lazy)`);
console.info(
  `  ${recordingScrubOutputFile}  ${recordingScrubOutputSizeKib} KiB (lazy)`,
);
console.info(
  `  ${frameCaptureOutputFile}  ${frameCaptureOutputSizeKib} KiB (lazy)`,
);
console.info(
  `  ${linkedLightOutputFile}  ${linkedLightOutputSizeKib} KiB (lazy)`,
);
console.info(`  ${cardViewOutputFile}  ${cardViewOutputSizeKib} KiB (lazy)`);
console.info(`  ${gridOutputFile}  ${gridOutputSizeKib} KiB (lazy)`);
console.info(
  `  ${slideshowOutputFile}  ${slideshowOutputSizeKib} KiB (lazy)`,
);
console.info(`  ${previewOutputFile}  ${previewOutputSizeKib} KiB (lazy)`);
console.info(
  `  ${recordingsOutputFile}  ${recordingsOutputSizeKib} KiB (lazy)`,
);
console.info(`  ${ptzOutputFile}  ${ptzOutputSizeKib} KiB (lazy)`);
console.info(
  `  ${pictureInPictureOutputFile}  ${pictureInPictureOutputSizeKib} KiB (lazy)`,
);
console.info(
  `  ${cardPickerDemoOutputFile}  ${cardPickerDemoOutputSizeKib} KiB (lazy)`,
);
console.info(
  `  ${editorPreviewDraftOutputFile}  ${editorPreviewDraftOutputSizeKib} KiB (lazy)`,
);
console.info(`  ${wideViewOutputFile}  ${wideViewOutputSizeKib} KiB (lazy)`);
console.info(
  `  ${wideCompanionOutputFile}  ${wideCompanionOutputSizeKib} KiB (lazy)`,
);
console.info(
  `  ${wideTimelineOutputFile}  ${wideTimelineOutputSizeKib} KiB (lazy)`,
);
console.info(`  ${hlsOutputFile}  ${hlsOutputSizeKib} KiB (lazy)`);
console.info(
  `  ${LANGUAGE_ASSET_NAMES.length} locale assets  ${languageAssetsSizeKib} KiB (lazy)`,
);
