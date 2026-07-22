/// <reference path="../.astro/types.d.ts" />

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}

interface ImportMetaEnv {
  readonly STRAPI_URL: string;
  readonly STRAPI_API_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Env {
  STRAPI_URL: string;
  STRAPI_API_TOKEN: string;
}
