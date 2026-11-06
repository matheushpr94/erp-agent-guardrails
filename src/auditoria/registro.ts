/**
 * Trilha de auditoria das escritas (JSONL, append-only, 0600).
 *
 * Tres tipos de linha: `tentativa` (gravada ANTES da chamada), `desfecho`
 * (sempre, inclusive em erro de rede) e `bloqueio` (recusa tambem e rastro).
 * Escrita que morre no meio e o caso que mais importa reconstituir: o ERP pode
 * ter gravado e a resposta ter se perdido.
 */
import { appendFile, chmod, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { RAIZ_PROJETO } from '../config.js';

export interface Origem {
  /** quem pediu segundo o CANAL (gateway). Autenticado. */
  origem_canal?: string;
  /** a frase que originou a proposta */
  mensagem?: string;
  /** o texto da proposta, palavra por palavra */
  proposta?: string;
  /** o que o MODELO alegou como confirmacao */
  confirmacao_alegada?: string;
  /** o que o CANAL entregou como confirmacao */
  confirmacao_do_canal?: string;
  confirmado_por?: 'texto' | 'voz' | 'botao' | 'sem-canal';
}

export interface Tentativa {
  instante: string;
  provedor: string;
  chave: string;
  tool?: string;
  metodo: string;
  endpoint: string;
  corpo: unknown;
  antes?: unknown;
  origem: Origem;
}

export interface Desfecho {
  status?: number;
  resposta?: unknown;
  id_erp?: string;
  erro?: string;
  duracao_ms: number;
  repetida?: boolean;
}

export function arquivoDaTrilha(): string {
  return process.env.AUDITORIA_ARQUIVO ?? join(RAIZ_PROJETO, 'auditoria', 'escritas.jsonl');
}

/** Chave de idempotencia: mesma acao, mesmo pedido, mesmo corpo. */
export function chaveDe(metodo: string, caminho: string, canal: string | undefined, mensagem: string | undefined, corpo: unknown): string {
  const material = JSON.stringify([(metodo ?? '').toUpperCase(), caminho ?? '', canal ?? '', (mensagem ?? '').trim(), corpo]);
  return createHash('sha256').update(material).digest('hex').slice(0, 24);
}

async function anexar(linha: Record<string, unknown>): Promise<void> {
  const p = arquivoDaTrilha();
  await mkdir(dirname(p), { recursive: true });
  if (!existsSync(p)) {
    await appendFile(p, '', 'utf8');
    await chmod(p, 0o600).catch(() => {});
  }
  await appendFile(p, JSON.stringify(linha) + '\n', 'utf8');
}

export const registrarTentativa = (t: Tentativa) => anexar({ tipo: 'tentativa', ...t });

export const registrarDesfecho = (chave: string, d: Desfecho) =>
  anexar({ tipo: 'desfecho', chave, instante: new Date().toISOString(), ...d });

export const registrarBloqueio = (metodo: string, endpoint: string, motivo: string, origem: Origem = {}) =>
  anexar({ tipo: 'bloqueio', instante: new Date().toISOString(), metodo, endpoint, motivo, origem });

export interface Linha {
  tipo: 'tentativa' | 'desfecho' | 'bloqueio';
  chave?: string;
  [k: string]: unknown;
}

export async function ler(): Promise<Linha[]> {
  const p = arquivoDaTrilha();
  if (!existsSync(p)) return [];
  return (await readFile(p, 'utf8'))
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as Linha;
      } catch {
        return { tipo: 'tentativa', _ilegivel: l } as Linha;
      }
    });
}

/** Desfecho 2xx anterior com a mesma chave: devolve-o em vez de repetir. */
export async function jaExecutada(chave: string): Promise<Desfecho | null> {
  for (const l of await ler()) {
    if (l.tipo !== 'desfecho' || l.chave !== chave) continue;
    const d = l as unknown as Desfecho;
    if (typeof d.status === 'number' && d.status >= 200 && d.status < 300) return d;
  }
  return null;
}

/**
 * "Nao sei" nao e "falhou". Dois estados sao INCERTOS e repetir as cegas
 * DUPLICA a escrita: tentativa orfa (sem desfecho: a resposta se perdeu) e
 * protocolo que ficou PENDENTE (o ERP aceitou e nao confirmou).
 */
export async function estadoIncerto(chave: string): Promise<{ caso: string; frase: string } | null> {
  let tentativas = 0;
  let desfechos = 0;
  let tem2xx = false;
  let pendente = false;
  for (const l of await ler()) {
    if (l.chave !== chave) continue;
    if (l.tipo === 'tentativa') tentativas += 1;
    if (l.tipo === 'desfecho') {
      desfechos += 1;
      const st = (l as { status?: unknown }).status;
      if (typeof st === 'number' && st >= 200 && st < 300) tem2xx = true;
      if (/protocolo PENDING/.test(String((l as { erro?: unknown }).erro ?? ''))) pendente = true;
    }
  }
  if (tem2xx) return null;
  if (pendente) {
    return { caso: 'protocolo_pendente', frase: 'esta MESMA acao ja foi aceita pelo ERP e ficou sem confirmacao; pode ter entrado depois. Confira no ERP antes de repetir.' };
  }
  if (tentativas > desfechos) {
    return { caso: 'tentativa_orfa', frase: 'ha uma tentativa desta MESMA acao sem desfecho; ela PODE ter sido gravada. Confira no ERP antes de repetir.' };
  }
  return null;
}
