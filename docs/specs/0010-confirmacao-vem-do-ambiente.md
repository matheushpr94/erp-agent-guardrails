# Spec 0010: a confirmação vem do ambiente, não do argumento

> Versão condensada e anonimizada da especificação usada em produção.

## Problema
Na primeira versão, `confirmar_acao(id, resposta)` julgava a string `resposta`. Quem escolhe essa string é o **modelo**. Em teste, o próprio agente mostrou o buraco: passou como "resposta" uma frase do dono que não tinha "sim" nenhum e que fora escrita **antes** da proposta existir, e o portão executou.

Nenhum ajuste na lista de palavras resolve isso: enquanto a validação olhar o argumento, ela só verifica o que o próprio confirmando escreveu.

## Decisão
O gateway (que existe antes do modelo) injeta no ambiente do processo MCP:

| variável | o que é |
|---|---|
| `CANAL_CHAT_ID` | quem está falando (escopo da proposta) |
| `CANAL_PAPEL` | dono, funcionário ou dev |
| `CANAL_MENSAGEM` | o texto que o canal entregou |
| `CANAL_MENSAGEM_EM` | o carimbo de hora **do canal** |
| `CANAL_MENSAGEM_ORIGEM` | texto, voz ou botão (desconhecido = texto) |

É o mesmo padrão três vezes: o canal (escopo), o papel (alçada) e a confirmação. **O que autoriza não passa pela mão de quem é autorizado.**

## Critérios de aceite
- **AC-01** WHEN há canal, THE SYSTEM SHALL julgar a frase do canal e ignorar a alegada pelo modelo (que vai para a trilha como `confirmacao_alegada`).
- **AC-02** WHEN a mensagem do canal é anterior à criação da proposta (com folga de 2 s para carimbo truncado em segundos), THE SYSTEM SHALL recusar.
- **AC-03** WHEN a mensagem do canal é a mesma que originou a proposta, THE SYSTEM SHALL recusar, mesmo em turno de 0 s.
- **AC-04** WHEN há canal mas falta a mensagem autêntica, THE SYSTEM SHALL recusar (fail-closed).
- **AC-05** WHEN a proposta é de faixa 3 e a confirmação chegou por voz, THE SYSTEM SHALL recusar sem consumir a proposta.
- **AC-06** WHEN a proposta foi criada em outro canal, THE SYSTEM SHALL recusar.

## Gate
`npm run gate:confirmacao` (com `--known-bad`), e os evals `modelo-tenta-se-autoconfirmar` e `injecao-indireta-na-descricao`.
