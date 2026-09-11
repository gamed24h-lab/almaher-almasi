-- Private storage for ID Studio template designer assets.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'id-card-template-assets',
  'id-card-template-assets',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
