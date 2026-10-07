import Phaser from 'phaser';
import manifest from '../../../../assets/manifest.json';
import { Tile } from '../../../../shared/src/config/game.config';
import type { Actor, Snapshot } from '../../../../shared/src/types';
import { network } from '../networking/NetworkSystem';
import { registerAnimations } from '../animations/AnimationSystem';
import { InputSystem } from '../systems/InputSystem';
import { audio } from '../systems/AudioSystem';
import { ArenaPresentation, px, py, T } from '../systems/ArenaPresentation';
import { moveActor } from '../../../../shared/src/gameplay/movement';

export class GameScene extends Phaser.Scene {
  private objects = new Map<string, Phaser.GameObjects.Sprite>();
  private tiles: Phaser.GameObjects.Image[][] = [];
  private floors: Phaser.GameObjects.Image[] = [];
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private effects: Phaser.GameObjects.Sprite[] = [];
  private eventId = 0;
  private stage = -1;
  private lastGrid = '';
  private lastTick = -1;
  private warnings!: Phaser.GameObjects.Graphics;
  private exit!: Phaser.GameObjects.Container;
  private inputSystem!: InputSystem;
  private roomCode = '';
  private presentation!: ArenaPresentation;
  private snapshotAt = 0;
  private snapshotTime = -1;
  private bombTicks = new Map<string, number>();
  private projectilePool: Phaser.GameObjects.Sprite[] = [];
  constructor() {
    super('Game');
  }
  preload(): void {
    const progress = document.getElementById('loading-status');
    this.load.on('progress', (p: number) => {
      if (progress)
        progress.textContent = `Preparando a aventura… ${Math.round(p * 100)}%`;
    });
    Object.entries(manifest)
      .filter(([key]) => !key.startsWith('maps/') && !key.startsWith('hud/'))
      .forEach(([key, url]) => this.load.image(key, `${import.meta.env.BASE_URL}${url.replace(/^\//, '')}`));
  }
  create(): void {
    registerAnimations(this, manifest);
    this.inputSystem = new InputSystem(this);
    this.cameras.main.setBackgroundColor('#10151e');
    this.presentation = new ArenaPresentation(this);
    this.warnings = this.add.graphics().setDepth(4);
    const ring = this.add
      .ellipse(0, 0, 48, 27, 0x9fe05a, 0.8)
      .setStrokeStyle(4, 0xf3ffb2);
    const text = this.add
      .text(0, -26, 'SAÍDA', {
        fontFamily: 'Arial',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#183b30',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
    this.exit = this.add
      .container(px(13), py(9), [ring, text])
      .setDepth(3)
      .setVisible(false);
    document.dispatchEvent(new Event('game-ready'));
    document.getElementById('loading-status')?.remove();
    this.events.once('shutdown', () => {
      this.objects.clear();
    });
  }
  private sprite(
    id: string,
    key: string,
    x: number,
    y: number,
    height: number,
    origin = 1,
  ): Phaser.GameObjects.Sprite {
    let sprite = this.objects.get(id);
    if (!sprite) {
      sprite = id.startsWith('projectile')
        ? this.projectilePool.pop()
        : undefined;
      if (sprite)
        sprite
          .setTexture(key)
          .setPosition(px(x), py(y))
          .setActive(true)
          .setVisible(true);
      else sprite = this.add.sprite(px(x), py(y), key);
      sprite.setOrigin(0.5, origin).clearTint().setAlpha(1);
      sprite.setDisplaySize((height * sprite.width) / sprite.height, height);
      this.objects.set(id, sprite);
    }
    return sprite;
  }
  private syncMap(s: Snapshot): void {
    const signature = JSON.stringify(s.grid);
    if (this.stage === s.stage && signature === this.lastGrid) return;
    if (this.stage !== s.stage) {
      for (const row of this.tiles) row.forEach((t) => t?.destroy());
      this.tiles = [];
      this.floors.forEach((f) => f.destroy());
      this.floors = [];
      this.objects.forEach((o) => o.destroy());
      this.objects.clear();
      this.labels.forEach((o) => o.destroy());
      this.labels.clear();
      const floorKey = `tiles/${s.theme === 'garden' || s.theme === 'water' ? 'grass' : s.theme === 'lava' ? 'stone' : s.theme}/floor`;
      const tint: Record<string, number> = {
        garden: 0xcce1b1,
        water: 0xd2ffce,
        lava: 0xb59585,
        ice: 0xade8ff,
        boss: 0x9d84b8,
      };
      s.grid.forEach((row, y) =>
        row.forEach((tile, x) => {
          const floor = this.add
            .image(px(x), py(y), floorKey)
            .setDisplaySize(T + 1, T + 1)
            .setTint((x + y) % 2 ? 0xffffff : tint[s.theme])
            .setDepth(0);
          this.floors.push(floor);
          if (tile === Tile.Water || tile === Tile.Lava || tile === Tile.Ice) {
            floor
              .setTexture(
                `tiles/${tile === Tile.Water ? 'water' : tile === Tile.Lava ? 'lava' : 'ice'}/floor`,
              )
              .clearTint();
          }
        }),
      );
    }
    s.grid.forEach((row, y) => {
      this.tiles[y] ??= [];
      row.forEach((tile, x) => {
        const old = this.tiles[y][x],
          key =
            tile === Tile.Solid
              ? 'tiles/solid'
              : tile === Tile.Breakable
                ? 'tiles/breakable'
                : '';
        if (key && !old)
          this.tiles[y][x] = this.add
            .image(px(x), py(y) - 3, key)
            .setDisplaySize(T + 2, T + 7)
            .setTint(
              s.theme === 'ice'
                ? 0xb0e5ff
                : s.theme === 'lava'
                  ? 0xcaa594
                  : s.theme === 'boss'
                    ? 0xb19ac7
                    : 0xffffff,
            )
            .setDepth(10 + y * 0.1 - 0.04);
        else if (!key && old) {
          old.destroy();
          delete this.tiles[y][x];
        }
      });
    });
    this.stage = s.stage;
    this.lastGrid = signature;
  }
  private actor(a: Actor, prefix: string, height: number, dt: number): void {
    const sprite = this.sprite(a.id, `${prefix}/idle_01`, a.x, a.y, height);
    const blend = 1 - Math.exp(-dt / 48);
    // Large corrections are respawns/transitions; normal movement is interpolated.
    if (Math.hypot(sprite.x - px(a.x), sprite.y - (py(a.y) + 25)) > T * 3) {
      sprite.x = px(a.x);
      sprite.y = py(a.y) + 25;
    } else {
      sprite.x += (px(a.x) - sprite.x) * blend;
      sprite.y += (py(a.y) + 25 - sprite.y) * blend;
    }
    sprite.setDepth(10 + a.y * 0.1).setFlipX(a.direction === 'left');
    const key = `${prefix}/${a.action}`;
    if (this.anims.exists(key) && sprite.anims.currentAnim?.key !== key)
      sprite.play(key);
    sprite.setAlpha(!a.alive ? 0.7 : 1);
  }
  private effect(kind: string, x: number, y: number): void {
    const key =
      kind === 'block_break'
        ? 'effects/block_break/01'
        : kind === 'pickup' || kind === 'shield_break'
          ? 'effects/pickup/01'
          : kind === 'smoke'
            ? 'effects/smoke/01'
            : 'effects/stun/01';
    let effect = this.effects.find((e) => !e.active);
    if (!effect) {
      if (this.effects.length >= 96) return;
      effect = this.add.sprite(0, 0, key);
      this.effects.push(effect);
    }
    effect
      .setTexture(key)
      .setPosition(px(x), py(y))
      .setDisplaySize(55, 55)
      .setDepth(30)
      .setAlpha(0.9)
      .setActive(true)
      .setVisible(true);
    this.tweens.add({
      targets: effect,
      alpha: 0,
      y: effect.y - 18,
      duration: 420,
      onComplete: () => effect!.setActive(false).setVisible(false),
    });
  }
  update(_time: number, dt: number): void {
    if (!this.inputSystem) return;
    this.inputSystem.disabled =
      document.body.classList.contains('paused') ||
      !!document.getElementById('settings-dialog') ||
      network.status !== 'CONNECTED';
    this.inputSystem.update(dt);
    const s = network.state;
    if (!s || s.phase === 'LOBBY' || !s.grid.length) return;
    if (this.roomCode !== s.code) {
      this.stage = -1;
      this.eventId = 0;
      this.roomCode = s.code;
      this.presentation.reset();
      this.bombTicks.clear();
    }
    if (this.snapshotTime !== s.time || this.stage !== s.stage) {
      this.syncMap(s);
      this.snapshotTime = s.time;
      this.snapshotAt = performance.now();
    }
    this.presentation.localId = network.id;
    this.presentation.update(s, _time);
    const present = new Set<string>();
    for (const p of s.players) {
      present.add(p.id);
      const renderPlayer = { ...p };
      if (
        p.id === network.id &&
        p.alive &&
        !s.paused &&
        network.status === 'CONNECTED' &&
        !this.inputSystem.disabled
      ) {
        const input = this.inputSystem.direction;
        moveActor(
          { state: { ...s, bombs: s.bombs.map((b) => ({ ...b })) } },
          renderPlayer,
          input.dx,
          input.dy,
          p.speed,
          Math.min(0.06, (performance.now() - this.snapshotAt) / 1000),
        );
      }
      this.actor(
        renderPlayer,
        `players/${p.color}`,
        105,
        p.id === network.id ? dt * 2 : dt,
      );
      const sprite = this.objects.get(p.id)!;
      if (p.alive && p.invulnerability > s.time)
        sprite.setAlpha(Math.floor(s.time * 12) % 2 ? 0.4 : 1);
      let label = this.labels.get(p.id);
      if (!label) {
        label = this.add
          .text(0, 0, p.nickname, {
            fontFamily: 'Arial',
            fontSize: '11px',
            fontStyle: 'bold',
            color: '#ffffff',
            stroke: '#18342b',
            strokeThickness: 4,
          })
          .setOrigin(0.5)
          .setDepth(40);
        this.labels.set(p.id, label);
      }
      label.setPosition(sprite.x, sprite.y - 94).setVisible(p.alive);
      if (p.hasShield && p.alive) {
        const shield = this.sprite(
          `shield-${p.id}`,
          'items/shield',
          p.x,
          p.y,
          82,
          0.5,
        );
        shield
          .setPosition(sprite.x, sprite.y - 30)
          .setAlpha(0.22)
          .setDepth(20);
        present.add(`shield-${p.id}`);
      }
    }
    for (const e of s.enemies) {
      if (!e.alive && s.time > e.actionUntil) continue;
      present.add(e.id);
      this.actor(e, `enemies/${e.kind}`, 87, dt);
    }
    if (s.boss) {
      present.add(s.boss.id);
      this.actor(s.boss, 'boss/bomb_forge', 185, dt);
      if (s.boss.invulnerability > s.time)
        this.objects.get(s.boss.id)!.setTint(0xffbbbb);
      else this.objects.get(s.boss.id)!.clearTint();
    }
    for (const b of s.bombs) {
      present.add(b.id);
      const sprite = this.sprite(b.id, 'bombs/idle_01', b.x, b.y, 58, 0.7);
      const age = s.time - b.placedAt,
        bounce = age < 0.3 ? Math.sin((age / 0.3) * Math.PI) * 8 : 0;
      sprite.setPosition(px(b.x), py(b.y) + 8 - bounce).setDepth(8);
      if (!sprite.anims.isPlaying) sprite.play('bomb/fuse');
      sprite.anims.timeScale = b.remote
        ? 0.6
        : b.explodeAt - s.time < 0.75
          ? 2.3
          : 1;
      const pulse =
        1 + Math.sin(s.time * (b.explodeAt - s.time < 0.75 ? 25 : 10)) * 0.035;
      sprite.setDisplaySize(((58 * 192) / 224) * pulse, 58 * pulse);
      if (b.remote) sprite.setTint(0xb8deff);
      if (!b.remote && b.explodeAt - s.time < 0.75) {
        const beat = Math.floor(s.time * 7);
        if (this.bombTicks.get(b.id) !== beat) {
          this.bombTicks.set(b.id, beat);
          audio.play('bomb_tick');
        }
      }
    }
    for (const f of s.blasts) {
      present.add(f.id);
      const sprite = this.sprite(
        f.id,
        `effects/explosion/${f.part}`,
        f.x,
        f.y,
        72,
        0.5,
      );
      sprite
        .setPosition(px(f.x), py(f.y))
        .setDisplaySize(75, 75)
        .setAlpha(Math.min(1, (f.expires - s.time) * 5))
        .setDepth(9);
    }
    for (const item of s.items) {
      present.add(item.id);
      const fresh = !this.objects.has(item.id);
      const itemSprite = this.sprite(
        item.id,
        `items/${item.kind}`,
        item.x,
        item.y,
        42,
        0.5,
      )
        .setPosition(px(item.x), py(item.y) + Math.sin(s.time * 3) * 3)
        .setDepth(7);
      if (fresh) {
        const scale = itemSprite.scaleX;
        itemSprite.setScale(scale * 0.25);
        this.tweens.add({
          targets: itemSprite,
          scaleX: scale,
          scaleY: scale,
          duration: 260,
          ease: 'Back.Out',
        });
      }
    }
    for (const p of s.projectiles) {
      present.add(p.id);
      this.sprite(
        p.id,
        p.kind === 'fire' ? 'items/fire_up' : 'effects/stun/01',
        p.x,
        p.y,
        29,
        0.5,
      )
        .setPosition(px(p.x), py(p.y))
        .setDepth(15);
    }
    for (const [id, sprite] of this.objects)
      if (!present.has(id)) {
        if (id.startsWith('projectile') && this.projectilePool.length < 32) {
          sprite.setActive(false).setVisible(false);
          this.projectilePool.push(sprite);
        } else sprite.destroy();
        this.objects.delete(id);
        this.bombTicks.delete(id);
        this.labels.get(id)?.destroy();
        this.labels.delete(id);
      }
    this.exit
      .setPosition(px(s.exit.x), py(s.exit.y))
      .setVisible(s.exit.open)
      .setAlpha(0.7 + Math.sin(s.time * 4) * 0.25);
    this.warnings.clear();
    for (const w of s.warnings) {
      this.warnings.fillStyle(0xff4327, 0.2 + Math.sin(s.time * 16) * 0.15);
      this.warnings.lineStyle(3, 0xffdd70, 0.9);
      for (const c of w.cells) {
        this.warnings.fillRect(px(c.x) - 28, py(c.y) - 28, 56, 56);
        this.warnings.strokeRect(px(c.x) - 28, py(c.y) - 28, 56, 56);
      }
    }
    if (this.lastTick !== s.time) {
      for (const event of s.events)
        if (event.id > this.eventId) {
          this.eventId = event.id;
          audio.play(event.kind);
          if (event.kind === 'boss_death') {
            this.cameras.main.shake(350, 0.004);
            this.cameras.main.flash(180, 255, 220, 140);
            for (let i = 0; i < 8; i++) {
              const angle = (i * Math.PI) / 4;
              this.effect(
                'block_break',
                event.x + Math.cos(angle) * 0.8,
                event.y + Math.sin(angle) * 0.8,
              );
            }
            this.effect('pickup', event.x, event.y);
          } else if (event.kind === 'explosion') {
            this.effect('smoke', event.x, event.y);
            this.cameras.main.shake(90, 0.0015);
            this.cameras.main.flash(
              45,
              255,
              218,
              100,
              false,
              undefined,
              undefined,
            );
          } else if (
            [
              'block_break',
              'pickup',
              'shield_break',
              'smoke',
              'player_death',
              'boss_hit',
              'boss_death',
              'enemy_death',
            ].includes(event.kind)
          ) {
            this.effect(event.kind, event.x, event.y);
            if (event.kind === 'block_break')
              this.effect('smoke', event.x, event.y);
            if (event.kind === 'player_death' || event.kind === 'enemy_death') {
              const victim = [...s.players, ...s.enemies].find(
                (a) =>
                  !a.alive && Math.hypot(a.x - event.x, a.y - event.y) < 0.2,
              );
              const sprite = victim && this.objects.get(victim.id);
              if (sprite) {
                sprite.setTint(0xffffff);
                this.tweens.add({
                  targets: sprite,
                  scaleX: sprite.scaleX * 1.15,
                  scaleY: sprite.scaleY * 0.8,
                  duration: 120,
                  yoyo: true,
                });
              }
            }
          }
        }
      this.lastTick = s.time;
    }
  }
}
