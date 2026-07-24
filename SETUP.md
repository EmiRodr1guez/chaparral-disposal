# Setup — Chaparral Disposal site + Strapi + Cloudflare Pages

Mirrors the Elevate build. Three things, in order: Strapi, run locally, deploy.

Strapi instance for this client: **https://chaparral.cms.venpro.solutions**

---

## 0. Server side (one time — not yet done)

The Strapi instance for this client does **not exist yet**. `chaparral.cms.venpro.solutions`
resolves to `5.78.227.34` (wildcard DNS) but no vhost is configured. Someone with SSH
access needs to provision a Strapi instance there, the same way `client1` was set up.

Until that exists, `/blog` renders "Articles temporarily unavailable" — by design, the
site never hard-fails on a Strapi outage.

### Gotcha: uploads directory ownership

Each tenant bind-mounts a host dir for media:
`/data/strapi-uploads/<tenant>:/opt/app/public/uploads`

The Strapi container runs as the **`node` user (uid/gid 1000)**, so that host directory
**must be owned by `1000:1000`**. If it's created with plain `mkdir` as root, image
uploads fail in the admin with a misleading **"Unexpected end of JSON input"**, and the
container log shows the real cause:

```
Error: EACCES: permission denied, open '/opt/app/public/uploads/<file>.png'
```

Fix (no restart needed — permissions apply live):

```bash
chown -R 1000:1000 /data/strapi-uploads/<tenant>
```

Always run that right after creating the directory for a new tenant.

---

## 1. Strapi side (~10 minutes)

Open the admin at https://chaparral.cms.venpro.solutions/admin and sign in.

### 1a. Create the `Article` content type

Content-Type Builder → Create new collection type
- **Display name**: `Article`
- (Singular `article`, Plural `articles` — Strapi auto-fills these)

Add these fields one at a time:

| Field name | Type | Settings |
|---|---|---|
| `title` | Text → Short text | Advanced → Required |
| `slug` | UID | Attached field: `title`. Advanced → Required |
| `excerpt` | Text → Long text | (optional) |
| `content` | Rich text → **Blocks** (not Markdown) | (optional) |
| `category` | Enumeration | Values (one per line): `Residential`, `Commercial`, `Recycling`, `Community` |
| `coverImage` | Media → Single media | Allowed types: Images |
| `bodyHtml` | Text → Long text | (optional — full-takeover HTML, see below) |

Click **Save**. Strapi restarts (~30s).

> The enum values must match exactly — they're typed in `src/lib/strapi.ts` and drive
> the category pill on cards and `articleSection` in the Article structured data.

### 1b. Allow the API token to read articles

Settings → API Tokens → Create new API Token
- **Name**: `cloudflare-pages-readonly`
- **Token duration**: Unlimited
- **Token type**: Read-only

Save. **Copy the token immediately — it's only shown once.**

### 1c. Add a test article

Content Manager → Article → Create new entry → fill title, excerpt, content, category →
**Save**, then **Publish**. Repeat 2–3 times so the grid fills out.

### 1d. (Optional) Lock down the Public role

Settings → Users & Permissions → Roles → Public → uncheck everything for Article.
The token still works because it authenticates as itself, not as Public.

---

## 2. Local development

```bash
cd "/Users/hosting/Desktop/Chaparral"
cp .env.example .env
```

Edit `.env`:

```
STRAPI_URL=https://chaparral.cms.venpro.solutions
STRAPI_API_TOKEN=<paste the token from step 1b>
```

Run:

```bash
npm install
npm run dev
```

Open the URL it prints (4321, or 4322 if that port is taken). `/blog` shows the list,
clicking through goes to `/blog/<slug>`.

If you see "Articles temporarily unavailable", check the terminal — usually a typo in
`.env`, a missing token, or Strapi not reachable.

---

## 3. Cloudflare Pages deploy

### 3a. Push

```bash
git push -u origin astro-strapi
```

Merge to `main` once reviewed.

### 3b. Connect Cloudflare Pages

Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git →
pick `EmiRodr1guez/chaparral-disposal`.

**Build settings**:
- Framework preset: **Astro**
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: (leave blank)

**Environment variables**:
- `STRAPI_URL` = `https://chaparral.cms.venpro.solutions`
- `STRAPI_API_TOKEN` = (the token from 1b — mark as **Encrypted**)

Set these for **both** Production and Preview, or preview builds will show the fallback.

### 3c. Custom domain

Pages project → Custom domains → `chaparraldsllc.com` and `www.chaparraldsllc.com`.
DNS for this zone is already on Cloudflare, so Pages creates the records and issues the
cert automatically. **Do not touch the existing MX / SPF TXT records** — they run the
client's email forwarding.

---

## How content updates flow

1. Editor publishes an article in Strapi.
2. Cloudflare's edge cache holds the page **60s fresh** (`Cache-Control` in `Layout.astro`).
3. For up to 5 minutes after, visitors get the cached copy while a background fetch updates it.
4. Net effect: new posts appear within ~60s; Strapi is hit at most once per minute per edge.

Static pages (home, services, about, contact, billing) use `cacheStrategy="static"` —
1h browser / 24h edge — since they hit no remote data.

Force-clear: Cloudflare dashboard → Caching → Configuration → Purge Everything.

---

## What's intentionally NOT wired up

- **Contact form** shows a client-side "Thanks!" and sends nothing. To capture submissions:
  add a `Submission` collection type in Strapi and POST to it, or drop in Formspree /
  Web3Forms.
- **Pay Online button** (`/billing`) still fires a placeholder `alert()`. Replace the
  handler in `src/pages/billing.astro` with the real payment-processor URL.
- **Homepage** has no blog feed — posts appear on `/blog` only. To add a "latest 3"
  strip, call `getArticles({ limit: 3 })` in `src/pages/index.astro`, same pattern as
  `src/pages/blog/index.astro`.
- **Testimonials, service copy, stats** are hardcoded in the page `.astro` files.

---

## Files at a glance

```
src/
├── lib/strapi.ts             Fetch wrapper + Blocks→HTML renderer + types
├── layouts/Layout.astro      <head>, header, footer, cache headers, LocalBusiness schema
├── styles/global.css         All site styles (brand blue #214080)
└── pages/
    ├── index.astro           Home
    ├── services.astro        Services + FAQ
    ├── about.astro           About + gallery
    ├── contact.astro         Contact form + info
    ├── billing.astro         Pay My Bill
    └── blog/
        ├── index.astro       Paginated list (12/page, ?page=N) — Strapi
        └── [slug].astro      Individual post — Strapi
public/assets/                logos + main.js (nav, scroll-reveal, form)
```

---

## Editorial standards (Strapi)

1. **Always fill `alternativeText` on media uploads** — it's the alt text for screen
   readers and Google Image Search.
2. **Always fill `excerpt`** — it's the SEO meta description, the social-share preview,
   and the card teaser on `/blog`. Without it the description falls back to a generic
   "Read X on the Chaparral Disposal blog."
3. **Pick a `category`** — drives the pill on cards and `articleSection` in structured data.
4. **`bodyHtml` is NOT sanitized.** If filled, it replaces the whole article layout and is
   emitted raw. Only trusted editors should have publish rights. If publishing is ever
   opened up, add a Workers-compatible sanitizer (DOMPurify needs jsdom and breaks in V8
   isolates).
5. **Slugs lock at first save** — fix typos before the first Save.
