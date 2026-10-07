import Phaser from 'phaser';
import { network } from '../networking/NetworkSystem';
export class InputSystem {
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
  private seq = 0;
  private elapsed = 0;
  private padBomb = false;
  private padRemote = false;
  private bombQueued = false;
  private remoteQueued = false;
  disabled = false;
  direction = { dx: 0, dy: 0 };
  constructor(scene: Phaser.Scene) {
    this.keys = scene.input.keyboard!.addKeys(
      'W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,E',
    ) as Record<string, Phaser.Input.Keyboard.Key>;
    this.keys.SPACE.on('down', () => {
      this.bombQueued = true;
    });
    this.keys.E.on('down', () => {
      this.remoteQueued = true;
    });
    window.addEventListener('blur', this.blur);
    scene.events.once('shutdown', () =>
      window.removeEventListener('blur', this.blur),
    );
  }
  private blur = () => {
    Object.values(this.keys).forEach((k) => k.reset());
    network.input({
      dx: 0,
      dy: 0,
      bomb: false,
      remote: false,
      seq: ++this.seq,
    });
  };
  update(dt: number): void {
    this.elapsed += dt;
    if (this.elapsed < 50) return;
    this.elapsed = 0;
    const k = this.keys,
      pad = navigator.getGamepads?.()[0];
    const ax = pad?.axes[0] ?? 0,
      ay = pad?.axes[1] ?? 0;
    let dx =
      k.A.isDown || k.LEFT.isDown || ax < -0.35
        ? -1
        : k.D.isDown || k.RIGHT.isDown || ax > 0.35
          ? 1
          : 0;
    let dy =
      k.W.isDown || k.UP.isDown || ay < -0.35
        ? -1
        : k.S.isDown || k.DOWN.isDown || ay > 0.35
          ? 1
          : 0;
    if (dx && dy) {
      const latest = (names: string[]) =>
        Math.max(
          ...names.filter((n) => k[n].isDown).map((n) => k[n].timeDown),
          0,
        );
      if (
        latest(['W', 'UP', 'S', 'DOWN']) > latest(['A', 'LEFT', 'D', 'RIGHT'])
      )
        dx = 0;
      else dy = 0;
    }
    const pb = pad?.buttons[0]?.pressed ?? false,
      pr = pad?.buttons[1]?.pressed ?? false;
    const bomb = this.bombQueued || (pb && !this.padBomb),
      remote = this.remoteQueued || (pr && !this.padRemote);
    this.bombQueued = false;
    this.remoteQueued = false;
    this.padBomb = pb;
    this.padRemote = pr;
    this.direction = { dx: this.disabled ? 0 : dx, dy: this.disabled ? 0 : dy };
    if (network.state?.phase === 'PLAYING')
      network.input({
        dx: this.disabled ? 0 : dx,
        dy: this.disabled ? 0 : dy,
        bomb: !this.disabled && bomb,
        remote: !this.disabled && remote,
        seq: ++this.seq,
      });
  }
}
