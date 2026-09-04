import compat from "eslint-plugin-compat";

export default [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      compat,
    },
    rules: {
      "compat/compat": "error",
    },
  },
];
