import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Dług odziedziczony: ~182 błędy sprzed monorepo (głównie celowe `as any`
    // przy upsertach Supabase — patrz CLAUDE.md). Reguły zdegradowane do
    // warning, żeby CI mogło blokować nowy dług bez blokowania pracy.
    // Nowe pliki piszemy pod strict (wzorzec: packages/*/eslint.config.mjs);
    // nie dopisujemy nowych wyjątków do tej listy.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "prefer-const": "warn",
    },
  },
]);

export default eslintConfig;
