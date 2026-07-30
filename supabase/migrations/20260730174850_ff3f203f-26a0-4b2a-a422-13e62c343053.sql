-- Helper: barbershop_id do usuário autenticado (pela barbershop_members)
create or replace function public.current_barbershop_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select barbershop_id from public.barbershop_members where user_id = auth.uid() limit 1;
$$;

-- INSERT: dono da barbearia pode subir arquivos na sua pasta
create policy "qr_media_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'quick-reply-media'
    and (storage.foldername(name))[1] = public.current_barbershop_id()::text
  );

-- SELECT: dono da barbearia pode ler arquivos da sua pasta
create policy "qr_media_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'quick-reply-media'
    and (storage.foldername(name))[1] = public.current_barbershop_id()::text
  );

-- UPDATE: dono da barbearia pode atualizar arquivos da sua pasta
create policy "qr_media_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'quick-reply-media'
    and (storage.foldername(name))[1] = public.current_barbershop_id()::text
  )
  with check (
    bucket_id = 'quick-reply-media'
    and (storage.foldername(name))[1] = public.current_barbershop_id()::text
  );

-- DELETE: dono da barbearia pode remover arquivos da sua pasta
create policy "qr_media_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'quick-reply-media'
    and (storage.foldername(name))[1] = public.current_barbershop_id()::text
  );