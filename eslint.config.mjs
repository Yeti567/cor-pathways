import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    // supabase/.temp and output/playwright are scratch written by the Supabase CLI and
    // by a Playwright run. Both are gitignored, but eslint walks the working tree rather
    // than the index, so without this anyone who starts Supabase locally or runs the
    // end-to-end suite gets a few hundred lint errors out of minified vendor files.
    ignores: [".next/**", "node_modules/**", "coverage/**", "supabase/.temp/**", "output/**"],
  },
  {
    // Honor the underscore-prefix convention for deliberately-unused bindings
    // (e.g. a server-action signature that must accept formData but ignores it).
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Standalone Node build scripts (e.g. the sales-deck generator) are CommonJS
    // tooling run directly with node, not part of the Next app's TS module graph,
    // so allow require() there.
    files: ["docs/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
