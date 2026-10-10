import { expect, it } from 'vitest';
import { RemoteMotion } from '../apps/client/src/networking/RemoteMotion';
import { Game } from '../apps/server/src/state/Game';

function fixture() {
  const g = new Game(() => 0.2);
  g.addPlayer('remote', 'Remote');
  g.loadStage(0);
  g.state.code = 'BR-MOTION';
  return g.state;
}
const variation = (a: number[]) => {
  const mean = a.reduce((n, v) => n + v, 0) / a.length;
  return (
    Math.sqrt(a.reduce((n, v) => n + (v - mean) ** 2, 0) / a.length) / mean
  );
};

it.each([10, 15, 30, 60, 120, 144, 165, 200])(
  'smooths jittered 7.5 Hz motion at %i FPS without FPS-dependent velocity',
  (fps) => {
    const motion = new RemoteMotion(),
      s = fixture(),
      p = s.players[0];
    // Four peers, 80 ms transit and 0–25 ms deterministic arrival jitter.
    s.players.push(...[1, 2, 3].map((n) => ({ ...p, id: `p${n}` })));
    const velocities: number[] = [],
      oldVelocities: number[] = [];
    let packet = 0,
      last = 0,
      old = 0,
      oldLast = 0;
    for (let frame = 0; frame < fps * 22; frame++) {
      const now = (frame * 1000) / fps;
      while (
        (packet * 1000) / 7.5 + 80 + [0, 25, 5, 20, 10][packet % 5] <=
        now
      ) {
        s.time = packet / 7.5;
        p.x = s.time * 2;
        p.action = 'walk';
        p.direction = 'right';
        motion.push(s, now);
        packet++;
      }
      motion.beginFrame(now);
      const view = motion.sample(p.id);
      if (!view) continue;
      old += (p.x - old) * (1 - Math.exp(-1000 / fps / 48));
      if (frame > fps * 2) {
        velocities.push((view.x - last) * fps);
        oldVelocities.push((old - oldLast) * fps);
        expect(view.x).toBeLessThanOrEqual(p.x + 1e-6);
      }
      last = view.x;
      oldLast = old;
    }
    expect(variation(velocities)).toBeLessThan(variation(oldVelocities) * 0.45);
    expect(
      velocities.reduce((n, v) => n + v, 0) / velocities.length,
    ).toBeCloseTo(2, 1);
    expect(motion.delayMs).toBeLessThanOrEqual(180);
  },
);

it('snaps respawn, teleport, reconnect and stage changes; drops previous-stage history', () => {
  const m = new RemoteMotion(),
    s = fixture(),
    p = s.players[0];
  m.push(s, 0);
  s.time += 0.1;
  p.x += 0.3;
  m.push(s, 100);
  p.lives--;
  p.x = 1;
  s.time += 0.1;
  m.push(s, 200);
  expect(m.sample(p.id)?.x).toBe(1);
  p.x = 12;
  s.time += 0.1;
  m.push(s, 300);
  expect(m.sample(p.id)?.x).toBe(12);
  p.connected = false;
  p.x = 11;
  s.time += 0.1;
  m.push(s, 400);
  expect(m.sample(p.id)?.x).toBe(11);
  s.stageRevision++;
  p.x = 2;
  m.push(s, 500);
  expect(m.sample(p.id)?.x).toBe(2);
  m.reset();
  expect(m.sample(p.id)).toBeUndefined();
});

it('stops at the last known position during a network gap and retains walk frames between packets', () => {
  const m = new RemoteMotion(),
    s = fixture(),
    p = s.players[0];
  m.push(s, 0);
  s.time += 0.1;
  p.x += 0.3;
  p.action = 'walk';
  m.push(s, 100);
  for (let now = 100; now < 1200; now += 16) m.beginFrame(now);
  expect(m.sample(p.id)?.x).toBe(p.x);
  expect(m.sample(p.id)?.action).toBe('walk');
  p.x += 0.3;
  s.time += 0.1;
  m.push(s, 1300);
  expect(m.sample(p.id)?.x).toBe(p.x);
});
