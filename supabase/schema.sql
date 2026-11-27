-- Mappa 3D Colline del Prosecco – schema Supabase per la versione definitiva.
-- Eseguire nell'editor SQL del progetto Supabase. Ogni tabella tiene i campi dell'elemento in "dati"
-- (stessa forma dei file JSON in public/data) e un flag "eliminato".

create table if not exists profili (
  id uuid primary key references auth.users on delete cascade,
  nome text,
  ruolo text not null default 'lettore' check (ruolo in ('lettore', 'redazione'))
);

create table if not exists localita   (id text primary key, dati jsonb not null default '{}', eliminato boolean not null default false, aggiornato timestamptz not null default now());
create table if not exists contenuti  (id text primary key, dati jsonb not null default '{}', eliminato boolean not null default false, aggiornato timestamptz not null default now());
create table if not exists audio      (id text primary key, dati jsonb not null default '{}', eliminato boolean not null default false, aggiornato timestamptz not null default now());
create table if not exists giochi     (id text primary key, dati jsonb not null default '{}', eliminato boolean not null default false, aggiornato timestamptz not null default now());
create table if not exists impostazioni (id text primary key, dati jsonb not null default '{}', aggiornato timestamptz not null default now());

-- chi è redazione
create or replace function is_redazione() returns boolean language sql stable security definer as $$
  select exists (select 1 from profili where id = auth.uid() and ruolo = 'redazione');
$$;

-- Regole di accesso: tutti leggono; i contenuti in bozza solo la redazione; scrive solo la redazione.
do $$
declare t text;
begin
  foreach t in array array['localita', 'audio', 'giochi', 'impostazioni'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists lettura on %I', t);
    execute format('create policy lettura on %I for select using (true)', t);
    execute format('drop policy if exists scrittura on %I', t);
    execute format('create policy scrittura on %I for all using (is_redazione()) with check (is_redazione())', t);
  end loop;
end $$;

alter table contenuti enable row level security;
drop policy if exists lettura on contenuti;
create policy lettura on contenuti for select using (coalesce(dati->>'stato', 'pubblicato') = 'pubblicato' or is_redazione());
drop policy if exists scrittura on contenuti;
create policy scrittura on contenuti for all using (is_redazione()) with check (is_redazione());

alter table profili enable row level security;
drop policy if exists proprio_profilo on profili;
create policy proprio_profilo on profili for select using (id = auth.uid());

-- aggiornamenti in tempo reale
alter publication supabase_realtime add table localita, contenuti, audio, giochi, impostazioni;

-- archivio file (immagini, foto 360, audio, PDF): lettura pubblica, caricamento solo redazione
insert into storage.buckets (id, name, public) values ('media', 'media', true) on conflict (id) do nothing;
drop policy if exists media_scrittura on storage.objects;
create policy media_scrittura on storage.objects for insert with check (bucket_id = 'media' and is_redazione());

-- Per abilitare una persona della redazione (dopo che si è registrata):
-- insert into profili (id, nome, ruolo) values ('<uuid utente>', 'Nome Cognome', 'redazione')
--   on conflict (id) do update set ruolo = 'redazione';
