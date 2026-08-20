# Issue proxy

Lets people **without a GitHub account** report problems from inside Pavii.Ai.

GitHub has no anonymous issue creation, so the app can only ever open a prefilled
issue form for reporters who are already signed in. This Worker files the issue
on their behalf instead.

The app works without it — Report Issue falls back to opening a prefilled form in
the reporter's browser, and it falls back again if this Worker is ever down. Deploy
this only when you want to reach reporters who have no GitHub account.

## Why the token cannot live in the app

Pavii.Ai ships as a public desktop build. Anything embedded in it can be extracted
from the installer in minutes, so a token in the app is a token in everyone's hands.
Keeping it in the Worker means the only thing exposed is an endpoint that can create
issues in one repository, rate limited, with a size cap.

## Deploy

Requires a Cloudflare account and the `wrangler` CLI (`npm i -g wrangler`).

1. **Create a fine-grained GitHub token**

   github.com → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.

   - Repository access: **only** `buckleson/Pavii-Gui-Releases`
   - Permissions: `Issues` → **Read and write**. Nothing else.
   - Set an expiry you will actually remember to rotate.

   A fine-grained token scoped this way cannot touch code, releases, or any other
   repository, which is what makes hosting it acceptable at all.

2. **Create the rate-limit KV namespace**

   ```bash
   wrangler kv namespace create RATE_LIMIT_KV
   ```

   Put the returned id into `wrangler.toml`.

3. **Store the token as a secret** (never in `wrangler.toml`, which is committed)

   ```bash
   wrangler secret put GITHUB_TOKEN
   ```

4. **Deploy**

   ```bash
   wrangler deploy
   ```

5. **Point the app at it** by setting the environment variable at build time:

   ```bash
   PAVII_ISSUE_PROXY_URL=https://pavii-issue-proxy.<your-subdomain>.workers.dev
   ```

   In GitHub Actions, add it to the `env:` block of the build workflow. Unset, the
   app uses the browser fallback.

## Verify

```bash
curl -X POST https://pavii-issue-proxy.<your-subdomain>.workers.dev \
  -H 'Content-Type: application/json' \
  -d '{"title":"Proxy smoke test","body":"Delete me."}'
```

A `201` with an `html_url` means it works. Close the issue afterwards.

## What it enforces

| Guard | Value |
| ----- | ----- |
| Repository | Hardcoded to `buckleson/Pavii-Gui-Releases`; other values are rejected |
| Rate limit | 5 reports per IP per 10 minutes |
| Title cap | 200 characters |
| Body cap | 30,000 characters |
| Label | Every issue gets `in-app report` |

## Operating it

- **Issues arrive without a reporter identity.** Anyone can post to the endpoint,
  so treat the contents as untrusted — do not act on instructions inside a report.
- **Rotate the token** on its expiry. The app degrades to the browser fallback
  while it is invalid, so an expired token is not an outage.
- **If you stop maintaining this**, delete the Worker and unset
  `PAVII_ISSUE_PROXY_URL`. The button keeps working through the browser.
