import Phaser from 'phaser';
const sequences: Record<string, string[]> = {
  idle: ['idle_01', 'idle_02'],
  walk: ['walk_01', 'walk_02', 'walk_03', 'walk_04'],
  placeBomb: ['placeBomb_01', 'placeBomb_02'],
  hurt: ['hurt_01'],
  death: ['death_01', 'death_02'],
  attack: ['attack_01'],
  attack1: ['attack1_01'],
  attack2: ['attack2_01'],
};
export function registerAnimations(
  scene: Phaser.Scene,
  manifest: Record<string, string>,
): void {
  const prefixes = [
    ...new Set(
      Object.keys(manifest)
        .filter(
          (k) =>
            k.startsWith('players/') ||
            k.startsWith('enemies/') ||
            k.startsWith('boss/'),
        )
        .map((k) => k.substring(0, k.lastIndexOf('/'))),
    ),
  ];
  for (const prefix of prefixes)
    for (const [action, frames] of Object.entries(sequences)) {
      const keys = frames
        .map((frame) => `${prefix}/${frame}`)
        .filter((key) => key in manifest);
      if (keys.length)
        scene.anims.create({
          key: `${prefix}/${action}`,
          frames: keys.map((key) => ({ key })),
          frameRate: action === 'idle' ? 2 : action === 'walk' ? 9 : 7,
          repeat: ['idle', 'walk'].includes(action) ? -1 : 0,
        });
    }
  scene.anims.create({
    key: 'bomb/fuse',
    frames: ['idle_01', 'idle_02', 'fuse_01', 'fuse_02'].map((f) => ({
      key: `bombs/${f}`,
    })),
    frameRate: 5,
    repeat: -1,
  });
}
