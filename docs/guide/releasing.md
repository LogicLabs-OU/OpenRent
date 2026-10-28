# Releasing OpenRent

For maintainers. A release is one version for every package (`fixed` in `.changeset/config.json`).

## While working

Every change people would notice gets a changeset in the same pull request:

```sh
pnpm changeset
```

Pick the packages it touches, the kind of change (patch, minor, major) and write one or two sentences for the changelog. Breaking changes to the REST API, the plugin API or the theme API are major and need an RFC issue first (see CONTRIBUTING.md).

## Cutting a release

1. **Check everything is green** on `main`: CI (lint, typecheck, unit tests, integration tests on PostgreSQL 16, end-to-end tests, Storybook with axe, the Helm chart in kind, the Docker images).
2. **Record the last migration** of this release in `packages/db/releases.json` and point `previous` at the release before it. The N-1 test (`apps/api/test/upgrade.test.ts`) then upgrades from that release's schema.
3. **Version and changelogs:**

   ```sh
   pnpm changeset version
   pnpm install
   ```

4. **Record the API versions** this release provides in the compatibility matrix, with `--lts-until=YYYY-MM-DD` for a long-term support release:

   ```sh
   node scripts/compat-matrix.ts --record
   ```

5. **Regenerate the API document and the SDK types**, and check nothing else changed:

   ```sh
   pnpm openapi
   ```

6. **Run the release checks** once more locally: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`, and the end-to-end suite three times.
7. **Commit, tag and push**: `git commit -m "Release x.y.z"`, `git tag vx.y.z`, push with the tag.
8. **Build and push the images** for the tag (CI only builds them, it does not publish):

   ```sh
   for t in api worker storefront; do
     docker build --target $t -t ghcr.io/openrent/$t:x.y.z . && docker push ghcr.io/openrent/$t:x.y.z
   done
   ```

   The Helm chart's `appVersion` in `deploy/helm/openrent/Chart.yaml` names the same version.
9. **Package the WordPress plugin and the Shopify app:** zip `integrations/wordpress/openrent` as `openrent.zip` (after `pnpm --filter @openrent/wordpress build`, which writes its translations), and deploy the Shopify theme app extension with `shopify app deploy` from `integrations/shopify`.
10. **Publish the release notes** from the changelogs.

## After a release

- Live checks against provider sandboxes (docs/guide/live-checks.md) before announcing.
- Upgrade the demo installation with the chart or Compose (docs/guide/operations.md).

## Long-term support

Every fourth minor release is a long-term support (LTS) release, starting with **1.4**. An LTS release gets security fixes and fixes for data loss for **18 months** from its release day, on its own branch. Other releases are supported until the next minor release.

**Cutting an LTS release** is a normal release with two more steps:

1. Record it with its end date: `node scripts/compat-matrix.ts --record --lts-until=YYYY-MM-DD` (18 months after the release day), and add the line to the table in `SECURITY.md`.
2. After tagging, create the branch from the tag and push it: `git branch lts/1.4 v1.4.0 && git push origin lts/1.4`.

**Fixing an LTS release:**

- A fix lands on `main` first, then is cherry-picked onto `lts/x.y`. A fix that only applies to the LTS branch is written there, with a test.
- Only security fixes and fixes for lost or wrong data go onto the branch; nothing new.
- The plugin API, the theme API and the REST API stay as they were in x.y.0. Plugins and themes made for x.y keep working through every x.y patch.
- A migration on the branch only where the fix cannot do without one. It must also land on `main`, with a name that sorts before the migrations `main` has added since x.y.0, so a database moves from the LTS branch to the next release without trouble.
- Patch releases (x.y.1, x.y.2, …) follow the steps above from the branch, with patch changesets, and their notes say which fixes they carry.

**Upgrading:** from one LTS release to the next works in one step. The N-1 test (`apps/api/test/upgrade.test.ts`) covers it when `packages/db/releases.json` names the previous LTS release as `previous` while an LTS release is cut.

When an LTS release ends, it gets a last patch release if fixes are waiting, the end is announced, and `SECURITY.md` moves it to the unsupported list.

