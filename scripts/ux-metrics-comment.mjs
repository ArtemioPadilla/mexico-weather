/**
 * Story 26.2 — the `ux-metrics` workflow's actions/github-script step.
 *
 *   const { default: run } = await import(`${process.env.GITHUB_WORKSPACE}/scripts/ux-metrics-comment.mjs`);
 *   await run({ github, context, core, readFile });
 *
 * Reads test-results/ux-metrics.json, raises one `core.warning` per soft
 * threshold missed (never fails the job), and creates or updates in place
 * the ONE PR comment that carries the numbers (found by its marker, among
 * comments by a bot). Fork PRs get a read-only token: warnings only.
 * Everything it touches is injected so src/lib/ux-metrics-comment.test.ts
 * drives it with fakes.
 */
import {
  UX_COMMENT_MARKER,
  parseUxComment,
  renderUxComment,
  uxWarnings,
} from './ux-metrics-lib.mjs';

export const DEFAULT_METRICS_PATH = 'test-results/ux-metrics.json';

/**
 * @param {{
 *   github: any,
 *   context: any,
 *   core: { warning(msg: string): void, info(msg: string): void },
 *   readFile: (path: string) => string,
 *   metricsPath?: string,
 * }} deps
 * @returns {Promise<'created' | 'updated' | 'skipped-fork' | 'no-pr'>}
 */
export default async function run({
  github,
  context,
  core,
  readFile,
  metricsPath = DEFAULT_METRICS_PATH,
}) {
  let metrics = null;
  try {
    metrics = JSON.parse(readFile(metricsPath));
  } catch (err) {
    core.info(`No ${metricsPath}: ${err?.message ?? err}`);
  }
  for (const w of uxWarnings(metrics)) core.warning(w);

  const pr = context.payload?.pull_request;
  if (!pr) return 'no-pr';
  const { owner, repo } = context.repo;
  if (pr.head?.repo?.full_name !== `${owner}/${repo}`) {
    core.info('Fork PR: read-only token, numbers reported as warnings only.');
    return 'skipped-fork';
  }
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pr.number,
    per_page: 100,
  });
  const mine = comments.find(
    (c) =>
      c.user?.type === 'Bot' &&
      typeof c.body === 'string' &&
      c.body.includes(UX_COMMENT_MARKER)
  );
  const body = renderUxComment(metrics, {
    previous: mine ? parseUxComment(mine.body) : null,
    sha: pr.head?.sha ?? '',
    runUrl: `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`,
  });
  if (mine) {
    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: mine.id,
      body,
    });
    return 'updated';
  }
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: pr.number,
    body,
  });
  return 'created';
}
