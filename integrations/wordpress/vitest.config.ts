import { defineConfig } from 'vitest/config';

// One WordPress for the whole file: the tests build on each other's settings, in order.
export default defineConfig({ test: { fileParallelism: false, testTimeout: 120_000, hookTimeout: 600_000 } });
