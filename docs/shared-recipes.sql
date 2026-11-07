-- AI 스마트 바텐더 v3.1 — 모두의 레시피(공유 레시피) 서버 정의 (Supabase / PostgreSQL 17)
-- 적용: 2026-11-07, Supabase 프로젝트 "smart-bartender"(서울) 마이그레이션 shared_recipes_v1 과 같은 내용.
-- 다시 만들 때: Supabase SQL 편집기에 그대로 붙여 실행 → 앱 src/lib/share/api.ts 의 SHARE_API_URL·SHARE_API_KEY(공개용 키)를 새 프로젝트 값으로.
--
-- 설계
--  - 앱은 표에 직접 접근하지 않고 아래 public 함수(RPC)만 부름. 표는 RLS 켜고 정책 없음 + 권한 회수 → 공개용 키로 읽기·쓰기 불가
--  - 함수는 SECURITY DEFINER + search_path='' (Supabase 점검의 "anon 이 SECURITY DEFINER 실행" 경고는 이 설계상 의도한 것)
--  - 기기 번호(p_device, 앱이 만든 무작위 UUID)는 같은 기기 1번 셈·내 것 지우기·신고 1번에만 쓰고, 응답에는 mine/used 로만 돌려줌
--  - 서버가 다시 검사: 글 길이·제어 문자·링크/이메일/휴대폰 번호·재료 1~5개·ml·도수(서버가 다시 계산, 20.5% 넘으면 거절)·
--    같은 기기 하루 10개/모두 50개·전체 한 시간 300개·같은 레시피 두 번 올리기
--  - 신고 3번이면 숨김, 신고한 기기에는 바로 안 보임. 사용 횟수는 기기당 1번(올린 사람 본인은 세지 않음), 하루 100번까지
--  - v2(맨 아래, 2026-11-08): 기기 번호는 클라이언트가 정하므로 접속 주소 해시(ip_key)로도 한도·신고 숨김 조건을 둠, 술 표시(has_alcohol),
--    AI 이름 허용 목록, 같은 레시피를 다시 올리면 기존 id. 처음부터 다시 만들 때는 이 파일을 위에서부터 그대로 실행

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.shared_recipes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 30),
  name_en text not null default '' check (char_length(name_en) <= 40),
  description text not null default '' check (char_length(description) <= 200),
  comment text not null default '' check (char_length(comment) <= 100),
  nickname text not null default '' check (char_length(nickname) <= 16),
  ingredients jsonb not null check (jsonb_typeof(ingredients) = 'array' and jsonb_array_length(ingredients) between 1 and 5),
  total_ml numeric(6,1) not null check (total_ml between 30 and 500),
  estimated_abv numeric(4,1) not null check (estimated_abv between 0 and 20.5),
  strength text not null check (strength in ('none', 'light', 'medium', 'strong')),
  flavor jsonb not null check (jsonb_typeof(flavor) = 'object'),
  garnish text not null default '' check (char_length(garnish) <= 100),
  tips text not null default '' check (char_length(tips) <= 200),
  source text not null check (source in ('direct', 'offline')),
  ai_label text not null default '' check (char_length(ai_label) <= 20),
  search_text text not null,
  recipe_key text not null,
  owner_device uuid not null,
  use_count integer not null default 0 check (use_count >= 0),
  report_count integer not null default 0 check (report_count >= 0),
  hidden boolean not null default false
);
create unique index shared_recipes_owner_key on public.shared_recipes (owner_device, recipe_key);
create index shared_recipes_rank on public.shared_recipes (use_count desc, created_at desc) where not hidden;
create index shared_recipes_owner on public.shared_recipes (owner_device, created_at desc);

create table public.shared_recipe_uses (
  recipe_id uuid not null references public.shared_recipes (id) on delete cascade,
  device uuid not null,
  at timestamptz not null default now(),
  primary key (recipe_id, device)
);
create index shared_recipe_uses_device on public.shared_recipe_uses (device, at desc);

create table public.shared_recipe_reports (
  recipe_id uuid not null references public.shared_recipes (id) on delete cascade,
  device uuid not null,
  at timestamptz not null default now(),
  primary key (recipe_id, device)
);
create index shared_recipe_reports_device on public.shared_recipe_reports (device, at desc);

alter table public.shared_recipes enable row level security;
alter table public.shared_recipe_uses enable row level security;
alter table public.shared_recipe_reports enable row level security;
revoke all on table public.shared_recipes, public.shared_recipe_uses, public.shared_recipe_reports from public, anon, authenticated;

-- 글 정리: 제어 문자 제거, 연속 공백 → 1칸, 앞뒤 공백 제거, 최대 길이
create function private.clean(t text, maxlen integer) returns text
language sql immutable set search_path = ''
as $$ select left(btrim(regexp_replace(regexp_replace(coalesce(t, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), maxlen) $$;

-- 링크·연락처(전화번호·이메일)가 든 글은 받지 않음
create function private.has_contact(t text) returns boolean
language sql immutable set search_path = ''
as $$ select t ~* '(https?:|www\.|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|01[016789][- .]?[0-9]{3,4}[- .]?[0-9]{4})' $$;

create function public.share_recipe(p_device uuid, p_recipe jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := private.clean(p_recipe->>'name', 30);
  v_name_en text := private.clean(p_recipe->>'nameEn', 40);
  v_desc text := private.clean(p_recipe->>'description', 200);
  v_comment text := private.clean(p_recipe->>'comment', 100);
  v_nick text := private.clean(p_recipe->>'nickname', 16);
  v_garnish text := private.clean(p_recipe->>'garnish', 100);
  v_tips text := private.clean(p_recipe->>'tips', 200);
  v_source text := p_recipe->>'source';
  v_ai text := private.clean(p_recipe->>'aiLabel', 20);
  v_items jsonb := '[]'::jsonb;
  v_names text[] := '{}';
  v_item jsonb;
  v_iname text;
  v_ml numeric;
  v_abv numeric;
  v_cat text;
  v_total numeric := 0;
  v_alc numeric := 0;
  v_est numeric;
  v_strength text;
  v_flavor jsonb;
  v_key text;
  v_id uuid;
  v_created timestamptz;
begin
  if p_device is null or p_recipe is null or jsonb_typeof(p_recipe) <> 'object' then
    raise exception 'INVALID' using hint = 'recipe';
  end if;
  if v_name = '' then raise exception 'INVALID' using hint = 'name'; end if;
  if v_source is null or v_source not in ('direct', 'offline') then v_source := 'direct'; end if;
  if private.has_contact(concat_ws(' ', v_name, v_name_en, v_desc, v_comment, v_nick, v_garnish, v_tips)) then
    raise exception 'CONTACT';
  end if;
  if jsonb_typeof(p_recipe->'ingredients') <> 'array' or jsonb_array_length(p_recipe->'ingredients') not between 1 and 5 then
    raise exception 'INVALID' using hint = 'ingredients';
  end if;
  for v_item in select value from jsonb_array_elements(p_recipe->'ingredients') loop
    v_iname := private.clean(v_item->>'name', 30);
    if v_iname = '' or lower(v_iname) = any (v_names) then raise exception 'INVALID' using hint = 'ingredient name'; end if;
    if private.has_contact(v_iname) then raise exception 'CONTACT'; end if;
    begin
      v_ml := round((v_item->>'ml')::numeric, 1);
      v_abv := round(coalesce((v_item->>'abv')::numeric, 0), 1);
    exception when others then
      raise exception 'INVALID' using hint = 'ingredient number';
    end;
    if v_ml is null or v_ml < 1 or v_ml > 300 or v_abv < 0 or v_abv > 96 then raise exception 'INVALID' using hint = 'ingredient range'; end if;
    v_cat := coalesce(v_item->>'category', 'other');
    if v_cat not in ('spirit', 'liqueur', 'wine', 'syrup', 'juice', 'soda', 'dairy', 'water', 'other') then v_cat := 'other'; end if;
    v_names := v_names || lower(v_iname);
    v_items := v_items || jsonb_build_array(jsonb_build_object('name', v_iname, 'ml', v_ml, 'abv', v_abv, 'category', v_cat));
    v_total := v_total + v_ml;
    v_alc := v_alc + v_ml * v_abv;
  end loop;
  if v_total < 30 or v_total > 500 then raise exception 'INVALID' using hint = 'total'; end if;
  v_est := round(v_alc / v_total, 1);
  if v_est > 20.5 then raise exception 'TOO_STRONG'; end if;
  v_strength := case when v_est <= 0 then 'none' when v_est <= 5 then 'light' when v_est <= 12 then 'medium' else 'strong' end;
  v_flavor := jsonb_build_object(
    'sweet', least(5, greatest(0, coalesce(round((p_recipe->'flavor'->>'sweet')::numeric), 0))),
    'sour', least(5, greatest(0, coalesce(round((p_recipe->'flavor'->>'sour')::numeric), 0))),
    'bitter', least(5, greatest(0, coalesce(round((p_recipe->'flavor'->>'bitter')::numeric), 0))),
    'fizzy', least(5, greatest(0, coalesce(round((p_recipe->'flavor'->>'fizzy')::numeric), 0))),
    'strength', least(5, greatest(0, coalesce(round((p_recipe->'flavor'->>'strength')::numeric), 0)))
  );
  select lower(v_name) || '|' || string_agg(n, ',' order by n) into v_key from unnest(v_names) as n;

  -- 한도: 같은 기기 하루 10개·모두 50개, 전체 한 시간 300개
  perform pg_advisory_xact_lock(hashtext('share:' || p_device::text));
  if (select count(*) from public.shared_recipes where owner_device = p_device and created_at > now() - interval '1 day') >= 10 then
    raise exception 'RATE_LIMIT';
  end if;
  if (select count(*) from public.shared_recipes where owner_device = p_device) >= 50 then
    raise exception 'TOO_MANY';
  end if;
  if (select count(*) from public.shared_recipes where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'BUSY';
  end if;
  if exists (select 1 from public.shared_recipes where owner_device = p_device and recipe_key = v_key) then
    raise exception 'DUPLICATE';
  end if;

  insert into public.shared_recipes (name, name_en, description, comment, nickname, ingredients, total_ml, estimated_abv, strength,
    flavor, garnish, tips, source, ai_label, search_text, recipe_key, owner_device)
  values (v_name, v_name_en, v_desc, v_comment, v_nick, v_items, v_total, v_est, v_strength,
    v_flavor, v_garnish, v_tips, v_source, v_ai,
    lower(concat_ws(' ', v_name, v_name_en, v_desc, v_comment, v_nick, array_to_string(v_names, ' '))), v_key, p_device)
  returning id, created_at into v_id, v_created;
  return jsonb_build_object('id', v_id, 'createdAt', v_created, 'estimatedAbv', v_est, 'strength', v_strength);
end;
$$;

create function public.browse_shared_recipes(
  p_device uuid default null,
  p_query text default '',
  p_limit integer default 20,
  p_offset integer default 0,
  p_alcohol boolean default true,
  p_mine boolean default false
)
returns table (
  id uuid, created_at timestamptz, name text, name_en text, description text, comment text, nickname text,
  ingredients jsonb, total_ml numeric, estimated_abv numeric, strength text, flavor jsonb, garnish text, tips text,
  source text, ai_label text, use_count integer, hidden boolean, mine boolean, used boolean, total_count bigint
)
language sql stable security definer set search_path = ''
as $$
  with q as (
    select array_remove(regexp_split_to_array(lower(private.clean(p_query, 40)), ' '), '') as words
  )
  select r.id, r.created_at, r.name, r.name_en, r.description, r.comment, r.nickname,
    r.ingredients, r.total_ml, r.estimated_abv, r.strength, r.flavor, r.garnish, r.tips,
    r.source, r.ai_label, r.use_count, r.hidden,
    coalesce(r.owner_device = p_device, false) as mine,
    exists (select 1 from public.shared_recipe_uses u where u.recipe_id = r.id and u.device = p_device) as used,
    count(*) over () as total_count
  from public.shared_recipes r, q
  where (case when coalesce(p_mine, false) then r.owner_device = p_device else not r.hidden end)
    and (coalesce(p_alcohol, true) or r.estimated_abv = 0)
    and not exists (select 1 from unnest(q.words) w where strpos(r.search_text, w) = 0)
    and not exists (select 1 from public.shared_recipe_reports x where x.recipe_id = r.id and x.device = p_device)
  order by r.use_count desc, r.created_at desc, r.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset least(greatest(coalesce(p_offset, 0), 0), 2000)
$$;

-- 실제로 만들었을 때 1번 (같은 기기는 레시피마다 1번, 올린 사람 본인은 세지 않음). 지금 사용 횟수를 돌려줌
create function public.use_shared_recipe(p_device uuid, p_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_count integer;
  v_rows integer := 0;
begin
  if p_device is null or p_id is null then raise exception 'INVALID'; end if;
  select owner_device, use_count into v_owner, v_count from public.shared_recipes where id = p_id and not hidden;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_owner = p_device then return v_count; end if;
  if (select count(*) from public.shared_recipe_uses where device = p_device and at > now() - interval '1 day') >= 100 then
    raise exception 'RATE_LIMIT';
  end if;
  insert into public.shared_recipe_uses (recipe_id, device) values (p_id, p_device) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    update public.shared_recipes set use_count = use_count + 1 where id = p_id returning use_count into v_count;
  end if;
  return v_count;
end;
$$;

-- 신고: 같은 기기는 1번, 3번 쌓이면 목록에서 숨김. 신고한 기기에는 바로 안 보임
create function public.report_shared_recipe(p_device uuid, p_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_rows integer := 0;
begin
  if p_device is null or p_id is null then raise exception 'INVALID'; end if;
  select owner_device into v_owner from public.shared_recipes where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_owner = p_device then raise exception 'OWN_RECIPE'; end if;
  if (select count(*) from public.shared_recipe_reports where device = p_device and at > now() - interval '1 day') >= 30 then
    raise exception 'RATE_LIMIT';
  end if;
  insert into public.shared_recipe_reports (recipe_id, device) values (p_id, p_device) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    update public.shared_recipes set report_count = report_count + 1, hidden = hidden or report_count + 1 >= 3 where id = p_id;
  end if;
  return true;
end;
$$;

-- 내가 올린 레시피 공유 취소
create function public.delete_shared_recipe(p_device uuid, p_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if p_device is null or p_id is null then raise exception 'INVALID'; end if;
  delete from public.shared_recipes where id = p_id and owner_device = p_device;
  return found;
end;
$$;

revoke execute on function public.share_recipe(uuid, jsonb) from public;
revoke execute on function public.browse_shared_recipes(uuid, text, integer, integer, boolean, boolean) from public;
revoke execute on function public.use_shared_recipe(uuid, uuid) from public;
revoke execute on function public.report_shared_recipe(uuid, uuid) from public;
revoke execute on function public.delete_shared_recipe(uuid, uuid) from public;
grant execute on function public.share_recipe(uuid, jsonb) to anon, authenticated;
grant execute on function public.browse_shared_recipes(uuid, text, integer, integer, boolean, boolean) to anon, authenticated;
grant execute on function public.use_shared_recipe(uuid, uuid) to anon, authenticated;
grant execute on function public.report_shared_recipe(uuid, uuid) to anon, authenticated;
grant execute on function public.delete_shared_recipe(uuid, uuid) to anon, authenticated;
revoke execute on function private.clean(text, integer) from public, anon, authenticated;
revoke execute on function private.has_contact(text) from public, anon, authenticated;

-- ===== v2 (2026-11-08 적용, 마이그레이션 shared_recipes_v2_abuse_limits) — 위 v1 의 함수들을 아래로 바꿈 =====
-- v2 (2026-11-08, 독립 검토 반영)
--  - 남용 막기: 기기 번호(클라이언트가 정함)만으로는 신고·사용 횟수·올리기 한도를 피할 수 있어, 접속 주소(Cloudflare 의 CF-Connecting-IP — 위조하면
--    Cloudflare 가 요청을 거절함)를 비밀 소금과 섞은 해시(ip_key)로도 한도를 둠. 주소 자체는 저장하지 않음
--  - 신고로 숨기기: 신고 3번 + 서로 다른 접속 주소 2곳 이상
--  - 술 표시(has_alcohol): 완성 도수 > 0 이거나 술 종류(spirit·liqueur·wine)·술 이름 재료가 있으면 — 성인 확인 전 목록에서 뺌
--  - AI 이름은 허용 목록만, 같은 레시피를 다시 올리면 오류 대신 기존 id (응답을 못 받고 다시 눌러도 맞춰지게)
create table if not exists private.settings (k text primary key, v text not null);
revoke all on table private.settings from public, anon, authenticated;
insert into private.settings (k, v)
  values ('ip_salt', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (k) do nothing;

create or replace function private.client_key() returns text
language sql stable set search_path = ''
as $$
  select md5(
    coalesce((select v from private.settings where k = 'ip_salt'), '') || '|' ||
    coalesce(nullif(btrim((nullif(current_setting('request.headers', true), '')::json) ->> 'cf-connecting-ip'), ''), 'unknown')
  )
$$;
revoke execute on function private.client_key() from public, anon, authenticated;

create or replace function private.is_alcohol_name(t text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(t, '') ~* '(보드카|vodka|위스키|whisk|데킬라|테킬라|tequila|브랜디|brandy|코냑|리큐르|리큐어|liqueur|와인|wine|샴페인|champagne|맥주|beer|소주|사케|막걸리|동동주|고량주|트리플 ?섹|triple ?sec|쿠앵트로|cointreau|아마레또|amaretto|미도리|midori|압생트|absinthe|깔루아|kahlua|말리부|malibu|베일리스|baileys|캄파리|campari|아페롤|aperol|버무스|vermouth|예거|럼|rum|^진$|드라이 ?진|\mgin\M)'
     and coalesce(t, '') !~* '(무알콜|무알코올|논알콜|논알코올|비알콜|non.?alcoholic|alcohol.?free|제로|0\.0)'
$$;
revoke execute on function private.is_alcohol_name(text) from public, anon, authenticated;

alter table public.shared_recipes add column if not exists ip_key text;
alter table public.shared_recipes add column if not exists has_alcohol boolean not null default false;
alter table public.shared_recipe_uses add column if not exists ip_key text;
alter table public.shared_recipe_reports add column if not exists ip_key text;
update public.shared_recipes set has_alcohol = estimated_abv > 0 where not has_alcohol;
create index if not exists shared_recipes_ip on public.shared_recipes (ip_key, created_at desc);
create index if not exists shared_recipe_uses_ip on public.shared_recipe_uses (ip_key, at desc);
create index if not exists shared_recipe_uses_recipe_ip on public.shared_recipe_uses (recipe_id, ip_key);
create index if not exists shared_recipe_reports_ip on public.shared_recipe_reports (ip_key, at desc);

create or replace function public.share_recipe(p_device uuid, p_recipe jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := private.clean(p_recipe->>'name', 30);
  v_name_en text := private.clean(p_recipe->>'nameEn', 40);
  v_desc text := private.clean(p_recipe->>'description', 200);
  v_comment text := private.clean(p_recipe->>'comment', 100);
  v_nick text := private.clean(p_recipe->>'nickname', 16);
  v_garnish text := private.clean(p_recipe->>'garnish', 100);
  v_tips text := private.clean(p_recipe->>'tips', 200);
  v_source text := p_recipe->>'source';
  v_ai text := private.clean(p_recipe->>'aiLabel', 20);
  v_ip text := private.client_key();
  v_items jsonb := '[]'::jsonb;
  v_names text[] := '{}';
  v_item jsonb;
  v_iname text;
  v_ml numeric;
  v_abv numeric;
  v_cat text;
  v_total numeric := 0;
  v_alc numeric := 0;
  v_has_alc boolean := false;
  v_est numeric;
  v_strength text;
  v_flavor jsonb;
  v_key text;
  v_id uuid;
  v_created timestamptz;
begin
  if p_device is null or p_recipe is null or jsonb_typeof(p_recipe) <> 'object' then
    raise exception 'INVALID' using hint = 'recipe';
  end if;
  if v_name = '' then raise exception 'INVALID' using hint = 'name'; end if;
  if v_source is null or v_source not in ('direct', 'offline') then v_source := 'direct'; end if;
  if v_source <> 'direct' or v_ai not in ('Gemini', 'ChatGPT', 'Claude', 'Grok', 'DeepSeek', 'Mistral', 'Groq', 'OpenRouter', 'AI') then
    v_ai := case when v_source = 'direct' then 'AI' else '' end;
  end if;
  if private.has_contact(concat_ws(' ', v_name, v_name_en, v_desc, v_comment, v_nick, v_garnish, v_tips)) then
    raise exception 'CONTACT';
  end if;
  if jsonb_typeof(p_recipe->'ingredients') <> 'array' or jsonb_array_length(p_recipe->'ingredients') not between 1 and 5 then
    raise exception 'INVALID' using hint = 'ingredients';
  end if;
  for v_item in select value from jsonb_array_elements(p_recipe->'ingredients') loop
    v_iname := private.clean(v_item->>'name', 30);
    if v_iname = '' or lower(v_iname) = any (v_names) then raise exception 'INVALID' using hint = 'ingredient name'; end if;
    if private.has_contact(v_iname) then raise exception 'CONTACT'; end if;
    begin
      v_ml := round((v_item->>'ml')::numeric, 1);
      v_abv := round(coalesce((v_item->>'abv')::numeric, 0), 1);
    exception when others then
      raise exception 'INVALID' using hint = 'ingredient number';
    end;
    if v_ml is null or v_ml < 1 or v_ml > 300 or v_abv < 0 or v_abv > 96 then raise exception 'INVALID' using hint = 'ingredient range'; end if;
    v_cat := coalesce(v_item->>'category', 'other');
    if v_cat not in ('spirit', 'liqueur', 'wine', 'syrup', 'juice', 'soda', 'dairy', 'water', 'other') then v_cat := 'other'; end if;
    if v_abv > 0 or v_cat in ('spirit', 'liqueur', 'wine') or private.is_alcohol_name(v_iname) then v_has_alc := true; end if;
    v_names := v_names || lower(v_iname);
    v_items := v_items || jsonb_build_array(jsonb_build_object('name', v_iname, 'ml', v_ml, 'abv', v_abv, 'category', v_cat));
    v_total := v_total + v_ml;
    v_alc := v_alc + v_ml * v_abv;
  end loop;
  if v_total < 30 or v_total > 500 then raise exception 'INVALID' using hint = 'total'; end if;
  v_est := round(v_alc / v_total, 1);
  if v_est > 20.5 then raise exception 'TOO_STRONG'; end if;
  v_strength := case when v_est <= 0 then 'none' when v_est <= 5 then 'light' when v_est <= 12 then 'medium' else 'strong' end;
  v_flavor := jsonb_build_object(
    'sweet', least(5, greatest(0, coalesce(round((p_recipe->'flavor'->>'sweet')::numeric), 0))),
    'sour', least(5, greatest(0, coalesce(round((p_recipe->'flavor'->>'sour')::numeric), 0))),
    'bitter', least(5, greatest(0, coalesce(round((p_recipe->'flavor'->>'bitter')::numeric), 0))),
    'fizzy', least(5, greatest(0, coalesce(round((p_recipe->'flavor'->>'fizzy')::numeric), 0))),
    'strength', least(5, greatest(0, coalesce(round((p_recipe->'flavor'->>'strength')::numeric), 0)))
  );
  select lower(v_name) || '|' || string_agg(n, ',' order by n) into v_key from unnest(v_names) as n;

  perform pg_advisory_xact_lock(hashtext('share:' || p_device::text));
  -- 같은 기기가 같은 레시피를 다시 올리면 기존 것을 돌려줌 (응답을 못 받고 다시 눌러도 맞춰지게)
  select id, created_at into v_id, v_created from public.shared_recipes where owner_device = p_device and recipe_key = v_key;
  if found then
    return jsonb_build_object('id', v_id, 'createdAt', v_created, 'estimatedAbv', v_est, 'strength', v_strength, 'existing', true);
  end if;
  -- 한도: 같은 기기 하루 10개·모두 50개, 같은 접속 주소 하루 20개, 전체 한 시간 600개
  if (select count(*) from public.shared_recipes where owner_device = p_device and created_at > now() - interval '1 day') >= 10 then
    raise exception 'RATE_LIMIT';
  end if;
  if (select count(*) from public.shared_recipes where owner_device = p_device) >= 50 then
    raise exception 'TOO_MANY';
  end if;
  if (select count(*) from public.shared_recipes where ip_key = v_ip and created_at > now() - interval '1 day') >= 20 then
    raise exception 'RATE_LIMIT';
  end if;
  if (select count(*) from public.shared_recipes where created_at > now() - interval '1 hour') >= 600 then
    raise exception 'BUSY';
  end if;

  insert into public.shared_recipes (name, name_en, description, comment, nickname, ingredients, total_ml, estimated_abv, strength,
    flavor, garnish, tips, source, ai_label, search_text, recipe_key, owner_device, ip_key, has_alcohol)
  values (v_name, v_name_en, v_desc, v_comment, v_nick, v_items, v_total, v_est, v_strength,
    v_flavor, v_garnish, v_tips, v_source, v_ai,
    lower(concat_ws(' ', v_name, v_name_en, v_desc, v_comment, v_nick, array_to_string(v_names, ' '))), v_key, p_device, v_ip, v_has_alc)
  returning id, created_at into v_id, v_created;
  return jsonb_build_object('id', v_id, 'createdAt', v_created, 'estimatedAbv', v_est, 'strength', v_strength);
end;
$$;

create or replace function public.browse_shared_recipes(
  p_device uuid default null,
  p_query text default '',
  p_limit integer default 20,
  p_offset integer default 0,
  p_alcohol boolean default true,
  p_mine boolean default false
)
returns table (
  id uuid, created_at timestamptz, name text, name_en text, description text, comment text, nickname text,
  ingredients jsonb, total_ml numeric, estimated_abv numeric, strength text, flavor jsonb, garnish text, tips text,
  source text, ai_label text, use_count integer, hidden boolean, mine boolean, used boolean, total_count bigint
)
language sql stable security definer set search_path = ''
as $$
  with q as (
    select array_remove(regexp_split_to_array(lower(private.clean(p_query, 40)), ' '), '') as words
  )
  select r.id, r.created_at, r.name, r.name_en, r.description, r.comment, r.nickname,
    r.ingredients, r.total_ml, r.estimated_abv, r.strength, r.flavor, r.garnish, r.tips,
    r.source, r.ai_label, r.use_count, r.hidden,
    coalesce(r.owner_device = p_device, false) as mine,
    exists (select 1 from public.shared_recipe_uses u where u.recipe_id = r.id and u.device = p_device) as used,
    count(*) over () as total_count
  from public.shared_recipes r, q
  where (case when coalesce(p_mine, false) then r.owner_device = p_device else not r.hidden end)
    and (coalesce(p_alcohol, true) or not r.has_alcohol)
    and not exists (select 1 from unnest(q.words) w where strpos(r.search_text, w) = 0)
    and not exists (select 1 from public.shared_recipe_reports x where x.recipe_id = r.id and x.device = p_device)
  order by r.use_count desc, r.created_at desc, r.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset least(greatest(coalesce(p_offset, 0), 0), 2000)
$$;

create or replace function public.use_shared_recipe(p_device uuid, p_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_count integer;
  v_rows integer := 0;
  v_ip text := private.client_key();
begin
  if p_device is null or p_id is null then raise exception 'INVALID'; end if;
  select owner_device, use_count into v_owner, v_count from public.shared_recipes where id = p_id and not hidden;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_owner = p_device then return v_count; end if;
  if (select count(*) from public.shared_recipe_uses where device = p_device and at > now() - interval '1 day') >= 100 then
    raise exception 'RATE_LIMIT';
  end if;
  if (select count(*) from public.shared_recipe_uses where ip_key = v_ip and at > now() - interval '1 day') >= 300 then
    raise exception 'RATE_LIMIT';
  end if;
  -- 같은 접속 주소(같은 와이파이 등)에서는 레시피마다 20대까지만 셈
  if (select count(*) from public.shared_recipe_uses where recipe_id = p_id and ip_key = v_ip) >= 20 then
    return v_count;
  end if;
  insert into public.shared_recipe_uses (recipe_id, device, ip_key) values (p_id, p_device, v_ip) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    update public.shared_recipes set use_count = use_count + 1 where id = p_id returning use_count into v_count;
  end if;
  return v_count;
end;
$$;

create or replace function public.report_shared_recipe(p_device uuid, p_id uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_rows integer := 0;
  v_ip text := private.client_key();
begin
  if p_device is null or p_id is null then raise exception 'INVALID'; end if;
  select owner_device into v_owner from public.shared_recipes where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_owner = p_device then raise exception 'OWN_RECIPE'; end if;
  if (select count(*) from public.shared_recipe_reports where device = p_device and at > now() - interval '1 day') >= 30 then
    raise exception 'RATE_LIMIT';
  end if;
  if (select count(*) from public.shared_recipe_reports where ip_key = v_ip and at > now() - interval '1 day') >= 20 then
    raise exception 'RATE_LIMIT';
  end if;
  insert into public.shared_recipe_reports (recipe_id, device, ip_key) values (p_id, p_device, v_ip) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    -- 신고 3번 이상 + 서로 다른 접속 주소 2곳 이상이면 숨김 (한 사람이 기기 번호만 바꿔 숨기지 못하게)
    update public.shared_recipes r set report_count = r.report_count + 1,
      hidden = r.hidden or (r.report_count + 1 >= 3
        and (select count(distinct x.ip_key) from public.shared_recipe_reports x where x.recipe_id = p_id) >= 2)
    where r.id = p_id;
  end if;
  return true;
end;
$$;

revoke execute on function public.share_recipe(uuid, jsonb) from public;
revoke execute on function public.browse_shared_recipes(uuid, text, integer, integer, boolean, boolean) from public;
revoke execute on function public.use_shared_recipe(uuid, uuid) from public;
revoke execute on function public.report_shared_recipe(uuid, uuid) from public;
grant execute on function public.share_recipe(uuid, jsonb) to anon, authenticated;
grant execute on function public.browse_shared_recipes(uuid, text, integer, integer, boolean, boolean) to anon, authenticated;
grant execute on function public.use_shared_recipe(uuid, uuid) to anon, authenticated;
grant execute on function public.report_shared_recipe(uuid, uuid) to anon, authenticated;

-- ===== v3 (2026-11-08 적용, 마이그레이션 shared_recipes_v3_alcohol_name, 2차 검토 반영) — 술 이름 판정을 앱 ALCOHOL_NAME_RE 와 같게 =====
-- (진저에일·크럼블 시럽·럼주스·드럼 등은 술 아님, 매실주·슈냅스·탱커레이 진·오렌지 큐라소 등은 술). PostgreSQL ARE: \b 대신 \y
create or replace function private.is_alcohol_name(t text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(t, '') ~* '보드카|vodka|위스키|whisk|데킬라|테킬라|tequila|브랜디|brandy|코냑|리큐르|리큐어|liqueur|와인|wine|샴페인|champagne|맥주|beer|소주|사케|막걸리|동동주|고량주|매실주(?!스)|복분자주(?!스)|트리플\s*섹|triple\s*sec|쿠앵트로|cointreau|오렌지\s*큐라소|orange\s*cura[cç]ao|그랑\s*마르니에|grand\s*marnier|아마레또|amaretto|미도리|midori|압생트|absinthe|깔루아|kahlua|피치\s*트리|peach\s*tree|말리부|malibu|슈냅스|schnapps|코코넛\s*럼|베일리스|baileys|캄파리|campari|아페롤|aperol|버무스|vermouth|예거|jäger|(?:^|[^가-힣])(?:(?:화이트|다크|골드|라이트|스파이스드|블랙)\s*)?럼(?:주(?!스))?(?=$|[^가-힣]|[을를이가은는과와도만으로의에랑])|\yrum\y|(?:^|[^가-힣])(?:(?:런던\s*)?드라이\s*)?진(?=$|[^가-힣]|[을이은과만으의에랑])|\ygin\y'
     and coalesce(t, '') !~* '(무알콜|무알코올|논알콜|논알코올|비알콜|non.?alcoholic|alcohol.?free|제로|0\.0)'
$$;
revoke execute on function private.is_alcohol_name(text) from public, anon, authenticated;

update public.shared_recipes r set has_alcohol = r.estimated_abv > 0 or exists (
  select 1 from jsonb_array_elements(r.ingredients) i
  where coalesce((i->>'abv')::numeric, 0) > 0 or i->>'category' in ('spirit', 'liqueur', 'wine') or private.is_alcohol_name(i->>'name')
);
