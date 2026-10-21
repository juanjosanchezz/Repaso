-- Repaso · base de datos para las cuentas de la versión web.
-- Se aplica solo en cada despliegue de Vercel (scripts/migrate.js, con POSTGRES_URL de la
-- integración de Supabase). A mano: Supabase → SQL Editor → New query → pegar → Run.
-- Se puede ejecutar más de una vez.
--
-- Una fila por documento de la app (perfil, asignaturas, temas, archivos, materiales…).
-- `path` es la ruta dentro de la cuenta, p. ej. "profile" o "profile/subjects/abc123".
-- Cada usuaria solo puede leer y escribir sus filas (Row Level Security).

set client_min_messages = warning;

create table if not exists public.repaso_docs (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  path       text        not null check (char_length(path) between 1 and 600),
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, path)
);

create index if not exists repaso_docs_user_updated on public.repaso_docs (user_id, updated_at);

-- La hora de cada cambio la pone el servidor, para sincronizar bien entre dispositivos.
create or replace function public.repaso_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists repaso_docs_touch on public.repaso_docs;
create trigger repaso_docs_touch before insert or update on public.repaso_docs
  for each row execute function public.repaso_touch();

alter table public.repaso_docs enable row level security;

drop policy if exists "repaso: leer lo mio" on public.repaso_docs;
drop policy if exists "repaso: crear lo mio" on public.repaso_docs;
drop policy if exists "repaso: cambiar lo mio" on public.repaso_docs;
drop policy if exists "repaso: borrar lo mio" on public.repaso_docs;

create policy "repaso: leer lo mio" on public.repaso_docs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "repaso: crear lo mio" on public.repaso_docs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "repaso: cambiar lo mio" on public.repaso_docs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "repaso: borrar lo mio" on public.repaso_docs
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.repaso_docs from anon;
grant select, insert, update, delete on public.repaso_docs to authenticated;

-- Que la API de Supabase vea la tabla nueva sin esperar.
notify pgrst, 'reload schema';
