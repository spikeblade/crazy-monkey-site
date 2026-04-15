# Crazy Monkey — Collection Noir

Sitio de e-commerce para **Crazy Monkey Shirts**, marca de diseño independiente gótico y disidente hecha en Colombia. Ediciones limitadas desde $95.000 COP con envío nacional.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + JS vanilla — sin frameworks, sin build step |
| Hosting | Netlify (deploy automático desde GitHub en push a `main`) |
| Backend | Netlify Functions (Node.js serverless) |
| Base de datos | Supabase (PostgreSQL + Auth) |
| Pagos | MercadoPago Checkout Pro |
| Email | Resend |
| Tests | Jest — 164 tests, 14 suites |

---

## Estructura del proyecto

```
crazy-monkey-site/
│
├── index.html              # Catálogo principal — carga productos desde Supabase
├── producto.html           # Página de producto individual con reviews
├── checkout.html           # Formulario de datos de envío + MercadoPago
├── cuenta.html             # Registro, login y perfil de usuario + historial de pedidos
├── admin.html              # Panel de administración SPA (hash routing)
├── pago-exitoso.html       # Confirmación post-pago
├── pago-fallido.html       # Página de error / pago cancelado
├── estado-pedido.html      # Lookup de estado de pedido por email (clientes)
├── tallas.html             # Guía de tallas
├── envios.html             # Información de envíos y tiempos
├── contacto.html           # Formulario de contacto
├── manifiesto.html         # Manifiesto de la marca
├── declaracion.html        # Declaración de principios
│
├── imgs/                   # Imágenes de productos
│
├── favicon.svg
├── manifest.json           # PWA manifest
├── og-cover.jpg            # Imagen Open Graph
├── netlify.toml            # Configuración de Netlify
│
├── netlify/
│   └── functions/
│       ├── create-preference.js   # Verifica stock, crea preferencia MP, pre-guarda pedido
│       ├── mp-webhook.js          # Webhook MP → confirma pago, stock atómico, emails
│       ├── save-order.js          # Guarda pedido en Supabase
│       ├── get-orders.js          # Lista pedidos (admin)
│       ├── get-order-status.js    # Estado de pedido por email (público)
│       ├── get-profile.js         # Lee perfil de usuario (JWT)
│       ├── save-profile.js        # Guarda/actualiza perfil (JWT)
│       ├── productos.js           # CRUD catálogo (GET público, resto admin)
│       ├── reviews.js             # Reseñas verificadas por compra
│       ├── configuracion.js       # Precios globales (GET público, PATCH admin)
│       ├── produccion.js          # Gestión de lotes de producción (admin)
│       ├── analytics.js           # KPIs, top productos, departamentos (admin)
│       ├── taxonomias.js          # CRUD categorías y colecciones (admin)
│       ├── send-contact.js        # Formulario de contacto → Resend
│       ├── abandoned-cart.js      # Recuperación de carritos abandonados (scheduled)
│       └── __tests__/             # Tests Jest (164 tests, 14 suites)
│
└── supabase/
    └── migrations/                # Historial de migraciones SQL
        ├── 000000_initial_schema.sql
        ├── 000001_carrito_abandonado_y_tracking.sql
        ├── 000002_categorias_colecciones.sql
        └── 000003_atomic_increment_stock.sql
```

---

## Variables de entorno

Configurar en **Netlify → Site configuration → Environment variables** (y en `.env` local):

| Variable | Descripción |
|---|---|
| `MP_ACCESS_TOKEN` | Access Token de producción de MercadoPago |
| `SITE_URL` | URL del sitio sin `/` final (ej: `https://crazymonkey.store`) |
| `SUPABASE_URL` | URL del proyecto Supabase (ej: `https://xxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | Anon key pública de Supabase |
| `ADMIN_PASSWORD` | Contraseña para el panel `/admin.html` |
| `RESEND_API_KEY` | API key de Resend para emails transaccionales |
| `ADMIN_EMAIL` | Email que recibe notificaciones de pedidos y alertas de stock |

---

## Base de datos — Supabase

### Tablas

**`productos`** — catálogo administrable
```
id, orden, nombre, coleccion, categoria, descripcion,
imagen, precio, activo, stock_total, stock_vendido, created_at
```

**`pedidos`** — órdenes de compra
```
id, created_at, nombre, telefono, email, departamento, ciudad, direccion,
items (jsonb), total, mp_preference_id, mp_payment_id, mp_status,
estado, user_id, tracking_number, carrier, recovery_sent
```
Estados: `pendiente → confirmado → enviado → entregado` (+ `revisar_stock` para oversell)

**`perfiles`** — datos de envío por usuario (RLS por user_id)
```
id, nombre, telefono, departamento, ciudad, barrio, direccion, updated_at
```

**`reviews`** — reseñas verificadas por compra
```
id, created_at, user_id, producto, estrellas, comentario, nombre, aprobada
```

**`configuracion`** — fila única de precios globales
```
id (siempre 1), precio_venta, costo_produccion, updated_at
```

**`lotes_produccion`** — lotes de fabricación
```
id, created_at, nombre, estado, costo_unit, notas, pedidos_ids (jsonb)
```

**`categorias`** — categorías de producto
```
id, nombre, slug, orden
```

**`colecciones`** — colecciones de producto
```
id, nombre, descripcion, orden, activo
```

### Función RPC

```sql
-- Atómica y condicional: solo incrementa si hay stock disponible.
-- Retorna TRUE si tuvo éxito, FALSE si el stock estaba agotado.
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

---

## Flujo de compra

```
Cliente agrega al carrito (localStorage)
        ↓
checkout.html — nombre, teléfono, email, departamento, ciudad, dirección
        ↓
create-preference.js — verifica stock disponible (→ 409 si agotado)
        ↓
create-preference.js — crea preferencia en MP, pre-guarda pedido como "pendiente"
        ↓
MercadoPago — pago con tarjeta / PSE / Nequi / Daviplata
        ↓
mp-webhook.js — verifica pago, incremento atómico de stock,
                actualiza estado a "confirmado", envía emails cliente + admin
        ↓
pago-exitoso.html — resumen del pedido
```

Si el stock se agota justo antes del pago (race condition): el pedido queda en `revisar_stock` para gestión manual.

Si el pago falla → `pago-fallido.html` con opción de reintentar o pedir por WhatsApp.

---

## Panel de administración

Acceso: `tu-sitio/admin.html` — requiere `ADMIN_PASSWORD`

Secciones (hash routing, sesión TTL 8h en sessionStorage):
- **Pedidos** — lista completa, cambio de estado, WhatsApp directo al cliente, número de tracking
- **Producción** — lotes de fabricación vinculados a pedidos confirmados
- **Productos** — CRUD completo, control de stock con barra visual, activar/desactivar
- **Reseñas** — moderación de reviews de clientes
- **Precios** — precio de venta y costo de producción global
- **Taxonomías** — gestión de categorías y colecciones
- **Analytics** — KPIs (ventas, ingresos, margen), top productos, mapa por departamentos, estados

---

## Tests

```bash
# Correr todos los tests
npx jest --no-coverage

# Correr un suite específico
npx jest --testPathPattern="mp-webhook" --no-coverage
```

164 tests en 14 suites cubriendo todas las Netlify Functions. Cada cambio a una función debe ir acompañado de tests actualizados.

---

## Migraciones Supabase

Las migraciones están en `supabase/migrations/`. Cada cambio al esquema SQL debe registrarse como una nueva migración con nombre `YYYYMMDDHHMMSS_descripcion.sql`.

---

## Desarrollo local

```bash
npm install -g netlify-cli
netlify dev
# Sirve en http://localhost:8888
# Functions en /.netlify/functions/*
```

Crea `.env` en la raíz con todas las variables de entorno listadas arriba.

---

## Git flow

```bash
# Todo el trabajo en develop
git checkout develop
git add .
git commit -m "descripción"
git push origin develop

# Pasar a producción via PR
gh pr create --base main --head develop --title "descripción"
```

Netlify despliega automáticamente en push a `main`.

---

## Webhook MercadoPago

Registrar en MP Dashboard → Developers → Webhooks:
- **URL:** `https://tu-sitio.netlify.app/.netlify/functions/mp-webhook`
- **Eventos:** Pagos

---

## Contacto

**WhatsApp:** +57 301 656 8222  
**Medellín, Colombia**

---

*Crazy Monkey Collection Noir — Diseño independiente · Ediciones limitadas · Cada pieza, una declaración.*
