import { chmod, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { z } from 'zod';

/**
 * Persistencia do par de tokens OAuth.
 *
 * O refresh_token e ROTATIVO: cada renovacao invalida o anterior. Isso dita
 * duas regras deste arquivo:
 *
 *  1. ESCRITA ATOMICA. Arquivo truncado = refresh_token perdido = refazer o
 *     OAuth no navegador. Grava em .tmp e faz rename(), atomico no mesmo
 *     filesystem.
 *  2. LOCK ENTRE PROCESSOS. Servidor MCP e rotinas agendadas renovam ao mesmo
 *     tempo; sem lock, o segundo grava por cima um token que o primeiro ja
 *     invalidou e a integracao cai. O lock serializa ler -> renovar -> gravar.
 */
const TokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().default('Bearer'),
  /** epoch ms em que o access_token expira (ja com margem) */
  expires_at: z.number().int().positive(),
  rotated_at: z.number().int().positive(),
  /** qual provedor gerou este par: impede usar token do mock contra o real */
  provedor: z.enum(['mock', 'contaazul']),
});

export type StoredTokens = z.infer<typeof TokenSchema>;

export class TokenStoreError extends Error {}

/** Renova um pouco antes do vencimento real, em vez de tomar 401. */
export const EXPIRY_SKEW_MS = 60_000;

export async function readTokens(file: string): Promise<StoredTokens | null> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new TokenStoreError(`Token store corrompido (JSON invalido): ${file}`);
  }
  const parsed = TokenSchema.safeParse(json);
  if (!parsed.success) {
    throw new TokenStoreError(
      `Token store com formato inesperado: ${file}\n`
        + parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  return parsed.data;
}

export async function writeTokens(file: string, tokens: StoredTokens): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(tokens, null, 2), { encoding: 'utf8', mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => {});
  await rename(tmp, file); // atomico
  await chmod(file, 0o600).catch(() => {});
}

/**
 * Os tres tempos do lock. A RELACAO entre eles e o contrato: `timeoutMs` tem
 * de ser maior que `staleMs`, senao quem espera desiste antes de o lock orfao
 * (processo morto) amadurecer para a faxina.
 */
export interface TemposDoLock {
  staleMs: number;
  retryMs: number;
  timeoutMs: number;
}

const TEMPOS_PADRAO: TemposDoLock = { staleMs: 30_000, retryMs: 120, timeoutMs: 45_000 };

async function tryAcquire(lockFile: string, staleMs: number): Promise<boolean> {
  try {
    const fh = await open(lockFile, 'wx', 0o600); // 'wx' falha se ja existe
    await fh.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
    await fh.close();
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    try {
      const st = await stat(lockFile);
      if (Date.now() - st.mtimeMs > staleMs) await unlink(lockFile).catch(() => {});
    } catch {
      /* sumiu no meio do caminho */
    }
    return false;
  }
}

/** Roda `fn` com exclusividade sobre o token store. */
export async function withTokenLock<T>(
  file: string,
  fn: () => Promise<T>,
  tempos: TemposDoLock = TEMPOS_PADRAO,
): Promise<T> {
  const lockFile = `${file}.lock`;
  const deadline = Date.now() + tempos.timeoutMs;
  while (!(await tryAcquire(lockFile, tempos.staleMs))) {
    if (Date.now() > deadline) {
      throw new TokenStoreError(
        `Timeout esperando o lock do token store (${lockFile}). Lock de processo morto `
          + `se limpa sozinho apos ${Math.round(tempos.staleMs / 1000)}s.`,
      );
    }
    await new Promise((r) => setTimeout(r, tempos.retryMs));
  }
  try {
    return await fn();
  } finally {
    await unlink(lockFile).catch(() => {});
  }
}

export function isExpired(tokens: StoredTokens, now = Date.now()): boolean {
  return now >= tokens.expires_at;
}
