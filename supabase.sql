-- Pegar entero en Supabase → SQL Editor → Run. Antes, crear el bucket público "listados" en Storage.
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
alter table clientes  enable row level security;
alter table versiones enable row level security;
create policy leer on clientes  for select using (true);
create policy leer on versiones for select using (true);
create policy cargar on clientes for insert to authenticated
  with check (auth.jwt() ->> 'email' like '%@hmconsulting.com.ar');
create policy cargar on versiones for insert to authenticated
  with check (auth.jwt() ->> 'email' like '%@hmconsulting.com.ar');
create policy subir_listados on storage.objects for insert to authenticated
  with check (bucket_id = 'listados' and auth.jwt() ->> 'email' like '%@hmconsulting.com.ar');
