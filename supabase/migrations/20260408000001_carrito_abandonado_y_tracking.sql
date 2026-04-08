-- Columnas para carrito abandonado y tracking de envíos
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS recovery_sent  boolean DEFAULT false;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tracking_number text;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS carrier         text;
