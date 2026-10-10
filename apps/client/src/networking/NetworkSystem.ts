import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Snapshot, Input, Color } from '../../../../shared/src/types';
import { Game } from '../../../server/src/state/Game';
import { supabase } from './SupabaseClient';
import { RemoteMotion } from './RemoteMotion';

export type ConnectionStatus =
  'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';

type PeerMessage = {
  sequence?: number;
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
  readonly remoteMotion = new RemoteMotion();
  readonly debug = { rttMs: 0, snapshotIntervalMs: 0, snapshots: 0 };
  private pingSentAt = 0;
  readonly endpoint = 'supabase-realtime';
  private channel: RealtimeChannel | null = null;
  private localGame: Game | null = null;
  private localTimer: ReturnType<typeof setInterval> | undefined;
  private clock: Worker | undefined;
  private clockStartup: ReturnType<typeof setTimeout> | undefined;
  private peerWatchTimer: ReturnType<typeof setInterval> | undefined;
  private localSessionId = '';
  private localTicks = 0;
  private peerHost = false;
  private intentional = false;
  private lastInput = new Map<string, number>();
  private inputSequence = new Map<string, number>();
  private lastSnapshotAt = 0;
  private subscribed = false;
  private hostId = '';
  private roomCode = '';
  private snapshotSequence = 0;
  private receivedSequence = -1;
  private lastSeen = new Map<string, number>();
  private lastReadyAt = 0;
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
    this.roomCode = roomCode;
    this.localSessionId =
      (code && sessionStorage.getItem(`bombrush-peer:${roomCode}`)) ||
      crypto.randomUUID();
    sessionStorage.setItem(`bombrush-peer:${roomCode}`, this.localSessionId);
    this.peerHost = !code;
    this.hostId = this.peerHost ? this.localSessionId : '';

    if (this.peerHost) {
      this.createPeerGame(nickname, color, roomCode);
    }

    const channel = supabase.channel(`bombrush:v2:${roomCode}`, {
      config: { broadcast: { self: false, ack: false } },
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
        this.failConnect(
          this.subscribed && !this.peerHost
            ? 'ROOM_NOT_FOUND'
            : 'CONNECTION_ERROR',
        );
      }, 10000);

      channel.subscribe((subscriptionStatus) => {
        if (this.channel !== channel) return;
        if (subscriptionStatus === 'SUBSCRIBED') {
          this.subscribed = true;
          this.startPeerWatch();
          if (this.peerHost) {
            this.startTicks();
            this.finishConnect();
            this.publishLocal(true);
          } else {
            if (this.status === 'ERROR' || this.status === 'DISCONNECTED')
              this.setStatus('RECONNECTING');
            void this.sendPeer('join', {
              nickname,
              color,
            } satisfies JoinPayload);
          }
        } else if (
          subscriptionStatus === 'CHANNEL_ERROR' ||
          subscriptionStatus === 'TIMED_OUT'
        ) {
          this.subscribed = false;
          if (this.status === 'CONNECTING')
            this.failConnect('CONNECTION_ERROR');
          else if (!this.intentional) this.setStatus('RECONNECTING');
        } else if (
          subscriptionStatus === 'CLOSED' &&
          !this.intentional &&
          this.status === 'CONNECTED'
        ) {
          this.subscribed = false;
          this.setStatus('RECONNECTING');
        }
      });
    });
  }

  private startLocal(
    nickname: string,
    color: Color | undefined,
    code: string,
  ): void {
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
    game.synchronizeStages = true;
    game.addPlayer(this.localSessionId, this.cleanNickname(nickname));
    if (color) game.setColor(this.localSessionId, color);
    this.lastInput.set(this.localSessionId, Date.now());
  }

  private stopTicks(): void {
    clearInterval(this.localTimer);
    this.localTimer = undefined;
    clearTimeout(this.clockStartup);
    this.clockStartup = undefined;
    this.clock?.terminate();
    this.clock = undefined;
  }

  private startTicks(): void {
    this.stopTicks();
    this.localTicks = 0;
    let lastTickAt = performance.now();
    const tick = () => {
      const game = this.localGame;
      if (!game) return;
      if (this.peerHost && !this.subscribed) {
        lastTickAt = performance.now();
        return;
      }
      for (const [id, last] of this.lastInput) {
        if (Date.now() - last > 800) game.inputs.delete(id);
      }
      const previousRevision = game.state.stageRevision;
      const previousPhase = game.state.phase;
      const now = performance.now();
      game.tick(Math.min(0.1, (now - lastTickAt) / 1000));
      lastTickAt = now;
      this.remoteMotion.push(game.state, now, true);
      // Publish room changes even when a client is waiting to acknowledge a new map.
      // Broadcast delivery is charged per subscriber. Keep four-player rooms
      // within the free Realtime throughput while keeping two-player updates at 15Hz.
      const snapshotEvery =
        game.state.phase === 'LOBBY'
          ? 30
          : Math.max(2, game.state.players.length);
      if (
        ++this.localTicks % snapshotEvery === 0 ||
        previousRevision !== game.state.stageRevision ||
        previousPhase !== game.state.phase
      )
        this.publishLocal(this.peerHost);
    };
    const fallback = () => {
      this.stopTicks();
      lastTickAt = performance.now();
      this.localTimer = setInterval(tick, 1000 / 30);
    };
    if (typeof Worker !== 'undefined') {
      try {
        this.clock = new Worker(
          new URL('./SimulationClock.ts', import.meta.url),
          { type: 'module' },
        );
        this.clock.onmessage = () => {
          clearTimeout(this.clockStartup);
          this.clockStartup = undefined;
          tick();
        };
        this.clock.onerror = fallback;
        // Failed worker downloads may not report an error on every browser.
        this.clockStartup = setTimeout(fallback, 1500);
      } catch {
        fallback();
      }
    } else fallback();
  }

  private publishLocal(broadcast = false): void {
    if (!this.localGame) return;
    this.state = this.localGame.state;
    this.remoteMotion.push(this.state, performance.now(), true);
    this.onSnapshot(this.localGame.state);
    if (broadcast) void this.sendPeer('snapshot', this.localGame.state);
  }

  private receivePeer(message: PeerMessage): void {
    if (this.intentional) return;
    if (message.to && message.to !== this.localSessionId) return;

    if (this.peerHost && this.localGame) {
      if (message.type === 'join') {
        this.acceptJoin(message);
        return;
      }
      if (!this.localGame.state.players.some((p) => p.id === message.from))
        return;
      this.lastSeen.set(message.from, Date.now());
      if (message.type === 'ping') {
        const p = this.localGame.state.players.find(
          (p) => p.id === message.from,
        )!;
        p.connected = true;
        if (typeof message.payload === 'number')
          void this.sendPeer('pong', message.payload, message.from);
        return;
      }
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

    if (this.hostId && message.from !== this.hostId) return;
    if (message.type === 'pong' && message.payload === this.pingSentAt) {
      const rtt = performance.now() - this.pingSentAt;
      if (rtt >= 0 && rtt < 10000) this.debug.rttMs = rtt;
      return;
    }
    if (message.type === 'closed') {
      void this.leave().then(() => this.onError('HOST_LEFT'));
      return;
    }
    if (message.type === 'snapshot' && this.isSnapshot(message.payload)) {
      const snapshot = message.payload;
      if (
        snapshot.host !== message.from ||
        snapshot.code !== this.roomCode ||
        !Number.isInteger(message.sequence) ||
        message.sequence! <= this.receivedSequence
      )
        return;
      if (!snapshot.players.some((p) => p.id === this.localSessionId)) return;
      this.hostId = message.from;
      this.receivedSequence = message.sequence!;
      this.state = snapshot;
      if (this.lastSnapshotAt)
        this.debug.snapshotIntervalMs = Date.now() - this.lastSnapshotAt;
      this.debug.snapshots++;
      this.remoteMotion.push(snapshot, performance.now());
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
        message.payload &&
        typeof message.payload === 'object' &&
        'code' in message.payload &&
        typeof message.payload.code === 'string'
          ? message.payload.code
          : 'CONNECTION_ERROR';
      if (this.status === 'CONNECTING') this.failConnect(code);
      else this.onError(code);
    }
  }

  private acceptJoin(message: PeerMessage): void {
    const game = this.localGame!;
    const payload = message.payload as Partial<JoinPayload> | undefined;
    // A returning participant must be restored before the phase/full-room guards.
    const existing = game.state.players.find((p) => p.id === message.from);
    if (existing) {
      existing.connected = true;
      this.lastSeen.set(message.from, Date.now());
      this.inputSequence.delete(message.from);
      game.inputs.delete(message.from);
      this.publishLocal(true);
      return;
    }
    if (game.state.phase !== 'LOBBY') {
      void this.sendPeer('error', { code: 'MATCH_STARTED' }, message.from);
      return;
    }
    if (game.state.players.length >= 4) {
      void this.sendPeer('error', { code: 'ROOM_FULL' }, message.from);
      return;
    }
    const nickname = this.cleanNickname(payload?.nickname);
    game.addPlayer(message.from, nickname);
    if (payload?.color && COLORS.includes(payload.color)) {
      game.setColor(message.from, payload.color);
    }
    this.lastInput.set(message.from, Date.now());
    this.lastSeen.set(message.from, Date.now());
    this.publishLocal(true);
  }

  private applyCommand(id: string, type: string, payload?: unknown): void {
    const game = this.localGame;
    if (!game) return;
    const player = game.state.players.find((p) => p.id === id);

    if (type === 'input' && this.validInput(payload)) {
      if (game.state.phase !== 'PLAYING') return;
      if (payload.stageRevision !== game.state.stageRevision) return;
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
    if (type === 'stage-ready' && typeof payload === 'number') {
      game.acknowledgeStage(id, payload);
      this.publishLocal(this.peerHost);
      return;
    }
    if (type === 'color' && typeof payload === 'string') {
      if (
        !COLORS.includes(payload as Color) ||
        !game.setColor(id, payload as Color)
      ) {
        if (id === this.localSessionId) this.onError('COLOR_UNAVAILABLE');
        else void this.sendPeer('error', { code: 'COLOR_UNAVAILABLE' }, id);
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
      typeof payload.phase === 'string' &&
      'grid' in payload &&
      Array.isArray(payload.grid) &&
      'stageRevision' in payload &&
      Number.isInteger(payload.stageRevision),
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
    return (
      value
        .replace(/[<>\x00-\x1f]/g, '')
        .trim()
        .slice(0, 16) || 'Rush'
    );
  }

  private makeCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    let code = 'BR-';
    for (const byte of bytes)
      code += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
    return code;
  }

  private startPeerWatch(): void {
    clearInterval(this.peerWatchTimer);
    this.peerWatchTimer = setInterval(() => {
      if (this.peerHost && this.localGame) {
        for (const p of [...this.localGame.state.players]) {
          if (p.id === this.id) continue;
          const elapsed = Date.now() - (this.lastSeen.get(p.id) || Date.now());
          if (elapsed > 6000) {
            p.connected = false;
            this.localGame.inputs.delete(p.id);
            this.localGame.acknowledgeStage(
              p.id,
              this.localGame.state.stageRevision,
            );
          }
          if (elapsed > 30000 && this.localGame.state.phase === 'LOBBY') {
            this.localGame.removePlayer(p.id);
            this.lastSeen.delete(p.id);
          }
        }
      } else if (this.subscribed) {
        this.pingSentAt = performance.now();
        void this.sendPeer('ping', this.pingSentAt);
      }
      if (
        !this.peerHost &&
        ['CONNECTED', 'RECONNECTING'].includes(this.status) &&
        this.lastSnapshotAt &&
        Date.now() - this.lastSnapshotAt > 6000
      ) {
        this.setStatus('RECONNECTING');
        void this.sendPeer('join', {
          nickname:
            this.state?.players.find((p) => p.id === this.localSessionId)
              ?.nickname || 'Rush',
        });
        if (Date.now() - this.lastSnapshotAt > 30000)
          void this.leave(true).then(() => this.onError('CONNECTION_LOST'));
      }
    }, 2000);
  }

  private async sendPeer(
    type: string,
    payload?: unknown,
    to?: string,
  ): Promise<void> {
    // Never let the SDK turn a disconnected stream into many REST requests.
    if (!this.channel || !this.subscribed) return;
    try {
      await this.channel.send({
        type: 'broadcast',
        event: 'room',
        payload: {
          type,
          from: this.localSessionId,
          to,
          payload,
          sequence: type === 'snapshot' ? ++this.snapshotSequence : undefined,
        } satisfies PeerMessage,
      });
    } catch {
      if (!this.intentional) this.setStatus('RECONNECTING');
    }
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
    const channel = this.channel;
    this.channel = null;
    this.subscribed = false;
    this.stopTicks();
    clearInterval(this.peerWatchTimer);
    this.localGame = null;
    this.state = null;
    this.remoteMotion.reset();
    if (channel && supabase)
      void supabase.removeChannel(channel).catch(() => {});
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
  stageReady(revision: number): void {
    if (
      this.state?.phase !== 'SYNCING' ||
      !this.state.pendingStagePlayers.includes(this.id)
    )
      return;
    if (performance.now() - this.lastReadyAt < 250) return;
    this.lastReadyAt = performance.now();
    this.send('stage-ready', revision);
  }

  async leave(preserveIdentity = false): Promise<void> {
    const wasActive = this.state !== null;
    this.intentional = true;
    clearTimeout(this.connectTimeout);
    this.connectTimeout = undefined;
    this.stopTicks();
    clearInterval(this.peerWatchTimer);
    this.peerWatchTimer = undefined;
    this.connectResolve = null;
    this.connectReject?.(new Error('CONNECTION_CANCELLED'));
    this.connectReject = null;

    const channel = this.channel;
    if (channel && this.localSessionId) {
      await this.sendPeer(this.peerHost ? 'closed' : 'leave');
    }
    if (this.roomCode && !preserveIdentity)
      sessionStorage.removeItem(`bombrush-peer:${this.roomCode}`);
    this.channel = null;
    if (channel && supabase)
      await supabase.removeChannel(channel).catch(() => {});

    this.localGame = null;
    this.localSessionId = '';
    this.localTicks = 0;
    this.lastSnapshotAt = 0;
    this.subscribed = false;
    this.hostId = '';
    this.roomCode = '';
    this.receivedSequence = -1;
    this.snapshotSequence = 0;
    this.lastSeen.clear();
    this.peerHost = false;
    this.lastInput.clear();
    this.inputSequence.clear();
    this.state = null;
    this.remoteMotion.reset();
    this.debug.rttMs = this.debug.snapshotIntervalMs = this.debug.snapshots = 0;
    this.setStatus('DISCONNECTED');
    if (wasActive) this.onDisconnect('');
  }
}

export const network = new NetworkSystem();
