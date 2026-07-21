-- Renombrar tenant (código de empresa) de forma segura.
-- Ejecutar una vez en Supabase → SQL Editor.
-- Permite a un admin cambiar el tenant_id de su empresa y de todos sus datos.

create or replace function public.rename_tenant(p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  if coalesce(public.current_role(), '') <> 'admin' then
    raise exception 'Solo un administrador puede cambiar el nombre de empresa';
  end if;

  if public.current_tenant() is distinct from p_old then
    raise exception 'El tenant actual no coincide con el origen';
  end if;

  if p_new is null or length(trim(p_new)) < 2 then
    raise exception 'El nuevo nombre de empresa no es válido';
  end if;

  if p_old = p_new then
    return;
  end if;

  if exists (select 1 from public.usuarios where tenant_id = p_new limit 1) then
    raise exception 'Ya existe una empresa con ese código. Elige otro nombre.';
  end if;

  update public.usuarios
  set tenant_id = p_new
  where tenant_id = p_old;

  foreach t in array array['productos','familias','categorias','sucursales','bodegas','movimientos','inventarios','config']
  loop
    execute format(
      'update public.%I set tenant_id = $1 where tenant_id = $2',
      t
    )
    using p_new, p_old;
  end loop;
end;
$$;

revoke all on function public.rename_tenant(text, text) from public;
grant execute on function public.rename_tenant(text, text) to authenticated;
