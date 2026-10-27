# Changesets

Every change that people using OpenRent would notice gets a changeset: `pnpm changeset`, pick the packages, write one or two sentences for the changelog. All OpenRent packages share one version (`fixed` in config.json), so a release bumps them together.

At release time `pnpm changeset version` writes the changelogs and versions; see docs/guide/releasing.md.
