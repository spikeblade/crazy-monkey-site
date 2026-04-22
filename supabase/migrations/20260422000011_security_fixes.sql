-- Tres correcciones de seguridad reportadas por el advisor de Supabase:
-- 1. search_path fijo en funciones RPC (evita search_path injection)
-- 2. Elimina política ALL permisiva en categorias/colecciones (taxonomias.js usa service role)
-- 3. Elimina SELECT policy de listing en bucket artes (public bucket sirve URLs sin política)

-- ── 1. search_path fijo en increment_stock ───────────────────────────────────
CREATE OR REPLACE FUNCTION increment_stock(p_nombre text, p_cantidad integer)
RETURNS boolean AS $$
  WITH updated AS (
    UPDATE productos
    SET stock_vendido = COALESCE(stock_vendido, 0) + p_cantidad
    WHERE nombre = p_nombre
      AND stock_total IS NOT NULL
      AND (COALESCE(stock_vendido, 0) + p_cantidad) <= stock_total
    RETURNING 1
  )
  SELECT EXISTS(SELECT 1 FROM updated);
$$ LANGUAGE sql SET search_path = public;

-- ── 1b. search_path fijo en increment_stock_talla ────────────────────────────
CREATE OR REPLACE FUNCTION increment_stock_talla(p_nombre text, p_talla text, p_cantidad integer)
RETURNS boolean AS $$
DECLARE
  v_total   integer;
  v_vendido integer;
BEGIN
  SELECT
    (stock_tallas -> p_talla ->> 'total')::int,
    (stock_tallas -> p_talla ->> 'vendido')::int
  INTO v_total, v_vendido
  FROM productos
  WHERE nombre = p_nombre AND stock_tallas IS NOT NULL;

  IF v_total IS NULL THEN
    RETURN FALSE;
  END IF;

  IF (v_vendido + p_cantidad) > v_total THEN
    RETURN FALSE;
  END IF;

  UPDATE productos
  SET stock_tallas = jsonb_set(
    stock_tallas,
    ARRAY[p_talla, 'vendido'],
    to_jsonb(v_vendido + p_cantidad)
  )
  WHERE nombre = p_nombre;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ── 2. Elimina políticas de escritura anon en categorias/colecciones ─────────
-- taxonomias.js usa SUPABASE_SERVICE_KEY para POST/PATCH/DELETE.
-- Service role bypassa RLS; no se necesita política para escrituras.
DROP POLICY IF EXISTS "categorias_write_anon" ON categorias;
DROP POLICY IF EXISTS "colecciones_write_anon" ON colecciones;

-- ── 3. Elimina SELECT (listing) policy del bucket artes ──────────────────────
-- El bucket es public:true; las URLs de objetos funcionan sin política.
-- La política SELECT solo habilitaba listing de todos los archivos.
DROP POLICY IF EXISTS "Lectura pública — artes de producción" ON storage.objects;
