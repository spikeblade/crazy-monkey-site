-- Agrega campo arte_url a productos
-- URL al archivo de arte listo para impresión (alta resolución / vectorial)
-- Usado por el taller para imprimir las camisetas

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS arte_url TEXT DEFAULT NULL;

COMMENT ON COLUMN productos.arte_url IS 'URL al archivo de arte para impresión (Google Drive, Dropbox, Supabase Storage, etc.)';
