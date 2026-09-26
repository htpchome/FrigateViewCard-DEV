import { build, transform } from "esbuild";
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

const outputFile = "dist/frigate-view-card.js";
const editorOutputFile = "dist/frigate-view-card-editor.js";
const circlePadOutputFile = "dist/frigate-view-card-circle-pad.js";
const hlsOutputFile = "dist/frigate-view-card-hls-1.5.17.js";
const hlsLicenseOutputFile =
  "dist/frigate-view-card-hls-1.5.17.LICENSE.txt";
const cardLicenseOutputFile = "dist/frigate-view-card.LICENSE.txt";
const languageSourceDirectory = "src/features/localization/languages";
const outputBanner =
  "/** FrigateView Card - generated file. Edit src/ instead. MIT license: frigate-view-card.LICENSE.txt. */";

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
  const modernized = bundled
    .replace(/^var\s+/gm, "const ")
    .replaceAll("/* @__PURE__ */ ", "");
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
const hlsOutputSizeKib = ((await stat(hlsOutputFile)).size / 1024).toFixed(1);
const languageAssetsSizeKib = (
  languageAssetSizes.reduce((total, size) => total + size, 0) / 1024
).toFixed(1);
console.info(`  ${outputFile}  ${outputSizeKib} KiB (minified)`);
console.info(`  ${editorOutputFile}  ${editorOutputSizeKib} KiB (lazy)`);
console.info(`  ${circlePadOutputFile}  ${circlePadOutputSizeKib} KiB (lazy)`);
console.info(`  ${hlsOutputFile}  ${hlsOutputSizeKib} KiB (lazy)`);
console.info(
  `  ${LANGUAGE_ASSET_NAMES.length} locale assets  ${languageAssetsSizeKib} KiB (lazy)`,
);
