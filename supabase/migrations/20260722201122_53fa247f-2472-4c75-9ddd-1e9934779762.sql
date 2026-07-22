
CREATE OR REPLACE FUNCTION public.handle_new_barbershop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if new.created_by is not null then
    insert into public.barbershop_members (barbershop_id, user_id, role)
    values (new.id, new.created_by, 'owner');
  end if;
  return new;
end;
$function$;
