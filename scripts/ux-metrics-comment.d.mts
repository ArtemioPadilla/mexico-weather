/** Type surface of scripts/ux-metrics-comment.mjs for the vitest suite. */

export const DEFAULT_METRICS_PATH: string;

export interface RunDeps {
  // Octokit + the github-script context, loosely typed on purpose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  github: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any;
  core: { warning(msg: string): void; info(msg: string): void };
  readFile: (path: string) => string;
  metricsPath?: string;
}

export default function run(
  deps: RunDeps
): Promise<'created' | 'updated' | 'skipped-fork' | 'no-pr'>;
