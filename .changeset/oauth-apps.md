---
"@openrent/core": minor
"@openrent/db": minor
"@openrent/api": minor
"@openrent/admin": minor
---

OAuth 2.1 for third-party apps: apps register themselves (or the operator registers them with a secret), owners and admins approve them on a consent page, and apps call the API with short access tokens and rotating refresh tokens. PKCE (S256) is required, a refresh token used twice ends the app's access, and Settings → Apps lists the connected apps for disconnecting.
