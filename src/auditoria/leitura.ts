/**
 * Rastro de LEITURA: o que o agente consultou, sem o conteudo.
 *
 * Grava rota, filtro e quantos registros voltaram, nunca os dados em si. E o
 * minimo que responde "o agente olhou o cadastro de quem, e quando?" sem criar
 * uma segunda copia da base do cliente (LGPD: minimizacao).
 */
import { appendFile, chmod, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RAIZ_PROJETO } from '../config.js';

export function origemDoAmbiente(): string {
  return (process.env.CANAL_CHAT_ID ?? '').trim() || 'desconhecida';
}

export function contarRegistros(resposta: unknown): number | null {
  if (Array.isArray(resposta)) return resposta.length;
  if (resposta && typeof resposta === 'object') {
    for (const k of ['itens', 'items', 'data']) {
      const v = (resposta as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v.length;
    }
    return 1;
  }
  return null;
}

export async function auditarLeitura(rota: string, filtro: Record<string, unknown> | undefined, inicio: number, status: number | 'erro', resposta?: unknown): Promise<void> {
  const p = process.env.AUDITORIA_LEITURA_ARQUIVO ?? join(RAIZ_PROJETO, 'auditoria', 'leituras.jsonl');
  try {
    await mkdir(dirname(p), { recursive: true });
    if (!existsSync(p)) {
      await appendFile(p, '', 'utf8');
      await chmod(p, 0o600).catch(() => {});
    }
    const limpo = filtro ? Object.fromEntries(Object.entries(filtro).filter(([, v]) => v !== undefined && v !== null && v !== '')) : undefined;
    await appendFile(p, JSON.stringify({
      instante: new Date().toISOString(),
      origem: origemDoAmbiente(),
      rota,
      ...(limpo && Object.keys(limpo).length ? { filtro: limpo } : {}),
      registros: resposta === undefined ? null : contarRegistros(resposta),
      status,
      duracao_ms: Date.now() - inicio,
    }) + '\n', 'utf8');
  } catch (e) {
    // fail-open: a consulta ja foi respondida; a lacuna vai para stderr.
    process.stderr.write(`[auditoria-leitura] nao gravou ${rota}: ${String(e)}\n`);
  }
}
