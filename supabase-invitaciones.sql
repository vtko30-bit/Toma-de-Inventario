-- Invitaciones por correo: ejecutar una vez en Supabase SQL Editor.
-- Permite vincular al invitado a tu empresa aunque se registre con Google
-- o con otro nombre de empresa.

create table if not exists public.invitaciones (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  email text not null,
  role text not null default 'usuario',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (tenant_id, email)
);

alter table public.invitaciones enable row level security;

drop policy if exists "invitaciones_select" on public.invitaciones;
create policy "invitaciones_select" on public.invitaciones
  for select using (
    tenant_id = public.current_tenant()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists "invitaciones_insert_admin" on public.invitaciones;
create policy "invitaciones_insert_admin" on public.invitaciones
  for insert with check (
    tenant_id = public.current_tenant()
    and public.current_role() = 'admin'
  );

drop policy if exists "invitaciones_update_admin" on public.invitaciones;
create policy "invitaciones_update_admin" on public.invitaciones
  for update using (
    tenant_id = public.current_tenant()
    and public.current_role() = 'admin'
  );

drop policy if exists "invitaciones_delete_admin" on public.invitaciones;
create policy "invitaciones_delete_admin" on public.invitaciones
  for delete using (
    tenant_id = public.current_tenant()
    and public.current_role() = 'admin'
  );

-- Admin crea/reabre una invitación pendiente
create or replace function public.crear_invitacion(p_email text, p_role text default 'usuario')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_role text;
  v_tenant text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if coalesce(public.current_role(), '') <> 'admin' then
    raise exception 'Solo un administrador puede invitar';
  end if;

  v_tenant := public.current_tenant();
  if v_tenant is null or length(trim(v_tenant)) < 1 then
    raise exception 'No hay empresa activa';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Correo inválido';
  end if;

  v_role := lower(trim(coalesce(p_role, 'usuario')));
  if v_role not in ('admin', 'usuario', 'inventario') then
    v_role := 'usuario';
  end if;

  insert into public.invitaciones (tenant_id, email, role, invited_by, accepted_at)
  values (v_tenant, v_email, v_role, auth.uid(), null)
  on conflict (tenant_id, email)
  do update set
    role = excluded.role,
    invited_by = excluded.invited_by,
    accepted_at = null,
    created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- El usuario autenticado aplica su invitación pendiente (mueve tenant/rol)
create or replace function public.aplicar_invitacion()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_inv public.invitaciones%rowtype;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_email = '' then
    select lower(email) into v_email from public.usuarios where id = auth.uid();
  end if;
  if v_email is null or v_email = '' then
    return jsonb_build_object('applied', false, 'reason', 'sin_email');
  end if;

  select * into v_inv
  from public.invitaciones
  where lower(email) = v_email
    and accepted_at is null
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'sin_invitacion');
  end if;

  insert into public.usuarios (id, email, nombre, tenant_id, role)
  values (
    auth.uid(),
    v_email,
    coalesce((auth.jwt() -> 'user_metadata' ->> 'full_name'), (auth.jwt() -> 'user_metadata' ->> 'name'), v_email),
    v_inv.tenant_id,
    v_inv.role
  )
  on conflict (id) do update set
    tenant_id = excluded.tenant_id,
    role = excluded.role,
    email = excluded.email;

  update public.invitaciones
  set accepted_at = now()
  where id = v_inv.id;

  return jsonb_build_object(
    'applied', true,
    'tenant_id', v_inv.tenant_id,
    'role', v_inv.role,
    'email', v_email
  );
end;
$$;

-- Admin fuerza el vínculo de un usuario ya registrado (misma invitación)
create or replace function public.vincular_invitado(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_tenant text;
  v_inv public.invitaciones%rowtype;
  v_user public.usuarios%rowtype;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if coalesce(public.current_role(), '') <> 'admin' then
    raise exception 'Solo un administrador puede vincular';
  end if;

  v_tenant := public.current_tenant();
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' then
    raise exception 'Correo inválido';
  end if;

  select * into v_inv
  from public.invitaciones
  where tenant_id = v_tenant
    and lower(email) = v_email
  order by created_at desc
  limit 1;

  if not found then
    -- crear invitación implícita y continuar
    insert into public.invitaciones (tenant_id, email, role, invited_by)
    values (v_tenant, v_email, 'usuario', auth.uid())
    returning * into v_inv;
  end if;

  select * into v_user
  from public.usuarios
  where lower(email) = v_email
  order by created_at asc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'reason', 'usuario_no_registrado',
      'message', 'Esa persona aún no tiene cuenta. Debe registrarse o entrar con Google; luego vuelve a Vincular.'
    );
  end if;

  update public.usuarios
  set tenant_id = v_tenant,
      role = coalesce(nullif(v_inv.role, ''), 'usuario')
  where id = v_user.id;

  update public.invitaciones
  set accepted_at = now(),
      role = coalesce(nullif(v_inv.role, ''), 'usuario')
  where id = v_inv.id;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_user.id,
    'email', v_email,
    'tenant_id', v_tenant,
    'role', coalesce(nullif(v_inv.role, ''), 'usuario')
  );
end;
$$;

revoke all on function public.crear_invitacion(text, text) from public;
revoke all on function public.aplicar_invitacion() from public;
revoke all on function public.vincular_invitado(text) from public;
grant execute on function public.crear_invitacion(text, text) to authenticated;
grant execute on function public.aplicar_invitacion() to authenticated;
grant execute on function public.vincular_invitado(text) to authenticated;
