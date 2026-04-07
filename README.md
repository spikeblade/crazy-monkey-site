# Crazy Monkey — Collection Noir

Sitio de e-commerce para **Crazy Monkey Shirts**, marca de diseño independiente gótico y disidente hecha en Colombia. Ediciones limitadas desde $95.000 COP con envío nacional.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + JS vanilla — sin frameworks |
| Hosting | Netlify (deploy automático desde GitHub) |
| Backend | Netlify Functions (Node.js) |
| Base de datos | Supabase (PostgreSQL) |
| Autenticación | Supabase Auth |
| Pagos | MercadoPago Checkout Pro |
| Email | Resend |

---

## Estructura del proyecto

```
crazy-monkey-site/
│
├── index.html              # Catálogo principal — carga productos desde Supabase
├── producto.html           # Página de producto individual
├── checkout.html           # Formulario de datos de envío
├── cuenta.html             # Registro, login y perfil de usuario
├── admin.html              # Panel de administración (pedidos, productos, reseñas)
├── pago-exitoso.html       # Confirmación post-pago
├── pago-fallido.html       # Página de error / pago cancelado
├── manifiesto.html         # Manifiesto de la marca
├── declaracion.html        # Declaración de principios
├── contacto.html           # Contacto directo
│
├── imgs/                   # Imágenes de productos
│   ├── shirt_01.png
│   └── ... shirt_24.png
│
├── favicon.svg
├── apple-touch-icon.png
├── manifest.json           # PWA manifest
├── og-cover.jpg            # Imagen Open Graph (WhatsApp / redes)
├── netlify.toml            # Configuración de Netlify
│
└── netlify/
    └── functions/
        ├── create-preference.js   # Crea preferencia de pago en MP
        ├── save-order.js          # Guarda pedido en Supabase
        ├── get-orders.js          # Devuelve pedidos al panel admin
        ├── mp-webhook.js          # Webhook MP → confirma pago + email + stock
        ├── get-profile.js         # Lee perfil de usuario
        ├── save-profile.js        # Guarda/actualiza perfil
        ├── productos.js           # CRUD de productos (catálogo dinámico)
        └── reviews.js             # Reseñas verificadas por compra
```

---

## Variables de entorno (Netlify)

Configurar en **Site configuration → Environment variables**:

| Variable | Descripción |
|---|---|
| `MP_ACCESS_TOKEN` | Access Token de producción de MercadoPago |
| `SITE_URL` | URL del sitio sin `/` final (ej: `https://crazymonkey.netlify.app`) |
| `SUPABASE_URL` | URL del proyecto Supabase (ej: `https://xxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | Anon key pública de Supabase |
| `ADMIN_PASSWORD` | Contraseña para acceder al panel `/admin.html` |
| `RESEND_API_KEY` | API key de Resend para emails de notificación |
| `ADMIN_EMAIL` | Email donde llegan las notificaciones de pedidos nuevos |

---

## Base de datos — Supabase

### Tablas

**`productos`** — catálogo administrable
```sql
id, orden, nombre, coleccion, categoria, descripcion,
imagen, precio, activo, stock_total, stock_vendido, created_at
```

**`pedidos`** — órdenes de compra
```sql
id, created_at, nombre, telefono, departamento, ciudad, direccion,
items (jsonb), total, mp_preference_id, mp_payment_id, mp_status,
estado, user_id
```

**`perfiles`** — datos de envío guardados por usuario
```sql
id (ref auth.users), nombre, telefono, departamento, ciudad, direccion, updated_at
```

**`reviews`** — reseñas verificadas por compra
```sql
id, created_at, user_id, producto, estrellas, comentario, nombre, aprobada
```

### Función SQL requerida
```sql
create or replace function increment_stock(p_nombre text, p_cantidad integer)
returns void as $$
  update productos
  set stock_vendido = coalesce(stock_vendido, 0) + p_cantidad
  where nombre = p_nombre and stock_total is not null;
$$ language sql;
```

---

## Flujo de compra

```
Cliente agrega al carrito
        ↓
checkout.html — nombre, teléfono, departamento, ciudad, dirección
        ↓
create-preference.js — crea preferencia en MP, pre-guarda pedido en Supabase
        ↓
MercadoPago — pago con tarjeta / PSE / Nequi / Daviplata
        ↓
mp-webhook.js — confirma pedido + incrementa stock + envía email
        ↓
pago-exitoso.html — resumen del pedido
```

Si el pago falla → `pago-fallido.html` con opción de reintentar o pedir por WhatsApp.

---

## Panel de administración

Acceso: `tu-sitio.netlify.app/admin.html`

Requiere la contraseña configurada en `ADMIN_PASSWORD`.

Funcionalidades:
- Ver todos los pedidos con estado (pendiente → confirmado → enviado → entregado)
- Actualizar estado de cada pedido con un clic
- Abrir WhatsApp directo al cliente con mensaje pre-armado
- Ver todas las reseñas de productos
- Gestionar catálogo: crear, editar, activar/desactivar, eliminar productos
- Control de stock por diseño con barra de progreso visual

---

## Agregar un producto nuevo

1. Sube la imagen a `imgs/shirt_XX.png` y haz `git push`
2. Netlify redesplega automáticamente en ~1 minuto
3. En el panel admin → **▤ Productos** → **+ Agregar producto**
4. Llena nombre, colección, categoría, descripción, ruta de imagen y stock
5. El producto aparece en la tienda de inmediato

---

## Desarrollo local

El sitio es HTML estático — ábrelo directamente en el navegador.

Para probar las Netlify Functions localmente:

```bash
npm install -g netlify-cli
netlify dev
```

Crea un archivo `.env` en la raíz con las variables de entorno para desarrollo local.

---

## Git flow

```bash
# Trabajar en develop
git checkout develop
git add .
git commit -m "descripción del cambio"
git push

# Cuando está listo para producción
gh pr create --base main --head develop --title "descripción"
gh pr merge --merge
```

Netlify despliega automáticamente cada push a `main`.

---

## Webhook MercadoPago

Registrar en el panel de desarrolladores de MP:

- **URL:** `https://tu-sitio.netlify.app/.netlify/functions/mp-webhook`
- **Eventos:** Pagos

---

## Contacto

**WhatsApp:** +57 301 656 8222  
**Medellín, Colombia**

---

*Crazy Monkey Collection Noir — Diseño independiente · Ediciones limitadas · Cada pieza, una declaración.*
