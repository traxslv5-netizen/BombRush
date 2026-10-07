# BombRush v0.2

Campanha de arena para **1–4 jogadores**, com quatro objetivos distintos e a arena de Bomb Forge. Preserva Phaser 4, TypeScript, Vite, Colyseus e as animações dos sprites fornecidos. Colyseus decide o gameplay; Supabase armazena identidade, salas, histórico, estatísticas e progresso.

## Executar

Requer Node.js 22+ (validado com Node 24), npm e navegador com WebGL.

```sh
npm install
npm run dev
```

Abra **http://localhost:5173**. O comando inicia cliente e servidor; Ctrl+C encerra ambos. O servidor usa a porta **2567**. Os assets preparados estão incluídos. O cliente tem HMR; após editar o servidor, reinicie o comando, ou use `npm run dev:server` (watch) e `npm run dev:client` em dois terminais.

### Dois ou quatro jogadores

1. Primeiro navegador: **Jogar → Criar sala**, informe nickname e cor. Copie o código `BR-XXXXXX` no lobby.
2. Segundo navegador: **Multiplayer → Entrar na sala**, informe o código e outro nickname.
3. Escolha uma cor livre. Cores ocupadas ficam bloqueadas; o servidor também rejeita conflitos com `COLOR_UNAVAILABLE`.
4. **Todos, inclusive o host**, clicam em **Estou pronto**. Trocar de cor remove o estado de pronto.
5. O host seleciona **Começar aventura**. Repita a entrada para até quatro jogadores.

Em **Jogar → Solo**, confirmação e início são automáticos. Com Supabase ativo, use perfis de navegador distintos ou uma janela anônima: abas normais compartilham a mesma identidade de Auth.

Na rede local, use `http://IP-DO-SERVIDOR:5173`; as portas 5173 e 2567 precisam estar acessíveis. O WebSocket usa o hostname da página. Para alterar a porta, configure `COLYSEUS_PORT` e `VITE_SERVER_URL` juntos.

## Supabase

Sem banco, o jogo funciona e o HUD informa **SESSÃO LOCAL**, sem persistência. Para habilitar:

1. Abra seu projeto Supabase.
2. No **SQL Editor**, execute todo `supabase/schema.sql` como administrador. Cria seis tabelas, índices, RLS e funções transacionais; pode ser executado novamente.
3. Habilite **Anonymous Sign-Ins** em Authentication. Isso fornece um UUID verificável sem exigir formulário de cadastro.
4. Copie `.env.example` para `.env` na raiz e preencha:

```dotenv
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_ANON_PUBLICA
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=SUA_CHAVE_SERVICE_ROLE_PRIVADA
COLYSEUS_PORT=2567
VITE_SERVER_URL=ws://localhost:2567
```

5. Reinicie `npm run dev`. Na rede local, deixe `VITE_SERVER_URL` vazio para usar o hostname atual ou informe o endereço acessível do servidor.
6. Crie uma sala e termine uma partida. Confira os registros no banco. Quando todos saem durante a campanha, registra-se abandono.

**Service role exclusivamente no servidor, nunca com prefixo `VITE_`.** `.env` está no gitignore. Nenhuma chave real está no código. As variáveis `VITE_` são públicas e incorporadas ao build. Em HTTPS, configure `VITE_SERVER_URL=wss://seu-servidor` e TLS no proxy.

| Tabela          | Dados                                                                              |
| --------------- | ---------------------------------------------------------------------------------- |
| profiles        | UUID ligado a auth.users, nickname, datas                                          |
| rooms           | UUID interno, código único, host, status, fase, limite                             |
| room_players    | Identidade, nickname, cor, ready, conexão; unicidade por jogador e por cor na sala |
| matches         | Início, fim, resultado e fase alcançada                                            |
| match_players   | Kills de jogadores, mortes, itens, mobs derrotados e dano no boss                  |
| player_progress | Maior fase, partidas, vitórias e bosses derrotados                                 |

O servidor valida o token com `auth.getUser`. RLS limita leitura ao próprio perfil/histórico/progresso e à sala da qual o usuário participa. O cliente pode editar seu nickname; não escreve resultados, salas ou estatísticas. `sync_room_members` troca o roster atomicamente. `finish_match` grava resultados e progresso em transação idempotente: repetir não duplica vitórias.

Escritas são serializadas com três tentativas. Falhas não interrompem o gameplay; o HUD mostra **PROGRESSO NÃO SALVO**. O histórico persiste, mas a simulação da partida continua em memória; reiniciar o servidor não retoma a arena.

**Validação:** schema, restrições, idempotência e RLS foram executados em PostgreSQL local via PGlite. Não há credenciais configuradas, portanto o acesso a um Supabase hospedado ainda não foi validado. O teste local fornece somente as roles/funções do Auth e omite a extensão opcional pgcrypto; gen_random_uuid é nativo nesse PostgreSQL.

## Controles e regras

| Ação           | Teclado              | Gamepad padrão     |
| -------------- | -------------------- | ------------------ |
| Mover          | WASD ou setas        | Analógico esquerdo |
| Bomba          | Espaço               | Botão 0 / A        |
| Detonar Remote | E                    | Botão 1 / B        |
| Pausa          | Esc ou botão na tela | Teclado            |
| Navegar menus  | Setas, Tab e Enter   | Teclado            |

Movimento contínuo em quatro direções, priorizando a direção apertada mais recentemente. Assistência suave de corredor configurável por `GRID_ASSIST_DISTANCE` e `GRID_ASSIST_STRENGTH` em `shared/src/config/player.config.ts`. Colisões usam a área dos pés e passos curtos, evitando atravessar paredes em frames grandes.

Bomba: o dono sai enquanto há sobreposição geométrica; ao sair completamente, `ownerCanPass` torna-se falso e bloqueia a volta. Não há prazo fixo de atravessamento. Outros jogadores/inimigos já colidem. Kick para antes de obstáculos, jogadores, inimigos e boss.

Pavio de 2,5 s. Explosões em cruz param em parede, água, primeiro bloco ou núcleo e causam reação em cadeia. **Fogo amigo ativo.** Três vidas, respawn em dois segundos quando houver vidas, invulnerabilidade breve e Shield absorvendo um impacto. Aliados eliminados retornam com uma vida ao avançar de fase.

Itens: Bomb Up, Fire Up, Speed Up, Kick, Remote e Shield. Limites e balanceamento estão nos configs. Remote respeita a capacidade de bombas; bombas de um dono morto voltam a ter pavio e sair definitivamente remove suas bombas.

**Solo:** pausa congela o servidor. **Multiplayer:** Esc abre somente seu overlay e interrompe seus inputs; a partida continua. Volume geral, música sintetizada, efeitos e fullscreen funcionam. Volumes persistem no navegador.

## Campanha

| Fase             | Objetivo                                                    | Mecânicas                                                    |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| Garden Entry     | 2 fragmentos de chave nos blocos marcados e eliminar slimes | Introdução, ataques próximos com aviso                       |
| Flooded Garden   | 3 comportas; permanecer perto por 1,5 s                     | Rios, pontes, dash telegrafado do Wind-Up                    |
| Furnace District | 3 Bomb Cores, cada um com 2 impactos                        | Lava, vapor com aviso, projéteis do Fire Spirit              |
| Frozen Labyrinth | Libertar e recolher 3 Energy Crystals                       | Labirinto, gelo, Ghost atravessando breakables em intervalos |
| Bomb Forge       | Derrotar o boss                                             | Slam, linhas, bombas, reforços limitados e vents no rage     |

Cada mapa define spawns, objetivo, decoração e exitCandidates. O servidor escolhe uma saída alcançável aleatória, oculta até completar o objetivo. Todos veem a mesma saída. Todos os vivos conectados podem entrar, ou alguém permanece nela por três segundos para reunir a turma. Os layouts são autorais; somente a escolha da saída e os drops variam.

Boss: 100 HP solo, escala **1 / 1,2 / 1,4 / 1,6** para 1–4 jogadores. Fases acima de 65%, entre 65–30% e abaixo de 30%. Explosões válidas causam 10 de dano, com proteção contra repetições pela mesma chama. Os ataques têm aviso. Morte leva a **Stage Complete → Victory**. Vitória/derrota permitem reinício pelo host ou saída ao menu.

## Organização

```text
apps/client/src/
  scenes/          Phaser, interpolação, efeitos
  animations/      Animações originais preservadas
  systems/         Input, áudio, settings, apresentação das arenas
  networking/      Colyseus e identidade Supabase
  ui/              Menu, lobby, HUD, resultados, SVG próprios
apps/server/src/
  rooms/           Salas, cores, ready, validação, reconexão
  state/           Estado autoritativo
  systems/         Colisões, bombas, inimigos, objetivos, boss
  persistence/     Auth, metadata e estatísticas Supabase
shared/src/
  gameplay/        Movimento e colisões compartilhados
  config/          Balanceamento e layouts
  types.ts         Contrato dos snapshots
supabase/schema.sql
assets/source/     Dez sheets originais preservados
assets/game/       Sprites RGBA e pisos extraídos
```

## Comandos e validação

```sh
npm run dev          # Cliente + servidor
npm run dev:client   # Somente cliente
npm run dev:server   # Autoridade com watch
npm run build        # TypeScript estrito + builds
npm start            # Servidor compilado
npm test             # Gameplay, sockets reais e PostgreSQL
npm run lint         # ESLint
npm run format       # Prettier
npm run assets       # Reprocessa os sheets originais
```

Cliente compilado: `dist/client`, servido por hospedagem estática. Autoridade: `dist/server/index.js`, com dependências de node_modules. Esta versão não foi publicada na internet.

Simulação a 30 Hz, snapshots a 15 Hz, até 65 mensagens/s por jogador. Inputs possuem sequência, formato validado e expiram em 400 ms. O cliente interpola e extrapola brevemente a posição local usando a mesma colisão; acertos, drops e objetivos são decididos pelo servidor. HUD atualiza quando valores mudam. Efeitos temporários e sprites de projéteis têm pools limitados.

Salas privadas bloqueiam novas entradas após iniciar. Uma queda reserva identidade/cor por **12 segundos** e há tentativas automáticas de reconexão. Após o prazo remove-se o jogador. Saída voluntária é imediata; a liderança migra quando o host sai. Recarregar a página ou reiniciar o servidor não recupera a campanha.

Com dev server ativo:

```sh
npx playwright install chromium
npm run test:browser
npm run test:visual
```

`test:browser` usa dois contextos reais: criar/entrar com código, cores/ready, movimento por teclado, bomba sincronizada, reconexão, pausa e saída. Capturas e relatório ficam em `test-results`.

`test:visual` usa **fixtures de renderização** para as cinco arenas e resoluções 1920×1080, 960×540 e 390×844, além de volume/fullscreen. Essas imagens não representam uma campanha jogada manualmente. A campanha completa e Victory são verificadas na simulação, e o multiplayer é verificado por sockets reais.

Testes essenciais cobrem paredes, owner grace, grid assist, reação em cadeia, blocos/drops, itens, Kick/Remote/Shield, saídas alcançáveis, quatro objetivos, hazards, telegraphs, reforços do boss, campanha, quatro clientes, exclusividade de cor, ready do host, sincronização de mobs/explosões/objetivos, reconexão e RLS/idempotência.

## Limites da demonstração

- Sem controles touch ou remapeamento. O layout adapta-se; interação exige teclado/gamepad.
- Gelo visual sem inércia adicional. As poses para cima reutilizam as animações disponíveis; esquerda usa espelhamento.
- Sem retomada de campanha após restart do servidor.
- Rede validada localmente; latência de internet, escala e benchmark de 60 FPS em hardware variado ainda precisam de medição.
- Balanceamento inicial; testes automatizados não substituem playtests humanos prolongados.
