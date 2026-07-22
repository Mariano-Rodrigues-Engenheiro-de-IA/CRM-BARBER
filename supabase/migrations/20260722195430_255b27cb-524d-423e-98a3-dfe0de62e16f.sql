
-- Lock down SECURITY DEFINER helpers.
revoke all on function public.is_barbershop_member(uuid, uuid) from public, anon;
grant execute on function public.is_barbershop_member(uuid, uuid) to authenticated, service_role;

revoke all on function public.has_barbershop_role(uuid, uuid, public.app_role) from public, anon;
grant execute on function public.has_barbershop_role(uuid, uuid, public.app_role) to authenticated, service_role;

-- Trigger-only function: nobody should call it directly.
revoke all on function public.handle_new_barbershop() from public, anon, authenticated;
grant execute on function public.handle_new_barbershop() to service_role;

-- Utility function used only by triggers.
revoke all on function public.set_updated_at() from public, anon, authenticated;
grant execute on function public.set_updated_at() to service_role;
