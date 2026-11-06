# `allowedTools` não restringe: o que medimos ao reduzir a superfície de um agente

> Artigo curto. Contexto: um agente de LLM que atende um cliente externo e opera o ERP dele. A primeira versão rodava em cima de um CLI de agente de uso geral, em modo headless, com flags de ferramenta. Esta versão pública usa a API diretamente e não depende disso, mas a lição vale para qualquer harness de agente.

## A suposição errada

A ideia era simples: o agente só deveria enxergar as ferramentas do servidor MCP do ERP. Nada de shell, nada de arquivo, nada de web. A flag óbvia era a de **ferramentas permitidas**, com o padrão `mcp__erp__*`.

Subimos o agente assim e pedimos: *"liste as ferramentas que você tem"*. A resposta trouxe shell, leitura e escrita de arquivo, busca no disco, subagentes e agendador. E **nenhuma** ferramenta do ERP.

**A lista de permitidas não é uma lista branca.** Ela **pré-aprova** (dispensa o pedido de permissão) o que casar com o padrão. Todo o resto continua existindo.

## O que restringe de fato

A lista de **negação** remove a ferramenta do conjunto. Só que lista de negação tem uma fragilidade inerente: você precisa saber o nome de tudo que quer tirar. Na primeira tentativa negamos o óbvio (shell, leitura/escrita de arquivo, busca, fetch de URL) e sobraram:

- uma ferramenta de **monitoramento de processo que executa comando de shell**, ou seja, um shell com outro nome;
- ferramentas de **agendamento** (criar/listar/apagar tarefas futuras) e de disparo remoto.

A lista final verificada tinha **41 nomes**. Cada atualização do CLI pode trazer uma ferramenta nova, que entra **liberada por padrão**.

## As duas flags são complementares

Segundo achado, logo depois: com **só** a lista de negação, o agente enxerga as ferramentas do MCP mas **não consegue chamá-las**. Elas exigem aprovação, e em modo headless não há quem aprove. Resposta literal: *"as buscas foram bloqueadas por falta de permissão"*.

| flag | o que faz de verdade |
|---|---|
| negação | **remove** a ferramenta do conjunto |
| permitidas | **pré-aprova** o que sobrou, para rodar sem prompt |

O primeiro teste não pegou isso porque só pedia a lista, nunca chamava nada. **Listar e executar são caminhos diferentes**, e um teste que só verifica o primeiro passa com o segundo quebrado. A verificação canônica passou a ter dois passos:

1. *"liste suas ferramentas"* → só as do ERP;
2. *"qual meu saldo?"* → um número de verdade, não um erro de permissão.

## O que isso mudou no desenho

1. **Teste de superfície a cada atualização do harness.** Lista de negação envelhece; o teste dos dois passos vira rotina.
2. **Segunda barreira fora do agente:** usuário de sistema sem privilégios, só com o próprio workspace. Se um dia alguém liberar shell "só para depurar", o raio de alcance é a casa desse usuário.
3. **Nesta versão pública, a superfície é mínima por construção.** O agente (`agente/agente.ts`) chama a API da Anthropic e entrega ao modelo **exatamente** as ferramentas que o servidor MCP lista (hoje 10). Não há o que negar, porque nada além disso foi oferecido.
4. **A escrita não depende da superfície.** Mesmo com a superfície certa, o modelo pode escolher mal. Por isso a escrita passa por propose/confirm, com a confirmação vinda do canal (ver o README). A superfície mínima reduz o que o agente *pode tentar*; o propose/confirm decide o que *acontece*.

## Resumo

- Em harness de agente, "permitir" costuma significar "não perguntar", não "só isto".
- Teste a superfície pelos dois caminhos: listar **e** executar.
- Prefira harness em que você entrega a lista de ferramentas (API/SDK) a harness em que você precisa negar as que vêm de fábrica.
