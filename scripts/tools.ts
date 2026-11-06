#!/usr/bin/env tsx
/**
 * Inventario das tools, lido do REGISTRY (nunca de um paragrafo de README:
 * contagem colada em documento envelhece em dias).
 *
 *   npm run tools
 */
process.env.ERP_IGNORAR_DOTENV = '1';
const { TODAS } = await import('../src/tools/registry.js');
const por = (e: string) => TODAS.filter((t) => (t.efeito ?? 'leitura') === e);
console.log(`\n${TODAS.length} tools servidas ao modelo\n`);
for (const e of ['leitura', 'proposta', 'escrita']) {
  console.log(`${e.padEnd(9)} ${String(por(e).length).padStart(2)}  ${por(e).map((t) => t.name).join(', ')}`);
}
const tokens = TODAS.reduce((s, t) => s + t.description.length, 0);
console.log(`\ndescricoes somam ${tokens} caracteres (e o que o modelo le para escolher)\n`);
