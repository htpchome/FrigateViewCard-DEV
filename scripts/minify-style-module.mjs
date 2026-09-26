import { transform } from "esbuild";

const STYLE_TEMPLATE_ASSIGNMENT =
  /(?:export\s+)?const\s+[A-Z0-9_]*STYLES\s*=\s*`/;
const STYLE_INTERPOLATION = /\$\{([^{}]+)\}/g;
const ROOT_PLACEHOLDER_PREFIX = "fvc-build-style-slot";
const VALUE_PLACEHOLDER_BASE = 314159265358979;

const valuePlaceholder = (index) => String(VALUE_PLACEHOLDER_BASE + index);

const replaceTemplateInterpolations = (css, { rootStyleModule }) => {
  const expressions = [];
  const prepared = css.replace(STYLE_INTERPOLATION, (_match, expression) => {
    const index = expressions.push(expression) - 1;
    return rootStyleModule
      ? `.${ROOT_PLACEHOLDER_PREFIX}-${index}{--${ROOT_PLACEHOLDER_PREFIX}:${index}}`
      : valuePlaceholder(index);
  });
  return { expressions, prepared };
};

const restoreTemplateInterpolations = (
  css,
  expressions,
  { rootStyleModule },
) => {
  let restored = css;
  expressions.forEach((expression, index) => {
    const placeholder = rootStyleModule
      ? `.${ROOT_PLACEHOLDER_PREFIX}-${index}{--${ROOT_PLACEHOLDER_PREFIX}:${index}}`
      : valuePlaceholder(index);
    if (!restored.includes(placeholder)) {
      throw new Error(`CSS minification removed interpolation ${index}.`);
    }
    restored = restored.replaceAll(placeholder, `\${${expression}}`);
  });
  return restored;
};

const minifyCss = async (css, options) => {
  const { expressions, prepared } = replaceTemplateInterpolations(css, options);
  const { code } = await transform(prepared, {
    loader: "css",
    minify: true,
    charset: "utf8",
    legalComments: "none",
    logLevel: "silent",
  });
  return restoreTemplateInterpolations(code.trim(), expressions, options);
};

export const minifyStyleModule = async (
  source,
  { rootStyleModule = false } = {},
) => {
  const assignmentPattern = new RegExp(STYLE_TEMPLATE_ASSIGNMENT.source, "g");
  const replacements = [];
  let match = assignmentPattern.exec(source);
  while (match) {
    const templateStart = assignmentPattern.lastIndex;
    const templateEnd = source.indexOf("`;", templateStart);
    if (templateEnd < 0) {
      throw new Error("Style template is missing its closing backtick.");
    }
    const css = source.slice(templateStart, templateEnd);
    replacements.push({
      start: templateStart,
      end: templateEnd,
      value: await minifyCss(css, { rootStyleModule }),
    });
    assignmentPattern.lastIndex = templateEnd + 2;
    match = assignmentPattern.exec(source);
  }

  return replacements.reduceRight(
    (result, { start, end, value }) =>
      `${result.slice(0, start)}${value}${result.slice(end)}`,
    source,
  );
};
