# Security policy

Please report vulnerabilities privately through GitHub security advisories on this repository, not in public issues.
We acknowledge reports within 3 working days and aim to release a fix within 90 days, coordinating disclosure with you.

Supported versions: the latest minor release. Self-hosters should keep `OPENRENT_ENCRYPTION_KEY` secret, run the API with a
database role that cannot bypass row-level security, and terminate TLS in front of the API (the bundled Caddy does this).
