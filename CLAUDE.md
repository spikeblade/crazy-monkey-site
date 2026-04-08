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

**Language convention:** All UI copy and code comments are in Colombian Spanish.

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
```

There is no build step — HTML is served as-is from the root.

## Git Workflow

```bash
# Feature work on develop branch
git checkout develop
git add . && git commit -m "message"
git push

# Merge to production via PR
gh pr create --base main --head develop
```

Netlify auto-deploys on push to `main`.

## Architecture

### Static Pages → Serverless Functions → Supabase

All pages are standalone HTML files that call Netlify Functions via `fetch()`. Functions interact with Supabase via REST API.

**Key pages:**
- `index.html` — Product catalog (dynamically rendered via JS from `/productos`)
- `producto.html` — Single product view + reviews
- `checkout.html` — Shipping form + triggers MercadoPago
- `cuenta.html` — Auth (signup/login) + user profile
- `admin.html` — Admin panel (orders, products, reviews, production, pricing)
- `pago-exitoso.html` / `pago-fallido.html` — Payment outcomes

**Netlify Functions (`netlify/functions/`):**
- `productos.js` — CRUD for product catalog (GET: public, POST/PATCH/DELETE: admin)
- `create-preference.js` — Creates MercadoPago checkout preference + pre-saves order
- `save-order.js` — Saves order to Supabase
- `mp-webhook.js` — MercadoPago payment webhook: confirms order, updates stock, sends emails
- `get-orders.js` — Admin: list all orders
- `get-profile.js` / `save-profile.js` — User shipping address (JWT-authenticated)
- `reviews.js` — Product reviews (verified buyers only)
- `send-contact.js` — Contact form → Resend email
- `configuracion.js` — Global pricing config (GET: public, PATCH: admin)
- `produccion.js` — Production batch management

**Supabase tables:**
- `productos` — Catalog (activo flag for soft-delete, stock_total/stock_vendido)
- `pedidos` — Orders with JSON `items` column, estado field (pendiente → confirmado → enviado → entregado)
- `perfiles` — User shipping addresses (RLS by user_id)
- `reviews` — Ratings with `aprobada` flag for moderation
- `configuracion` — Global `precio_venta` and `costo_produccion` (single-row config)
- `lotes_produccion` — Production batches linking confirmed orders to manufacturing

### Purchase Flow

1. Cart stored in `localStorage`
2. Checkout form collects shipping info
3. `POST /create-preference` → calculates total, saves pending order to Supabase, returns MercadoPago `init_point` URL
4. User redirected to MercadoPago → pays
5. MercadoPago POSTs to `mp-webhook.js` → verifies payment, updates order estado to `confirmado`, increments `stock_vendido`, sends emails via Resend
6. User lands on `pago-exitoso.html`

### Admin Authentication

Admin endpoints check `x-admin-password` header against `process.env.ADMIN_PASSWORD`. There is no OAuth — single-user admin.

### Pricing

A single row in `configuracion` holds global `precio_venta` and `costo_produccion`. Individual products can override this. The constraint `precio_venta >= costo_produccion` is validated in the function before saving.

## Supabase Setup

This SQL function must exist in Supabase:
```sql
create or replace function increment_stock(p_nombre text, p_cantidad integer)
returns void as $$
  update productos
  set stock_vendido = coalesce(stock_vendido, 0) + p_cantidad
  where nombre = p_nombre and stock_total is not null;
$$ language sql;
```

## MercadoPago Webhook

Register in MP Dashboard → Developers → Webhooks:
- **URL**: `https://yourdomain.netlify.app/.netlify/functions/mp-webhook`
- **Events**: Pagos (payment notifications)
