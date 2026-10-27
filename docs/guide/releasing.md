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

4. **Regenerate the API document and the SDK types**, and check nothing else changed:

   ```sh
   pnpm openapi
   ```

5. **Run the release checks** once more locally: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`, and the end-to-end suite three times.
6. **Commit, tag and push**: `git commit -m "Release x.y.z"`, `git tag vx.y.z`, push with the tag.
7. **Build and push the images** for the tag (CI only builds them, it does not publish):

   ```sh
   for t in api worker storefront; do
     docker build --target $t -t ghcr.io/openrent/$t:x.y.z . && docker push ghcr.io/openrent/$t:x.y.z
   done
   ```

   The Helm chart's `appVersion` in `deploy/helm/openrent/Chart.yaml` names the same version.
8. **Publish the release notes** from the changelogs.

## After a release

- Live checks against provider sandboxes (docs/guide/live-checks.md) before announcing.
- Upgrade the demo installation with the chart or Compose (docs/guide/operations.md).
