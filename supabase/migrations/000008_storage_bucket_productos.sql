-- Bucket de Supabase Storage para imágenes de productos
-- Lectura pública; escritura restringida por tipo y tamaño.
-- La autenticación real de admin se valida en upload-imagen.js (x-admin-password).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'productos',
  'productos',
  true,
  5242880,  -- 5 MB
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
) on conflict (id) do nothing;

-- Lectura pública (URLs accesibles en la tienda sin autenticación)
drop policy if exists "Lectura pública — imágenes de productos" on storage.objects;
create policy "Lectura pública — imágenes de productos"
  on storage.objects for select
  using (bucket_id = 'productos');

-- Insert permitido desde el rol anon (la función upload-imagen.js valida el admin password)
drop policy if exists "Upload de imágenes de productos" on storage.objects;
create policy "Upload de imágenes de productos"
  on storage.objects for insert
  with check (bucket_id = 'productos');
