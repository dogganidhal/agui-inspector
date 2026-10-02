// Runs only the SC-009 browser benchmark (tests/benchmarks/interaction.spec.ts). The root config's
// testDir is tests/e2e, so the benchmark has its own: one worker, a long timeout, and headless by
// default. The required runner sets BENCHMARK_HEADED=1 for the headed foreground window the plan asks for.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'interaction.spec.ts',
  timeout: 40 * 60 * 1000,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: 'list',
  // A stalled step must fail with a message, not wait for the whole test timeout.
  use: { browserName: 'chromium', headless: process.env.BENCHMARK_HEADED !== '1', actionTimeout: 15_000 },
});
