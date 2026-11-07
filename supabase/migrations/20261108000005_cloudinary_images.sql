-- IfeCollection: product photos can live on Cloudinary (recommended) or Supabase Storage (fallback).
--   provider = 'cloudinary': path = Cloudinary secure_url, external_id = Cloudinary public_id,
--                            thumb_path is NULL (thumbnails are made by Cloudinary from the URL).
--   provider = 'supabase':   path / thumb_path = object paths in the product-images bucket (as before).
alter table public.product_images
  add column provider text not null default 'supabase' check (provider in ('supabase', 'cloudinary')),
  add column external_id text,
  alter column thumb_path drop not null;

alter table public.product_images
  add constraint product_images_provider_fields check (
    (provider = 'supabase' and thumb_path is not null)
    or (provider = 'cloudinary' and path like 'https://res.cloudinary.com/%' and external_id is not null)
  );
