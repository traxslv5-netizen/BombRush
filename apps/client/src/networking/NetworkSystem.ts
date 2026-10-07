import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Snapshot, Input, Color } from '../../../../shared/src/types';
import { Game } from '../../../server/src/state/Game';
import { supabase } from './SupabaseClient';

export type ConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

type PeerMessage = {
  type: string;
  from: string;
  to?: string;
  payload?: unknown;
};

type JoinPayload = {
  nickname: string;
  color?: Color;
};

const COLORS: Color[] = ['red', 'blue', 'purple', 'yellow'];
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class NetworkSystem {
  readonly endpoint = 'supabase-realtime';
  private channel: RealtimeChannel | null = null;
  private localGame: Game | null = null;
  private localTimer: ReturnType<typeof setInterval> | undefined;
  private peerWatchTimer: ReturnType<typeof setInterval> | undefined;
  private localSessionId = '';
  private localTicks = 0;
  private peerHost = false;
  private intentional = false;
  private lastInput = new Map<string, number>();
  private inputSequence = new Map<string, number>();
  private lastSnapshotAt = 0;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | undefined;
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
    await this.leave();
    this.intentional = false;
    this.setStatus('CONNECTING');

    if (localSolo) {
      this.startLocal(nickname, color, 'SOLO');
      return;
    }
    if (!supabase) {
      this.setStatus('ERROR');
      throw new Error('SUPABASE_CONFIG_INCOMPLETE');
    }

    const roomCode = code?.trim().toUpperCase() || this.makeCode();
    this.localSessionId = crypto.randomUUID();
    this.peerHost = !code;

    if (this.peerHost) {
      this.createPeerGame(nickname, color, roomCode);
    }

    const channel = supabase.channel(`bombrush:${roomCode}`, {
      config: { broadcast: { self: false, ack: true } },
    });
    this.channel = channel;
    channel.on('broadcast', { event: 'room' }, ({ payload }) => {
      if (this.channel !== channel || !this.isPeerMessage(payload)) return;
      this.receivePeer(payload);
    });

    return new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.connectTimeout = setTimeout(() => {
        this.failConnect('ROOM_NOT_FOUND');
      }, 10000);

      channel.subscribe((subscriptionStatus) => {
        if (this.channel !== channel) return;
        if (subscriptionStatus === 'SUBSCRIBED') {
          if (this.peerHost) {
            this.startTicks();
            this.finishConnect();
            this.publishLocal(true);
          } else {
            if (this.status === 'ERROR' || this.status === 'DISCONNECTED')
              this.setStatus('RECONNECTING');
            void this.sendPeer('join', { nickname, color } satisfies JoinPayload);
          }
        } else if (
          subscriptionStatus === 'CHANNEL_ERROR' ||
          subscriptionStatus === 'TIMED_OUT'
        ) {
          if (this.status === 'CONNECTING') this.failConnect('CONNECTION_ERROR');
          else if (!this.intentional) this.setStatus('RECONNECTING');
        } else if (
          subscriptionStatus === 'CLOSED' &&
          !this.intentional &&
          this.status === 'CONNECTED'
        ) {
          this.state = null;
          this.setStatus('DISCONNECTED');
          this.onDisconnect('CONNECTION_LOST');
        }
      });
    });
  }

  private startLocal(nickname: string, color: Color | undefined, code: string): void {
    this.localSessionId = `solo-${crypto.randomUUID()}`;
    const game = new Game();
    this.localGame = game;
    game.state.code = code;
    game.addPlayer(this.localSessionId, this.cleanNickname(nickname));
    if (color) game.setColor(this.localSessionId, color);
    this.setStatus('CONNECTED');
    this.publishLocal();
    this.startTicks();
  }

  private createPeerGame(
    nickname: string,
    color: Color | undefined,
    roomCode: string,
  ): void {
    const game = new Game();
    this.localGame = game;
    game.state.code = roomCode;
    game.addPlayer(this.localSessionId, this.cleanNickname(nickname));
    if (color) game.setColor(this.localSessionId, color);
    this.lastInput.set(this.localSessionId, Date.now());
  }

  private startTicks(): void {
    clearInterval(this.localTimer);
    this.localTicks = 0;
    this.localTimer = setInterval(() => {
      const game = this.localGame;
      if (!game) return;
      for (const [id, last] of this.lastInput) {
        if (Date.now() - last > 400) game.inputs.delete(id);
      }
      game.tick(1 / 30);
      if (++this.localTicks % 2 === 0) this.publishLocal(this.peerHost);
    }, 1000 / 30);
  }

  private publishLocal(broadcast = false): void {
    if (!this.localGame) return;
    this.state = this.localGame.state;
    this.onSnapshot(this.localGame.state);
    if (broadcast) void this.sendPeer('snapshot', this.localGame.state);
  }

  private receivePeer(message: PeerMessage): void {
    if (message.to && message.to !== this.localSessionId) return;

    if (this.peerHost && this.localGame) {
      if (message.type === 'join') {
        this.acceptJoin(message);
        return;
      }
      if (!this.localGame.state.players.some((p) => p.id === message.from)) return;
      if (message.type === 'leave') {
        this.localGame.removePlayer(message.from);
        this.lastInput.delete(message.from);
        this.inputSequence.delete(message.from);
        this.publishLocal(true);
      } else {
        this.applyCommand(message.from, message.type, message.payload);
      }
      return;
    }

    if (message.type === 'snapshot' && this.isSnapshot(message.payload)) {
      const snapshot = message.payload;
      if (!snapshot.players.some((p) => p.id === this.localSessionId)) return;
      this.state = snapshot;
      this.lastSnapshotAt = Date.now();
      this.onSnapshot(snapshot);
      if (this.status === 'CONNECTING') {
        this.startPeerWatch();
        this.finishConnect();
      } else if (this.status !== 'CONNECTED') {
        this.setStatus('CONNECTED');
      }
    } else if (message.type === 'error') {
      const code =
        message.payload && typeof message.payload === 'object' &&
        'code' in message.payload && typeof message.payload.code === 'string'
          ? message.payload.code
          : 'CONNECTION_ERROR';
      if (this.status === 'CONNECTING') this.failConnect(code);
      else this.onError(code);
    }
  }

  private acceptJoin(message: PeerMessage): void {
    const game = this.localGame!;
    const payload = message.payload as Partial<JoinPayload> | undefined;
    if (game.state.phase !== 'LOBBY') {
      void this.sendPeer('error', { code: 'MATCH_STARTED' }, message.from);
      return;
    }
    if (game.state.players.length >= 4) {
      void this.sendPeer('error', { code: 'ROOM_FULL' }, message.from);
      return;
    }
    if (game.state.players.some((p) => p.id === message.from)) {
      this.publishLocal(true);
      return;
    }
    const nickname = this.cleanNickname(payload?.nickname);
    game.addPlayer(message.from, nickname);
    if (payload?.color && COLORS.includes(payload.color)) {
      game.setColor(message.from, payload.color);
    }
    this.lastInput.set(message.from, Date.now());
    this.publishLocal(true);
  }

  private applyCommand(id: string, type: string, payload?: unknown): void {
    const game = this.localGame;
    if (!game) return;
    const player = game.state.players.find((p) => p.id === id);

    if (type === 'input' && this.validInput(payload)) {
      if (game.state.phase !== 'PLAYING') return;
      const sequence = this.inputSequence.get(id) ?? -1;
      if (payload.seq <= sequence) return;
      this.inputSequence.set(id, payload.seq);
      this.lastInput.set(id, Date.now());
      const previous = game.inputs.get(id);
      game.inputs.set(id, {
        dx: payload.dx,
        dy: payload.dx ? 0 : payload.dy,
        bomb: payload.bomb || previous?.bomb || false,
        remote: payload.remote || previous?.remote || false,
        seq: payload.seq,
      });
      return;
    }
    if (type === 'color' && typeof payload === 'string') {
      if (!COLORS.includes(payload as Color) || !game.setColor(id, payload as Color)) {
        void this.sendPeer('error', { code: 'COLOR_UNAVAILABLE' }, id);
      }
    } else if (type === 'ready' && player && game.state.phase === 'LOBBY') {
      player.ready = !player.ready;
    } else if (
      type === 'start' &&
      id === game.state.host &&
      game.state.phase === 'LOBBY' &&
      game.state.players.every((p) => p.ready && p.connected)
    ) {
      game.start();
    } else if (
      type === 'pause' &&
      typeof payload === 'boolean' &&
      game.state.players.length === 1 &&
      game.state.phase === 'PLAYING'
    ) {
      game.state.paused = payload;
      game.inputs.delete(id);
    } else if (
      type === 'restart' &&
      id === game.state.host &&
      ['GAME_OVER', 'VICTORY'].includes(game.state.phase)
    ) {
      game.restart();
    }
    this.publishLocal(this.peerHost);
  }

  private validInput(payload: unknown): payload is Input {
    if (!payload || typeof payload !== 'object') return false;
    const input = payload as Partial<Input>;
    return (
      Number.isInteger(input.seq) &&
      [-1, 0, 1].includes(input.dx as number) &&
      [-1, 0, 1].includes(input.dy as number) &&
      typeof input.bomb === 'boolean' &&
      typeof input.remote === 'boolean'
    );
  }

  private isSnapshot(payload: unknown): payload is Snapshot {
    return Boolean(
      payload &&
      typeof payload === 'object' &&
      'players' in payload &&
      Array.isArray(payload.players) &&
      'phase' in payload &&
      typeof payload.phase === 'string',
    );
  }

  private isPeerMessage(payload: unknown): payload is PeerMessage {
    return Boolean(
      payload &&
      typeof payload === 'object' &&
      'type' in payload &&
      typeof payload.type === 'string' &&
      'from' in payload &&
      typeof payload.from === 'string',
    );
  }

  private cleanNickname(value: unknown): string {
    if (typeof value !== 'string') return 'Rush';
    return value.replace(/[<>\x00-\x1f]/g, '').trim().slice(0, 16) || 'Rush';
  }

  private makeCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    let code = 'BR-';
    for (const byte of bytes) code += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
    return code;
  }

  private startPeerWatch(): void {
    clearInterval(this.peerWatchTimer);
    this.peerWatchTimer = setInterval(() => {
      if (
        !this.peerHost &&
        this.status === 'CONNECTED' &&
        this.lastSnapshotAt &&
        Date.now() - this.lastSnapshotAt > 15000
      ) {
        this.setStatus('RECONNECTING');
        void this.sendPeer('join', {
          nickname:
            this.state?.players.find((p) => p.id === this.localSessionId)
              ?.nickname || 'Rush',
        });
      }
    }, 3000);
  }

  private async sendPeer(type: string, payload?: unknown, to?: string): Promise<void> {
    if (!this.channel) return;
    await this.channel.send({
      type: 'broadcast',
      event: 'room',
      payload: { type, from: this.localSessionId, to, payload } satisfies PeerMessage,
    });
  }

  private finishConnect(): void {
    clearTimeout(this.connectTimeout);
    this.connectTimeout = undefined;
    this.setStatus('CONNECTED');
    const resolve = this.connectResolve;
    this.connectResolve = null;
    this.connectReject = null;
    resolve?.();
  }

  private failConnect(code: string): void {
    clearTimeout(this.connectTimeout);
    this.connectTimeout = undefined;
    this.setStatus('ERROR');
    const reject = this.connectReject;
    this.connectResolve = null;
    this.connectReject = null;
    reject?.(new Error(code));
  }

  get id(): string {
    return this.localSessionId;
  }

  send(type: string, payload?: unknown): void {
    if (this.localGame) {
      this.applyCommand(this.localSessionId, type, payload);
      return;
    }
    if (this.status === 'CONNECTED') void this.sendPeer(type, payload);
  }

  input(input: Input): void {
    this.send('input', input);
  }

  async leave(): Promise<void> {
    this.intentional = true;
    clearTimeout(this.connectTimeout);
    this.connectTimeout = undefined;
    clearInterval(this.localTimer);
    this.localTimer = undefined;
    clearInterval(this.peerWatchTimer);
    this.peerWatchTimer = undefined;
    this.connectResolve = null;
    this.connectReject = null;

    const channel = this.channel;
    if (channel && !this.peerHost && this.localSessionId) {
      await this.sendPeer('leave').catch(() => {});
    }
    this.channel = null;
    if (channel && supabase) await supabase.removeChannel(channel).catch(() => {});

    this.localGame = null;
    this.localSessionId = '';
    this.localTicks = 0;
    this.lastSnapshotAt = 0;
    this.peerHost = false;
    this.lastInput.clear();
    this.inputSequence.clear();
    this.state = null;
    this.setStatus('DISCONNECTED');
  }
}

export const network = new NetworkSystem();
