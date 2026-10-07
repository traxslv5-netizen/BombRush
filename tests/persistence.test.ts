import { it, expect, vi } from 'vitest';
import { Game } from '../apps/server/src/state/Game';
const fake = vi.hoisted(() => ({
  failResult: false,
  holdProfile: null as null | Promise<{ error: null }>,
  finishes: 0,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: async () => ({ error: null }),
      upsert: () => fake.holdProfile ?? Promise.resolve({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
    rpc: async (name: string) => {
      if (name === 'finish_match') {
        fake.finishes++;
        if (fake.failResult)
          return { error: { message: 'test write failure' } };
      }
      return { error: null };
    },
  }),
}));
import { RoomPersistence } from '../apps/server/src/persistence/SupabaseStore';
it('rejects concurrent joins by one profile before the database completes', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-placeholder');
  let release!: (value: { error: null }) => void;
  fake.holdProfile = new Promise((resolve) => (release = resolve));
  const store = new RoomPersistence(new Game().state);
  const first = store.player('a', 'profile', 'Alice');
  await expect(store.player('b', 'profile', 'Bob')).rejects.toThrow(
    'PROFILE_ALREADY_IN_ROOM',
  );
  release({ error: null });
  await first;
  fake.holdProfile = null;
  vi.unstubAllEnvs();
});
it('does not claim progress was saved after all result writes fail but metadata succeeds', async () => {
  const g = new Game();
  g.addPlayer('one', 'One');
  const store = new RoomPersistence(g.state);
  store.identities.set('one', 'profile');
  fake.failResult = true;
  fake.finishes = 0;
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    store.start();
    store.finish('victory');
    await store.close();
    expect(fake.finishes).toBe(3);
    expect(g.state.persistence).toBe('error');
  } finally {
    fake.failResult = false;
    error.mockRestore();
  }
});
