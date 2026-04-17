-- Campo etiqueta_url en productos (arte de la etiqueta para producción)
alter table productos add column if not exists etiqueta_url text;

-- Bucket de Storage para archivos de arte (diseño + etiqueta)
-- Acepta imágenes y PDFs hasta 20MB; lectura pública
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artes',
  'artes',
  true,
  20971520,  -- 20 MB
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf']
) on conflict (id) do nothing;

drop policy if exists "Lectura pública — artes de producción" on storage.objects;
create policy "Lectura pública — artes de producción"
  on storage.objects for select
  using (bucket_id = 'artes');

drop policy if exists "Upload de artes de producción" on storage.objects;
create policy "Upload de artes de producción"
  on storage.objects for insert
  with check (bucket_id = 'artes');
