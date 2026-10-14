// Nocturne auth worker: swaps a GitHub login code for a user token.
// GitHub's code exchange needs the App's client secret and sends no CORS headers,
// so the admin page cannot do it alone. This is the only thing this worker does.
//
// Deploy: Cloudflare dashboard > Workers & Pages > Create > Hello World > Edit code,
// paste this file, deploy. Then Settings > Variables and Secrets:
//   CLIENT_ID      (Text)   the GitHub App's client ID
//   CLIENT_SECRET  (Secret) the GitHub App's client secret
// It answers POST /token, and only for pages served from SITE. It never logs the
// code or the token, and it drops the refresh token before replying.

const SITE = 'https://hpotty36.github.io';
const GITHUB = 'https://github.com/login/oauth/access_token';
const MAX_FIELD = 512;

// Every reply is JSON, never cached, and allowed cross-origin only for SITE.
function reply(request, status, body, extra = {}) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    ...extra,
  });
  if (request.headers.get('Origin') === SITE) headers.set('Access-Control-Allow-Origin', SITE);
  if (body === null) return new Response(null, { status, headers });
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

const isField = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD;

// The three fields the admin page sends, or null when the body is not what it should be.
async function readBody(request) {
  let data;
  try {
    data = JSON.parse(await request.text());
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const { code, code_verifier, redirect_uri } = data;
  if (!isField(code) || !isField(code_verifier) || !isField(redirect_uri)) return null;
  return { code, code_verifier, redirect_uri };
}

// GitHub's answer for the exchange as {ok, data} (data a JSON object), or null when GitHub could not be reached or
// did not answer with one. Its HTTP status is not enough: an unknown client_id is a 404 with {"error":"Not Found"}.
async function exchange(env, fields) {
  try {
    const res = await fetch(GITHUB, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, ...fields }),
    });
    const data = await res.json();
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? { ok: res.ok, data } : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/token') return reply(request, 404, { error: 'not_found' });
    if (request.method !== 'POST' && request.method !== 'OPTIONS') {
      return reply(request, 405, { error: 'method_not_allowed' }, { Allow: 'POST, OPTIONS' });
    }
    if (request.headers.get('Origin') !== SITE) return reply(request, 403, { error: 'forbidden' });
    if (request.method === 'OPTIONS') {
      return reply(request, 204, null, {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
    }
    if (!env.CLIENT_ID || !env.CLIENT_SECRET) return reply(request, 500, { error: 'not_configured' });

    const fields = await readBody(request);
    if (!fields) return reply(request, 400, { error: 'bad_request' });

    const answer = await exchange(env, fields);
    if (!answer) return reply(request, 502, { error: 'github_unreachable' });
    const { ok, data } = answer;
    if (typeof data.error === 'string') return reply(request, 400, { error: data.error }); // whatever GitHub's status
    if (!ok || typeof data.access_token !== 'string' || !data.access_token) return reply(request, 502, { error: 'github_unreachable' });

    const token = { access_token: data.access_token };
    if (Number.isFinite(data.expires_in)) token.expires_in = data.expires_in;
    return reply(request, 200, token);
  },
};
