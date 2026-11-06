# LGPD por design: modelo para um agente que toca dado de terceiro

> Modelo genérico, sem nomes. Na versão em produção, estes documentos existem preenchidos e foram tratados com o cliente; aqui ficam como **estrutura** reutilizável.

Quando um agente de LLM opera o ERP de uma empresa, quem contrata é **controlador** dos dados (de clientes e fornecedores dela) e quem opera o agente é **operador**. O agente lê nomes, documentos, e-mails e valores de terceiros que nunca falaram com você.

## O que o código já faz (minimização por construção)
| decisão | onde |
|---|---|
| rastro de **leitura** guarda rota, filtro e contagem, nunca o conteúdo | `src/auditoria/leitura.ts` |
| trilha de **escrita** guarda o necessário para desfazer (estado anterior, corpo, frase do pedido) | `src/auditoria/registro.ts` |
| arquivos de trilha, propostas e tokens com permissão 0600 | idem, `src/auth/token-store.ts` |
| nenhuma cópia da base: cada pergunta consulta o ERP na hora | `src/tools/leitura.ts` |
| sem treino de modelo com dado do cliente | decisão contratual; o repositório não tem pipeline de treino |
| seed ficticio, documentos com DV inválido | `mock-erp/seed.ts`, `npm run documentos` |

## Os quatro documentos (modelos nesta pasta)
1. [`01-contrato-operador.md`](01-contrato-operador.md): papéis, finalidade, suboperadores, incidentes.
2. [`02-ropa.md`](02-ropa.md): registro das operações de tratamento.
3. [`03-aviso-aos-titulares.md`](03-aviso-aos-titulares.md): texto curto para o controlador publicar.
4. [`04-runbook-eliminacao.md`](04-runbook-eliminacao.md): como atender um pedido de eliminação, inclusive nas trilhas.

Não é parecer jurídico. É o mínimo para a conversa com o jurídico começar do lugar certo.
