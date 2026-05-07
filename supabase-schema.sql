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
