import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import type { Player, Snapshot } from '../../../../shared/src/types';
let singleton: SupabaseClient | null | undefined;
export function database(): SupabaseClient | null {
  if (singleton !== undefined) return singleton;
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (Boolean(url) !== Boolean(key))
    throw new Error('SUPABASE_CONFIG_INCOMPLETE');
  singleton =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (input, init) =>
              fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
          },
        })
      : null;
  return singleton;
}
export async function authorize(
  token: unknown,
): Promise<{ profileId: string }> {
  const db = database();
  if (!db) return { profileId: randomUUID() };
  if (typeof token !== 'string' || token.length > 8192)
    throw new Error('AUTH_REQUIRED');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error('AUTH_REQUIRED');
  return { profileId: data.user.id };
}
function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}
export class RoomPersistence {
  readonly id = randomUUID();
  private pending = Promise.resolve();
  private matchId: string | null = null;
  private joining = new Set<string>();
  private writeFailed = false;
  readonly identities = new Map<string, string>();
  private roster = new Map<string, Player>();
  constructor(private state: Snapshot) {
    state.persistence = database() ? 'online' : 'local';
  }
  async reserve(code: string): Promise<boolean> {
    const db = database();
    if (!db) return true;
    const { error } = await db.from('rooms').insert({ id: this.id, code });
    if (error?.code === '23505') return false;
    check(error);
    return true;
  }
  async player(
    sessionId: string,
    profileId: string,
    nickname: string,
  ): Promise<void> {
    if (
      this.joining.has(profileId) ||
      this.state.players.some((p) => this.identities.get(p.id) === profileId)
    )
      throw new Error('PROFILE_ALREADY_IN_ROOM');
    this.joining.add(profileId);
    try {
      const db = database();
      if (db) {
        const { error } = await db
          .from('profiles')
          .upsert({ id: profileId, nickname });
        check(error);
      }
      this.identities.set(sessionId, profileId);
    } finally {
      this.joining.delete(profileId);
    }
  }
  private enqueue(job: () => Promise<void>): void {
    if (!database()) return;
    this.pending = this.pending.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++)
        try {
          await job();
          if (!this.writeFailed) this.state.persistence = 'online';
          return;
        } catch {
          if (attempt === 2) {
            this.writeFailed = true;
            this.state.persistence = 'error';
            console.error(
              'Supabase: metadata write failed after 3 attempts. Gameplay continues.',
            );
          } else
            await new Promise((resolve) =>
              setTimeout(resolve, 250 * (attempt + 1)),
            );
        }
    });
  }
  sync(): void {
    const s = this.state,
      host = this.identities.get(s.host) ?? null,
      status =
        s.phase === 'LOBBY'
          ? 'lobby'
          : ['GAME_OVER', 'VICTORY'].includes(s.phase)
            ? 'finished'
            : 'playing';
    const members = s.players.map((p) => ({
      player_id: this.identities.get(p.id),
      nickname: p.nickname,
      color: p.color,
      ready: p.ready,
      connected: p.connected,
    }));
    const stage = s.stage + 1;
    this.enqueue(async () => {
      const db = database()!;
      check(
        (
          await db
            .from('rooms')
            .update({ host_id: host, status, stage })
            .eq('id', this.id)
        ).error,
      );
      check(
        (
          await db.rpc('sync_room_members', {
            p_room: this.id,
            p_members: members,
          })
        ).error,
      );
    });
  }
  start(): void {
    this.matchId = randomUUID();
    this.roster = new Map(this.state.players.map((p) => [p.id, p]));
    const id = this.matchId;
    this.enqueue(async () => {
      check(
        (await database()!.from('matches').upsert({ id, room_id: this.id }))
          .error,
      );
    });
    this.sync();
  }
  finish(result: 'victory' | 'defeat' | 'abandoned'): void {
    if (!this.matchId) return;
    const match = this.matchId;
    this.matchId = null;
    const stage = this.state.stage + 1;
    const players = [...this.roster.values()].map((p) => ({
      player_id: this.identities.get(p.id),
      nickname: p.nickname,
      color: p.color,
      kills: p.stats.kills,
      deaths: p.stats.deaths,
      items_collected: p.stats.itemsCollected,
      mobs_killed: p.stats.mobsKilled,
      boss_damage: p.stats.bossDamage,
    }));
    this.enqueue(async () => {
      check(
        (
          await database()!.rpc('finish_match', {
            p_match: match,
            p_result: result,
            p_stage: stage,
            p_players: players,
          })
        ).error,
      );
    });
    this.sync();
  }
  async close(): Promise<void> {
    this.finish('abandoned');
    this.enqueue(async () => {
      check(
        (
          await database()!
            .from('rooms')
            .update({ status: 'finished' })
            .eq('id', this.id)
        ).error,
      );
    });
    await this.pending;
  }
}
