# CRAZY MONKEY — Guía de Deployment
## Netlify + Supabase + MercadoPago

---

## Prerequisitos

- Cuenta GitHub con el repo `crazy-monkey-site`
- Cuenta Netlify (gratis)
- Proyecto Supabase activo (`crazy_monkey_store`)
- Cuenta MercadoPago de vendedor
- Cuenta Resend con dominio verificado

---

## PASO 1 — Conectar Netlify a GitHub

1. Ve a [netlify.com](https://netlify.com) → "Add new site" → "Import an existing project"
2. Conecta GitHub y selecciona `crazy-monkey-site`
3. Configuración de build:
   - **Build command:** (dejar vacío)
   - **Publish directory:** `.`
4. Clic en "Deploy site"

El sitio queda en vivo en minutos. Netlify despliega automáticamente en cada push a `main`.

---

## PASO 2 — Variables de entorno en Netlify

**Site configuration → Environment variables** — agregar todas estas:

| Variable | Descripción |
|---|---|
| `MP_ACCESS_TOKEN` | Access Token de producción de MercadoPago (`APP_USR-...`) |
| `SITE_URL` | URL del sitio sin `/` final (ej: `https://crazymonkey.store`) |
| `SUPABASE_URL` | URL del proyecto Supabase (ej: `https://xxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | Anon key pública de Supabase |
| `ADMIN_PASSWORD` | Contraseña para el panel `/admin.html` |
| `RESEND_API_KEY` | API key de Resend (`re_...`) |
| `ADMIN_EMAIL` | Email que recibe notificaciones de pedidos y alertas de stock |

Después de guardar → "Trigger deploy" para que los cambios tomen efecto.

---

## PASO 3 — Supabase: aplicar migraciones

Las migraciones están en `supabase/migrations/`. Aplicarlas en orden en el **SQL Editor** de Supabase:

1. `000000_initial_schema.sql` — Esquema base completo
2. `000001_carrito_abandonado_y_tracking.sql` — Columnas de tracking en pedidos
3. `000002_categorias_colecciones.sql` — Tablas de taxonomías
4. `000003_atomic_increment_stock.sql` — Función RPC atómica para stock

> Si es un proyecto nuevo, basta con ejecutar los 4 archivos en orden en el SQL Editor.

---

## PASO 4 — Webhook MercadoPago

1. Ve a [mercadopago.com.co/developers](https://www.mercadopago.com.co/developers)
2. Mis aplicaciones → tu aplicación → Webhooks
3. Agregar webhook:
   - **URL:** `https://tu-sitio.netlify.app/.netlify/functions/mp-webhook`
   - **Eventos:** Pagos (`payment`)
4. Guardar

---

## PASO 5 — Dominio propio (opcional)

En Netlify → "Domain management" → "Add custom domain"

El dominio actual es `crazymonkey.store`. Si necesitas configurarlo de nuevo:
1. Agrega el dominio en Netlify
2. Apunta los nameservers de tu registrador a los de Netlify
3. SSL se configura automáticamente

---

## Pruebas antes de producción

Para probar pagos sin cobrar dinero real:

1. En MercadoPago → usar credenciales de **sandbox** (no de producción)
2. Tarjeta de prueba VISA aprobada: `4509 9535 6623 3704` | CVV: `123`
3. Verificar que el webhook recibe la notificación y actualiza el pedido en Supabase

---

## Seguridad

- `MP_ACCESS_TOKEN` y `ADMIN_PASSWORD` **nunca** deben estar en el código
- Solo viven en las variables de entorno de Netlify
- El panel admin usa contraseña simple (single-user) — no OAuth
- Las sesiones de admin tienen TTL de 8 horas (sessionStorage)

---

## Desarrollo local

```bash
npm install -g netlify-cli
netlify dev
# Sirve en http://localhost:8888
```

Crea `.env` en la raíz del proyecto:
```
MP_ACCESS_TOKEN=APP_USR-...
SITE_URL=http://localhost:8888
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
ADMIN_PASSWORD=tu-password-local
RESEND_API_KEY=re_...
ADMIN_EMAIL=tu@email.com
```

---

## Tests

```bash
npm install
npx jest --no-coverage
# 164 tests, 14 suites — todos deben pasar antes de hacer deploy
```

---

## Soporte

Si algo falla en el checkout, el cliente ve `pago-fallido.html` con opción de completar el pedido por WhatsApp al +57 301 656 8222.
