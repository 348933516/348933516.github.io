-- Remove prototype stock placeholders while preserving uploaded and intentional external media.
delete from public.content_media
where external_url like 'https://images.unsplash.com/%';
