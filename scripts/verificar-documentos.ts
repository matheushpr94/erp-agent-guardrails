#!/usr/bin/env tsx
/**
 * Varre o repositorio atras de CNPJ/CPF com DIGITO VERIFICADOR VALIDO.
 *
 * Documento "de teste" com DV valido pode coincidir com empresa ou pessoa real.
 * Aqui todo documento ficticio e gerado com DV invalido de proposito; este
 * script prova isso no CI e falha se aparecer qualquer numero valido.
 *
 *   npx tsx scripts/verificar-documentos.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RAIZ } from './lib/gate.js';
import { seed } from '../mock-erp/seed.js';

const IGNORAR = new Set(['node_modules', '.git', 'dist', '.estado']);
const so = (s: string) => s.replace(/\D/g, '');

export function cnpjValido(c: string): boolean {
  const d = so(c);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = pesos.reduce((s, p, i) => s + Number(d[i]) * p, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function cpfValido(c: string): boolean {
  const d = so(c);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    const s = d.slice(0, n).split('').reduce((acc, x, i) => acc + Number(x) * (n + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

function* arquivos(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    if (IGNORAR.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* arquivos(p);
    else yield p;
  }
}

// Known-bad do proprio verificador: um CNPJ com DV calculado na hora (nunca
// literal no codigo) TEM de ser reconhecido como valido, senao o 0 abaixo e
// verde por cegueira.
{
  const base = '123456780001';
  const dv = (s: string, p: number[]) => { const r = s.split('').reduce((a, x, i) => a + Number(x) * p[i]!, 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (!cnpjValido(base + d1 + d2) || cnpjValido(base + d1 + ((d2 + 1) % 10))) {
    console.log('✗ o verificador nao distingue DV valido de invalido');
    process.exit(1);
  }
}

const achados: string[] = [];
let candidatos = 0;
for (const f of arquivos(RAIZ)) {
  const txt = readFileSync(f, 'utf8');
  for (const m of txt.matchAll(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g)) {
    candidatos += 1;
    if (cnpjValido(m[0]) || cpfValido(m[0])) achados.push(`${relative(RAIZ, f)}: ${m[0]}`);
  }
}
const docsSeed = seed().pessoas.flatMap((p) => (p.documento ? [p.documento] : [])).concat(seed().empresa.documento);
const seedValidos = docsSeed.filter((d) => cnpjValido(d) || cpfValido(d));
console.log(`candidatos no texto: ${candidatos}; com DV valido: ${achados.length}`);
console.log(`documentos gerados pelo seed: ${docsSeed.length}; com DV valido: ${seedValidos.length}`);
for (const a of achados) console.log(`  ✗ ${a}`);
process.exit(achados.length || seedValidos.length ? 1 : 0);
