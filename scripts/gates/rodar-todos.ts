/**
 * Roda cada gate DUAS vezes: normal (tem de passar) e --known-bad (tem de
 * reprovar a implementacao sabotada). Grava o placar em resultados/gates.json.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ } from '../lib/gate.js';

const GATES = ['escrita', 'proposta', 'papel', 'confirmacao', 'integracao'];
const linhas: Array<Record<string, unknown>> = [];
let falhou = false;

for (const nome of GATES) {
  for (const kb of [false, true]) {
    const arq = join(RAIZ, 'scripts', 'gates', `${nome}-gate.ts`);
    const r = spawnSync(process.execPath, [join(RAIZ, 'node_modules/tsx/dist/cli.mjs'), arq, ...(kb ? ['--known-bad'] : [])], { cwd: RAIZ, encoding: 'utf8' });
    const placar = (r.stdout.match(/^PLACAR (.*)$/m)?.[1]) ?? '{}';
    const p = JSON.parse(placar) as Record<string, unknown>;
    const ok = r.status === 0;
    if (!ok) { falhou = true; process.stdout.write(r.stdout + r.stderr); }
    linhas.push({ ...p, gate: nome, modo: kb ? 'known-bad' : 'normal', resultado: ok ? (kb ? 'reprovou a sabotagem (ok)' : 'passou') : 'FALHOU' });
    console.log(`${ok ? '✓' : '✗'} ${nome.padEnd(12)} ${kb ? 'known-bad' : 'normal   '}  ${p.passaram ?? '?'}/${p.total ?? '?'} casos passaram${kb ? ' (o esperado e reprovar ao menos 1)' : ''}`);
  }
}
mkdirSync(join(RAIZ, 'resultados'), { recursive: true });
writeFileSync(join(RAIZ, 'resultados', 'gates.json'), JSON.stringify({ gerado_em: new Date().toISOString(), node: process.version, gates: linhas }, null, 2) + '\n');
process.exit(falhou ? 1 : 0);
