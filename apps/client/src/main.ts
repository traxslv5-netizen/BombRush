import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { menu } from './ui/Interface';
import './style.css';
menu();
new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  width: 1280,
  height: 900,
  backgroundColor: '#10151e',
  antialias: true,
  powerPreference: 'high-performance',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [GameScene],
  audio: { noAudio: true },
  fps: { target: 60 },
});
