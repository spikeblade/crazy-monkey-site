-- Galería de imágenes por producto
-- imagenes: array de URLs adicionales (la imagen principal sigue en el campo imagen)
ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagenes TEXT[] DEFAULT NULL;
COMMENT ON COLUMN productos.imagenes IS 'URLs adicionales de imágenes del producto (galería)';
