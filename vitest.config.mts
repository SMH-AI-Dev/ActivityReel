import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/unit/**/*.test.ts", "test/webview/**/*.test.{ts,tsx}"],
    environment: "node",
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 10_000,
  },
});
