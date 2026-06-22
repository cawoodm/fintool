// GitHub directory CSV source.
//
// Parses a github.com "tree" (directory) URL and pulls the three FinTool CSVs
// via the GitHub Contents API. The Contents API is the right tool here because:
//   - it is CORS-enabled (Access-Control-Allow-Origin: *), unlike
//     raw.githubusercontent.com for PRIVATE repos;
//   - it works for private repos when given a Personal Access Token;
//   - with the "application/vnd.github.raw" Accept header it returns the file
//     body as plain text (no base64 decoding needed).
//
// Public repos work without a token (60 req/hr unauthenticated is ample for 3 files).

const API = 'https://api.github.com';

// The fixed set of files FinTool expects — the parsers (parsers.js) require
// exactly these. We fetch by name rather than listing the directory.
const FILES = ['income.csv', 'categories.csv', 'payments.csv'];

// Parse a github.com URL into { owner, repo, branch, path }.
// Accepts a directory "tree" URL, e.g.
//   https://github.com/cawoodm/my-data/tree/main/fintool/data
// and a bare repo URL (branch defaults to "main", path to "").
export function parseGithubUrl(url) {
  let u;
  try {
    u = new URL(String(url).trim());
  } catch {
    throw new Error('Not a valid URL.');
  }
  if (u.hostname !== 'github.com') {
    throw new Error('Expected a github.com URL, e.g. https://github.com/owner/repo/tree/main/path');
  }
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('URL must include an owner and repository, e.g. github.com/owner/repo/tree/main/path');
  }
  const [owner, repo, kind, branch, ...rest] = parts;
  if (kind && kind !== 'tree') {
    throw new Error(`Unsupported GitHub URL — link to a directory ("/tree/<branch>/<path>"), not "/${kind}/…".`);
  }
  return {
    owner,
    repo,
    branch: branch || 'main',
    path: rest.join('/'),
  };
}

async function fetchOne(loc, file, pat) {
  const dir = loc.path ? `${loc.path}/` : '';
  const apiUrl =
    `${API}/repos/${loc.owner}/${loc.repo}/contents/${encodeURI(dir + file)}` +
    `?ref=${encodeURIComponent(loc.branch)}`;
  const headers = { Accept: 'application/vnd.github.raw' };
  if (pat) headers.Authorization = `Bearer ${pat}`;

  let res;
  try {
    res = await fetch(apiUrl, { headers });
  } catch (e) {
    throw new Error(`Network error fetching ${file}: ${e.message}`);
  }
  if (res.ok) return res.text();

  if (res.status === 404) {
    const where = `${loc.owner}/${loc.repo}/${loc.path ? loc.path + '/' : ''}${file}@${loc.branch}`;
    throw new Error(`${file} not found at ${where} (or the repo is private — add a token below).`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      pat
        ? `Access denied for ${file} (${res.status}). Check the token has Contents:Read on this repo, or that the rate limit isn't exhausted.`
        : `Access denied for ${file} (${res.status}). Add a Personal Access Token for private repos or if rate-limited.`
    );
  }
  throw new Error(`Failed to fetch ${file}: ${res.status} ${res.statusText}.`);
}

// Fetch the three CSVs from a GitHub directory URL. Returns { income, categories,
// payments } text blobs. Does NOT touch storage — the caller validates and saves.
export async function fetchGithubCsvs(url, pat) {
  const loc = parseGithubUrl(url);
  const [income, categories, payments] = await Promise.all(
    FILES.map((f) => fetchOne(loc, f, pat))
  );
  return { income, categories, payments };
}
