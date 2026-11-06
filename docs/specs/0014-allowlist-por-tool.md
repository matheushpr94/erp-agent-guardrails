# Spec 0014: liberação de escrita por ferramenta

> Versão condensada e anonimizada da especificação usada em produção.

## Problema
Um kill-switch único é tudo ou nada. Liberar o cadastro de clientes não pode, por tabela, liberar baixa de parcelas.

## Decisão
Escrita exige **as duas** condições: o mestre `ERP_ESCRITA=habilitada` **e** a ferramenta nomeada em `ERP_ESCRITA_TOOLS`. A liberação é feita uma ferramenta por vez, em ondas ordenadas por reversibilidade.

## Critérios de aceite
- **AC-01** WHEN o mestre está desligado, THE SYSTEM SHALL bloquear tudo, independente da lista.
- **AC-02** WHEN a lista está vazia ou ausente, THE SYSTEM SHALL bloquear tudo (omissão nunca libera).
- **AC-03** WHEN a rota de escrita não tem ferramenta mapeada, THE SYSTEM SHALL bloqueá-la.
- **AC-04** WHEN a recusa acontece, THE SYSTEM SHALL dizer qual dos dois níveis barrou.
- **AC-05** WHEN a lista contém um nome que não é ferramenta de escrita, THE SYSTEM SHALL falhar o boot nomeando o erro.
- **AC-06** WHEN a ferramenta não está liberada, THE SYSTEM SHALL recusar já ao PROPOR, para o cliente não passar pelo ritual de confirmação e receber um erro no fim.
- **AC-07** THE SYSTEM SHALL manter três listas coerentes: rota→ferramenta (parede HTTP), classe→ferramenta (alçada) e o registry. O gate confere.
- **AC-08** WHEN existe tentativa sem desfecho ou protocolo pendente para a mesma ação, THE SYSTEM SHALL recusar repetir e mandar conferir no ERP ("não sei" não é "falhou").

## Gate
`npm run gate:escrita` e `npm run gate:integracao`.
