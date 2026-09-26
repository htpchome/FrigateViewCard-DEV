import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { minifyStyleModule } from "../scripts/minify-style-module.mjs";

test("minifies dedicated CSS template modules", async () => {
  const source = `
export const EXAMPLE_STYLES = \`
  .example {
    color: rgb(255, 0, 0);
    margin: 0px 0px 0px 0px;
  }
\`;
`;

  const result = await minifyStyleModule(source);

  assert.match(result, /\.example\{color:red;margin:0\}/);
  assert.doesNotMatch(result, /\n\s+color:/);
});

test("minifies private component CSS template constants", async () => {
  const source = `
const CIRCLE_PAD_STYLES = \`
  :host {
    display: block;
    margin: 0px 0px 0px 0px;
  }
\`;
`;

  const result = await minifyStyleModule(source);

  assert.match(result, /const CIRCLE_PAD_STYLES = `:host\{display:block;margin:0\}`/);
});

test("preserves value interpolations while minifying CSS", async () => {
  const source = `
export const EXAMPLE_STYLES = \`
  .example {
    animation: fade \${TIMING.hideMs}ms linear;
  }
  @keyframes fade {
    0%, \${FADE_START_PERCENT}% { opacity: 1; }
    100% { opacity: 0; }
  }
\`;
`;

  const result = await minifyStyleModule(source);

  assert.match(result, /fade \$\{TIMING\.hideMs\}ms linear/);
  assert.match(result, /0%,\$\{FADE_START_PERCENT\}%\{opacity:1\}/);
});

test("preserves composed root style interpolation order", async () => {
  const source = `
import { CHILD_STYLES } from "./child.styles.js";
export const STYLES = \`
  .before { color: red; }
  \${CHILD_STYLES}
  .after { color: blue; }
\`;
`;

  const result = await minifyStyleModule(source, { rootStyleModule: true });

  assert.match(result, /\.before\{color:red\}\$\{CHILD_STYLES\}\.after\{color:#00f\}/);
});

test("keeps non-ASCII CSS content safe inside JavaScript templates", async () => {
  const source = `
export const EXAMPLE_STYLES = \`
  .resize-handle::before { content: "↔"; }
  .loading::after { content: "Loading…"; }
\`;
`;

  const result = await minifyStyleModule(source);

  assert.match(result, /content:"↔"/);
  assert.match(result, /content:"Loading…"/);
  assert.doesNotMatch(result, /\\(?:2194|2026)/);
});

test("minifies the extracted editor stylesheet", async () => {
  const source = fs.readFileSync(
    new URL("../src/editor/styles.js", import.meta.url),
    "utf8",
  );
  const result = await minifyStyleModule(source);

  assert.match(result, /export const EDITOR_STYLES = `:host\{/);
  assert.ok(Buffer.byteLength(result) < Buffer.byteLength(source));
  assert.doesNotMatch(result, /\n\s+:host/);
});
