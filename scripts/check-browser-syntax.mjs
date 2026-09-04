import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const distDirectory = "dist";
const hazards = [
  {
    label: "regular-expression positive lookbehind",
    token: "(?<=",
  },
  {
    label: "regular-expression negative lookbehind",
    token: "(?<!",
  },
];

const entries = await readdir(distDirectory, { withFileTypes: true });
const bundleNames = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => entry.name)
  .sort();

if (!bundleNames.length) {
  throw new Error("No generated JavaScript bundles were found in dist/.");
}

const violations = [];

for (const bundleName of bundleNames) {
  const bundlePath = join(distDirectory, bundleName);
  const source = await readFile(bundlePath, "utf8");

  for (const { label, token } of hazards) {
    if (source.includes(token)) {
      violations.push(`${bundlePath}: contains ${label} (${token})`);
    }
  }
}

if (violations.length) {
  console.error("Generated bundle compatibility check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.info(
    `Checked ${bundleNames.length} generated JavaScript bundles for catastrophic syntax hazards.`,
  );
}
