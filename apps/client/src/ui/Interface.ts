import { network, type ConnectionStatus } from '../networking/NetworkSystem';
import { audio } from '../systems/AudioSystem';
import { settings, setVolume, type Settings } from '../systems/Settings';
import { svg } from './icons';
import { COLORS } from '../../../../shared/src/config/game.config';
import { STAGES } from '../../../../shared/src/config/stages.config';
import type { Color, Snapshot } from '../../../../shared/src/types';
const root = document.getElementById('interface')!;
const colorNames: Record<Color, string> = {
  red: 'Vermelho',
  blue: 'Azul',
  purple: 'Roxo',
  yellow: 'Amarelo',
};
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const icon = (name: string) => `<img src="/game/items/${name}.png" alt=""/>`;
let screen = '',
  selected: Color = 'red',
  paused = false,
  busy = false,
  autoSolo = false,
  lobbyKey = '',
  lastHud = '',
  lastBossHp = -1,
  lastEvent = 0;
let uiReady = false;
document.addEventListener('game-ready', () => {
  uiReady = true;
  const b = document.getElementById('start') as HTMLButtonElement | null;
  if (b && network.state) b.disabled = !canStart(network.state);
  trySolo();
});
const messages: Record<string, string> = {
  COLOR_UNAVAILABLE: 'Essa cor já foi escolhida. Selecione uma cor livre.',
  ROOM_NOT_FOUND: 'Não encontramos essa sala. Confira o código.',
  ROOM_FULL: 'A sala está completa, com quatro jogadores.',
  MATCH_STARTED: 'Essa aventura já começou. Aguarde uma nova sala.',
  INVALID_CODE: 'Use o código completo, no formato BR-XXXXXX.',
  CONNECTION_LOST:
    'A conexão foi perdida. Você pode criar ou entrar em outra sala.',
  AUTH_REQUIRED: 'Sua sessão expirou. Recarregue o jogo para entrar novamente.',
  AUTH_UNAVAILABLE:
    'Não foi possível criar sua sessão. Confira o acesso anônimo no Supabase.',
  SUPABASE_CONFIG_INCOMPLETE: 'A configuração do Supabase está incompleta.',
  PROFILE_ALREADY_IN_ROOM:
    'Este perfil já está nessa sala. Use outro perfil de navegador para o segundo jogador.',
};
function bind(id: string, action: () => void): void {
  document.getElementById(id)?.addEventListener('click', () => {
    audio.unlock();
    audio.play('ui_click');
    action();
  });
}
function logo(): string {
  return `<div class="game-logo" aria-label="BombRush"><span>BOMB</span><b>RUSH</b><i></i></div>`;
}
function ambient(): string {
  return `<div class="menu-world" aria-hidden="true"><img src="/game/maps/garden.png"/><div class="world-shade"></div>${Array.from({ length: 14 }, (_, i) => `<i style="--n:${i}"></i>`).join('')}</div>`;
}
function status(): string {
  return `<div id="connection" class="connection" data-state="${network.status}">${svg('network')}<span>${network.status === 'CONNECTED' ? 'CONECTADO' : network.status === 'RECONNECTING' ? 'RECONECTANDO' : 'BOMBRUSH v0.2'}</span></div>`;
}
function error(code: string): void {
  let node = document.getElementById('error');
  if (!node) {
    node = document.createElement('div');
    node.id = 'error';
    node.className = 'toast';
    node.setAttribute('role', 'status');
    root.append(node);
  }
  node.textContent =
    messages[code] ||
    'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
}
function colors(current: Color, players: Snapshot['players'] = []): string {
  return `<div class="color-picker" aria-label="Cor do personagem">${COLORS.map(
    (c) => {
      const owner = players.find((p) => p.color === c && p.id !== network.id);
      return `<button type="button" data-color="${c}" aria-label="${colorNames[c]}${owner ? ' ocupada' : ''}" aria-pressed="${c === current}" ${owner ? 'disabled' : ''} class="color-choice ${c} ${c === current ? 'selected' : ''}"><span></span>${owner ? svg('lock') : c === current ? svg('check') : ''}<small>${colorNames[c]}</small></button>`;
    },
  ).join('')}</div>`;
}
function bindColors(inLobby = false): void {
  root.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) =>
    b.addEventListener('click', () => {
      audio.play('ui_click');
      const color = b.dataset.color as Color;
      if (inLobby) network.send('color', color);
      else {
        selected = color;
        root.querySelectorAll('[data-color]').forEach((el) => {
          el.classList.toggle(
            'selected',
            (el as HTMLElement).dataset.color === color,
          );
          el.setAttribute(
            'aria-pressed',
            String((el as HTMLElement).dataset.color === color),
          );
        });
        const portrait = document.getElementById(
          'setup-portrait',
        ) as HTMLImageElement;
        if (portrait) portrait.src = `/game/players/${color}/idle_02.png`;
      }
    }),
  );
}
export function menu(message = ''): void {
  screen = 'menu';
  paused = false;
  autoSolo = false;
  document.body.className = 'menu';
  root.innerHTML = `${ambient()}<div class="menu-brand">${logo()}<p>ACENDA O PAVIO. ENTRE NA ARENA.</p></div><div class="menu-character"><img src="/game/players/red/idle_01.png" alt=""/><img class="friend" src="/game/players/blue/idle_02.png" alt=""/></div><nav class="main-menu" aria-label="Menu principal"><span class="overline">CAMPANHA DE ARENA / 1–4 JOGADORES</span><button id="play" class="menu-button primary">${svg('play')}<span>JOGAR<small>Uma aventura. Cinco arenas.</small></span>${svg('arrow')}</button><button id="multiplayer" class="menu-button">${svg('network')}<span>MULTIPLAYER<small>Junte a sua turma</small></span>${svg('arrow')}</button><button id="settings" class="menu-button">${svg('settings')}<span>CONFIGURAÇÕES</span></button><p id="error" role="status">${message ? esc(messages[message] || message) : ''}</p></nav><footer class="menu-footer"><span>WASD / SETAS <b>MOVER</b> &nbsp; ESPAÇO <b>BOMBA</b> &nbsp; E <b>REMOTE</b></span>${status()}</footer><div class="build-label">VERTICAL SLICE <b>02</b></div><div id="loading-status"></div>`;
  bind('play', () => playMenu());
  bind('multiplayer', () => playMenu(true));
  bind('settings', () => openSettings());
  document.getElementById('play')?.focus();
}
function playMenu(multiplayer = false): void {
  screen = 'play';
  document.body.className = 'menu';
  root.innerHTML = `${ambient()}<div class="sub-header">${logo()}<button id="back" class="icon-button">${svg('back')} VOLTAR</button></div><section class="choice-menu"><span class="overline">${multiplayer ? 'JOGUE JUNTO' : 'ESCOLHA SUA AVENTURA'}</span><h1>Todo pavio tem<br/>um começo.</h1><div class="mode-options">${multiplayer ? '' : `<button id="solo" class="mode-option"><img src="/game/players/red/placeBomb_01.png" alt=""/><span>SOLO<small>A campanha é toda sua</small></span>${svg('arrow')}</button>`}<button id="create-view" class="mode-option"><img src="/game/players/blue/idle_02.png" alt=""/><span>CRIAR SALA<small>Convide até três amigos</small></span>${svg('arrow')}</button><button id="join-view" class="mode-option"><img src="/game/players/purple/walk_02.png" alt=""/><span>ENTRAR NA SALA<small>Use o código da sua turma</small></span>${svg('arrow')}</button></div></section><footer class="menu-footer"><span>SEM CONTA. SEM COMPLICAÇÃO.</span>${status()}</footer>`;
  bind('back', () => menu());
  bind('solo', () => setup('solo'));
  bind('create-view', () => setup('create'));
  bind('join-view', () => setup('join'));
}
function setup(mode: 'solo' | 'create' | 'join'): void {
  screen = 'setup';
  root.innerHTML = `${ambient()}<div class="sub-header">${logo()}<button id="back" class="icon-button">${svg('back')} VOLTAR</button></div><section class="setup-screen"><div class="setup-art"><img id="setup-portrait" src="/game/players/${selected}/idle_02.png" alt="Personagem escolhido"/><div class="pedestal"></div><span>SEU LUGAR NA ARENA</span></div><form id="setup-form" class="setup-form"><span class="overline">${mode === 'solo' ? 'CAMPANHA SOLO' : mode === 'join' ? 'ENCONTRE SUA TURMA' : 'NOVA AVENTURA'}</span><h1>${mode === 'join' ? 'Entrar na sala' : mode === 'solo' ? 'Pronto para começar?' : 'Criar sala'}</h1>${mode === 'join' ? '<label for="room-code">CÓDIGO DA SALA</label><input id="room-code" placeholder="BR-XXXXXX" maxlength="9" required autocomplete="off"/>' : ''}<label for="nickname">SEU NICKNAME</label><input id="nickname" placeholder="Como vamos te chamar?" maxlength="16" value="${esc(localStorage.getItem('bombrush-name') || '')}" required autocomplete="nickname"/>${mode !== 'join' ? `<label>ESCOLHA SUA COR</label>${colors(selected)}<p class="private-note">${svg('lock')} SALA PRIVADA <span>Apenas convidados com o código</span></p>` : ''}<button class="primary" id="${mode === 'join' ? 'join' : 'create'}" type="submit">${mode === 'join' ? 'ENTRAR' : mode === 'solo' ? 'INICIAR AVENTURA' : 'CRIAR SALA'} ${svg('arrow')}</button><p id="error" role="status"></p><p class="setup-hint">${mode === 'join' ? 'Cada cor pertence a um jogador. Você escolhe a sua no lobby.' : 'Explosões atingem todos. Proteja a turma e cuide do seu pavio.'}</p></form></section><footer class="menu-footer"><span>BOMBRUSH / CAMPANHA 01</span>${status()}</footer>`;
  bind('back', () => playMenu());
  bindColors();
  document.getElementById('setup-form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    void connect(mode);
  });
}
async function connect(mode: string): Promise<void> {
  if (busy) return;
  const code =
    mode === 'join'
      ? (document.getElementById('room-code') as HTMLInputElement).value
          .trim()
          .toUpperCase()
      : undefined;
  if (code && !/^BR-[A-Z0-9]{6}$/.test(code)) {
    error('INVALID_CODE');
    return;
  }
  const name = (
    document.getElementById('nickname') as HTMLInputElement
  ).value.trim();
  if (!name) return;
  busy = true;
  audio.unlock();
  const submit = root.querySelector<HTMLButtonElement>('button[type=submit]')!;
  submit.disabled = true;
  submit.textContent = 'CONECTANDO...';
  localStorage.setItem('bombrush-name', name);
  try {
    autoSolo = mode === 'solo';
    await network.connect(name, code, selected);
    if (autoSolo) network.send('ready');
  } catch (e) {
    error(e instanceof Error ? e.message : 'CONNECTION_ERROR');
    submit.disabled = false;
    submit.innerHTML = `TENTAR NOVAMENTE ${svg('arrow')}`;
    autoSolo = false;
  } finally {
    busy = false;
  }
}
function canStart(s: Snapshot): boolean {
  return (
    uiReady &&
    s.players.length > 0 &&
    s.players.every((p) => p.ready && p.connected)
  );
}
function trySolo(): void {
  if (autoSolo && network.state?.phase === 'LOBBY' && canStart(network.state)) {
    autoSolo = false;
    network.send('start');
  }
}
function lobby(s: Snapshot): void {
  screen = 'lobby';
  document.body.className = 'lobby';
  const me = s.players.find((p) => p.id === network.id)!;
  root.innerHTML = `${ambient()}<div class="sub-header">${logo()}<button id="leave" class="icon-button">${svg('back')} SAIR DA SALA</button></div><section class="lobby-screen"><div class="lobby-heading"><div><span class="overline">PREPARE A TURMA</span><h1>Prontos para o <em>rush?</em></h1></div><button class="room-code" id="copy"><small>${svg('lock')} SALA PRIVADA</small><strong>${s.code}</strong><span>${svg('copy')} COPIAR CÓDIGO</span></button></div><div class="lobby-slots">${Array.from(
    { length: 4 },
    (_, i) => {
      const p = s.players[i];
      return `<article class="lobby-slot ${p?.color ?? 'vacant'} ${p?.ready ? 'is-ready' : ''}"><div class="slot-top"><span>PLAYER 0${i + 1}</span>${p?.id === s.host ? `<b>${svg('crown')} HOST</b>` : ''}</div><div class="slot-art"><img src="/game/players/${p?.color ?? COLORS[i]}/${p?.ready ? 'idle_02' : 'idle_01'}.png" alt="${p ? colorNames[p.color] : ''}"/><div class="pedestal"></div></div><h2>${p ? esc(p.nickname) : 'ESPAÇO LIVRE'}</h2><span class="slot-color">${p ? colorNames[p.color] : 'Aguardando jogador'}</span><div class="slot-status">${p ? `${svg(!p.connected ? 'network' : p.ready ? 'check' : 'clock')} ${!p.connected ? 'RECONECTANDO' : p.ready ? 'PRONTO' : 'PREPARANDO'}` : 'CONVIDE UM AMIGO'}</div>${p?.id === network.id ? '<span class="local-tag">SEU PERSONAGEM</span>' : ''}</article>`;
    },
  ).join(
    '',
  )}</div><div class="lobby-bottom"><div><span class="overline">SUA COR</span>${colors(me.color, s.players)}</div><div class="lobby-controls"><button id="ready" class="${me.ready ? 'secondary' : 'primary'}">${svg('check')} ${me.ready ? 'CANCELAR PRONTO' : 'ESTOU PRONTO'}</button>${s.host === network.id ? `<button id="start" class="primary" ${canStart(s) ? '' : 'disabled'}>COMEÇAR AVENTURA ${svg('arrow')}</button>` : '<p>O host inicia quando todos estiverem prontos.</p>'}<small>${uiReady ? 'Todos precisam confirmar, inclusive o host.' : 'Preparando os assets da arena...'}</small></div></div><p id="error" role="status"></p></section><footer class="menu-footer"><span>5 ARENAS <b>/</b> OBJETIVOS EM EQUIPE <b>/</b> FOGO AMIGO ATIVO</span>${status()}</footer>`;
  bind('leave', () => void network.leave());
  bind('ready', () => network.send('ready'));
  bind('start', () => network.send('start'));
  bindColors(true);
  bind('copy', () => {
    void navigator.clipboard
      .writeText(s.code)
      .then(() => {
        document.querySelector('#copy>span')!.innerHTML =
          `${svg('check')} CÓDIGO COPIADO`;
      })
      .catch(() => {
        document.querySelector('#copy>span')!.textContent =
          'Selecione o código para copiar';
      });
  });
}
function gameUI(): void {
  screen = 'game';
  lastHud = '';
  lastBossHp = -1;
  document.body.className = 'playing';
  root.innerHTML = `<div class="hud-layout"><section id="player-hud" class="hud-panel player-hud"></section><section class="stage-hud"><span id="stage-number"></span><h2 id="stage-name"></h2><div id="timer"></div></section><section id="objective-hud" class="hud-panel objective-hud"></section></div><div class="game-corner-tools"><button id="pause" class="icon-button" aria-label="Pausar">${svg('pause')}</button><button id="settings" class="icon-button" aria-label="Configurações">${svg('settings')}</button></div><div class="boss-hud" id="boss-hud"></div><footer class="game-footer"><span><kbd>WASD</kbd> MOVER <kbd>ESPAÇO</kbd> BOMBA <kbd>E</kbd> REMOTE</span><span id="objective-hint"></span>${status()}</footer><div id="overlay"></div><div id="event-toast" aria-live="polite"></div>`;
  bind('pause', togglePause);
  bind('settings', () => {
    if (!paused) togglePause();
    openSettings();
  });
}
function togglePause(): void {
  if (network.state?.phase !== 'PLAYING') return;
  paused = !paused;
  if (network.state.players.length === 1) network.send('pause', paused);
  document.body.classList.toggle('paused', paused);
  renderOverlay(network.state);
}
function renderOverlay(s: Snapshot): void {
  const node = document.getElementById('overlay');
  if (!node) return;
  let title = '',
    sub = '',
    action = '',
    kicker = '',
    image = 'idle_02';
  if (paused) {
    kicker = 'PAUSA';
    title = 'Respire. O pavio espera.';
    sub =
      s.players.length === 1
        ? 'A aventura está pausada.'
        : 'A partida continua para a sua turma.';
    action = `<button id="resume" class="primary">CONTINUAR ${svg('play')}</button><button id="pause-settings" class="secondary">CONFIGURAÇÕES</button><button id="exit-game" class="quiet">SAIR DA SALA</button>`;
  } else if (s.phase === 'LOADING') {
    kicker = 'PRÓXIMA PARADA';
    title = 'Garden Entry';
    sub = STAGES[0].objective.description;
  } else if (s.phase === 'STAGE_CLEAR') {
    kicker = 'STAGE COMPLETE';
    title =
      s.stage === 4 ? 'O coração da fábrica parou.' : 'Objetivo concluído!';
    sub =
      s.stage === 4
        ? 'A arena é de vocês.'
        : `A seguir: ${STAGES[s.stage + 1].name}`;
  } else if (s.phase === 'GAME_OVER' || s.phase === 'VICTORY') {
    kicker = s.phase === 'VICTORY' ? 'VICTORY' : 'GAME OVER';
    title =
      s.phase === 'VICTORY'
        ? 'A turma fez história.'
        : 'Todo rush merece revanche.';
    sub =
      s.phase === 'VICTORY'
        ? 'Cinco arenas conquistadas. Bomb Forge derrotado.'
        : 'Reorganize a equipe, escolha sua rota e tente novamente.';
    image = s.phase === 'VICTORY' ? 'idle_02' : 'hurt_01';
    action =
      s.host === network.id
        ? `<button id="restart" class="primary">JOGAR NOVAMENTE ${svg('arrow')}</button>`
        : '<p>Aguardando o host para reiniciar.</p>';
    action += '<button id="exit-game" class="quiet">VOLTAR AO MENU</button>';
  }
  const key = title + sub + action;
  if (node.dataset.key === key) return;
  node.dataset.key = key;
  node.innerHTML = title
    ? `<div class="scrim"><section class="result"><span class="overline">${kicker}</span><img src="/game/players/red/${image}.png" alt=""/><h1>${title}</h1><p>${sub}</p>${action}</section></div>`
    : '';
  bind('resume', togglePause);
  bind('pause-settings', () => openSettings());
  bind('restart', () => {
    paused = false;
    network.send('restart');
  });
  bind('exit-game', () => void network.leave());
}
function openSettings(): void {
  if (document.getElementById('settings-dialog')) return;
  const d = document.createElement('div');
  d.id = 'settings-dialog';
  d.className = 'scrim';
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-modal', 'true');
  d.setAttribute('aria-label', 'Configurações');
  d.innerHTML = `<section class="settings-box"><span class="overline">DO SEU JEITO</span><h1>Configurações</h1>${(['master', 'music', 'sfx'] as const).map((key, i) => `<label for="volume-${key}">${['VOLUME GERAL', 'MÚSICA', 'EFEITOS'][i]}<output id="value-${key}">${Math.round(settings[key] * 100)}%</output></label><input id="volume-${key}" data-volume="${key}" type="range" min="0" max="100" value="${settings[key] * 100}"/>`).join('')}<button id="fullscreen" class="secondary">${svg('fullscreen')} ${document.fullscreenElement ? 'SAIR DA TELA CHEIA' : 'TELA CHEIA'}</button><p id="settings-note"></p><button id="settings-close" class="primary">CONCLUÍDO ${svg('check')}</button></section>`;
  root.append(d);
  d.querySelectorAll<HTMLInputElement>('[data-volume]').forEach((input) =>
    input.addEventListener('input', () => {
      const key = input.dataset.volume as keyof Settings;
      setVolume(key, Number(input.value) / 100);
      document.getElementById(`value-${key}`)!.textContent = `${input.value}%`;
      audio.unlock();
    }),
  );
  bind('fullscreen', () => {
    const action = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    void action
      .then(() => {
        document.getElementById('fullscreen')!.innerHTML =
          `${svg('fullscreen')} ${document.fullscreenElement ? 'SAIR DA TELA CHEIA' : 'TELA CHEIA'}`;
      })
      .catch(() => {
        document.getElementById('settings-note')!.textContent =
          'Tela cheia indisponível neste navegador.';
      });
  });
  bind('settings-close', () => d.remove());
  document.getElementById('settings-close')?.focus();
}
export function updateUI(s: Snapshot): void {
  if (s.phase !== 'PLAYING' && paused) {
    paused = false;
    document.body.classList.remove('paused');
  }
  if (s.phase === 'LOBBY') {
    const key =
      JSON.stringify(
        s.players.map((p) => [p.id, p.color, p.ready, p.connected]),
      ) +
      s.host +
      uiReady;
    if (screen !== 'lobby' || lobbyKey !== key) {
      lobbyKey = key;
      lobby(s);
    }
    trySolo();
    return;
  }
  if (screen !== 'game') gameUI();
  const p = s.players.find((p) => p.id === network.id);
  if (!p) return;
  const seconds = Math.ceil(s.remaining),
    signature = JSON.stringify([
      p.nickname,
      p.color,
      p.lives,
      p.maxBombs,
      p.activeBombs,
      p.blastRange,
      p.speed,
      p.canKick,
      p.hasRemote,
      p.hasShield,
      s.stage,
      seconds,
      s.objective.current,
      s.objective.complete,
      s.enemies.filter((e) => e.alive).length,
      s.exit.open,
      s.transitionAt ? Math.ceil(s.transitionAt - s.time) : 0,
    ]);
  if (signature !== lastHud) {
    lastHud = signature;
    document.getElementById('player-hud')!.innerHTML =
      `<div class="portrait ${p.color}"><img src="/game/players/${p.color}/idle_01.png" alt=""/></div><div class="player-details"><strong>${esc(p.nickname)}</strong><div class="lives">${Array.from({ length: 3 }, (_, i) => svg('life', i < p.lives ? 'filled' : 'empty')).join('')}</div><div class="stats"><span>${icon('bomb_up')}<b>${p.maxBombs - p.activeBombs}/${p.maxBombs}</b></span><span>${icon('fire_up')}<b>${p.blastRange}</b></span><span>${icon('speed_up')}<b>${Math.round((p.speed - 3.65) / 0.4) + 1}</b></span></div></div><div class="powers">${[
        ['kick', p.canKick],
        ['remote', p.hasRemote],
        ['shield', p.hasShield],
      ]
        .map(
          ([name, active]) =>
            `<span title="${name}" class="${active ? 'active' : ''}">${icon(String(name))}</span>`,
        )
        .join('')}</div>`;
    document.getElementById('stage-number')!.textContent =
      `STAGE 0${s.stage + 1} / 05`;
    document.getElementById('stage-name')!.textContent = s.stageName;
    document.getElementById('timer')!.innerHTML =
      `${svg('clock')} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const objectiveIcon = {
      collect_keys: 'key',
      activate_totems: 'totem',
      destroy_cores: 'core',
      collect_crystals: 'crystal',
      defeat_boss: 'core',
    }[s.objective.type];
    document.getElementById('objective-hud')!.innerHTML =
      `<span class="overline">OBJETIVO DA EQUIPE</span><div>${svg(objectiveIcon)}<strong>${s.objective.label}</strong><b>${s.objective.current}<small> / ${s.objective.target}</small></b></div><footer><span>${svg('enemy')} INIMIGOS <b>${s.enemies.filter((e) => e.alive).length}</b></span><span class="${s.objective.complete ? 'complete' : ''}">${s.objective.complete ? 'CONCLUÍDO' : 'EM ANDAMENTO'}</span></footer>`;
    document.getElementById('objective-hint')!.textContent = s.exit.open
      ? s.transitionAt
        ? `Reunindo a turma: ${Math.max(0, Math.ceil(s.transitionAt - s.time))}s`
        : 'Portal aberto. Siga o marcador na arena.'
      : s.objective.description;
  }
  const boss = document.getElementById('boss-hud')!;
  boss.hidden = !s.boss;
  if (s.boss) {
    boss.dataset.phase = String(s.boss.phase);
    if (lastBossHp !== s.boss.hp) {
      boss.innerHTML = `${svg('core')}<div><header><strong>BOMB FORGE</strong><span>${['PHASE I', 'PHASE II', 'RAGE'][s.boss.phase]} <b>${s.boss.hp}/${s.boss.maxHp}</b></span></header><div class="boss-track"><i style="width:${(100 * s.boss.hp) / s.boss.maxHp}%"></i></div></div>`;
      if (lastBossHp > s.boss.hp) {
        boss.classList.remove('hit');
        void boss.offsetWidth;
        boss.classList.add('hit');
      }
      lastBossHp = s.boss.hp;
    }
  }
  for (const e of s.events)
    if (e.id > lastEvent) {
      lastEvent = e.id;
      if (e.kind === 'pickup') {
        document.getElementById('player-hud')!.classList.remove('pickup');
        requestAnimationFrame(() =>
          document.getElementById('player-hud')?.classList.add('pickup'),
        );
      }
      if (e.kind === 'exit_reveal' || e.kind === 'objective_pickup') {
        const toast = document.getElementById('event-toast')!;
        toast.textContent =
          e.kind === 'exit_reveal' ? 'PORTAL ABERTO' : 'OBJETIVO ATUALIZADO';
        toast.classList.remove('show');
        void toast.offsetWidth;
        toast.classList.add('show');
      }
    }
  renderOverlay(s);
  connection(network.status);
}
function connection(value: ConnectionStatus): void {
  const node = document.getElementById('connection');
  if (!node) return;
  const text =
    value === 'RECONNECTING'
      ? 'RECONECTANDO...'
      : value === 'CONNECTED'
        ? network.state?.persistence === 'error'
          ? 'PROGRESSO NÃO SALVO'
          : network.state?.persistence === 'online'
            ? 'ONLINE / PROGRESSO SALVO'
            : 'CONECTADO / SESSÃO LOCAL'
        : value === 'CONNECTING'
          ? 'CONECTANDO...'
          : 'BOMBRUSH v0.2';
  if (
    node.dataset.state !== value ||
    node.querySelector('span')?.textContent !== text
  ) {
    node.dataset.state = value;
    node.innerHTML = `${svg('network')}<span>${text}</span>`;
  }
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    e.preventDefault();
    const settings = document.getElementById('settings-dialog');
    if (settings) {
      settings.remove();
      return;
    }
    if (screen === 'game') togglePause();
    else if (screen === 'setup') playMenu();
    else if (screen === 'play') menu();
    return;
  }
  if (
    !['ArrowUp', 'ArrowDown'].includes(e.code) ||
    e.target instanceof HTMLInputElement
  )
    return;
  if (screen === 'game' && !paused) return;
  const scope = document.getElementById('settings-dialog') ?? root;
  const buttons = Array.from(
    scope.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
  ).filter((b) => b.offsetParent !== null);
  if (!buttons.length) return;
  e.preventDefault();
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[
    (i + (e.code === 'ArrowDown' ? 1 : buttons.length - 1) + buttons.length) %
      buttons.length
  ].focus();
});
network.onSnapshot = updateUI;
network.onStatus = connection;
network.onError = error;
network.onDisconnect = (reason) => {
  lastEvent = 0;
  lobbyKey = '';
  menu(reason);
};
