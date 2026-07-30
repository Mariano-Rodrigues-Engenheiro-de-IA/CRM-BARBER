drop policy if exists "qr_media_insert" on storage.objects;
drop policy if exists "qr_media_select" on storage.objects;
drop policy if exists "qr_media_update" on storage.objects;
drop policy if exists "qr_media_delete" on storage.objects;
drop function if exists public.current_barbershop_id();

create policy "qr_media_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'quick-reply-media'
    and (storage.foldername(name))[1]::uuid in (
      select barbershop_id from public.barbershop_members where user_id = auth.uid()
    )
  );

create policy "qr_media_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'quick-reply-media'
    and (storage.foldername(name))[1]::uuid in (
      select barbershop_id from public.barbershop_members where user_id = auth.uid()
    )
  );

create policy "qr_media_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'quick-reply-media'
    and (storage.foldername(name))[1]::uuid in (
      select barbershop_id from public.barbershop_members where user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'quick-reply-media'
    and (storage.foldername(name))[1]::uuid in (
      select barbershop_id from public.barbershop_members where user_id = auth.uid()
    )
  );

create policy "qr_media_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'quick-reply-media'
    and (storage.foldername(name))[1]::uuid in (
      select barbershop_id from public.barbershop_members where user_id = auth.uid()
    )
  );