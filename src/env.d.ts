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
