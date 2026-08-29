# Japanese Progress Tracker

Reads WaniKani progress from the [API v2](https://docs.api.wanikani.com/20170710/)
directly from the browser. WaniKani sends CORS headers for client-side reads, so
there is no backend and nothing to deploy beyond the static files.

## The token

Use a **read-only** personal access token from
<https://www.wanikani.com/settings/personal_access_tokens>. This page only ever
issues `GET` requests; a read-only token cannot alter reviews or study material.

There are two ways to supply it, and neither one puts it in git.

### 1. Paste it into the page (works everywhere, including the live site)

Open the tracker and paste the token into the Connect box. It is written to
`localStorage` under `wk.token` on that machine and never leaves the browser
except in the `Authorization` header to `api.wanikani.com`.

### 2. `token.local.js` (local development only)

**A browser cannot read OS environment variables.** There is no API for it, and
this site is static files on GitHub Pages with no server to substitute one in —
so a `wanikanikey` environment variable cannot reach the page on its own.

The bridge is an untracked file that sets a global. `index.html` loads
`token.local.js` before everything else and it is matched by the root
`.gitignore`, so it is never committed. Generate it from the environment
variable rather than typing the token out:

```powershell
"window.WK_TOKEN = '$env:wanikanikey';" | Set-Content -Encoding ascii "Japanese\ProgressTracker\token.local.js"
```

(Run from the repo root. `-Encoding ascii` rather than `utf8` because Windows
PowerShell 5.1 writes a BOM for `utf8`, and a token is ASCII anyway.)

When `window.WK_TOKEN` is set it wins over `localStorage`, and the Disconnect
button hides itself because there would be nothing for it to clear.

**Do not commit this file, and do not wire the token into a build step or a
GitHub Actions secret.** Anything a GitHub Pages build emits is served publicly —
a token injected at build time would be readable by anyone who views source.
Revoke and reissue the token on the WaniKani settings page if it ever lands in a
commit.

## Files

Plain scripts, no modules and no build step, matching the rest of the site.
Load order is the `<script>` order.

- `wanikani.js` — API client and the assignment cache. **Zero DOM.**
- `script.js` — the view: renders the panel, wires the buttons. Only file that
  touches the DOM.
- `style.css`, `content/` — presentation and art.

Cache-busting is a `?v=` query on the stylesheet and both scripts — bump them
with `TRACKER_VERSION` in `script.js`.

## How the sync works

- `/user` and `/summary` are one request each, on every load.
- `/assignments` is cursor-paginated at 500 per page — about 19 requests for a
  finished account, against a limit of 60/minute. The result is cached in
  `localStorage` as `[subject_id, typeIndex, srs_stage]` triples.
- Every load after the first passes `updated_after` with the previous sync's
  `data_updated_at` and merges by subject id, so a repeat visit costs one
  request instead of nineteen.

## Subscription bounds the data

`subscription.max_level_granted` caps what the API returns — 3 on the free plan.
An account that reached a higher level and then lapsed keeps its `level`, but
queries above the granted level return `total_count: 0` with a 200 rather than
an error. The panel clamps to the highest served level and says so on screen, so
the counts are never mistaken for the whole account.

## Not covered

WaniKani teaches radicals, kanji and vocabulary. Kana and grammar are outside
it, so those need a different source before the tracker can show them.
