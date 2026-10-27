
create table if not exists public.couple_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.couple_data enable row level security;

drop policy if exists "Users can read own caixinha" on public.couple_data;
create policy "Users can read own caixinha" on public.couple_data
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users can insert own caixinha" on public.couple_data;
create policy "Users can insert own caixinha" on public.couple_data
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users can update own caixinha" on public.couple_data;
create policy "Users can update own caixinha" on public.couple_data
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select on public.couple_data to authenticated;

-- Não reabre escrita direta caso a migração do ledger já esteja instalada.
do $$
begin
  if to_regprocedure('public.save_caixinha(jsonb,timestamptz)') is null then
    grant insert, update on public.couple_data to authenticated;
  else
    revoke insert, update, delete on public.couple_data from anon, authenticated;
  end if;
end $$;

-- Permite executar este script novamente sem duplicar a publicação.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'couple_data'
  ) then
    alter publication supabase_realtime add table public.couple_data;
  end if;
end $$;

