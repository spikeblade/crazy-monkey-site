# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Crazy Monkey is a headless e-commerce platform for an independent Colombian gothic clothing brand. It sells limited-edition designs with a production-on-demand workflow.

**Tech stack:**
- Frontend: Static HTML + inline CSS + Vanilla JS (no frameworks, no build step)
- Hosting: Netlify (auto-deploys on push to `main`)
- Backend: Netlify Functions (Node.js serverless, `netlify/functions/`)
- Database: Supabase (PostgreSQL + Auth)
- Payments: MercadoPago Checkout Pro
- Email: Resend (transactional)
- Tests: Jest (`netlify/functions/__tests__/`) — 164 tests, 14 suites

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
ADMIN_PASSWORD=...
RESEND_API_KEY=re_...
ADMIN_EMAIL=...
MP_WEBHOOK_SECRET=...
```
`MP_WEBHOOK_SECRET` se obtiene en MercadoPago → Developers → Webhooks → Clave secreta. Si no está configurado, el webhook opera en fail-open.

There is no build step — HTML is served as-is from the root.

## Architecture

### Static Pages → Serverless Functions → Supabase

All pages are standalone HTML files that call Netlify Functions via `fetch()`. Functions interact with Supabase via REST API.

**Pages:**
- `index.html` — Product catalog (dynamically rendered from `/productos`)
- `producto.html` — Single product view + reviews
- `checkout.html` — Shipping form + triggers MercadoPago
- `cuenta.html` — Auth (signup/login) + user profile + order history
- `admin.html` — Admin SPA (hash routing, sessionStorage TTL 8h)
- `pago-exitoso.html` / `pago-fallido.html` — Payment outcomes
- `estado-pedido.html` — Order status lookup by email (public)
- `tallas.html` — Size guide
- `envios.html` — Shipping info
- `contacto.html` — Contact form

**Netlify Functions (`netlify/functions/`):**
- `productos.js` — CRUD for product catalog (GET: public, POST/PATCH/DELETE: admin)
- `create-preference.js` — Checks stock, creates MercadoPago preference, pre-saves order
- `mp-webhook.js` — MP payment webhook: confirms order, atomic stock update, sends emails, detects oversell
- `save-order.js` — Saves order to Supabase
- `get-orders.js` — Admin: list all orders
- `get-order-status.js` — Public: order status lookup by email
- `get-profile.js` / `save-profile.js` — User shipping address (JWT-authenticated)
- `reviews.js` — Product reviews (verified buyers only)
- `send-contact.js` — Contact form → Resend email
- `configuracion.js` — Global pricing config (GET: public, PATCH: admin)
- `produccion.js` — Production batch management (admin)
- `analytics.js` — KPIs, top products, departments, estados (admin)
- `taxonomias.js` — CRUD for categorias and colecciones (admin)
- `abandoned-cart.js` — Scheduled function for abandoned cart recovery

**Supabase tables:**
- `productos` — Catalog (activo flag, stock_total/stock_vendido)
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
7. User lands on `pago-exitoso.html`

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

All schema changes must be recorded in `supabase/migrations/` with format `YYYYMMDDHHMMSS_description.sql`. Current migrations:

- `000000_initial_schema.sql` — All base tables + original increment_stock
- `000001_carrito_abandonado_y_tracking.sql` — recovery_sent, tracking_number, carrier columns on pedidos
- `000002_categorias_colecciones.sql` — categorias and colecciones tables with seed data
- `000003_atomic_increment_stock.sql` — Replaces increment_stock with atomic boolean version

## Testing

```bash
npx jest --no-coverage        # full suite
npx jest --testPathPattern="mp-webhook" --no-coverage  # single suite
```

**Rules:**
- Every change to a Netlify Function must include updated/new tests
- Every SQL/schema change must include a migration file
- Run full suite before committing — all 164 tests must pass

## MercadoPago Webhook

Register in MP Dashboard → Developers → Webhooks:
- **URL**: `https://yourdomain.netlify.app/.netlify/functions/mp-webhook`
- **Events**: Pagos (payment notifications)
