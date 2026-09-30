import { resolve } from "node:path";
import {
  LANGUAGE_ASSET_NAMES,
  LANGUAGE_ASSET_PREFIX,
} from "../src/features/localization/catalogs.mjs";
import { RELEASE_ASSET_NAMES } from "../src/release-artifacts.mjs";

const outputDirectory = process.argv[2] || "dist";
const assetNames = [
  ...RELEASE_ASSET_NAMES,
  ...LANGUAGE_ASSET_NAMES.map(
    (language) => `${LANGUAGE_ASSET_PREFIX}-${language}.json`,
  ),
];

for (const assetName of assetNames) {
  console.info(resolve(outputDirectory, assetName));
}
