import { describe, expect, it } from 'vitest';
import run from '../../scripts/ux-metrics-comment.mjs';
import {
  UX_COMMENT_MARKER,
  buildUxMetrics,
  parseUxComment,
  renderUxComment,
} from '../../scripts/ux-metrics-lib.mjs';

const METRICS = buildUxMetrics({
  firstSatelliteFrameMs: 812,
  fps: { fps: 59.8, frames: 598, maxGapMs: 33, windowMs: 10_000 },
  controls: { desktop: 8, mobile: 5 },
  secondLoop: {
    frames: 15,
    requests: 465,
    newTiles: 0,
    requestsPerFrame: 31,
    newTilesPerFrame: 0,
    msPerFrame: 785,
  },
});

interface Comment {
  id: number;
  body: string;
  user: { type: string };
}

function fakes(opts: {
  comments?: Comment[];
  fork?: boolean;
  file?: string | null;
}) {
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const warnings: string[] = [];
  const listComments = () => undefined;
  const github = {
    paginate: async (fn: unknown, args: Record<string, unknown>) => {
      expect(fn).toBe(listComments);
      calls.push({ method: 'list', args });
      return opts.comments ?? [];
    },
    rest: {
      issues: {
        listComments,
        createComment: async (args: Record<string, unknown>) => {
          calls.push({ method: 'create', args });
        },
        updateComment: async (args: Record<string, unknown>) => {
          calls.push({ method: 'update', args });
        },
      },
    },
  };
  const context = {
    repo: { owner: 'o', repo: 'r' },
    serverUrl: 'https://github.com',
    runId: 42,
    payload: {
      pull_request: {
        number: 7,
        head: {
          sha: 'abcdef1234567',
          repo: { full_name: opts.fork ? 'someone/r' : 'o/r' },
        },
      },
    },
  };
  const core = {
    warning: (m: string) => warnings.push(m),
    info: () => undefined,
  };
  const readFile = () => {
    if (opts.file === null) throw new Error('ENOENT');
    return opts.file ?? JSON.stringify(METRICS);
  };
  return { deps: { github, context, core, readFile }, calls, warnings };
}

describe('ux-metrics comment runner', () => {
  it('creates the one comment when there is none', async () => {
    const f = fakes({
      comments: [{ id: 1, body: 'LGTM', user: { type: 'User' } }],
    });
    expect(await run(f.deps)).toBe('created');
    const create = f.calls.find((c) => c.method === 'create');
    expect(create?.args.issue_number).toBe(7);
    const body = String(create?.args.body);
    expect(body.startsWith(UX_COMMENT_MARKER)).toBe(true);
    expect(body).toContain('actions/runs/42');
    expect(parseUxComment(body)).toEqual(METRICS);
    expect(f.warnings).toEqual([]);
  });

  it('updates the bot comment in place, diffing against its numbers', async () => {
    const previous = { ...METRICS, firstSatelliteFrameMs: 700 };
    const f = fakes({
      comments: [
        // A human quoting the marker is never edited.
        { id: 2, body: `> ${UX_COMMENT_MARKER}`, user: { type: 'User' } },
        { id: 3, body: renderUxComment(previous), user: { type: 'Bot' } },
      ],
    });
    expect(await run(f.deps)).toBe('updated');
    const update = f.calls.find((c) => c.method === 'update');
    expect(update?.args.comment_id).toBe(3);
    expect(String(update?.args.body)).toContain('+112 ms (worse)');
    expect(f.calls.some((c) => c.method === 'create')).toBe(false);
  });

  it('raises one warning per missed soft target', async () => {
    const f = fakes({
      file: JSON.stringify({ ...METRICS, loopFps: 12 }),
    });
    await run(f.deps);
    expect(f.warnings).toHaveLength(1);
    expect(f.warnings[0]).toContain('loop fps 12');
  });

  it('still comments (and warns) when the spec produced no file', async () => {
    const f = fakes({ file: null });
    expect(await run(f.deps)).toBe('created');
    expect(f.warnings).toHaveLength(1);
    const body = String(f.calls.find((c) => c.method === 'create')?.args.body);
    expect(body).toContain('did not produce `ux-metrics.json`');
  });

  it('only warns on a fork PR (read-only token)', async () => {
    const f = fakes({
      fork: true,
      file: JSON.stringify({ ...METRICS, loopFps: 12 }),
    });
    expect(await run(f.deps)).toBe('skipped-fork');
    expect(f.calls).toEqual([]);
    expect(f.warnings).toHaveLength(1);
  });
});
