-- Habilita RLS en categorias y colecciones.
-- La autenticación de escritura se hace en la función taxonomias.js
-- (header x-admin-password). Supabase solo necesita permitir anon para
-- que las llamadas con SUPABASE_ANON_KEY sigan funcionando.

ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE colecciones ENABLE ROW LEVEL SECURITY;

-- ── categorias ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "categorias_select_public"  ON categorias;
DROP POLICY IF EXISTS "categorias_write_anon"     ON categorias;

CREATE POLICY "categorias_select_public"
  ON categorias FOR SELECT
  USING (true);

CREATE POLICY "categorias_write_anon"
  ON categorias FOR ALL
  USING (true)
  WITH CHECK (true);

-- ── colecciones ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "colecciones_select_public" ON colecciones;
DROP POLICY IF EXISTS "colecciones_write_anon"    ON colecciones;

CREATE POLICY "colecciones_select_public"
  ON colecciones FOR SELECT
  USING (true);

CREATE POLICY "colecciones_write_anon"
  ON colecciones FOR ALL
  USING (true)
  WITH CHECK (true);
