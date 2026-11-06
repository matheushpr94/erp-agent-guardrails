#!/usr/bin/env tsx
/**
 * Conversa interativa com o agente, contra o ERP simulado (sobe o mock no
 * proprio processo). Requer ANTHROPIC_API_KEY. O "gateway" aqui e o terminal:
 * ele carimba cada mensagem e define o papel.
 *
 *   ANTHROPIC_API_KEY=... npm run agente
 *   CANAL_PAPEL=funcionario ANTHROPIC_API_KEY=... npm run agente
 */
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { RAIZ } from '../scripts/lib/gate.js';
import { canal, conectar } from '../scripts/lib/mcp-em-processo.js';

const dir = join(RAIZ, '.estado', 'chat');
mkdirSync(dir, { recursive: true });
const { iniciarMock } = await import('../mock-erp/server.js');
const mock = await iniciarMock();
Object.assign(process.env, {
  ERP_IGNORAR_DOTENV: '1', ERP_API_BASE: mock.url, ERP_AUTH_BASE: mock.url,
  ERP_TOKEN_FILE: join(dir, 'tokens.json'), PROPOSTAS_ARQUIVO: join(dir, 'propostas.json'),
  AUDITORIA_ARQUIVO: join(dir, 'escritas.jsonl'), AUDITORIA_LEITURA_ARQUIVO: join(dir, 'leituras.jsonl'),
  ERP_ESCRITA: process.env.ERP_ESCRITA ?? 'habilitada',
  ERP_ESCRITA_TOOLS: process.env.ERP_ESCRITA_TOOLS ?? 'propor_lancar_conta,propor_dar_baixa,propor_criar_cliente',
});
const papel = process.env.CANAL_PAPEL ?? 'dono';
const { montarServidor } = await import('../src/server.js');
const { Agente } = await import('./agente.js');
const mcp = await conectar(montarServidor());
const agente = new Agente(mcp);
console.log(`ERP simulado: ${mock.estado().empresa.nome} (ficticia). Papel: ${papel}. Tools: ${(await agente.iniciar()).length}. Ctrl+D sai.\n`);
console.log(`Trilha de auditoria: ${process.env.AUDITORIA_ARQUIVO}\n`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
for (;;) {
  let linha: string;
  try { linha = await rl.question('voce> '); } catch { break; }
  if (!linha.trim()) continue;
  canal('terminal', papel, { texto: linha });
  const r = await agente.turno(linha);
  for (const c of r.chamadas) console.log(`  [tool] ${c.tool}${c.erro ? ' (erro)' : ''}`);
  console.log(`\nagente> ${r.resposta}\n`);
}
rl.close();
await mcp.close();
await mock.fechar();
