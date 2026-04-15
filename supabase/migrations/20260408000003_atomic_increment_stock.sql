-- Reemplaza increment_stock por versión atómica y condicional.
-- Solo incrementa stock_vendido si hay unidades disponibles.
-- Retorna TRUE si el incremento fue exitoso, FALSE si el stock estaba agotado.
-- Protege contra oversell en compras simultáneas de la última unidad.

DROP FUNCTION IF EXISTS increment_stock(text, integer);

CREATE FUNCTION increment_stock(p_nombre text, p_cantidad integer)
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
$$ LANGUAGE sql;
