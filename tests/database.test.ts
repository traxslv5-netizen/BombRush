import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { it, expect } from 'vitest';
it('executes the schema, enforces color uniqueness and RLS, and commits statistics idempotently', async () => {
  const db = new PGlite();
  try {
    // Supabase supplies these roles and auth functions. Stub only that boundary.
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
   create schema auth; create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth,public to anon,authenticated,service_role;
   grant execute on function auth.uid() to authenticated,service_role;`);
    const schema = (await readFile('supabase/schema.sql', 'utf8')).replace(
      'create extension if not exists pgcrypto;',
      '',
    );
    // gen_random_uuid is built into PostgreSQL; the optional pgcrypto extension is not bundled in PGlite.
    await db.exec(schema);
    await db.exec(schema);
    const a = '00000000-0000-4000-8000-000000000001',
      b = '00000000-0000-4000-8000-000000000002',
      room = '00000000-0000-4000-8000-000000000003',
      match = '00000000-0000-4000-8000-000000000004';
    await db.query('insert into auth.users values($1),($2)', [a, b]);
    await db.exec('set role service_role');
    await db.query(
      "insert into profiles(id,nickname) values($1,'Alice'),($2,'Bob')",
      [a, b],
    );
    await db.query(
      "insert into rooms(id,code,host_id) values($1,'BR-ABC123',$2)",
      [room, a],
    );
    const members = [
      {
        player_id: a,
        nickname: 'Alice',
        color: 'red',
        ready: true,
        connected: true,
      },
      {
        player_id: b,
        nickname: 'Bob',
        color: 'blue',
        ready: true,
        connected: true,
      },
    ];
    await db.query('select sync_room_members($1,$2)', [
      room,
      JSON.stringify(members),
    ]);
    await expect(
      db.query('select sync_room_members($1,$2)', [
        room,
        JSON.stringify(members.map((m) => ({ ...m, color: 'red' }))),
      ]),
    ).rejects.toThrow(/unique/);
    expect((await db.query('select * from room_players')).rows).toHaveLength(2);
    await db.query('insert into matches(id,room_id) values($1,$2)', [
      match,
      room,
    ]);
    const results = members.map((m) => ({
      ...m,
      kills: 0,
      deaths: 1,
      items_collected: 3,
      mobs_killed: 4,
      boss_damage: 50,
    }));
    for (let i = 0; i < 2; i++)
      await db.query("select finish_match($1,'victory',5,$2)", [
        match,
        JSON.stringify(results),
      ]);
    const progress = await db.query<{
      matches_played: number;
      wins: number;
      highest_stage: number;
    }>('select * from player_progress');
    expect(progress.rows).toHaveLength(2);
    expect(
      progress.rows.every(
        (p) => p.matches_played === 1 && p.wins === 1 && p.highest_stage === 5,
      ),
    ).toBe(true);
    await db.exec('reset role;set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
    expect((await db.query('select * from profiles')).rows).toHaveLength(1);
    expect((await db.query('select * from rooms')).rows).toHaveLength(1);
    expect((await db.query('select * from room_players')).rows).toHaveLength(2);
    expect((await db.query('select * from matches')).rows).toHaveLength(1);
    expect((await db.query('select * from match_players')).rows).toHaveLength(
      1,
    );
    expect((await db.query('select * from player_progress')).rows).toHaveLength(
      1,
    );
    await expect(
      db.exec('update player_progress set wins=999'),
    ).rejects.toThrow(/permission/);
    await expect(
      db.query('select sync_room_members($1,$2)', [room, '[]']),
    ).rejects.toThrow(/permission/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      '00000000-0000-4000-8000-000000000099',
    ]);
    expect((await db.query('select * from rooms')).rows).toHaveLength(0);
    await db.exec('reset role;set role anon');
    await expect(db.exec('select * from profiles')).rejects.toThrow(
      /permission/,
    );
  } finally {
    await db.close();
  }
}, 30000);
