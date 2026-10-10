import { afterEach, expect, it, vi } from 'vitest';
import { NetworkSystem } from '../apps/client/src/networking/NetworkSystem';

vi.mock('../apps/client/src/networking/SupabaseClient', () => ({ supabase: null }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['silent', 'error', 'constructor'])(
  'keeps gameplay advancing when the worker fails: %s',
  async (failure) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    class FailedWorker {
      static instances: FailedWorker[] = [];
      onerror?: () => void;
      terminate = vi.fn();
      constructor() {
        if (failure === 'constructor') throw new Error('Worker blocked');
        FailedWorker.instances.push(this);
      }
    }
    vi.stubGlobal('Worker', FailedWorker);
    const n = new NetworkSystem();
    try {
      await n.connect('Fallback', undefined, undefined, true);
      const worker = FailedWorker.instances[0];
      n.send('ready');
      n.send('start');
      if (failure === 'error') worker?.onerror?.();
      await vi.advanceTimersByTimeAsync(6500);
      expect(n.state?.phase).toBe('PLAYING');
      const remaining = n.state!.remaining;
      await vi.advanceTimersByTimeAsync(1000);
      expect(n.state!.remaining).toBeLessThan(remaining - 0.8);
      if (worker) expect(worker.terminate).toHaveBeenCalled();
    } finally {
      await n.leave();
    }
    expect(vi.getTimerCount()).toBe(0);
  },
);
