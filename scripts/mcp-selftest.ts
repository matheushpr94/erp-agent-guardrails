#!/usr/bin/env tsx
/**
 * Self-test do protocolo MCP: sobe o servidor DE VERDADE por stdio, faz o
 * handshake, lista as tools e chama uma contra o mock. Pega as falhas MUDAS do
 * stdio (o cliente so "nao conecta"): lixo em stdout, schema que o SDK recusa,
 * nome duplicado, anotacao que mente.
 *
 *   npm run selftest
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarMock } from '../mock-erp/server.js';

const raiz = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dir = join(raiz, '.estado', `selftest-${process.pid}`);
mkdirSync(dir, { recursive: true });

async function main(): Promise<number> {
  console.log('\n=== self-test do MCP (stdio) ===\n');
  const mock = await iniciarMock();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(raiz, 'node_modules/tsx/dist/cli.mjs'), resolve(raiz, 'src/index.ts')],
    cwd: raiz,
    env: {
      PATH: process.env.PATH ?? '',
      ERP_IGNORAR_DOTENV: '1',
      ERP_PROVIDER: 'mock',
      ERP_API_BASE: mock.url,
      ERP_AUTH_BASE: mock.url,
      ERP_TOKEN_FILE: join(dir, 'tokens.json'),
      AUDITORIA_ARQUIVO: join(dir, 'escritas.jsonl'),
      AUDITORIA_LEITURA_ARQUIVO: join(dir, 'leituras.jsonl'),
      PROPOSTAS_ARQUIVO: join(dir, 'propostas.json'),
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'selftest', version: '0.1.0' });
  let problemas = 0;
  await client.connect(transport);
  console.log('  ✓ handshake concluido (stdout limpo)');
  const { tools } = await client.listTools();
  console.log(`  ✓ tools/list respondeu: ${tools.length} tools`);

  if (tools.some((t) => !t.inputSchema)) { console.log('  ✗ tool sem inputSchema'); problemas += 1; }
  if (new Set(tools.map((t) => t.name)).size !== tools.length) { console.log('  ✗ nomes duplicados'); problemas += 1; }

  const alteraPeloNome = (n: string) => n.startsWith('propor_') || n === 'confirmar_acao';
  const mentemLendo = tools.filter((t) => alteraPeloNome(t.name) && t.annotations?.readOnlyHint === true);
  const mentemEscrevendo = tools.filter((t) => !alteraPeloNome(t.name) && t.annotations?.readOnlyHint !== true);
  const destrutivas = tools.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name);
  if (mentemLendo.length || mentemEscrevendo.length) {
    console.log(`  ✗ anotacao mente: ${[...mentemLendo, ...mentemEscrevendo].map((t) => t.name).join(', ')}`);
    problemas += 1;
  } else {
    const n = tools.filter((t) => alteraPeloNome(t.name)).length;
    console.log(`  ✓ anotacao bate com o efeito: ${tools.length - n} de leitura, ${n} que alteram (destrutiva: ${destrutivas.join(', ')})`);
  }
  if (destrutivas.length !== 1 || destrutivas[0] !== 'confirmar_acao') { console.log('  ✗ deveria haver exatamente um executor'); problemas += 1; }

  const r = await client.callTool({ name: 'consultar_saldo', arguments: {} });
  const txt = Array.isArray(r.content) && r.content[0]?.type === 'text' ? String(r.content[0].text) : '';
  if (!r.isError && /"total"/.test(txt)) console.log(`  ✓ tools/call contra o mock respondeu: ${txt.match(/"total": ?[\d.]+/)?.[0]}`);
  else { console.log(`  ✗ tools/call falhou: ${txt.slice(0, 160)}`); problemas += 1; }

  await client.close();
  await mock.fechar();
  mkdirSync(join(raiz, 'resultados'), { recursive: true });
  writeFileSync(join(raiz, 'resultados', 'selftest.json'), JSON.stringify({
    gerado_em: new Date().toISOString(), tools: tools.length,
    leitura: tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name),
    propostas: tools.filter((t) => t.name.startsWith('propor_')).map((t) => t.name),
    executores: destrutivas, problemas,
  }, null, 2) + '\n');
  console.log(problemas === 0 ? `\n=== self-test OK: ${tools.length} tools servidas por stdio ===\n` : `\n=== ${problemas} problema(s) ===\n`);
  return problemas;
}

main()
  .then((p) => { rmSync(dir, { recursive: true, force: true }); process.exit(p ? 1 : 0); })
  .catch((e: unknown) => { console.error(`FALHOU: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
