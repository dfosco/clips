export function remoteIdentityFromUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/([1-9]\d*)\/?$/);
    if (url.protocol !== 'https:' || !match) return null;
    return {
      host: url.host.toLowerCase(),
      repository: `${match[1]}/${match[2]}`.toLowerCase(),
      number: Number(match[3]),
    };
  } catch {
    return null;
  }
}

export function githubPullRequestKey(pr) {
  const remote = remoteIdentityFromUrl(pr.url || pr.html_url);
  const repository = typeof pr.repository === 'string'
    ? pr.repository
    : pr.repository?.nameWithOwner || remote?.repository || '';
  const host = String(pr.remote_host || remote?.host || '').toLowerCase();
  return `${host}#${repository.toLowerCase()}#${pr.pr_number ?? pr.number}`;
}
