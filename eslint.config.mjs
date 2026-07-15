import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Build config array before passing to defineConfig
const baseConfig = [
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // DB-19c: Disable react/no-danger (we use dangerouslySetInnerHTML for Markdown rendering)
  {
    rules: {
      "react/no-danger": "off",
    },
  },
  // DB-19b: Prevent SUPABASE_SERVICE_ROLE_KEY usage in client-side code
  // Blocks service role key imports outside server directories (lib/supabase.ts, app/api/, src/)
  {
    files: ["**/*.ts", "**/*.tsx"],
    excludedFiles: ["lib/supabase.ts", "app/api/**/*", "src/**/*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["*"],
              message:
                "SUPABASE_SERVICE_ROLE_KEY must not be used in client-side code. Use anon key only.",
            },
          ],
        },
      ],
    },
  },
];

const eslintConfig = defineConfig(baseConfig);

export default eslintConfig;