-- BombRush v0.2. Run in the Supabase SQL Editor as the project administrator.
-- Enable Authentication > Providers > Anonymous Sign-Ins separately.
begin;
create extension if not exists pgcrypto;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 nickname text not null check(char_length(nickname) between 1 and 16),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.rooms (
 id uuid primary key default gen_random_uuid(), code text not null unique check(code ~ '^BR-[A-Z0-9]{6}$'),
 host_id uuid references public.profiles(id) on delete set null,
 status text not null default 'lobby' check(status in ('lobby','playing','finished')),
 stage integer not null default 1 check(stage between 1 and 5), max_players integer not null default 4 check(max_players between 1 and 4),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.room_players (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
 player_id uuid not null references public.profiles(id) on delete cascade,
 nickname text not null check(char_length(nickname) between 1 and 16),
 color text not null check(color in ('red','blue','purple','yellow')), ready boolean not null default false,
 connected boolean not null default true, joined_at timestamptz not null default now(),
 unique(room_id,player_id), unique(room_id,color)
);
create table if not exists public.matches (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id),
 started_at timestamptz not null default now(), ended_at timestamptz,
 result text check(result in ('victory','defeat','abandoned')),
 final_stage integer not null default 1 check(final_stage between 1 and 5)
);
create table if not exists public.match_players (
 match_id uuid not null references public.matches(id) on delete cascade,
 player_id uuid not null references public.profiles(id) on delete cascade,
 nickname text not null, color text not null check(color in ('red','blue','purple','yellow')),
 kills integer not null default 0 check(kills>=0), deaths integer not null default 0 check(deaths>=0),
 items_collected integer not null default 0 check(items_collected>=0), mobs_killed integer not null default 0 check(mobs_killed>=0),
 boss_damage integer not null default 0 check(boss_damage>=0), primary key(match_id,player_id)
);
create table if not exists public.player_progress (
 player_id uuid primary key references public.profiles(id) on delete cascade,
 highest_stage integer not null default 1 check(highest_stage between 1 and 5),
 matches_played integer not null default 0 check(matches_played>=0), wins integer not null default 0 check(wins>=0),
 bosses_defeated integer not null default 0 check(bosses_defeated>=0), updated_at timestamptz not null default now()
);
create index if not exists room_players_player_idx on public.room_players(player_id);
create index if not exists matches_room_idx on public.matches(room_id,started_at desc);
create index if not exists match_players_player_idx on public.match_players(player_id);
create index if not exists rooms_status_idx on public.rooms(status,updated_at);
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now(); return new; end; $$;
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists rooms_updated_at on public.rooms;
create trigger rooms_updated_at before update on public.rooms for each row execute function public.touch_updated_at();
drop trigger if exists progress_updated_at on public.player_progress;
create trigger progress_updated_at before update on public.player_progress for each row execute function public.touch_updated_at();

-- Avoid recursive room_players policies. Only returns membership of the caller.
create or replace function public.is_room_member(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.room_players where room_id=target and player_id=(select auth.uid()));
$$;
revoke all on function public.is_room_member(uuid) from public,anon;
grant execute on function public.is_room_member(uuid) to authenticated,service_role;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.player_progress enable row level security;
revoke all on public.profiles,public.rooms,public.room_players,public.matches,public.match_players,public.player_progress from anon,authenticated;
grant select on public.profiles,public.rooms,public.room_players,public.matches,public.match_players,public.player_progress to authenticated;
grant update(nickname) on public.profiles to authenticated;
grant all on public.profiles,public.rooms,public.room_players,public.matches,public.match_players,public.player_progress to service_role;
drop policy if exists profile_read on public.profiles;
create policy profile_read on public.profiles for select to authenticated using(id=(select auth.uid()));
drop policy if exists profile_nickname on public.profiles;
create policy profile_nickname on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
drop policy if exists room_read on public.rooms;
create policy room_read on public.rooms for select to authenticated using(public.is_room_member(id));
drop policy if exists room_players_read on public.room_players;
create policy room_players_read on public.room_players for select to authenticated using(public.is_room_member(room_id));
drop policy if exists match_read on public.matches;
create policy match_read on public.matches for select to authenticated using(exists(select 1 from public.match_players p where p.match_id=id and p.player_id=(select auth.uid())));
drop policy if exists match_player_read on public.match_players;
create policy match_player_read on public.match_players for select to authenticated using(player_id=(select auth.uid()));
drop policy if exists progress_read on public.player_progress;
create policy progress_read on public.player_progress for select to authenticated using(player_id=(select auth.uid()));

-- One atomic replacement prevents intermediate UNIQUE(room_id,color) conflicts.
create or replace function public.sync_room_members(p_room uuid,p_members jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.rooms where id=p_room for update;
 if not found then raise exception 'ROOM_NOT_FOUND'; end if;
 if jsonb_array_length(p_members)>4 then raise exception 'ROOM_FULL'; end if;
 delete from public.room_players where room_id=p_room;
 insert into public.room_players(room_id,player_id,nickname,color,ready,connected)
 select p_room,x.player_id,x.nickname,x.color,x.ready,x.connected
 from jsonb_to_recordset(p_members) as x(player_id uuid,nickname text,color text,ready boolean,connected boolean);
end; $$;

-- Result + statistics + progress commit together. Retrying a finished match is a no-op.
create or replace function public.finish_match(p_match uuid,p_result text,p_stage integer,p_players jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare entry record;
begin
 if p_result not in ('victory','defeat','abandoned') or p_stage not between 1 and 5 then raise exception 'INVALID_RESULT'; end if;
 update public.matches set result=p_result,final_stage=p_stage,ended_at=now() where id=p_match and ended_at is null;
 if not found then return; end if;
 for entry in select * from jsonb_to_recordset(p_players) as x(player_id uuid,nickname text,color text,kills integer,deaths integer,items_collected integer,mobs_killed integer,boss_damage integer)
 loop
  insert into public.match_players values(p_match,entry.player_id,entry.nickname,entry.color,entry.kills,entry.deaths,entry.items_collected,entry.mobs_killed,entry.boss_damage);
  insert into public.player_progress(player_id,highest_stage,matches_played,wins,bosses_defeated)
  values(entry.player_id,p_stage,1,case when p_result='victory' then 1 else 0 end,case when p_result='victory' then 1 else 0 end)
  on conflict(player_id) do update set highest_stage=greatest(public.player_progress.highest_stage,excluded.highest_stage),matches_played=public.player_progress.matches_played+1,wins=public.player_progress.wins+excluded.wins,bosses_defeated=public.player_progress.bosses_defeated+excluded.bosses_defeated;
 end loop;
end; $$;
revoke all on function public.sync_room_members(uuid,jsonb),public.finish_match(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sync_room_members(uuid,jsonb),public.finish_match(uuid,text,integer,jsonb) to service_role;
commit;
