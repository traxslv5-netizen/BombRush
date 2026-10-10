# Estabilidade cooperativa — 9 de outubro de 2026

## Causas e correções

- Nickname: as capturas globais do teclado Phaser consumiam teclas de inputs HTML. O teclado de gameplay agora usa um único conjunto de listeners por cena, `event.code`, foco real do DOM e bloqueio para input/textarea/select/contenteditable e composição de texto. O Phaser continua sendo a engine.
- WASD: estado de teclas e ações pendentes atravessava menus/foco; o envio esperava o próximo intervalo. Direções e solturas são enviadas imediatamente; blur, foco editável e transições limpam controles. Teclas simultâneas usam a última direção pressionada.
- Fases/reconexão: faltavam confirmação de mapa carregado, versões de fase e ordenação dos snapshots. O reingresso era rejeitado por `MATCH_STARTED` antes de reconhecer o jogador existente. Agora a autoridade mantém uma revisão de fase, espera os clientes em `SYNCING`, descarta snapshots antigos e comandos da fase anterior e restaura a identidade/fase atual ao reconectar.
- Ciclo de vida: retorno ao menu, encerramento do host, cancelamento, timers, worker e canais são limpos; envio desconectado não deve gerar uma sequência de requisições REST. O relógio do host usa worker para reduzir efeitos da troca de aba. Salas antigas e novas usam versões separadas do protocolo.
- Apresentação: reinício também invalida o mapa, efeitos/tweens/entidades anteriores são limpos, HUD e overlay usam a fase atual. Foram removidos flashes de tela inteira das explosões e do boss.
- Publicação: o teste final no Pages encontrou dois deployments com layouts diferentes, causando 404 no worker e partida parada no início. Actions e publicação por branch agora usam o mesmo caminho `/BombRush/docs/`, preservam bundles antigos e publicam o worker. Falha ou bloqueio do worker ativa um relógio alternativo para não congelar a simulação.

## Arquivos principais

`InputSystem.ts`, `KeyboardState.ts`, `Focus.ts`, `main.ts`, `NetworkSystem.ts`, `SimulationClock.ts`, `GameScene.ts`, `Interface.ts`, `Game.ts`, `StageSystem.ts`, `BombRushRoom.ts`, `shared/src/types.ts`, testes de cooperação, configuração ESLint e workflow Pages.

## Evidência de testes

- 44 testes Vitest: aprovados. Incluem cinco arenas, spawns distintos/seguros, preservação de identidade/upgrades, confirmação de mapas com 2/3/4 jogadores, timeout, conclusão duplicada e reinício; integração com sockets Colyseus reais e três modos de falha do worker de simulação.
- Quatro contextos Chromium separados usando Supabase real: nickname `TRAX 2026`, espaço/Backspace/Ctrl+A/Home/End/Delete, WASD/setas/combinações, evento blur, foco editável, bombas, pronto/início, Stage 1 → 2 → 3 → 4 → 5, identidade na reconexão da Stage 3 por reload e queda do socket, snapshot atrasado, vitória/reinício, saída/host encerrado e duas sessões Solo sucessivas. Todos aprovados, sem erros de console capturados.
- Os testes de transição preparam objetivos e derrota do boss na autoridade para alcançar as condições de fim. Só a autoridade executa a transição; os quatro clientes recebem e renderizam o estado real pelo Supabase, sem refresh para mudar de fase. Isso testa sincronização; não equivale a uma campanha inteira concluída manualmente.
- Relatório automático local: `test-results/cooperative-browser.json`; capturas `test-results/coop-host-stage5.png` e `test-results/coop-guest-stage5.png`.
- Executar: iniciar `npm run dev:client -- --port 5174`, depois `npm run test:coop`. O runner exige as variáveis públicas do Supabase; não precisa de service-role. `npm test` é independente do serviço remoto.

## Limites reais

O Pages continua usando a simulação do módulo de servidor no navegador do host, com Supabase Realtime para transporte. Não foi contratado ou implantado um servidor dedicado. O host precisa manter o jogo aberto; ao sair, a sala encerra. A rota Colyseus existente permanece disponível e aceita `synchronizedStages: true` para confirmação de mapas. Jogadores existentes podem reconectar durante a campanha; novos participantes entram pelo lobby.

Latência zero, funcionamento offline no multiplayer e ausência absoluta de bugs não são garantias possíveis. Conexão, dispositivo do host, suspensão de abas/dispositivos e cotas do Supabase continuam afetando a sessão. Os testes locais com rede real não reproduzem todas as operadoras, regiões ou carga de várias salas simultâneas.
