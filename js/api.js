// GitHub API access to the private data repo. Milestone 1: connection check only.

export const DATA_REPO = 'manjo-banjo/wantlist-data';

const API = 'https://api.github.com';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// Returns 'ok', 'denied' (token rejected or cannot see the repo) or 'offline'.
export async function checkAccess(token) {
  let res;
  try {
    res = await fetch(`${API}/repos/${DATA_REPO}`, { headers: headers(token), cache: 'no-store' });
  } catch (e) {
    return 'offline';
  }
  if (res.ok) {
    const repo = await res.json();
    return repo.permissions && repo.permissions.push ? 'ok' : 'denied';
  }
  return res.status === 401 || res.status === 403 || res.status === 404 ? 'denied' : 'offline';
}
