/**
 * Normaliza o envelope de listagem.
 *
 * ERPs reais devolvem listas em formatos diferentes por endpoint (`itens` +
 * `itens_totais`, `items` + `totalItems`, `data` + `total`, array cru). Ler a
 * chave errada devolve lista VAZIA SEM ERRO, e o agente responderia "voce nao
 * tem nenhum cliente". O mock reproduz essa variedade de proposito.
 */
export interface Envelope { itens: unknown[]; total: number | null; extra?: Record<string, unknown> }

const CHAVES_LISTA = ['itens', 'items', 'data'] as const;
const CHAVES_TOTAL = ['itens_totais', 'total_itens', 'totalItems', 'total'] as const;
const ENVELOPE = new Set<string>([...CHAVES_LISTA, ...CHAVES_TOTAL]);

export function normalizarEnvelope(resposta: unknown): Envelope {
  if (Array.isArray(resposta)) return { itens: resposta, total: resposta.length };
  if (resposta === null || typeof resposta !== 'object') return { itens: [], total: null };
  const obj = resposta as Record<string, unknown>;
  const kLista = CHAVES_LISTA.find((k) => Array.isArray(obj[k]));
  const kTotal = CHAVES_TOTAL.find((k) => typeof obj[k] === 'number');
  const extra = Object.fromEntries(Object.entries(obj).filter(([k]) => !ENVELOPE.has(k)));
  return {
    itens: kLista ? (obj[kLista] as unknown[]) : [],
    total: kTotal ? (obj[kTotal] as number) : null,
    ...(Object.keys(extra).length ? { extra } : {}),
  };
}

/**
 * Resposta de listagem para o MODELO, com o aviso que impede os dois erros
 * classicos: "nenhum registro" lido como "voce nao deve nada", e somar uma
 * pagina como se fosse o total.
 */
export function respostaLista(resposta: unknown): { total: number | null; retornados: number; aviso?: string; itens: unknown[]; extra?: Record<string, unknown> } {
  const env = normalizarEnvelope(resposta);
  const retornados = env.itens.length;
  let aviso: string | undefined;
  if (retornados === 0) {
    aviso = 'NENHUM REGISTRO NESTE FILTRO. Isto significa que nao ha nada LANCADO com estes filtros; NAO significa que nao existe divida. Diga "nao encontrei nada lancado em <periodo>" e ofereca ampliar.';
  } else if (env.total !== null && env.total > retornados) {
    aviso = env.extra?.totais
      ? `AMOSTRA: ${retornados} de ${env.total} registros. NAO some os itens: use extra.totais, que cobre o filtro inteiro.`
      : `PARCIAL: ${retornados} de ${env.total} registros. Pagine antes de afirmar qualquer total.`;
  }
  return { total: env.total, retornados, ...(aviso ? { aviso } : {}), itens: env.itens, ...(env.extra ? { extra: env.extra } : {}) };
}
