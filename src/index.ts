#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getConfig } from './config.js';
import { montarServidor } from './server.js';
import { TODAS } from './tools/registry.js';

// stdout e o canal JSON-RPC: log so em stderr.
const log = (m: string) => process.stderr.write(`[erp-agent-guardrails] ${m}\n`);

async function main(): Promise<void> {
  const cfg = getConfig();
  const server = montarServidor();
  log(`provedor=${cfg.provedor} tools=${TODAS.length} escrita=${cfg.ERP_ESCRITA} allowlist=[${cfg.ERP_ESCRITA_TOOLS}] rate=${cfg.ERP_RPS}/s,${cfg.ERP_RPM}/min`);
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  log(`FALHA AO INICIAR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
