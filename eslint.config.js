// Flat ESLint config (ESLint 10 / typescript-eslint 8). Runs alongside tsc (types) and Prettier
// (formatting): ESLint owns code-quality rules only, so eslint-config-prettier is applied last to
// switch off any stylistic rules that would fight Prettier.
//
// The rule sets are the type-checked `strictTypeChecked`/`stylisticTypeChecked` ones — the engine
// is a small, from-scratch interpreter where the stronger, type-aware checks (no-floating-promises,
// no-unsafe-*, etc.) are cheap to satisfy and catch real bugs. The few rule tweaks below align
// ESLint with the project's established, deliberate conventions rather than changing source — the
// existing code is the definition of "clean" here.

import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import tsdoc from "eslint-plugin-tsdoc";
import prettier from "eslint-config-prettier";

export default defineConfig(
  {
    ignores: ["node_modules/", "test-suite/", "docs/", "coverage/"],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // `eslint.config.js` itself is tooling config, not part of the tsconfig `include` (spike,
        // packages, bowtie) — let the project service fall back to a default, ungraded project for
        // it instead of erroring.
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // TSDoc syntax checking only applies to hand-written package sources — not spikes, tests, or
    // the vendored metaschema modules, which carry plain (non-TSDoc) header comments.
    files: ["packages/*/src/**/*.ts"],
    plugins: { tsdoc },
    rules: {
      "tsdoc/syntax": "error",
    },
  },
  prettier,
  {
    rules: {
      // Existence checks (`if (!x) throw ...`) followed by a non-null `!` a few lines later are a
      // pervasive, deliberate idiom here — the checks aren't expressible as type guards TS can see.
      "@typescript-eslint/no-non-null-assertion": "off",
      // Match tsconfig's `noUnusedParameters`/`noUnusedLocals`, which ignore a leading underscore
      // (a deliberately-unused binding, e.g. an unused signature parameter).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Error/diagnostic messages routinely interpolate keyword values (numbers), match verdicts
      // (booleans), and optional debug fields (nullish) — all safe, intentional stringification.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],
      // JSON Pointer segments are built with `pointer + "/" + <index>` throughout the registry and
      // test-kit — string + number concatenation is the established idiom, not implicit coercion risk.
      "@typescript-eslint/restrict-plus-operands": [
        "error",
        { allowNumberAndString: true },
      ],
    },
  },
);
