-- Repaso · base de datos de la versión web (Neon u otro PostgreSQL 13+).
-- scripts/migrate.js lo aplica en cada despliegue; se puede ejecutar las veces que haga falta.
set client_min_messages = warning;

-- Cuentas: email y contraseña (scrypt, nunca en claro).
create table if not exists rp_users (
  id         uuid        primary key default gen_random_uuid(),
  email      text        not null unique check (email = lower(email) and char_length(email) <= 200),
  pass_hash  text        not null,
  name       text        not null default '',
  meta       jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Sesiones: se guarda el hash del token, no el token.
create table if not exists rp_sessions (
  token_hash text        primary key,
  user_id    uuid        not null references rp_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used  timestamptz not null default now()
);
create index if not exists rp_sessions_user on rp_sessions (user_id);

-- Una fila por documento de la app (perfil, asignaturas, temas, archivos, materiales…).
-- `path` es la ruta dentro de la cuenta: "profile", "profile/subjects/abc123"…
create table if not exists rp_docs (
  user_id    uuid        not null references rp_users (id) on delete cascade,
  path       text        not null check (char_length(path) between 1 and 600),
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, path)
);
create index if not exists rp_docs_user_updated on rp_docs (user_id, updated_at);

-- La hora de cada cambio la pone la base de datos, para sincronizar bien entre dispositivos.
create or replace function rp_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists rp_docs_touch on rp_docs;
create trigger rp_docs_touch before insert or update on rp_docs for each row execute function rp_touch();
