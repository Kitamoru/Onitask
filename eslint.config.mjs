import { defineConfig, globalIgnores } from "eslint/config";
import nextConfig from "eslint-config-next";

// eslint-config-next exports a flat config object (CommonJS)
// Convert to array for spreading into our config
const nextConfigArray = Array.isArray(nextConfig) ? nextConfig : [nextConfig];

// Build config array before passing to defineConfig
const baseConfig = [
  ...nextConfigArray,
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