# Contributing

Thanks for helping build OpenRent.

- Read the PRD (`.dev/general/prd.md`), especially the product principles: API first, correctness over convenience, no tier gating.
- Every feature needs an API endpoint, an OpenAPI description, tests, an audit entry for each mutation and a webhook event for each state change (PRD §11.2).
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and, with a database, `pnpm test:integration` before opening a pull request. Changes to `packages/ui` also run `pnpm --filter @openrent/ui build-storybook && pnpm storybook:a11y`.
- Add a changeset for anything users would notice: `pnpm changeset` (see [docs/guide/releasing.md](docs/guide/releasing.md)).
- Every text a person reads goes into the translation catalogues, in every language (`pnpm check:i18n`, `pnpm check:hardcoded`).
- Schema changes go through `packages/db/src/schema.ts` and `pnpm db:generate`; never write migration files by hand. New columns need a default or must allow null, so the N-1 upgrade test passes.
- Changes to the data model, the API contract or the plugin and theme APIs need an RFC issue first.
- Security problems: see [SECURITY.md](SECURITY.md); the threat model is in [docs/security/threat-model.md](docs/security/threat-model.md).
- Sign off your commits (`git commit -s`) under the [Developer Certificate of Origin](https://developercertificate.org/). There is no CLA.
