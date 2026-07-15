# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Crazy Monkey is a headless e-commerce platform for an independent Colombian gothic clothing brand. It sells limited-edition designs with a production-on-demand workflow.

**Tech stack:**
- Frontend: Astro V2 (static output) + inline CSS + Vanilla JS
- Build: `npm run build` → `astro build` → outputs to `dist/`
- Hosting: Netlify (auto-deploys on push to `main`, serves from `dist/`)
- Backend: Netlify Functions (Node.js 24 serverless, `netlify/functions/`)
- Database: Supabase (PostgreSQL + Auth)
- Payments: MercadoPago Checkout Pro
- Email: Resend (transactional)
- Tests: Jest (`netlify/functions/__tests__/`) — 224 tests, 18 suites
- Runtime: Node.js 24 (`.nvmrc` + `package.json engines` + `netlify.toml NODE_VERSION`)

**Language convention:** All UI copy and code comments are in Colombian Spanish.

## Git Workflow

```bash
# ALL work on develop — never commit directly to main
git checkout develop
git add . && git commit -m "message"
git push origin develop

# Merge to production via PR
gh pr create --base main --head develop
```

Netlify auto-deploys on push to `main`.

## Local Development

```bash
# Install Netlify CLI (one-time)
npm install -g netlify-cli

# Run dev server with local functions
netlify dev
# Serves at http://localhost:8888 — functions available at /.netlify/functions/*
```

Create a `.env` file at the project root with:
```
MP_ACCESS_TOKEN=APP_USR-...
SITE_URL=http://localhost:8888
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_KEY=eyJhbGciOi...
ADMIN_PASSWORD=...
RESEND_API_KEY=re_...
ADMIN_EMAIL=...
MP_WEBHOOK_SECRET=...
PUBLIC_GA_MEASUREMENT_ID=...
PUBLIC_META_PIXEL_ID=...
```
`MP_WEBHOOK_SECRET` se obtiene en MercadoPago → Developers → Webhooks → Clave secreta. Si no está configurado, el webhook opera en fail-open.
`SUPABASE_SERVICE_KEY` se obtiene en Supabase Dashboard → Settings → API → service_role. Usada en `taxonomias.js` para escrituras (bypassa RLS); nunca exponerla al cliente.
`PUBLIC_GA_MEASUREMENT_ID` / `PUBLIC_META_PIXEL_ID` son opcionales — sin ellas no se carga ningún tracking ni se muestra el aviso de cookies. Deben configurarse como variables de entorno de **build** en Netlify (Astro las incrusta en el HTML estático al compilar, no se leen en runtime).

Build step: `npm run build` runs `astro build` and outputs to `dist/`. Netlify deploys from `dist/`.

## Architecture

### Astro Pages → Serverless Functions → Supabase

Pages are Astro components (`src/pages/*.astro`) compiled to static HTML in `dist/`. They call Netlify Functions via `fetch()`. Functions interact with Supabase via REST API.

**Astro structure:**
- `src/layouts/Layout.astro` — Base layout (head, meta, fonts)
- `src/layouts/LayoutPublic.astro` — Public layout (Nav, CartPanel, Footer, AccountScript, StockToast)
- `src/layouts/LayoutPrivate.astro` — Authenticated layout
- `src/components/` — Nav, CartPanel, Footer, AccountScript, StockToast, Analytics (GA4/Meta Pixel, gated by env vars + cookie consent), CookieConsent (banner)
- `public/styles/` — Shared CSS: base.css, nav.css, cart.css

**Pages (`src/pages/`):**
- `index.astro` — Product catalog (dynamically rendered from `/productos`)
- `producto.astro` — Single product view + reviews
- `checkout.astro` — Shipping form + triggers MercadoPago
- `cuenta.astro` — Auth (signup/login) + user profile + order history
- `admin.astro` — Admin SPA (hash routing, sessionStorage TTL 8h)
- `pago-exitoso.astro` / `pago-fallido.astro` — Payment outcomes
- `estado-pedido.astro` — Order status lookup by email (public)
- `tallas.astro` — Size guide
- `envios.astro` — Shipping info
- `contacto.astro` — Contact form
- `declaracion.astro` / `manifiesto.astro` — Brand pages
- `privacidad.astro` — Privacy policy (Ley 1581 Habeas Data) + cookie preference reset

**Astro conventions:**
- All page scripts use `<script is:inline>` to preserve global function scope for onclick handlers
- All CSS uses `<style is:global>` to preserve plain class selectors for JS querySelector
- Scripts use `var` (not `const/let`) in pages that share globals with CartPanel (index, producto, checkout, cuenta)
- `admin.astro` uses modern JS (const/let/arrow) since it's self-contained

**Netlify Functions (`netlify/functions/`):**
- `productos.js` — CRUD for product catalog (GET: public, POST/PATCH/DELETE: admin)
- `create-preference.js` — Checks stock, creates MercadoPago preference, pre-saves order
- `mp-webhook.js` — MP payment webhook: confirms order, atomic stock update, sends emails, detects oversell
- `save-order.js` — Saves order to Supabase
- `get-orders.js` — Admin: list all orders
- `get-order-status.js` — Public: order status lookup by email
- `get-order-by-preference.js` — Public: single-order lookup by `mp_preference_id`, used by `pago-exitoso.astro` to show the real confirmed order instead of the pre-payment cart snapshot
- `get-profile.js` / `save-profile.js` — User shipping address (JWT-authenticated)
- `reviews.js` — Product reviews (verified buyers only)
- `send-contact.js` — Contact form → Resend email
- `configuracion.js` — Global pricing config (GET: public, PATCH: admin)
- `produccion.js` — Production batch management (admin)
- `analytics.js` — KPIs, top products, departments, estados (admin)
- `taxonomias.js` — CRUD for categorias and colecciones (admin)
- `get-clientes.js` — Unique customers aggregated from pedidos by email (admin)
- `abandoned-cart.js` — Scheduled function for abandoned cart recovery
- `upload-imagen.js` — Admin-authenticated image upload to Supabase Storage. Bucket `productos`: recompresses to WEBP (max width 1600px, quality 82) via `sharp` before upload. Bucket `artes`: uploaded as-is (needs original fidelity for production/printing)

**Supabase tables:**
- `productos` — Catalog (activo flag, stock_total/stock_vendido, arte_url for print artwork)
- `pedidos` — Orders with JSON `items`, estado, email, tracking_number, carrier, recovery_sent
- `perfiles` — User shipping addresses (RLS by user_id)
- `reviews` — Ratings with `aprobada` flag for moderation
- `configuracion` — Single-row global pricing (precio_venta, costo_produccion)
- `lotes_produccion` — Production batches linking orders to manufacturing
- `categorias` — Product categories (noir, gothic, punk, literary)
- `colecciones` — Product collections

### Purchase Flow

1. Cart stored in `localStorage`
2. Checkout form collects shipping info
3. `POST /create-preference` → checks stock availability (returns 409 if sold out) → creates MP preference → saves pending order to Supabase
4. User redirected to MercadoPago → pays
5. MercadoPago POSTs to `mp-webhook.js` → verifies payment → atomic stock increment → updates order to `confirmado` → sends emails via Resend
6. If atomic stock increment fails (oversell race condition) → order marked as `revisar_stock`
7. User lands on `pago-exitoso.astro` — reads `preference_id` from the MP return URL and calls `get-order-by-preference.js` to show the real confirmed order (not the pre-payment cart snapshot), with copy that adapts to approved/pending/rejected status

### Analytics / Marketing Tracking

GA4 and Meta Pixel load only if `PUBLIC_GA_MEASUREMENT_ID` / `PUBLIC_META_PIXEL_ID` are set **and** the user accepts the cookie banner (`CookieConsent.astro`) — opt-in, nothing loads by default. `Analytics.astro` (rendered in `Layout.astro`, opt-out via `noAnalytics` prop — used by `admin.astro`) exposes `window.cmTrack(eventName, params)`, a safe no-op stub when tracking isn't active. Funnel events fired from page scripts:
- `view_item` — `producto.astro` on product load
- `add_to_cart` — `producto.astro` `addToCart()`
- `begin_checkout` — `checkout.astro` on page load
- `purchase` — `pago-exitoso.astro`, only once the order is confirmed `approved`; deduped per `preference_id` via a `localStorage` flag so refreshing the page doesn't double-count

### Oversell Protection (two layers)

Limited-edition stock requires strict protection:

**Layer 1 — `create-preference.js`:** Queries current stock before creating the MP preference. Returns `409 { error: 'stock_agotado', producto: '...' }` if insufficient stock. Frontend redirects to catalog with a toast message.

**Layer 2 — `increment_stock` SQL (atomic):** The UPDATE includes the stock check in the WHERE clause. Two simultaneous webhooks cannot both succeed — one gets `false` and the order is marked `revisar_stock`.

### Admin Authentication

Admin endpoints check `x-admin-password` header against `process.env.ADMIN_PASSWORD`. Single-user admin, no OAuth.

### Pricing

A single row in `configuracion` holds global `precio_venta` and `costo_produccion`. Individual products can override this. The constraint `precio_venta >= costo_produccion` is validated before saving.

## Supabase — RPC Functions

### `increment_stock(p_nombre text, p_cantidad integer) → boolean`

Atomic and conditional. Only increments if stock is available. Returns `TRUE` on success, `FALSE` if sold out.

```sql
create or replace function increment_stock(p_nombre text, p_cantidad integer)
returns boolean as $$
  with updated as (
    update productos
    set stock_vendido = coalesce(stock_vendido, 0) + p_cantidad
    where nombre = p_nombre
      and stock_total is not null
      and (coalesce(stock_vendido, 0) + p_cantidad) <= stock_total
    returning 1
  )
  select exists(select 1 from updated);
$$ language sql;
```

## Migrations

All schema changes must be recorded in `supabase/migrations/` with format `YYYYMMDDHHMMSS_description.sql`.

**Migrations must be idempotent** — safe to run multiple times without error:

| Operation | Idempotent pattern |
|---|---|
| Create table | `CREATE TABLE IF NOT EXISTS` |
| Add column | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` |
| Create index | `CREATE INDEX IF NOT EXISTS` |
| Create function | `CREATE OR REPLACE FUNCTION` |
| Create policy | `DROP POLICY IF EXISTS ... ON ...; CREATE POLICY ...` |
| Insert seed data | `INSERT INTO ... ON CONFLICT DO NOTHING` |
| Create bucket | `INSERT INTO storage.buckets ... ON CONFLICT (id) DO NOTHING` |

Current migrations:

- `000000_initial_schema.sql` — All base tables + original increment_stock
- `000001_carrito_abandonado_y_tracking.sql` — recovery_sent, tracking_number, carrier columns on pedidos
- `000002_categorias_colecciones.sql` — categorias and colecciones tables with seed data
- `000003_atomic_increment_stock.sql` — Replaces increment_stock with atomic boolean version
- `000004_barrio_perfil.sql` — barrio field on perfiles table
- `000005_arte_url_productos.sql` — arte_url field on productos table (print artwork URL)
- `000006_galeria_productos.sql` — imagenes TEXT[] field on productos (image gallery)
- `000007_stock_por_talla.sql` — stock_tallas JSONB field + increment_stock_talla RPC
- `000008_storage_bucket_productos.sql` — Supabase Storage bucket `productos` for admin image uploads

## Testing

```bash
npx jest --no-coverage        # full suite
npx jest --testPathPattern="mp-webhook" --no-coverage  # single suite
```

**Rules:**
- Every change to a Netlify Function must include updated/new tests
- Every SQL/schema change must include a migration file
- Run full suite before committing — all 224 tests must pass
- After any change that affects stack, tests count, functions list, or schema: update README.md, DEPLOYMENT.md, and CLAUDE.md
- After every merge to main: update CHANGELOG.md and create a git tag (semver)

## Versioning

Semantic versioning on every merge to `main`. Tag format: `vX.Y.Z`

| Change type | Bump |
|---|---|
| Full stack migration, redesign | MAJOR `X.0.0` |
| New feature (page, function, panel section) | MINOR `2.X.0` |
| Bug fix, dep update, visual tweak | PATCH `2.0.X` |

Workflow:
1. Merge PR to main
2. Add entry to `CHANGELOG.md` under new version header
3. Bump `version` in `package.json`
4. `git tag vX.Y.Z -m "vX.Y.Z — short description"`
5. `git push origin vX.Y.Z`

## MercadoPago Webhook

Register in MP Dashboard → Developers → Webhooks:
- **URL**: `https://yourdomain.netlify.app/.netlify/functions/mp-webhook`
- **Events**: Pagos (payment notifications)
