import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-test/**",
      "media/webview/**",
      "node_modules/**",
      "out/**",
      "coverage/**",
      ".vscode-test/**",
      "images/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,mjs}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
    },
  },
  {
    files: ["webview/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
