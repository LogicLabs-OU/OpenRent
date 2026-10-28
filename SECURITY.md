# Security policy

Please report vulnerabilities privately through GitHub security advisories on this repository, not in public issues.
We acknowledge reports within 3 working days and aim to release a fix within 90 days, coordinating disclosure with you.

Supported versions:

| Version | Security fixes |
| --- | --- |
| The latest minor release | Until the next minor release |
| 1.4 (long-term support, from its release) | 18 months from its release day |

Long-term support releases are listed in `docs/compatibility.md` with their end dates; see `docs/guide/releasing.md#long-term-support`.

Self-hosters should keep `OPENRENT_ENCRYPTION_KEY` secret, run the API with a
database role that cannot bypass row-level security, and terminate TLS in front of the API (the bundled Caddy does this).
