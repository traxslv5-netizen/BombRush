import Phaser from 'phaser';
import { STAGES } from '../../../../shared/src/config/stages.config';
import type { Snapshot } from '../../../../shared/src/types';
export const OX = 192,
  OY = 180,
  T = 64;
export const px = (x: number) => OX + x * T,
  py = (y: number) => OY + y * T;
const themeColors: Record<
  string,
  { edge: number; light: number; ambient: number }
> = {
  garden: { edge: 0x3c5845, light: 0xa2b27b, ambient: 0xeec78b },
  water: { edge: 0x244653, light: 0x79b9b3, ambient: 0xa2ebf4 },
  lava: { edge: 0x4b3431, light: 0xcb8854, ambient: 0xffaa50 },
  ice: { edge: 0x364c69, light: 0x9bd6eb, ambient: 0xe1f4ff },
  boss: { edge: 0x393244, light: 0x948498, ambient: 0xe69d57 },
};
export class ArenaPresentation {
  private decor: Phaser.GameObjects.GameObject[] = [];
  private objectives: Phaser.GameObjects.Graphics;
  private ambiance: Phaser.GameObjects.Graphics;
  private markers: Phaser.GameObjects.Graphics;
  private stage = -1;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  constructor(private scene: Phaser.Scene) {
    this.objectives = scene.add.graphics().setDepth(12);
    this.markers = scene.add.graphics().setDepth(6);
    this.ambiance = scene.add.graphics().setDepth(45);
  }
  rebuild(s: Snapshot): void {
    this.stage = s.stage;
    this.decor.forEach((o) => o.destroy());
    this.decor = [];
    this.labels.forEach((l) => l.destroy());
    this.labels.clear();
    const colors = themeColors[s.theme],
      g = this.scene.add.graphics().setDepth(-2);
    this.decor.push(g);
    g.fillStyle(0x050914, 0.55);
    g.fillRoundedRect(px(0) - 49, py(0) - 40, 994, 728, 18);
    g.fillStyle(colors.edge);
    g.fillRoundedRect(px(0) - 43, py(0) - 49, 984, 722, 15);
    g.lineStyle(3, colors.light, 0.7);
    g.strokeRoundedRect(px(0) - 43, py(0) - 49, 984, 722, 15);
    for (const d of STAGES[s.stage].decor) {
      if (d.kind === 'flowers') {
        const img = this.scene.add
          .image(px(d.x), py(d.y) - 17, 'tiles/flowers')
          .setDisplaySize(85, 90)
          .setDepth(12);
        this.decor.push(img);
      } else if (d.kind === 'tree' || d.kind === 'snow') {
        const pine = this.scene.add.graphics().setDepth(12),
          x = px(d.x),
          y = py(d.y),
          snow = d.kind === 'snow';
        pine.fillStyle(0x111f2b, 0.35);
        pine.fillEllipse(x, y + 20, 57, 22);
        pine.fillStyle(0x75523b);
        pine.fillRoundedRect(x - 7, y - 4, 14, 25, 3);
        for (let tier = 0; tier < 3; tier++) {
          const w = 28 - tier * 6,
            bottom = y + 9 - tier * 18,
            top = bottom - 38;
          pine.fillStyle(snow ? 0x34666a : 0x225a3f);
          pine.lineStyle(3, 0x153b39);
          pine.fillTriangle(x, top, x - w, bottom, x + w, bottom);
          pine.strokeTriangle(x, top, x - w, bottom, x + w, bottom);
          pine.fillStyle(snow ? 0xeaf8ff : 0x5a9660);
          pine.fillTriangle(
            x,
            top - 1,
            x - w * 0.78,
            bottom - 9,
            x + w * 0.78,
            bottom - 9,
          );
          if (snow) {
            pine.fillStyle(0xc6e7f2);
            pine.fillEllipse(x, bottom - 10, w * 1.6, 12);
          }
        }
        this.decor.push(pine);
      } else {
        const prop = this.scene.add.graphics().setDepth(12);
        prop.fillStyle(0x172230);
        prop.fillRoundedRect(px(d.x) - 22, py(d.y) - 43, 44, 62, 10);
        prop.lineStyle(3, 0x697185);
        prop.strokeRoundedRect(px(d.x) - 22, py(d.y) - 43, 44, 62, 10);
        prop.fillStyle(d.kind === 'reactor' ? 0xeaad5c : 0x778496);
        prop.fillCircle(px(d.x), py(d.y) - 27, 13);
        prop.fillStyle(0xfdf0b4, 0.8);
        prop.fillCircle(px(d.x) - 3, py(d.y) - 31, 5);
        this.decor.push(prop);
      }
    }
    // Plank bridges use native drawing over the supplied water floor.
    s.grid.forEach((row, y) =>
      row.forEach((tile, x) => {
        if (tile !== 6) return;
        const b = this.scene.add.graphics().setDepth(2);
        for (let i = 0; i < 5; i++) {
          b.fillStyle(i % 2 ? 0x997653 : 0xb89466);
          b.fillRect(px(x) - 31, py(y) - 30 + i * 12, 62, 10);
        }
        b.lineStyle(4, 0x584b3b);
        b.lineBetween(px(x) - 25, py(y) - 31, px(x) - 25, py(y) + 31);
        b.lineBetween(px(x) + 25, py(y) - 31, px(x) + 25, py(y) + 31);
        this.decor.push(b);
      }),
    );
  }
  update(s: Snapshot, now: number): void {
    if (this.stage !== s.stage) this.rebuild(s);
    const g = this.objectives;
    g.clear();
    this.markers.clear();
    for (const p of s.objective.points) {
      const g = p.kind === 'totem' ? this.markers : this.objectives;
      const x = px(p.x),
        y = py(p.y),
        bob = Math.sin(now / 380) * 3;
      if (p.done) {
        this.labels.get(p.id)?.setVisible(false);
        if (p.kind === 'totem') {
          g.fillStyle(0x92cf7b, 0.4);
          g.fillCircle(x, y, 22);
          g.lineStyle(3, 0xc5f8a5);
          g.strokeCircle(x, y, 20);
        }
        continue;
      }
      if (p.hidden) {
        g.lineStyle(2, p.kind === 'key' ? 0xfad67e : 0x98eaff, 0.85);
        g.strokeCircle(x, y - 4, 10);
        g.lineBetween(x - 5, y - 4, x + 5, y - 4);
        g.lineBetween(x, y - 9, x, y + 1);
        continue;
      }
      g.fillStyle(0x07101a, 0.35);
      g.fillEllipse(x, y + 18, 46, 16);
      if (p.kind === 'key') {
        g.lineStyle(6, 0x664721);
        g.strokeCircle(x - 7, y - 8 + bob, 9);
        g.lineBetween(x, y - 2 + bob, x + 13, y + 11 + bob);
        g.lineStyle(4, 0xffd573);
        g.strokeCircle(x - 7, y - 8 + bob, 8);
        g.lineBetween(x, y - 2 + bob, x + 13, y + 11 + bob);
        g.lineBetween(x + 8, y + 7 + bob, x + 13, y + 2 + bob);
      } else if (p.kind === 'crystal') {
        g.fillStyle(0x25658c);
        g.fillPoints(
          [
            { x, y: y - 27 + bob },
            { x: x + 18, y: y - 7 + bob },
            { x, y: y + 23 + bob },
            { x: x - 18, y: y - 7 + bob },
          ].map((p) => new Phaser.Math.Vector2(p.x, p.y)),
          true,
        );
        g.fillStyle(0x9debff);
        g.fillTriangle(x, y - 23 + bob, x + 13, y - 7 + bob, x, y + 18 + bob);
        g.fillStyle(0x56b9e8);
        g.fillTriangle(x, y - 23 + bob, x - 13, y - 7 + bob, x, y + 18 + bob);
        g.lineStyle(2, 0xe6fcff);
        g.lineBetween(x, y - 23 + bob, x, y + 18 + bob);
      } else if (p.kind === 'totem') {
        g.fillStyle(0x273846);
        g.fillRoundedRect(x - 19, y - 29, 38, 50, 5);
        g.lineStyle(3, 0x7ab7b5);
        g.strokeRoundedRect(x - 19, y - 29, 38, 50, 5);
        g.fillStyle(0xe6ae54);
        g.fillCircle(x, y - 12, 10);
        g.lineStyle(4, 0xffe6a2);
        g.beginPath();
        g.arc(
          x,
          y - 12,
          15,
          -Math.PI / 2,
          -Math.PI / 2 + p.progress * Math.PI * 2,
          false,
        );
        g.strokePath();
      } else {
        g.fillStyle(0x403c4b);
        g.fillRoundedRect(x - 25, y - 29, 50, 53, 7);
        g.lineStyle(4, 0x927b69);
        g.strokeRoundedRect(x - 25, y - 29, 50, 53, 7);
        g.fillStyle(p.hitUntil > s.time ? 0xffe5a5 : 0xf08b37);
        g.fillCircle(x, y - 4, 17);
        g.lineStyle(3, 0x592729);
        g.lineBetween(x - 7, y - 15, x - 7, y + 7);
        g.lineBetween(x + 3, y - 15, x + 3, y + 7);
        g.fillStyle(0x131a26);
        g.fillRect(x - 22, y + 28, 44, 5);
        g.fillStyle(0xe8af5b);
        g.fillRect(x - 22, y + 28, (44 * p.hp) / p.maxHp, 5);
      }
      let label = this.labels.get(p.id);
      if (!label) {
        label = this.scene.add
          .text(
            x,
            y - 43,
            p.kind === 'totem' ? 'ATIVE' : p.kind === 'core' ? 'CORE' : '',
            {
              fontFamily: 'Arial',
              fontSize: '10px',
              color: '#ffe9b4',
              stroke: '#182431',
              strokeThickness: 3,
            },
          )
          .setOrigin(0.5)
          .setDepth(16);
        this.labels.set(p.id, label);
      }
    }
    for (const h of s.hazards) {
      const g = this.markers;
      const x = px(h.x),
        y = py(h.y),
        color =
          h.phase === 'warning'
            ? 0xffc65b
            : h.phase === 'active'
              ? 0xff643a
              : 0x737483;
      g.fillStyle(0x171d29);
      g.fillRect(x - 22, y - 22, 44, 44);
      g.lineStyle(3, color);
      for (let i = -12; i <= 12; i += 8)
        g.lineBetween(x - 18, y + i, x + 18, y + i);
      if (h.phase !== 'idle') {
        g.fillStyle(
          color,
          h.phase === 'active' ? 0.6 : 0.15 + Math.sin(now / 80) * 0.1,
        );
        g.fillRect(x - 29, y - 29, 58, 58);
      }
    }
    for (const e of s.enemies) {
      if (!e.alive) continue;
      if (e.telegraphUntil > s.time) {
        this.markers.lineStyle(3, 0xffd474, 0.8);
        this.markers.strokeCircle(
          px(e.x),
          py(e.y),
          28 + Math.sin(now / 70) * 2,
        );
        this.markers.lineBetween(
          px(e.x),
          py(e.y),
          px(e.x + e.attackX * 2),
          py(e.y + e.attackY * 2),
        );
        for (let i = 1; i <= 3; i++) {
          this.markers.fillStyle(0xffb755, 0.17);
          this.markers.fillRect(
            px(Math.round(e.x) + e.attackX * i) - 22,
            py(Math.round(e.y) + e.attackY * i) - 22,
            44,
            44,
          );
        }
      }
    }
    const local = s.players.find((p) => p.id === this.localId && p.alive);
    if (local) {
      this.markers.lineStyle(2, 0xffecb3, 0.9);
      this.markers.strokeEllipse(px(local.x), py(local.y) + 16, 40, 15);
    }
    const a = this.ambiance;
    a.clear();
    const color = themeColors[s.theme].ambient;
    if (s.theme === 'water')
      s.grid.forEach((row, y) =>
        row.forEach((tile, x) => {
          if (tile !== 3) return;
          this.markers.lineStyle(2, 0xc4f1f2, 0.2);
          for (let i = 0; i < 2; i++) {
            const h = Math.sin(now / 650 + x + i) * 4;
            this.markers.lineBetween(
              px(x) - 19,
              py(y) - 12 + i * 23 + h,
              px(x) + 14,
              py(y) - 12 + i * 23 + h,
            );
          }
        }),
      );
    for (let i = 0; i < 20; i++) {
      const x = px(0) - 25 + ((i * 79 + now * 0.009) % 950),
        y =
          py(0) -
          24 +
          ((i * 53 + now * (s.theme === 'ice' ? 0.013 : -0.012) + 100000) %
            670);
      a.fillStyle(color, 0.16 + (i % 3) * 0.04);
      if (s.theme === 'garden') a.fillEllipse(x, y, 5, 2);
      else a.fillCircle(x, y, s.theme === 'ice' ? 1.8 : 1.2);
    }
  }
  localId = '';
  reset(): void {
    this.stage = -1;
  }
}
