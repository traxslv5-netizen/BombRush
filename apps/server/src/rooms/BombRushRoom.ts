import { Room, type Client } from '@colyseus/core';
import { randomBytes } from 'node:crypto';
import { Game } from '../state/Game';
import { GAME } from '../../../../shared/src/config/game.config';
import type { Color, Input } from '../../../../shared/src/types';
import { RoomPersistence, authorize } from '../persistence/SupabaseStore';
import { roomRegistry } from './RoomRegistry';

export class BombRushRoom extends Room {
  maxClients = 4;
  game = new Game();
  private persistence = new RoomPersistence(this.game.state);
  private rate = new Map<
    string,
    { time: number; count: number; lastInput: number; seq: number }
  >();
  async onCreate(): Promise<void> {
    await this.setPrivate(true);
    let reserved = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = `BR-${randomBytes(3).toString('hex').toUpperCase()}`;
      if (!roomRegistry.has(code) && (await this.persistence.reserve(code))) {
        this.game.state.code = code;
        reserved = true;
        break;
      }
    }
    if (!reserved) throw new Error('ROOM_CODE_UNAVAILABLE');
    roomRegistry.set(this.game.state.code, {
      roomId: this.roomId,
      game: this.game,
    });
    this.onMessage('color', (client, value: unknown) => {
      if (!this.accept(client)) return;
      if (
        typeof value !== 'string' ||
        !this.game.setColor(client.sessionId, value as Color)
      )
        client.send('room_error', { code: 'COLOR_UNAVAILABLE' });
      else {
        this.persistence.sync();
        this.publish();
      }
    });
    this.onMessage('input', (client, payload: unknown) => {
      if (
        !this.accept(client) ||
        this.game.state.phase !== 'PLAYING' ||
        !payload ||
        typeof payload !== 'object'
      )
        return;
      const m = payload as Partial<Input>;
      if (
        !Number.isInteger(m.seq) ||
        ![-1, 0, 1].includes(m.dx as number) ||
        ![-1, 0, 1].includes(m.dy as number) ||
        typeof m.bomb !== 'boolean' ||
        typeof m.remote !== 'boolean'
      )
        return;
      const rate = this.rate.get(client.sessionId)!;
      if (m.seq! <= rate.seq) return;
      rate.seq = m.seq!;
      rate.lastInput = Date.now();
      const previous = this.game.inputs.get(client.sessionId);
      this.game.inputs.set(client.sessionId, {
        dx: m.dx!,
        dy: m.dx ? 0 : m.dy!,
        bomb: m.bomb || previous?.bomb || false,
        remote: m.remote || previous?.remote || false,
        seq: m.seq!,
      });
    });
    this.onMessage('ready', (client) => {
      if (!this.accept(client) || this.game.state.phase !== 'LOBBY') return;
      const p = this.game.state.players.find((p) => p.id === client.sessionId);
      if (p) p.ready = !p.ready;
      this.persistence.sync();
      this.publish();
    });
    this.onMessage('start', (client) => {
      if (
        !this.accept(client) ||
        client.sessionId !== this.game.state.host ||
        this.game.state.phase !== 'LOBBY'
      )
        return;
      if (this.game.state.players.every((p) => p.ready && p.connected)) {
        this.game.start();
        this.persistence.start();
        void this.lock();
      }
    });
    this.onMessage('restart', (client) => {
      if (
        !this.accept(client) ||
        client.sessionId !== this.game.state.host ||
        !['GAME_OVER', 'VICTORY'].includes(this.game.state.phase)
      )
        return;
      this.game.restart();
      this.persistence.start();
    });
    this.onMessage('pause', (client, paused: unknown) => {
      if (
        !this.accept(client) ||
        this.game.state.players.length !== 1 ||
        this.game.state.phase !== 'PLAYING' ||
        typeof paused !== 'boolean'
      )
        return;
      this.game.state.paused = paused;
      this.game.inputs.delete(client.sessionId);
      this.publish();
    });
    let ticks = 0;
    this.setSimulationInterval((ms) => {
      for (const [id, r] of this.rate)
        if (Date.now() - r.lastInput > 400) this.game.inputs.delete(id);
      const phase = this.game.state.phase,
        stage = this.game.state.stage;
      this.game.tick(ms / 1000);
      if (this.game.state.phase !== phase) {
        if (this.game.state.phase === 'VICTORY')
          this.persistence.finish('victory');
        else if (this.game.state.phase === 'GAME_OVER')
          this.persistence.finish('defeat');
      }
      if (stage !== this.game.state.stage) this.persistence.sync();
      if (++ticks % 2 === 0) this.publish();
    }, 1000 / GAME.tick);
  }
  private accept(client: Client): boolean {
    let r = this.rate.get(client.sessionId);
    if (!r) return false;
    if (Date.now() - r.time > 1000) {
      r = { ...r, time: Date.now(), count: 0 };
      this.rate.set(client.sessionId, r);
    }
    return ++r.count <= 65;
  }
  async onAuth(
    _client: Client,
    options: { token?: unknown },
  ): Promise<{ profileId: string }> {
    return authorize(options?.token);
  }
  async onJoin(
    client: Client,
    options: { nickname?: unknown; color?: unknown },
    auth: { profileId: string },
  ): Promise<void> {
    if (this.game.state.phase !== 'LOBBY')
      throw new Error('Partida já iniciada');
    const nickname =
      typeof options?.nickname === 'string'
        ? options.nickname
            .replace(/[<>\x00-\x1f]/g, '')
            .trim()
            .slice(0, 16)
        : '';
    await this.persistence.player(
      client.sessionId,
      auth.profileId,
      nickname || 'Rush',
    );
    if (this.game.state.phase !== 'LOBBY') throw new Error('MATCH_STARTED');
    this.game.addPlayer(
      client.sessionId,
      nickname || `Jogador ${this.clients.length}`,
    );
    if (typeof options.color === 'string')
      this.game.setColor(client.sessionId, options.color as Color);
    this.rate.set(client.sessionId, {
      time: Date.now(),
      count: 0,
      lastInput: Date.now(),
      seq: -1,
    });
    this.persistence.sync();
    this.publish();
  }
  onDrop(client: Client): void {
    const p = this.game.state.players.find((p) => p.id === client.sessionId);
    if (p) p.connected = false;
    this.game.inputs.delete(client.sessionId);
    this.game.state.paused = false;
    this.persistence.sync();
    this.publish();
    void this.allowReconnection(client, 12).catch(() => {});
  }
  onReconnect(client: Client): void {
    const p = this.game.state.players.find((p) => p.id === client.sessionId);
    if (p) p.connected = true;
    const rate = this.rate.get(client.sessionId);
    if (rate) {
      rate.lastInput = Date.now();
      rate.seq = -1;
    }
    this.persistence.sync();
    this.publish();
  }
  onLeave(client: Client): void {
    this.game.removePlayer(client.sessionId);
    this.rate.delete(client.sessionId);
    this.persistence.sync();
    this.publish();
  }
  async onDispose(): Promise<void> {
    roomRegistry.delete(this.game.state.code);
    await this.persistence.close();
  }
  publish(): void {
    this.broadcast('snapshot', this.game.state);
  }
}
