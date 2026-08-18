/**
 * Pavii.Ai issue proxy.
 *
 * Files GitHub issues on a reporter's behalf so that people **without a GitHub
 * account** can still report problems from inside the app. GitHub has no
 * anonymous issue creation, so without this the app can only open a prefilled
 * form for reporters who are already signed in.
 *
 * The token lives here, never in the app: a token shipped inside a public
 * desktop build can be extracted and used to spam or vandalise the repository.
 *
 * Deploy: see README.md in this directory.
 */

const ALLOWED_REPO = 'buckleson/Pavii-Gui-Releases';

/** Anything larger than this is not a bug report. */
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 30_000;

/** Per-IP budget. Generous for humans, hostile to scripts. */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 600;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

/**
 * Fixed-window rate limit backed by a KV namespace.
 *
 * If KV is not bound the request is allowed through: losing rate limiting is
 * better than losing every report, and abuse is still bounded by the token
 * scope. The deploy guide treats KV as required.
 */
async function isRateLimited(env, ip) {
  if (!env.RATE_LIMIT_KV) return false;

  const key = `rl:${ip}`;
  const current = Number((await env.RATE_LIMIT_KV.get(key)) ?? 0);
  if (current >= RATE_LIMIT_MAX) return true;

  await env.RATE_LIMIT_KV.put(key, String(current + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });
  return false;
}

function validate(payload) {
  const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload?.body === 'string' ? payload.body.trim() : '';

  if (!title || !body) return { error: 'title and body are required' };
  if (title.length > MAX_TITLE_LENGTH) return { error: 'title too long' };
  if (body.length > MAX_BODY_LENGTH) return { error: 'body too long' };
  // The app always sends its own repo; refuse to be used as a generic
  // issue-creation service for other repositories.
  if (payload.repo && payload.repo !== ALLOWED_REPO) return { error: 'repo not allowed' };

  return { title, body };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405);
    }

    if (!env.GITHUB_TOKEN) {
      return json({ error: 'proxy is not configured' }, 503);
    }

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (await isRateLimited(env, ip)) {
      return json({ error: 'too many reports, try again later' }, 429);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    const validated = validate(payload);
    if (validated.error) {
      return json({ error: validated.error }, 400);
    }

    const response = await fetch(`https://api.github.com/repos/${ALLOWED_REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        // GitHub rejects API requests without a User-Agent.
        'User-Agent': 'pavii-issue-proxy',
      },
      body: JSON.stringify({
        title: validated.title,
        body: validated.body,
        labels: ['in-app report'],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('github issue creation failed', response.status, detail);
      // Do not leak GitHub's response to the client; the app falls back to the
      // browser form on any non-2xx.
      return json({ error: 'could not create issue' }, 502);
    }

    const issue = await response.json();
    return json({ html_url: issue.html_url, number: issue.number }, 201, {
      'Access-Control-Allow-Origin': '*',
    });
  },
};
