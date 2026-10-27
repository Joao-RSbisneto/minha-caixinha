-- Executar uma vez no SQL Editor. Pode ser executado novamente.
-- Preserva couple_data e importa as movimentações existentes.
begin;

create table if not exists public.caixinha_transactions (
  user_id uuid not null references public.couple_data(user_id) on delete cascade,
  id text not null check (length(id) between 1 and 100),
  type text not null check (type in ('deposit', 'withdraw')),
  amount numeric(12,2) not null check (amount > 0),
  person smallint not null check (person in (1, 2)),
  date date not null,
  description text not null check (length(btrim(description)) between 1 and 100),
  primary key (user_id, id)
);
create table if not exists public.caixinha_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE', 'SETTINGS')),
  transaction_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists caixinha_audit_user_idx on public.caixinha_audit(user_id, id desc);
alter table public.caixinha_transactions enable row level security;
alter table public.caixinha_audit enable row level security;
drop policy if exists "Read own transactions" on public.caixinha_transactions;
create policy "Read own transactions" on public.caixinha_transactions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Read own history" on public.caixinha_audit;
create policy "Read own history" on public.caixinha_audit
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.caixinha_transactions, public.caixinha_audit from anon, authenticated;
grant select on public.caixinha_transactions, public.caixinha_audit to authenticated;

-- Valida também gravações feitas por clientes antigos e mantém a projeção
-- normalizada. Qualquer falha desfaz a operação inteira.
create or replace function public.sync_caixinha_ledger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p jsonb := new.payload;
  tx jsonb;
  previous public.caixinha_transactions%rowtype;
  amount_value numeric;
  opening numeric;
  balance_value numeric;
  tx_date date;
  ids text[] := array[]::text[];
  next_settings jsonb;
  old_settings jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object'
     or jsonb_typeof(p->'names') is distinct from 'array'
     or jsonb_typeof(p->'tx') is distinct from 'array'
     or jsonb_typeof(p->'setupComplete') is distinct from 'boolean'
     or jsonb_typeof(p->'goal') is distinct from 'number'
     or jsonb_typeof(p->'initialBalance') is distinct from 'number' then
    raise exception 'Estrutura da caixinha inválida.' using errcode = '22023';
  end if;
  if jsonb_array_length(p->'names') <> 2 then
    raise exception 'Informe dois nomes.' using errcode = '22023';
  end if;
  for tx in select value from jsonb_array_elements(p->'names') loop
    if jsonb_typeof(tx) <> 'string' or length(btrim(tx #>> '{}')) not between 1 and 35 then
      raise exception 'Nome inválido.' using errcode = '22023';
    end if;
  end loop;
  opening := (p->>'initialBalance')::numeric;
  amount_value := (p->>'goal')::numeric;
  if opening < 0 or opening > 9999999999.99 or opening <> round(opening, 2)
     or amount_value <= 0 or amount_value > 9999999999.99 or amount_value <> round(amount_value, 2) then
    raise exception 'Saldo inicial ou meta inválidos.' using errcode = '22023';
  end if;
  if p ? 'openingDate' then
    if jsonb_typeof(p->'openingDate') <> 'string' or (p->>'openingDate') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Data de abertura inválida.' using errcode = '22023';
    end if;
    tx_date := (p->>'openingDate')::date;
  end if;
  balance_value := opening;
  for tx in select value from jsonb_array_elements(p->'tx') loop
    if jsonb_typeof(tx) is distinct from 'object'
       or jsonb_typeof(tx->'id') is distinct from 'string'
       or length(tx->>'id') not between 1 and 100
       or (tx->>'id') = any(ids)
       or jsonb_typeof(tx->'type') is distinct from 'string'
       or (tx->>'type') not in ('deposit', 'withdraw')
       or jsonb_typeof(tx->'amount') is distinct from 'number'
       or jsonb_typeof(tx->'person') is distinct from 'number'
       or (tx->>'person')::numeric not in (1, 2)
       or jsonb_typeof(tx->'date') is distinct from 'string'
       or (tx->>'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or jsonb_typeof(tx->'desc') is distinct from 'string'
       or length(btrim(tx->>'desc')) not between 1 and 100 then
      raise exception 'Movimentação inválida ou identificador duplicado.' using errcode = '22023';
    end if;
    ids := array_append(ids, tx->>'id');
    amount_value := (tx->>'amount')::numeric;
    tx_date := (tx->>'date')::date;
    if amount_value <= 0 or amount_value > 9999999999.99 or amount_value <> round(amount_value, 2) then
      raise exception 'Valor da movimentação inválido.' using errcode = '22023';
    end if;
    balance_value := balance_value + case when tx->>'type' = 'deposit' then amount_value else -amount_value end;
    select * into previous from public.caixinha_transactions where user_id = new.user_id and id = tx->>'id';
    if not found then
      insert into public.caixinha_audit(user_id, action, transaction_id, after_data)
        values(new.user_id, 'INSERT', tx->>'id', tx);
    elsif row(previous.type, previous.amount, previous.person, previous.date, previous.description)
       is distinct from row(tx->>'type', amount_value, (tx->>'person')::smallint, tx_date, tx->>'desc') then
      insert into public.caixinha_audit(user_id, action, transaction_id, before_data, after_data)
        values(new.user_id, 'UPDATE', tx->>'id', jsonb_build_object('id', previous.id, 'type', previous.type, 'amount', previous.amount, 'person', previous.person, 'date', previous.date, 'desc', previous.description), tx);
    end if;
    insert into public.caixinha_transactions(user_id, id, type, amount, person, date, description)
      values(new.user_id, tx->>'id', tx->>'type', amount_value, (tx->>'person')::smallint, tx_date, tx->>'desc')
      on conflict(user_id, id) do update set type=excluded.type, amount=excluded.amount,
        person=excluded.person, date=excluded.date, description=excluded.description;
  end loop;
  if balance_value < 0 then
    raise exception 'A alteração deixaria o saldo negativo.' using errcode = '23514';
  end if;
  for previous in select * from public.caixinha_transactions where user_id = new.user_id and not(id = any(ids)) loop
    insert into public.caixinha_audit(user_id, action, transaction_id, before_data)
      values(new.user_id, 'DELETE', previous.id, jsonb_build_object('id', previous.id, 'type', previous.type, 'amount', previous.amount, 'person', previous.person, 'date', previous.date, 'desc', previous.description));
    delete from public.caixinha_transactions where user_id = new.user_id and id = previous.id;
  end loop;
  next_settings := p - 'tx';
  if tg_op = 'UPDATE' then old_settings := old.payload - 'tx'; end if;
  if old_settings is distinct from next_settings then
    insert into public.caixinha_audit(user_id, action, before_data, after_data)
      values(new.user_id, 'SETTINGS', old_settings, next_settings);
  end if;
  return new;
end $$;
revoke all on function public.sync_caixinha_ledger() from public, anon, authenticated;
drop trigger if exists sync_caixinha_ledger on public.couple_data;
create trigger sync_caixinha_ledger after insert or update of payload on public.couple_data
  for each row execute function public.sync_caixinha_ledger();

-- Importa o histórico atual sem remover a tabela original.
-- Dados antigos inválidos interrompem e revertem toda a migração.
update public.couple_data set payload = payload;

create or replace function public.save_caixinha(p_payload jsonb, p_expected_revision timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  existing public.couple_data%rowtype;
  result public.couple_data%rowtype;
begin
  if owner_id is null then raise exception 'Autenticação necessária.' using errcode = '42501'; end if;
  -- Serializa inclusive a primeira gravação da mesma conta.
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  select * into existing from public.couple_data where user_id = owner_id for update;
  if found then
    if p_expected_revision is distinct from existing.updated_at then
      raise exception 'Dados alterados em outro aparelho.' using errcode = '40001';
    end if;
    update public.couple_data set payload = p_payload, updated_at = clock_timestamp()
      where user_id = owner_id returning * into result;
  else
    if p_expected_revision is not null then
      raise exception 'Dados alterados em outro aparelho.' using errcode = '40001';
    end if;
    insert into public.couple_data(user_id, payload, updated_at)
      values(owner_id, p_payload, clock_timestamp()) returning * into result;
  end if;
  return jsonb_build_object('payload', result.payload, 'updated_at', result.updated_at);
end $$;
revoke all on function public.save_caixinha(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.save_caixinha(jsonb, timestamptz) to authenticated;

-- Toda gravação passa pela função: cliente não pode forjar owner_id,
-- contornar a revisão nem editar o histórico diretamente.
revoke insert, update, delete on public.couple_data from anon, authenticated;
grant select on public.couple_data to authenticated;
notify pgrst, 'reload schema';
commit;
