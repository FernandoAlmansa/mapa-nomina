-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr de nuevo sin romper nada.
-- Antes, crear el bucket público "listados" en Storage (ya está creado).

create table if not exists clientes (
  id text primary key,
  nombre text not null,
  creado_en timestamptz default now()
);
create table if not exists versiones (
  id bigint generated always as identity primary key,
  cliente_id text not null references clientes(id),
  rpdasc00_path text not null,
  t512w_path text not null,
  fecha_listado date,
  pasos int,
  reglas int,
  notas text,
  subido_por text default (auth.jwt() ->> 'email'),
  subido_en timestamptz default now()
);
alter table versiones add column if not exists esquema text;

-- Permisos de las tablas. Sin esto Supabase responde "permission denied for table clientes".
grant usage on schema public to anon, authenticated;
grant select on clientes, versiones to anon, authenticated;
grant insert on clientes, versiones to authenticated;

-- Quién puede ver y cargar: ver, cualquiera; cargar, solo mails @hmconsulting.com.ar
alter table clientes  enable row level security;
alter table versiones enable row level security;
drop policy if exists leer on clientes;
drop policy if exists leer on versiones;
drop policy if exists cargar on clientes;
drop policy if exists cargar on versiones;
create policy leer on clientes  for select using (true);
create policy leer on versiones for select using (true);
create policy cargar on clientes for insert to authenticated
  with check (auth.jwt() ->> 'email' like '%@hmconsulting.com.ar');
create policy cargar on versiones for insert to authenticated
  with check (auth.jwt() ->> 'email' like '%@hmconsulting.com.ar');

drop policy if exists subir_listados on storage.objects;
create policy subir_listados on storage.objects for insert to authenticated
  with check (bucket_id = 'listados' and auth.jwt() ->> 'email' like '%@hmconsulting.com.ar');
