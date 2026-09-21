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
    // `.snippets` holds guide code blocks extracted at test time (docs.test.ts) — transient files
    // outside the tsconfig project.
    ignores: [
      "node_modules/",
      "test-suite/",
      "docs/",
      "coverage/",
      // Its own install and its own check (bench/external/README.md): the
      // third-party validators it imports are not in the root install.
      "bench/external/",
      "**/.snippets/",
      "**/.cache/",
      "**/dist/",
      // Emitted-code fixtures: generated JS pinned byte-for-byte, not source.
      "packages/compiler/test/goldens/codegen/",
    ],
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
    // Codegen safety fence (D20/M6): the IR serializer (every module under
    // serialize/) assembles emitted code exclusively through emit.ts's js``
    // tag and typed wrappers. A raw (untagged) template literal there would
    // be a hand-assembly bypass, so it is forbidden — unit keys and messages
    // that legitimately use template literals live in plan.ts/runtime.ts,
    // outside this fence.
    files: ["packages/compiler/src/serialize/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Untagged template literals only; the sanctioned js`` tag (whose
          // quasi is a TemplateLiteral child of a TaggedTemplateExpression)
          // is allowed — it accepts only typed CodeChunk interpolations.
          selector:
            "TemplateLiteral:not(TaggedTemplateExpression > TemplateLiteral)",
          message:
            "Assemble emitted code through emit.ts (js`` + typed wrappers), not raw template literals.",
        },
      ],
    },
  },
  {
    // Vitest totals are a gate: the repo invariant is 0 skipped tests, so a
    // committed `.skip` (silently shrinks a file's coverage) or `.only`
    // (silently shrinks the whole file to one test) must fail lint. The
    // suite runner's injected `it.skip` lives in test-kit src, outside
    // these globs, and its self-test drives it through a recorder.
    files: ["packages/*/test/**/*.ts", "packages/*/src/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression > MemberExpression.callee[object.name=/^(it|describe|test)$/][property.name=/^(skip|only)$/]",
          message:
            "No vitest .skip/.only in test files — the repo gate expects 0 skipped tests.",
        },
      ],
    },
  },
  {
    // `new Function`/`eval` are confined to runtime-compile.ts (D10); the ban
    // is global so a stray code-gen site anywhere else fails the build.
    files: ["packages/**/*.ts"],
    ignores: ["packages/compiler/src/runtime-compile.ts"],
    rules: {
      "no-new-func": "error",
      "no-eval": "error",
    },
  },
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
