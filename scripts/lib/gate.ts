/**
 * Mini-harness de gate. Todo gate nasce com KNOWN-BAD: rodado com
 * `--known-bad`, ele aplica as MESMAS checagens a uma implementacao sabotada e
 * TEM de reprovar. Verde por ausencia de caso nao e verde.
 *
 *   modo normal    -> exit 0 se todos os casos passaram
 *   --known-bad    -> exit 0 se ao menos um caso REPROVOU (o gate morde)
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KNOWN_BAD = process.argv.includes('--known-bad');
export const RAIZ = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Diretorio de trabalho isolado do gate (dentro do repo, ignorado pelo git). */
export function sandbox(nome: string): string {
  const dir = join(RAIZ, '.estado', `${nome}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.ERP_IGNORAR_DOTENV = '1';
  process.env.PROPOSTAS_ARQUIVO = join(dir, 'propostas.json');
  process.env.AUDITORIA_ARQUIVO = join(dir, 'escritas.jsonl');
  process.env.AUDITORIA_LEITURA_ARQUIVO = join(dir, 'leituras.jsonl');
  process.env.ERP_TOKEN_FILE = join(dir, 'tokens.json');
  return dir;
}

export class Gate {
  private casos: Array<{ nome: string; ok: boolean; porque: string }> = [];
  constructor(private readonly nome: string) {}

  checar(nome: string, ok: boolean, porque = ''): void {
    this.casos.push({ nome, ok: !!ok, porque });
  }

  async checarAsync(nome: string, fn: () => Promise<boolean>, porque = ''): Promise<void> {
    let ok = false;
    try { ok = await fn(); } catch (e) { porque = `${porque} [lancou: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}]`; }
    this.checar(nome, ok, porque);
  }

  fim(dir?: string): never {
    if (dir && !process.env.GATE_MANTER) rmSync(dir, { recursive: true, force: true });
    const falhas = this.casos.filter((c) => !c.ok);
    const total = this.casos.length;
    console.log(`\n=== ${this.nome}${KNOWN_BAD ? ' (KNOWN-BAD)' : ''} ===`);
    for (const c of this.casos) console.log(`  ${c.ok ? '✓' : '✗'} ${c.nome}${!c.ok && c.porque ? `\n      porque: ${c.porque}` : ''}`);
    const linha = { gate: this.nome, modo: KNOWN_BAD ? 'known-bad' : 'normal', total, passaram: total - falhas.length };
    console.log(`PLACAR ${JSON.stringify(linha)}`);
    if (KNOWN_BAD) {
      if (falhas.length) {
        console.log(`  known-bad: o gate REPROVOU ${falhas.length}/${total} casos contra a implementacao sabotada (esperado).`);
        process.exit(0);
      }
      console.log('  known-bad: a sabotagem PASSOU em tudo; o gate nao morde.');
      process.exit(1);
    }
    console.log(`  ${total - falhas.length}/${total} casos passaram`);
    process.exit(falhas.length ? 1 : 0);
  }
}
