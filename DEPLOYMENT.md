# CRAZY MONKEY — Guía de Deployment
## Netlify + MercadoPago

---

## ESTRUCTURA DE ARCHIVOS

Tu proyecto debe quedar así:

```
crazy-monkey/
├── index.html
├── manifiesto.html
├── declaracion.html
├── contacto.html
├── pago-exitoso.html
├── pago-fallido.html
├── netlify.toml
└── netlify/
    └── functions/
        └── create-preference.js
```

---

## PASO 1 — Subir a GitHub

1. Crea una cuenta en https://github.com si no tienes
2. Crea un repositorio nuevo (ej: `crazy-monkey-site`)
3. Sube todos los archivos

---

## PASO 2 — Conectar Netlify

1. Ve a https://netlify.com y crea cuenta (gratis)
2. Clic en "Add new site" → "Import an existing project"
3. Conecta tu cuenta de GitHub
4. Selecciona el repositorio `crazy-monkey-site`
5. Configuración de build:
   - Build command: (dejar vacío)
   - Publish directory: `.`
6. Clic en "Deploy site"

Tu sitio queda en vivo en minutos con una URL tipo:
`https://crazy-monkey-xxxx.netlify.app`

---

## PASO 3 — Variables de entorno (MercadoPago)

### Obtener tu Access Token de MP:

1. Ve a https://www.mercadopago.com.co/developers
2. Inicia sesión con tu cuenta de vendedor
3. Ve a "Mis aplicaciones" → crea una nueva aplicación
4. En las credenciales encontrarás:
   - **Public Key** (empieza con `APP_USR-...`) — para el frontend
   - **Access Token** (empieza con `APP_USR-...`) — para el backend (SECRETO)

### Agregar las variables en Netlify:

1. En tu sitio de Netlify → "Site configuration" → "Environment variables"
2. Agrega estas dos variables:

| Variable | Valor |
|----------|-------|
| `MP_ACCESS_TOKEN` | Tu Access Token de producción |
| `SITE_URL` | `https://tu-dominio.netlify.app` (sin / al final) |

3. Clic en "Save"
4. Re-deploy el sitio (Site → Deploys → "Trigger deploy")

---

## PASO 4 — Probar antes de cobrar real

MP tiene un entorno de pruebas (Sandbox). Para probar:

1. En vez de `init_point` usa `sandbox_init_point` en el código
2. En `create-preference.js` línea 74, cambia:
   ```js
   init_point: mpResponse.body.init_point,
   ```
   por:
   ```js
   init_point: mpResponse.body.sandbox_init_point,
   ```
3. Usa las tarjetas de prueba de MP:
   - Tarjeta VISA aprobada: `4509 9535 6623 3704`
   - CVV: `123` | Vencimiento: cualquier fecha futura

4. Cuando todo funcione, vuelve a `init_point` para producción.

---

## PASO 5 — Dominio propio (opcional)

En Netlify → "Domain management" → "Add custom domain"

Dominios económicos recomendados:
- https://porkbun.com — desde $10 USD/año
- https://namecheap.com — desde $12 USD/año

Busca algo como `crazymonkey.store` o `crazymoneycol.com`

---

## SEGURIDAD

- El `MP_ACCESS_TOKEN` NUNCA debe estar en el código HTML
- Solo vive en las variables de entorno de Netlify
- La función `create-preference.js` es el único lugar que lo usa

---

## SOPORTE

Si algo falla en el checkout, el cliente ve la página `pago-fallido.html`
con opción de completar el pedido por WhatsApp al +57 301 656 8222.
