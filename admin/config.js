// Where the admin page works: the repository, the site workflow, the GitHub API, how often it looks again, and where
// "GitHub로 로그인" goes.
// DOM-free ES module.

export const CONFIG = Object.freeze({
  repo: 'HPotty36/nocturne',
  siteWorkflow: 'site.yml',
  api: 'https://api.github.com',
  pollMs: 15000,
  clientId: 'Iv23-not-set', // the GitHub App's client ID (public); set at rollout
  authorize: 'https://github.com/login/oauth/authorize',
  exchange: 'https://nocturne-auth.invalid/token', // the Worker that trades a login code for a token; set at rollout
});

/**
 * Author and committer of every commit the admin page makes. Without them GitHub uses the account's profile name and
 * email settings; this is the identity the repository's own commits use (scripts/github_api.py AUTHOR is the same).
 */
export const COMMIT_AUTHOR = Object.freeze({ name: 'HPotty36', email: '112685098+HPotty36@users.noreply.github.com' });

const LOCAL_PAGES = ['localhost', '127.0.0.1'];

/** `http://127.0.0.1:<port>` as an origin, or null for anything else (the page's CSP lets it reach only that). */
function localApi(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const local = url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== '' && url.username === '' && url.password === '';
  return local ? url.origin : null;
}

/**
 * A copy of CONFIG for the page at `location` (window.location, or a URL). Only a page opened on this computer
 * (localhost / 127.0.0.1) may point the API at a local fake GitHub with `?api=http://127.0.0.1:<port>`, and then the
 * login (authorize page and code exchange) goes to the same fake; anywhere else, and for any other address, `?api=`
 * is ignored, so a link can never send the token or a login code somewhere else.
 */
export function resolveConfig(location) {
  const config = { ...CONFIG };
  const api = new URLSearchParams(location.search).get('api');
  const local = LOCAL_PAGES.includes(location.hostname) && api ? localApi(api) : null;
  if (local) {
    config.api = local;
    config.authorize = `${local}/login/oauth/authorize`;
    config.exchange = `${local}/_auth/token`;
  }
  return config;
}
