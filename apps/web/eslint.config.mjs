import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `_`-prefixed bindings are the codebase's "intentionally unused" marker
      // (destructuring a key out of an object, unused positional args).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // React Compiler advisories new in eslint-plugin-react-hooks 7. The
      // existing hydration/sync-from-storage effects predate them; surfaced as
      // warnings so they get fixed deliberately rather than in a mass rewrite.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
  {
    // global-error replaces the root layout: its "home" link is a deliberate
    // full-page navigation, since the client router is what may have failed.
    files: ["src/app/global-error.tsx"],
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  globalIgnores([
    ".next/**",
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);
