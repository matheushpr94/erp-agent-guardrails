# Spec 0001: escrita no ERP só por proposta e confirmação

> Versão condensada e anonimizada da especificação usada em produção. Formato: critérios EARS nos itens críticos.

## Problema
Um agente de LLM que "paga essa conta" a partir de uma frase pode conciliar a fatura errada em silêncio, e o registro de auditoria fica coerente. Pedir no prompt para "sempre confirmar" é instrução, e instrução se esquece sob pressão de conversa.

## Decisão
Não existe ferramenta que escreva a partir de linguagem natural. Existem `propor_*` (montam o corpo, gravam a proposta, devolvem o texto) e **um** executor, `confirmar_acao(id)`.

## Impacto em dado de terceiro (obrigatório)
A contabilidade não é nossa. Cada classe de escrita declara o caminho de volta, que aparece **em toda proposta**, inclusive quando não há volta ("lançamento não se apaga por aqui; é pela tela do ERP").

## Critérios de aceite
- **AC-01** WHEN uma tool altera o ERP, THE SYSTEM SHALL anotá-la como não-readOnly; o boot falha se a anotação divergir da procedência do arquivo.
- **AC-02** WHEN o kill-switch mestre está desligado, THE SYSTEM SHALL recusar toda escrita na camada HTTP, sem depender da tool.
- **AC-03** WHEN um método ou rota de escrita não está mapeado, THE SYSTEM SHALL recusá-lo por ser desconhecido.
- **AC-04** WHEN o cliente responde, THE SYSTEM SHALL aceitar só afirmação explícita: pergunta, negação, hesitação ou outro pedido embutido não confirmam; "ok" sozinho não confirma.
- **AC-05** WHEN a proposta passa da janela, THE SYSTEM SHALL recusar a confirmação dizendo que venceu (e não "não encontrada").
- **AC-06** WHEN a confirmação é aceita, THE SYSTEM SHALL consumir a proposta antes de executar; refazer exige propor de novo.
- **AC-07** WHEN o ERP responde de forma assíncrona (protocolo), THE SYSTEM SHALL gravar na trilha o resultado final, não o "recebido".
- **AC-08** WHEN uma escrita sai, THE SYSTEM SHALL gravar na trilha a tentativa ANTES da chamada e o desfecho SEMPRE.

## Faixas de risco
| faixa | quando | portão |
|---|---|---|
| 1 | lançamento (só previsão) | "sim" |
| 2 | baixa, cadastro | "sim" + saldo antes/depois no texto |
| 3 | baixa acima do limite configurado | palavra exata, **digitada** |

Faixa mede o tamanho do estrago, não a reversibilidade: por isso o "como desfazer" aparece nas três.

## Gates
`npm run gate:escrita`, `npm run gate:proposta` (ambos com `--known-bad`).
