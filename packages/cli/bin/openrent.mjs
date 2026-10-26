#!/usr/bin/env node
// Built CLI (pnpm --filter @openrent/cli build); in a checkout without a build, use `pnpm openrent`.
await import('../dist/main.js');
