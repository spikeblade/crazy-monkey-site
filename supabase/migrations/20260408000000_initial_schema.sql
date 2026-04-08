-- Esquema inicial de Crazy Monkey Store
-- Aplicado manualmente antes de configurar migraciones automáticas.
-- Usa IF NOT EXISTS / CREATE OR REPLACE para ser idempotente.

-- ── Tabla: configuracion ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS configuracion (
  id               integer      NOT NULL DEFAULT 1,
  precio_venta     integer      NOT NULL DEFAULT 95000,
  costo_produccion integer      NOT NULL DEFAULT 49000,
  updated_at       timestamptz  DEFAULT now(),
  CONSTRAINT configuracion_pkey PRIMARY KEY (id),
  CONSTRAINT configuracion_single_row CHECK (id = 1)
);

-- Fila única de configuración
INSERT INTO configuracion (id, precio_venta, costo_produccion)
VALUES (1, 95000, 49000)
ON CONFLICT (id) DO NOTHING;

-- ── Tabla: productos ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos (
  id          uuid         NOT NULL DEFAULT gen_random_uuid(),
  orden       integer      NOT NULL DEFAULT 0,
  nombre      text         NOT NULL,
  coleccion   text         NOT NULL,
  categoria   text         NOT NULL,
  descripcion text         NOT NULL,
  imagen      text         NOT NULL,
  precio      integer      NOT NULL DEFAULT 95000,
  activo      boolean      NOT NULL DEFAULT true,
  created_at  timestamptz  DEFAULT now(),
  stock_total integer,
  stock_vendido integer    DEFAULT 0,
  CONSTRAINT productos_pkey PRIMARY KEY (id)
);

-- ── Tabla: pedidos ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pedidos (
  id               uuid         NOT NULL DEFAULT gen_random_uuid(),
  created_at       timestamptz  DEFAULT now(),
  nombre           text         NOT NULL,
  telefono         text         NOT NULL,
  departamento     text         NOT NULL,
  ciudad           text         NOT NULL,
  items            jsonb        NOT NULL,
  total            integer      NOT NULL,
  mp_preference_id text,
  mp_payment_id    text,
  mp_status        text         DEFAULT 'pending',
  estado           text         DEFAULT 'pendiente',
  user_id          uuid,
  email            text,
  direccion        text,
  CONSTRAINT pedidos_pkey PRIMARY KEY (id)
);

-- ── Tabla: perfiles ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS perfiles (
  id           uuid         NOT NULL,
  nombre       text,
  telefono     text,
  departamento text,
  ciudad       text,
  direccion    text,
  updated_at   timestamptz  DEFAULT now(),
  CONSTRAINT perfiles_pkey PRIMARY KEY (id)
);

-- ── Tabla: reviews ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id          uuid         NOT NULL DEFAULT gen_random_uuid(),
  created_at  timestamptz  DEFAULT now(),
  user_id     uuid,
  producto    text         NOT NULL,
  estrellas   integer      NOT NULL,
  comentario  text         NOT NULL,
  nombre      text,
  aprobada    boolean      DEFAULT true,
  CONSTRAINT reviews_pkey PRIMARY KEY (id)
);

-- ── Tabla: lotes_produccion ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lotes_produccion (
  id          uuid         NOT NULL DEFAULT gen_random_uuid(),
  created_at  timestamptz  DEFAULT now(),
  nombre      text         NOT NULL,
  estado      text         NOT NULL DEFAULT 'borrador',
  costo_unit  integer      NOT NULL DEFAULT 49000,
  notas       text,
  pedidos_ids jsonb        DEFAULT '[]'::jsonb,
  CONSTRAINT lotes_produccion_pkey PRIMARY KEY (id)
);

-- ── Función RPC: increment_stock ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_stock(p_nombre text, p_cantidad integer)
RETURNS void AS $$
  UPDATE productos
  SET stock_vendido = COALESCE(stock_vendido, 0) + p_cantidad
  WHERE nombre = p_nombre
    AND stock_total IS NOT NULL;
$$ LANGUAGE sql;
