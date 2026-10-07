import { Client, type Room } from '@colyseus/sdk';
import type { Snapshot, Input, Color } from '../../../../shared/src/types';
import { identityToken } from './SupabaseClient';
import { Game } from '../../../server/src/state/Game';
export type ConnectionStatus =
  'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';
export class NetworkSystem {
  readonly endpoint =
    import.meta.env.VITE_SERVER_URL ||
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:2567`;
  private client = new Client(this.endpoint);
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private intentional = false;
  private localGame: Game | null = null;
  private localTimer: ReturnType<typeof setInterval> | undefined;
  private localSessionId = '';
  private localTicks = 0;
  room: Room | null = null;
  state: Snapshot | null = null;
  status: ConnectionStatus = 'DISCONNECTED';
  onSnapshot: (s: Snapshot) => void = () => {};
  onDisconnect: (reason: string) => void = () => {};
  onStatus: (status: ConnectionStatus) => void = () => {};
  onError: (code: string) => void = () => {};
  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.onStatus(status);
  }
  async connect(
    nickname: string,
    code?: string,
    color?: Color,
    localSolo = false,
  ): Promise<void> {
    this.intentional = false;
    this.setStatus('CONNECTING');
    try {
      if (localSolo) {
        this.startLocal(nickname, color);
        return;
      }
      const token = await identityToken();
      let id: string | undefined;
      if (code) {
        const response = await fetch(
          `${this.endpoint.replace(/^ws/, 'http')}/rooms/${encodeURIComponent(code.trim().toUpperCase())}`,
          { signal: AbortSignal.timeout(8000) },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.code);
        id = data.roomId;
      }
      const room = id
        ? await this.client.joinById(id, { nickname, token })
        : await this.client.create('bombrush', { nickname, token, color });
      this.bind(room);
    } catch (error) {
      this.setStatus('ERROR');
      throw error;
    }
  }
  private startLocal(nickname: string, color?: Color): void {
    clearInterval(this.localTimer);
    const game = new Game();
    this.localGame = game;
    this.localSessionId = `solo-${crypto.randomUUID()}`;
    game.state.code = 'SOLO';
    game.addPlayer(this.localSessionId, nickname);
    if (color) game.setColor(this.localSessionId, color);
    this.state = game.state;
    this.setStatus('CONNECTED');
    this.publishLocal();
    this.localTimer = setInterval(() => {
      game.tick(1 / 30);
      if (++this.localTicks % 2 === 0) this.publishLocal();
    }, 1000 / 30);
  }
  private publishLocal(): void {
    if (!this.localGame) return;
    this.state = this.localGame.state;
    this.onSnapshot(this.localGame.state);
  }
  private bind(room: Room): void {
    this.room = room;
    room.reconnection.minUptime = 0;
    room.reconnection.maxRetries = 8;
    room.reconnection.minDelay = 350;
    room.reconnection.maxDelay = 1500;
    room.reconnection.maxEnqueuedMessages = 0;
    this.setStatus('CONNECTED');
    room.onMessage('snapshot', (s: Snapshot) => {
      if (this.room !== room) return;
      this.state = s;
      this.onSnapshot(s);
    });
    room.onMessage('room_error', (m: { code: string }) => this.onError(m.code));
    room.onDrop(() => {
      this.setStatus('RECONNECTING');
      clearTimeout(this.timeout);
      this.timeout = setTimeout(() => {
        if (this.status === 'RECONNECTING') {
          void this.leave();
          this.onError('CONNECTION_LOST');
        }
      }, 13000);
    });
    room.onReconnect(() => {
      clearTimeout(this.timeout);
      this.setStatus('CONNECTED');
    });
    room.onError((_code, message) =>
      this.onError(message || 'CONNECTION_ERROR'),
    );
    room.onLeave(() => {
      if (this.room !== room) return;
      clearTimeout(this.timeout);
      this.room = null;
      this.state = null;
      this.setStatus('DISCONNECTED');
      this.onDisconnect(this.intentional ? '' : 'CONNECTION_LOST');
    });
  }
  get id(): string {
    return this.localSessionId || this.room?.sessionId || '';
  }
  send(type: string, payload?: unknown): void {
    if (this.localGame) {
      const game = this.localGame;
      const player = game.state.players.find((p) => p.id === this.localSessionId);
      if (type === 'input' && payload && typeof payload === 'object')
        game.inputs.set(this.localSessionId, payload as Input);
      else if (type === 'color' && typeof payload === 'string')
        game.setColor(this.localSessionId, payload as Color);
      else if (type === 'ready' && player) player.ready = !player.ready;
      else if (type === 'start' && game.state.players.every((p) => p.ready))
        game.start();
      else if (type === 'pause' && typeof payload === 'boolean') {
        game.state.paused = payload;
        game.inputs.delete(this.localSessionId);
      } else if (type === 'restart') game.restart();
      this.publishLocal();
      return;
    }
    if (this.status === 'CONNECTED') this.room?.send(type, payload);
  }
  input(input: Input): void {
    this.send('input', input);
  }
  async leave(): Promise<void> {
    this.intentional = true;
    clearTimeout(this.timeout);
    if (this.localGame) {
      clearInterval(this.localTimer);
      this.localTimer = undefined;
      this.localGame = null;
      this.localSessionId = '';
      this.state = null;
      this.setStatus('DISCONNECTED');
      return;
    }
    await this.room?.leave();
  }
}
export const network = new NetworkSystem();
