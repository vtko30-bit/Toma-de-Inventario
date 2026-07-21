-- =====================================================
-- Schema y políticas RLS para Control de Inventario
-- Pegar y ejecutar en: Supabase Dashboard -> SQL Editor
-- =====================================================

-- 1. Tabla de perfil de usuario (vinculada a auth.users)
create table if not exists public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nombre text,
  tenant_id text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

-- Helper: tenant del usuario autenticado
create or replace function public.current_tenant()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.usuarios where id = auth.uid()
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.usuarios where id = auth.uid()
$$;

-- 2. Tablas de datos (todas tienen el mismo formato: id, tenant_id, data jsonb)
do $$
declare
  t text;
begin
  foreach t in array array['productos','familias','categorias','sucursales','bodegas','movimientos','inventarios']
  loop
    execute format($f$
      create table if not exists public.%I (
        id text not null,
        tenant_id text not null,
        data jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now(),
        primary key (tenant_id, id)
      );
    $f$, t);
  end loop;
end $$;

-- 3. Tabla de configuración (recetas y posibles ajustes futuros)
create table if not exists public.config (
  tenant_id text not null,
  key text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

-- 4. Habilitar Row Level Security
alter table public.usuarios enable row level security;
alter table public.productos enable row level security;
alter table public.familias enable row level security;
alter table public.categorias enable row level security;
alter table public.sucursales enable row level security;
alter table public.bodegas enable row level security;
alter table public.movimientos enable row level security;
alter table public.inventarios enable row level security;
alter table public.config enable row level security;

-- 5. Políticas para "usuarios"
drop policy if exists "usuarios_select_own_or_tenant" on public.usuarios;
create policy "usuarios_select_own_or_tenant" on public.usuarios
  for select using (
    auth.uid() = id
    or tenant_id = public.current_tenant()
  );

drop policy if exists "usuarios_insert_self" on public.usuarios;
create policy "usuarios_insert_self" on public.usuarios
  for insert with check (auth.uid() = id);

drop policy if exists "usuarios_update_self_or_admin" on public.usuarios;
create policy "usuarios_update_self_or_admin" on public.usuarios
  for update using (
    auth.uid() = id
    or (tenant_id = public.current_tenant() and public.current_role() = 'admin')
  );

drop policy if exists "usuarios_delete_admin" on public.usuarios;
create policy "usuarios_delete_admin" on public.usuarios
  for delete using (
    tenant_id = public.current_tenant() and public.current_role() = 'admin'
  );

-- 6. Políticas genéricas para todas las tablas de datos por tenant
do $$
declare
  t text;
begin
  foreach t in array array['productos','familias','categorias','sucursales','bodegas','movimientos','inventarios','config']
  loop
    execute format($f$
      drop policy if exists "%I_tenant_select" on public.%I;
      create policy "%I_tenant_select" on public.%I
        for select using (tenant_id = public.current_tenant());

      drop policy if exists "%I_tenant_modify" on public.%I;
      create policy "%I_tenant_modify" on public.%I
        for all using (tenant_id = public.current_tenant())
        with check (tenant_id = public.current_tenant());
    $f$, t, t, t, t, t, t, t, t);
  end loop;
end $$;

-- 7. Habilitar Realtime (Supabase realtime opera sobre la publicación supabase_realtime)
do $$
declare
  t text;
begin
  foreach t in array array['productos','familias','categorias','sucursales','bodegas','movimientos','inventarios','config']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I;', t);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;

-- 8. Renombrar tenant (admin puede cambiar el código de empresa)
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

-- Admin crea/reabre una invitaciÃ³n pendiente
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
    raise exception 'Correo invÃ¡lido';
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

-- El usuario autenticado aplica su invitaciÃ³n pendiente (mueve tenant/rol)
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

-- Admin fuerza el vÃ­nculo de un usuario ya registrado (misma invitaciÃ³n)
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
    raise exception 'Correo invÃ¡lido';
  end if;

  select * into v_inv
  from public.invitaciones
  where tenant_id = v_tenant
    and lower(email) = v_email
  order by created_at desc
  limit 1;

  if not found then
    -- crear invitaciÃ³n implÃ­cita y continuar
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
      'message', 'Esa persona aÃºn no tiene cuenta. Debe registrarse o entrar con Google; luego vuelve a Vincular.'
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

