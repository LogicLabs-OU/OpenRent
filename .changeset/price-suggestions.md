---
"@openrent/core": minor
"@openrent/db": minor
"@openrent/api": minor
"@openrent/worker": minor
"@openrent/admin": minor
---

Price suggestions: each Monday the coming twelve weeks of every product are compared with how full they are and how full they were a year ago, and busy or quiet weeks get a suggested price change under Pricing → Suggestions. Accepting one makes a season price rule; nothing changes without it. The PGlite stand-in for development and CI no longer lets two connections' queries mix, which made e2e runs hang now and then.
