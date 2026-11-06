import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // CDK synth with esbuild bundling can be slow on shared CI runners
    testTimeout: 15_000,
  },
});
