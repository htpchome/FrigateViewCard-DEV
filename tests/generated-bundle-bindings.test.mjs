import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { Linter } from "eslint";

test("generated bundles never assign to a constant binding", async () => {
  const linter = new Linter();
  const bundles = (await readdir(new URL("../dist/", import.meta.url)))
    .filter((name) => name.endsWith(".js"));
  assert.ok(bundles.length > 0);
  for (const name of bundles) {
    const source = await readFile(new URL(`../dist/${name}`, import.meta.url), "utf8");
    const errors = linter.verify(source, [{
      languageOptions: { ecmaVersion: "latest", sourceType: "module" },
      rules: { "no-const-assign": "error" },
    }]);
    assert.deepEqual(errors.map(({ message, line, column }) => ({ message, line, column })), [], name);
  }
});
