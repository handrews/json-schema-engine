// The root ESLint config, applied to this directory on its own: the root
// config ignores bench/external/ because its third-party validators are
// installed here, not in the root install, so type-aware linting of these
// scripts only works from here (`npm run check` in this directory).
import { defineConfig } from "eslint/config";
import root from "../../eslint.config.js";

export default defineConfig(
  // Everything from the root config except its global ignore list.
  root.filter(
    (block) => !("ignores" in block && Object.keys(block).length === 1),
  ),
  {
    ignores: ["node_modules/"],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
