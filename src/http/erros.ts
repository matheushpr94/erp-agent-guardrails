import { ApiError } from './client.js';
import { BloqueioError } from './bloqueio.js';

/**
 * Traduz erro do ERP para instrucao acionavel, NA CAMADA (vale para toda tool,
 * inclusive as que ainda nao existem). Traduzir nao e pre-validar: a API decide,
 * nos so tornamos legivel o que ela respondeu.
 */
export function explicar(err: unknown): string {
  if (err instanceof BloqueioError) {
    return `Acao recusada pela parede de escrita: ${err.motivo}. Nada foi alterado no ERP.`;
  }
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : String(err);
  const corpo = err.body.slice(0, 400);
  const base = `O ERP recusou a chamada (HTTP ${err.status}) em ${err.endpoint}.\n${corpo}`;
  if (err.status === 404) {
    return `${base}\n\nO QUE DIZER: nao encontrei esse registro. Peca para conferir o codigo; nao fale em erro do sistema.`;
  }
  if (err.status === 429) {
    return `${base}\n\nO ERP esta limitando a taxa de chamadas. Espere alguns segundos antes de tentar de novo.`;
  }
  return base;
}
