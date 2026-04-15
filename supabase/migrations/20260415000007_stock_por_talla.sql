-- Stock por talla
-- stock_tallas: JSONB con total y vendido por talla
-- Ejemplo: {"XS":{"total":5,"vendido":0},"S":{"total":10,"vendido":3},"M":{"total":15,"vendido":7}}
-- Si es NULL, el producto sigue usando la lógica global stock_total/stock_vendido (retrocompatible)
ALTER TABLE productos ADD COLUMN IF NOT EXISTS stock_tallas JSONB DEFAULT NULL;
COMMENT ON COLUMN productos.stock_tallas IS 'Stock por talla: {"S":{"total":10,"vendido":3},...}. NULL = usa stock_total global.';

-- RPC atómica para incrementar stock por talla
-- Retorna TRUE si tuvo éxito, FALSE si la talla está agotada
CREATE OR REPLACE FUNCTION increment_stock_talla(p_nombre text, p_talla text, p_cantidad integer)
RETURNS boolean AS $$
DECLARE
  v_total integer;
  v_vendido integer;
BEGIN
  SELECT
    (stock_tallas -> p_talla ->> 'total')::int,
    (stock_tallas -> p_talla ->> 'vendido')::int
  INTO v_total, v_vendido
  FROM productos
  WHERE nombre = p_nombre AND stock_tallas IS NOT NULL;

  IF v_total IS NULL THEN
    RETURN FALSE; -- talla no existe o producto sin stock_tallas
  END IF;

  IF (v_vendido + p_cantidad) > v_total THEN
    RETURN FALSE; -- stock insuficiente para esta talla
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
$$ LANGUAGE plpgsql;
