/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  /**
   * Optional Sentry DSN. When set at build time, BaseLayout renders an
   * opt-in error-monitoring script. Absent by default → fully inert.
   */
  readonly PUBLIC_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/*
 * Minimal ambient declarations for the Node built-ins used by the build-time
 * RSS endpoint (src/pages/rss.xml.ts). The project intentionally has no
 * `@types/node` dependency (Astro/Playwright are the only Node consumers and
 * the site itself ships no Node deps), so we declare just the tiny surface
 * actually used. Astro runs this code under Node at build time, so the
 * implementations exist at runtime; these only satisfy the type checker.
 */
declare module 'node:fs' {
  export function readFileSync(
    path: string,
    encoding: 'utf-8',
  ): string;
  export function statSync(path: string): { mtimeMs: number };
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
  export function resolve(...paths: string[]): string;
}

declare const process: {
  cwd(): string;
};
