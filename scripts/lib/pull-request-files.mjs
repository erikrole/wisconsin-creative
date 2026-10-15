const headersFor = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

/** The open same-repository pull request whose head is this exact successful CI commit. */
export async function findValidatedPullRequest(run, { repository, token, fetcher = fetch } = {}) {
  if (!run || run.event !== "pull_request" || run.conclusion !== "success" || run.head_repository?.full_name !== repository || !/^[a-f0-9]{40}$/.test(run.head_sha ?? "")) {
    throw new Error("Only successful same-repository PR validation may provision a preview");
  }
  const response = await fetcher(`https://api.github.com/repos/${repository}/commits/${run.head_sha}/pulls`, {
    headers: headersFor(token),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Could not confirm current PR: ${response.status}`);
  const prs = await response.json();
  if (!Array.isArray(prs)) throw new Error("Could not confirm current PR: unexpected response");
  const pr = prs.find((p) => p.state === "open" && p.base?.ref === "main" && p.head?.sha === run.head_sha && p.head?.ref === run.head_branch && p.head?.repo?.full_name === repository);
  if (!pr) throw new Error("Validated commit is no longer the head of an open same-repository PR; nothing deployed");
  return pr;
}

/** Every changed path, including later pages. A short first page must not hide an app file. */
export async function listPullRequestFiles(repository, number, { token, fetcher = fetch } = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) throw new Error("Unexpected repository");
  if (!Number.isInteger(number) || number < 1) throw new Error("Unexpected pull request");
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const response = await fetcher(`https://api.github.com/repos/${repository}/pulls/${number}/files?per_page=100&page=${page}`, {
      headers: headersFor(token),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Could not list pull request files: ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error("Pull request file list was not a list");
    files.push(...batch);
    if (batch.length < 100) return files;
  }
  throw new Error("Pull request file list did not end");
}
