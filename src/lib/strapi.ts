// Strapi 5 fetch wrapper. Works in three runtimes:
//   1. Astro dev server (Node)         → import.meta.env
//   2. Cloudflare Workers (production)  → Astro.locals.runtime.env  (passed in via getEnv arg)
//   3. astro build                     → import.meta.env at build time

export type StrapiBlock =
  | { type: 'paragraph'; children: StrapiInline[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: StrapiInline[] }
  | { type: 'list'; format: 'ordered' | 'unordered'; children: { children: StrapiInline[] }[] }
  | { type: 'quote'; children: StrapiInline[] }
  | { type: 'code'; children: StrapiInline[] }
  | { type: 'image'; image: { url: string; alternativeText?: string; width?: number; height?: number } }
  | { type: 'link'; url: string; children: StrapiInline[] };

export type StrapiInline = {
  type?: 'text' | 'link';
  text?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  url?: string;
  children?: StrapiInline[];
};

export interface StrapiImage {
  url: string;
  alternativeText?: string | null;
  width?: number;
  height?: number;
  formats?: Record<string, { url: string; width: number; height: number }>;
}

export interface Article {
  id: number;
  documentId: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: StrapiBlock[] | null;
  bodyHtml: string | null;
  category: 'Residential' | 'Commercial' | 'Recycling' | 'Community' | null;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  coverImage: StrapiImage | null;
}

export interface StrapiListResponse<T> {
  data: T[];
  meta: { pagination: { page: number; pageSize: number; pageCount: number; total: number } };
}

export interface StrapiSingleResponse<T> {
  data: T;
  meta: Record<string, unknown>;
}

interface RuntimeEnv {
  STRAPI_URL?: string;
  STRAPI_API_TOKEN?: string;
}

function readEnv(runtimeEnv?: RuntimeEnv): { url: string; token: string } {
  const url = runtimeEnv?.STRAPI_URL || import.meta.env.STRAPI_URL;
  const token = runtimeEnv?.STRAPI_API_TOKEN || import.meta.env.STRAPI_API_TOKEN;
  if (!url) throw new Error('STRAPI_URL is not set');
  if (!token) throw new Error('STRAPI_API_TOKEN is not set');
  return { url: url.replace(/\/$/, ''), token };
}

// Resolve a Strapi media URL — Strapi returns relative paths like /uploads/foo.jpg
// for local uploads, or absolute URLs for cloud storage. Make them absolute either way.
export function mediaUrl(path: string | undefined, runtimeEnv?: RuntimeEnv): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const { url } = readEnv(runtimeEnv);
  return url + path;
}

// Default 3s timeout — if Strapi is slow/down, fall through to fallback UI
// rather than hang the page render.
const FETCH_TIMEOUT_MS = 3000;

async function strapiFetch<T>(
  endpoint: string,
  runtimeEnv: RuntimeEnv | undefined,
  query?: Record<string, string | number | undefined>
): Promise<T> {
  const { url, token } = readEnv(runtimeEnv);
  const qs = query
    ? '?' +
      Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${url}/api${endpoint}${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Strapi ${endpoint} → ${res.status}: ${body.slice(0, 200)}`);
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Strapi ${endpoint} → timeout after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function getArticles(
  opts: { limit?: number; page?: number; runtimeEnv?: RuntimeEnv } = {}
): Promise<StrapiListResponse<Article>> {
  const { limit = 12, page = 1, runtimeEnv } = opts;
  return strapiFetch<StrapiListResponse<Article>>('/articles', runtimeEnv, {
    'sort': 'publishedAt:desc',
    'pagination[page]': page,
    'pagination[pageSize]': limit,
    'populate': 'coverImage',
  });
}

export async function getArticleBySlug(
  slug: string,
  runtimeEnv?: RuntimeEnv
): Promise<Article | null> {
  const res = await strapiFetch<StrapiListResponse<Article>>('/articles', runtimeEnv, {
    'filters[slug][$eq]': slug,
    'populate': 'coverImage',
    'pagination[pageSize]': 1,
  });
  return res.data[0] ?? null;
}

// ---- Strapi Blocks → HTML renderer (small, no React) ----

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(node: StrapiInline): string {
  if (node.type === 'link') {
    const inner = (node.children || []).map(renderInline).join('');
    const href = escapeHtml(node.url || '#');
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
  }
  let text = escapeHtml(node.text ?? '');
  if (node.code) text = `<code>${text}</code>`;
  if (node.bold) text = `<strong>${text}</strong>`;
  if (node.italic) text = `<em>${text}</em>`;
  if (node.underline) text = `<u>${text}</u>`;
  if (node.strikethrough) text = `<s>${text}</s>`;
  return text;
}

function renderChildren(children: StrapiInline[] | undefined): string {
  return (children || []).map(renderInline).join('');
}

export function renderBlocks(blocks: StrapiBlock[] | null | undefined): string {
  if (!blocks || blocks.length === 0) return '';
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'paragraph':
          return `<p>${renderChildren(b.children)}</p>`;
        case 'heading':
          return `<h${b.level}>${renderChildren(b.children)}</h${b.level}>`;
        case 'list': {
          const tag = b.format === 'ordered' ? 'ol' : 'ul';
          const items = b.children
            .map((li) => `<li>${renderChildren(li.children)}</li>`)
            .join('');
          return `<${tag}>${items}</${tag}>`;
        }
        case 'quote':
          return `<blockquote>${renderChildren(b.children)}</blockquote>`;
        case 'code':
          return `<pre><code>${renderChildren(b.children)}</code></pre>`;
        case 'image': {
          const alt = escapeHtml(b.image.alternativeText || '');
          const src = /^https?:\/\//i.test(b.image.url) ? b.image.url : b.image.url;
          return `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" />`;
        }
        case 'link':
          return `<a href="${escapeHtml(b.url)}" target="_blank" rel="noopener noreferrer">${renderChildren(b.children)}</a>`;
        default:
          return '';
      }
    })
    .join('');
}

// ---- Misc helpers ----

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
