# Contributing

Thanks for helping build OpenRent.

- Read the PRD (`.dev/general/prd.md`), especially the product principles: API first, correctness over convenience, no tier gating.
- Every feature needs an API endpoint, an OpenAPI description, tests, an audit entry for each mutation and a webhook event for each state change (PRD §11.2).
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and, with a database, `pnpm test:integration` before opening a pull request.
- Changes to the data model, the API contract or the plugin and theme APIs need an RFC issue first.
- Sign off your commits (`git commit -s`) under the [Developer Certificate of Origin](https://developercertificate.org/). There is no CLA.
