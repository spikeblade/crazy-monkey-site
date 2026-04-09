-- Tablas para gestión de categorías y colecciones de productos

CREATE TABLE IF NOT EXISTS categorias (
  id        uuid   NOT NULL DEFAULT gen_random_uuid(),
  nombre    text   NOT NULL,
  slug      text   NOT NULL,
  orden     integer NOT NULL DEFAULT 0,
  CONSTRAINT categorias_pkey    PRIMARY KEY (id),
  CONSTRAINT categorias_slug_uq UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS colecciones (
  id          uuid   NOT NULL DEFAULT gen_random_uuid(),
  nombre      text   NOT NULL,
  descripcion text,
  orden       integer NOT NULL DEFAULT 0,
  activo      boolean NOT NULL DEFAULT true,
  CONSTRAINT colecciones_pkey    PRIMARY KEY (id),
  CONSTRAINT colecciones_nombre_uq UNIQUE (nombre)
);

-- Datos iniciales (valores actuales hardcodeados en el admin)
INSERT INTO categorias (nombre, slug, orden) VALUES
  ('Noir',      'noir',      1),
  ('Gothic',    'gothic',    2),
  ('Punk',      'punk',      3),
  ('Literary',  'literary',  4)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO colecciones (nombre, orden) VALUES
  ('Collection Noir',     1),
  ('Gothic Fantasy',      2),
  ('Anti-Establishment',  3),
  ('Literario',           4)
ON CONFLICT (nombre) DO NOTHING;
