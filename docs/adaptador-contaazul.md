# Adaptador para a Conta Azul (`ERP_PROVIDER=contaazul`)

> **Projeto não oficial, sem vínculo com a Conta Azul.** "Conta Azul" é citada apenas nominalmente, para dizer com qual API este código conversa em produção. Nenhuma documentação, especificação, guia, exemplo ou marca da Conta Azul é redistribuída aqui.

## Onde está o contrato da API
Na documentação oficial: **https://developers.contaazul.com**. Credenciais, OAuth, rotas e limites devem ser conferidos lá. Este repositório não copia esse conteúdo.

## O que muda ao trocar o provedor
O código do servidor é o mesmo. `src/provider.ts` define, por provedor:

| | `mock` (padrão) | `contaazul` |
|---|---|---|
| base da API | `http://127.0.0.1:8787` | a da documentação oficial |
| endpoint de token | do mock | o da documentação oficial |
| credenciais | fixas de desenvolvimento | as do **seu** aplicativo, no **seu** `.env` |
| obtenção do primeiro token | código fixo, sem navegador | fluxo OAuth authorization_code da doc oficial |

As rotas usadas pelas tools (`/v1/financeiro/...`, `/v1/pessoas`) foram escritas pelo autor a partir do comportamento observado; o mock imita esse comportamento. Antes de apontar para uma conta real, **confira cada rota e cada corpo na documentação oficial**: a paridade não é garantida e pode ter mudado.

## Regras para usar com conta real
1. Comece com `ERP_ESCRITA=desabilitada` e allowlist vazia: só leitura.
2. Teste a escrita em conta de **desenvolvimento**, nunca na de um cliente.
3. Libere uma ferramenta por vez em `ERP_ESCRITA_TOOLS`.
4. Credenciais e tokens ficam fora do git (`.gitignore` já cobre `.env` e `.tokens*.json`). Nunca publique credencial em código.
5. Leia os termos de uso do portal do desenvolvedor que você aceitou antes de publicar qualquer integração.
