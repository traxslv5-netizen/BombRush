# Movimento remoto — 10/10/2026

## Causa e correção

O Pages usa a simulação `Game` no navegador do host e transporte Supabase Realtime. Colyseus continua no projeto, mas não é o transporte do frontend publicado. A simulação roda a 30 Hz; snapshots de campanha usam 15/10/7,5 Hz para 2/3/4 participantes. Aumentar a taxa prejudicaria a margem de mensagens do serviço.

O render perseguia somente o snapshot mais recente, com suavização exponencial de 48 ms. Entre pacotes de 67–133 ms, a velocidade caía quase a zero e subia novamente quando chegava outra posição. Não havia histórico temporal. O sprite já era reutilizado e a animação já tinha proteção contra reinício; esses mecanismos foram preservados.

`RemoteMotion.ts` mantém até 32 amostras por jogador e interpola posições e estados de animação numa linha do tempo atrasada. O relógio de apresentação avança por tempo decorrido, com pequenos ajustes de velocidade para absorver jitter. A margem adapta-se à frequência e à variação de chegada: normalmente 100 ms com dois jogadores e aproximadamente 157–180 ms com quatro. Limite: 180 ms. Não há extrapolação através de paredes ou durante perda de conexão.

O próprio jogador continua usando a previsão e colisão locais existentes. A escolha é por `network.id`, sem tratamento especial para P1/P2. O histórico é descartado por sala/revisão de fase; respawn, conexão, morte e correções maiores que três tiles reinicializam a posição. A retomada depois de suspensão longa do render ajusta o relógio imediatamente. O movimento cardinal e a prioridade de teclas combinadas permanecem iguais.

RTT e intervalo de snapshots ficam em `network.debug`, sem HUD extra. O RTT é medido nos convidados por ping/pong do heartbeat de dois segundos; zero no host significa sem medição, não latência zero. O buffer não cria timers/listeners. A visão remota é reutilizada entre frames, evitando a cópia de cada jogador remoto por frame.

## Arquivos

- `apps/client/src/networking/RemoteMotion.ts`: histórico, interpolação, resets.
- `apps/client/src/networking/NetworkSystem.ts`: alimentação do histórico e diagnóstico RTT.
- `apps/client/src/scenes/GameScene.ts`: posição renderizada por frame, separação local/remoto.
- `tests/remote-motion.test.ts`: regressões determinísticas com jitter, pausas e taxas de 10 a 200 FPS.
- `tools/motion-browser.mjs` e `tools/pages-motion-smoke.mjs`: medições com clientes reais e smoke do pacote público.
- `docs/assets`, `docs/index.html`, `index.html`: publicação pelo fluxo existente, com hash Vite.

## Medições

Dois contextos Chromium, rede Supabase real, 20,8 segundos de movimento contínuo por participante: coeficiente de variação da velocidade visual caiu de 0,381 para 0,049 (P1 visto por P2) e de 0,192 para 0,019 (P2 visto por P1). RTT observado: aproximadamente 121 ms; buffer de 100 ms.

Quatro clientes: cada jogador foi controlado por 20,8 segundos e medido pelos outros três. Nas 12 combinações, a variação caiu 62–86% frente à suavização antiga calculada sob os mesmos pacotes. Um convidado recebeu atraso adicional de 60–85 ms. Sprites permaneceram estáveis; nenhum erro de console capturado na rodada completa. Valores não representam todas as conexões ou dispositivos.

O fixture de medição abre uma área e protege os personagens apenas no host de teste; movimento/input/transportes continuam reais. A resolução do raster de teste é reduzida para quatro contextos de WebGL por software no mesmo computador. Isso não altera coordenadas, colisão ou frequência de simulação e não existe no build de produção. A equivalência entre FPS também é verificada em testes determinísticos.

Build, lint e 54 testes automatizados aprovados. Evidências locais: `test-results/motion-two-clients.json`, `test-results/motion-browser.json` e `test-results/motion-rows-*.json`.

A regressão cooperativa com quatro clientes também passou: nickname, WASD/setas/combinações, foco/blur, bomba replicada, menus, quatro transições até Stage 5, rejeição de snapshot atrasado, reconexão por reload e socket na Stage 3, vitória/reinício, encerramento e duas sessões solo. Objetivos são preparados na autoridade para testar transições; não se trata de campanha integral jogada manualmente. Console sem erros.

Internet continua tendo latência. A arquitetura depende do host aberto; suspensão do dispositivo e indisponibilidade do serviço não são eliminadas por interpolação.
