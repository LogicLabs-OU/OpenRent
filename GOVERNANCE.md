# Governance

Until 1.0, OpenRent is maintained by its founding contributors. Decisions are made by lazy consensus on GitHub and escalated
to the tech lead when consensus fails. After 1.0, or once three organisations contribute regularly, an elected steering
committee of five takes over (PRD §12.2). The roadmap is public. Every feature ships in the AGPL core; hosting, support
and services fund the work, never feature flags.

## Requests for comments

Changes that others build on need an RFC before code: the data model, the REST API contract, the plugin API, the theme API, and anything that would break an upgrade. So do new releases with long-term support beyond the policy in `docs/guide/releasing.md`.

1. Open an issue with the **RFC** template. It says what changes, why, what it breaks and how people move over.
2. The RFC is open for comments for at least **14 days**, and is announced in the project's discussions.
3. The maintainers (the steering committee once it exists) decide by lazy consensus. Without consensus, a vote of the maintainers decides by simple majority; the tech lead breaks a tie.
4. An accepted RFC becomes an ADR in `docs/adr/` with the decision and its reasons, and the work can start. A declined one is closed with the reasons.

Breaking changes to the REST API, the plugin API or the theme API wait for the next major release, and the old way keeps working, with a deprecation warning, for at least one long-term support release.

