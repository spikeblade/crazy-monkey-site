# Changelog

Todos los cambios notables se documentan aquí.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).
Versionamiento: [Semantic Versioning](https://semver.org/lang/es/).

---

## [2.2.0] — 2026-04-15

### Agregado
- **Galería de imágenes** — campo `imagenes TEXT[]` en productos, strip de miniaturas en `producto.astro`
- **Stock por talla** — campo `stock_tallas JSONB` con estructura `{S:{total,vendido},...}`; botones agotados por talla en producto; badges de stock en admin
- **Página de colecciones** — `/colecciones.html` con grid de colecciones enlazando al catálogo filtrado
- Enlace Colecciones en Nav (desktop y móvil)
- Función `increment_stock_talla(p_nombre, p_talla, p_cantidad)` — RPC atómica para decremento por talla
- Migraciones: `000006_galeria_productos.sql`, `000007_stock_por_talla.sql`
- Panel de clientes en admin — función `get-clientes.js` y vista de clientes únicos con totales

### Modificado
- `create-preference.js`: verificación de stock por talla (fallback a stock global si `stock_tallas = null`)
- `mp-webhook.js`: `incrementStock` usa `increment_stock_talla` cuando aplica, fallback a `increment_stock`
- `productos.js`: campos `imagenes` y `stock_tallas` en POST/PATCH
- `index.astro`: filtro `?coleccion=` activa la pestaña correspondiente al cargar
- Suite de tests: 199 tests, 16 suites — todos pasan

---

## [2.1.0] — 2026-04-15

### Agregado
- Panel de clientes en admin — agrega pedidos por email, muestra totales y último pedido (`get-clientes.js`)
- Tracking de guías en admin — modal para asignar número de guía y transportadora, envía email al cliente
- Pedidos por lote — tabla expandible en cada lote de producción con los pedidos incluidos
- Notificación de nuevos pedidos — toast + beep AudioContext cuando llegan pedidos mientras el admin está abierto
- Búsqueda de pedidos — filtro en tiempo real por nombre, email o teléfono
- `arte_url` en productos — campo para URL al archivo de arte para impresión, visible en orden de producción PDF
- Página 404 personalizada con diseño de marca

### Modificado
- Node.js actualizado a 24 (`.nvmrc`, `package.json engines`, `netlify.toml NODE_VERSION`)
- Suite de tests: 190 → 199 tests, 15 → 16 suites

---

## [2.0.0] — 2026-04-08

### Agregado (migración completa a Astro V2)
- Stack migrado de HTML estático manual a **Astro V2** con output estático
- 14 páginas Astro (`src/pages/`) reemplazando los `.html` manuales
- Layouts reutilizables: `Layout.astro`, `LayoutPublic.astro`, `LayoutPrivate.astro`
- Componentes: `Nav`, `CartPanel`, `Footer`, `AccountScript`, `StockToast`
- `astro.config.mjs` con `output: 'static'`, `build.format: 'file'`, site canonical
- `public/` para assets estáticos (imgs, favicon, og-cover, robots.txt, sitemap.xml)
- `.env.example` con todas las variables de entorno documentadas
- Redirects en `netlify.toml` (canonical `/index.html → /`, 404 personalizado)
- Schema.org Product dinámico en página de producto (rich snippets)
- `localStorage` versionado (`cm_cart_v2`) para evitar conflictos con carrito viejo
- Migraciones SQL: `000004_barrio_perfil`, `000005_arte_url_productos`
- Panel admin con analytics, taxonomías, producción con lotes, recuperación de carritos abandonados

### Eliminado
- Todos los `.html` manuales del root (reemplazados por Astro)

---

## [1.x] — Pre-Astro

Versión anterior con páginas HTML estáticas manuales. Ver historial de git para detalle.
