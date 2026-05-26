import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    plugins: {
      security,
    },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // ── TypeScript ────────────────────────────────────────────
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "destructuredArrayIgnorePattern": "^_"
      }],
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/ban-ts-comment": ["warn", {
        "minimumDescriptionLength": 5
      }],
      "@typescript-eslint/prefer-as-const": "warn",
      "@typescript-eslint/consistent-type-imports": ["warn", {
        "prefer": "type-imports",
        "fixStyle": "inline-type-imports"
      }],

      // ── TypeScript strict (debugging) ────────────────────────
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["warn", {
        "checksVoidReturn": false
      }],
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/restrict-plus-operands": "warn",
      "@typescript-eslint/no-confusing-void-expression": "warn",
      "@typescript-eslint/no-extra-non-null-assertion": "warn",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",
      "@typescript-eslint/prefer-promise-reject-errors": "warn",

      // ── React ─────────────────────────────────────────────────
      "react-hooks/exhaustive-deps": "warn",
      "react/no-unescaped-entities": "off",
      "react/display-name": "off",
      "react/prop-types": "off",

      // ── Next.js ───────────────────────────────────────────────
      "@next/next/no-img-element": "off",
      "@next/next/no-html-link-for-pages": "off",

      // ── Imports ───────────────────────────────────────────────
      "import/no-cycle": "warn",
      "import/no-duplicates": "warn",

      // ── General JS (debugging) ──────────────────────────────
      "eqeqeq": ["warn", "always", { "null": "ignore" }],
      "curly": ["warn", "multi-line"],
      "prefer-const": "warn",
      "no-unused-vars": "off",
      "no-console": "warn",
      "no-debugger": "warn",
      "no-empty": ["warn", { "allowEmptyCatch": true }],
      "no-unreachable": "error",
      "no-case-declarations": "warn",
      "no-fallthrough": ["warn", { "commentPattern": "falls?\\s?through" }],
      "no-constant-binary-expression": "warn",
      "no-self-compare": "warn",
      "no-template-curly-in-string": "warn",
      "no-unmodified-loop-condition": "warn",

      // ── Security ────────────────────────────────────────────────
      "security/detect-object-injection": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-non-literal-regexp": "warn",
      "security/detect-non-literal-require": "error",
      "security/detect-non-literal-fs-filename": "error",
      "security/detect-unsafe-regex": "error",
      "security/detect-pseudoRandomBytes": "error",
      "security/detect-possible-timing-attacks": "warn",
      "security/detect-buffer-noassert": "error",
      "security/detect-child-process": "error",
      "security/detect-disable-mustache-escape": "error",
      "security/detect-new-buffer": "error",
      "security/detect-bidi-characters": "warn",

      // ── Disabled (intentional) ────────────────────────────────
      "no-irregular-whitespace": "off",
      "no-redeclare": "off",
      "no-undef": "off",
      "no-useless-escape": "off",
    },
  },
  {
    files: ["**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "examples/**",
      "skills/**",
    ],
  },
];

export default eslintConfig;
