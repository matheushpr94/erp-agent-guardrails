/**
 * Servidor MCP DENTRO do processo, ligado a um cliente MCP por transporte em
 * memoria. Serve para evals e para o agente de exemplo: o protocolo e o mesmo
 * do stdio (tools/list, tools/call, anotacoes), sem subprocesso.
 *
 * O "gateway" simulado escreve o canal em `process.env` (CANAL_*) antes de cada
 * turno: e exatamente o papel do gateway real, que injeta o ambiente do
 * processo MCP e nunca passa por argumento de tool.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export async function conectar(server: McpServer): Promise<Client> {
  const [cliT, srvT] = InMemoryTransport.createLinkedPair();
  await server.connect(srvT);
  const client = new Client({ name: 'harness', version: '0.1.0' });
  await client.connect(cliT);
  return client;
}

export interface Mensagem { texto: string; em?: Date; origem?: 'texto' | 'voz' | 'botao' }

/** O gateway: grava QUEM fala e O QUE o canal entregou, antes do turno. */
export function canal(chatId: string, papel: string | undefined, m: Mensagem): void {
  process.env.CANAL_CHAT_ID = chatId;
  if (papel === undefined) delete process.env.CANAL_PAPEL; else process.env.CANAL_PAPEL = papel;
  process.env.CANAL_MENSAGEM = m.texto;
  process.env.CANAL_MENSAGEM_EM = (m.em ?? new Date()).toISOString();
  process.env.CANAL_MENSAGEM_ORIGEM = m.origem ?? 'texto';
}

export async function chamar(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ erro: boolean; dados: Record<string, unknown> & { _texto?: string } }> {
  const r = await client.callTool({ name, arguments: args });
  const txt = Array.isArray(r.content) && r.content[0]?.type === 'text' ? String(r.content[0].text) : '';
  let dados: Record<string, unknown> & { _texto?: string };
  try { dados = JSON.parse(txt) as Record<string, unknown>; } catch { dados = { _texto: txt }; }
  return { erro: !!r.isError, dados };
}
