/**
 * Parede de escrita na camada HTTP.
 *
 * Fica AQUI, e nao dentro de cada tool, porque tool nova esquece de checar e a
 * camada HTTP nao tem como ser contornada: toda chamada que sai do processo
 * passa por `avaliar`. Funcao pura, testavel sem rede.
 *
 * Ordem das regras (a primeira que recusa vence):
 *   1. metodo desconhecido ............ recusado por ser desconhecido
 *   2. GET ............................ leitura, sempre passa
 *   3. rota proibida (exclusao/inativacao) recusada mesmo com tudo ligado
 *   4. DELETE ......................... so por excecao nominal (nenhuma aqui)
 *   5. KILL-SWITCH mestre ............. desligado = nada escreve
 *   6. rota -> tool .................... rota sem tool mapeada e recusada
 *   7. ALLOWLIST por tool .............. a tool precisa estar nomeada
 */
const METODOS_CONHECIDOS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

const ROTAS_PROIBIDAS: ReadonlyArray<{ fragmento: RegExp; motivo: string }> = [
  {
    fragmento: /\/(excluir|exclusao|desativar|inativar)\b/i,
    motivo: 'exclusao/inativacao por rota nomeada destroi cadastro com historico; fica fora mesmo com escrita ligada',
  },
];

/** Lista exaustiva: so entra DELETE que alguma tool propoe. Hoje, nenhuma. */
const DELETE_PERMITIDO: ReadonlyArray<RegExp> = [];

/**
 * Rota de escrita -> nome da tool que a propoe. A allowlist fala o idioma do
 * operador (nome de tool); a parede fala HTTP. Escrita cujo caminho nao casa
 * com nenhuma entrada e bloqueada por ser desconhecida: tool nova nasce
 * bloqueada ate alguem mapea-la aqui.
 */
const TOOL_DA_ROTA: ReadonlyArray<{ tool: string; metodo: string; rota: RegExp }> = [
  { tool: 'propor_lancar_conta', metodo: 'POST', rota: /^\/v1\/financeiro\/eventos-financeiros\/contas-a-(pagar|receber)$/i },
  { tool: 'propor_dar_baixa', metodo: 'POST', rota: /^\/v1\/financeiro\/eventos-financeiros\/parcelas\/[^/]+\/baixa$/i },
  { tool: 'propor_criar_cliente', metodo: 'POST', rota: /^\/v1\/pessoas$/i },
];

export const TOOLS_DE_ESCRITA: ReadonlySet<string> = new Set(TOOL_DA_ROTA.map((t) => t.tool));

/** "a, b ,c" -> Set. String vazia = conjunto vazio = bloqueia tudo. */
export function allowlistDe(valor: string | undefined): Set<string> {
  return new Set((valor ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

export class BloqueioError extends Error {
  constructor(readonly metodo: string, readonly caminho: string, readonly motivo: string) {
    super(`BLOQUEADO ${metodo} ${caminho}: ${motivo}`);
    this.name = 'BloqueioError';
  }
}

export interface Veredito {
  permitido: boolean;
  leitura: boolean;
  motivo?: string;
}

export function avaliar(
  metodo: string,
  caminho: string,
  escritaHabilitada: boolean,
  toolsPermitidas: ReadonlySet<string>,
): Veredito {
  const m = (metodo || '').toUpperCase().trim();
  const semQuery = caminho.split('?')[0] ?? caminho;

  if (!METODOS_CONHECIDOS.has(m)) {
    return { permitido: false, leitura: false, motivo: `metodo "${metodo}" desconhecido; o padrao e recusar` };
  }
  if (m === 'GET') return { permitido: true, leitura: true };

  for (const { fragmento, motivo } of ROTAS_PROIBIDAS) {
    if (fragmento.test(semQuery)) return { permitido: false, leitura: false, motivo };
  }
  if (m === 'DELETE' && !DELETE_PERMITIDO.some((r) => r.test(semQuery))) {
    return { permitido: false, leitura: false, motivo: 'DELETE so por excecao nominal, e esta rota nao esta na lista' };
  }
  // O MESTRE vem antes da lista: desligado, bloqueia tudo, sem precisar editar lista nenhuma.
  if (!escritaHabilitada) {
    return { permitido: false, leitura: false, motivo: 'escrita desabilitada (kill-switch: ERP_ESCRITA != "habilitada")' };
  }
  const daRota = TOOL_DA_ROTA.find((t) => t.metodo === m && t.rota.test(semQuery));
  if (!daRota) {
    return { permitido: false, leitura: false, motivo: `escrita em rota sem tool mapeada (${m} ${semQuery}); o padrao e recusar` };
  }
  // `?.` porque chamador JS sem o parametro manda undefined, e omissao bloqueia.
  if (toolsPermitidas?.has?.(daRota.tool) !== true) {
    return { permitido: false, leitura: false, motivo: `fora da allowlist: "${daRota.tool}" nao esta em ERP_ESCRITA_TOOLS` };
  }
  return { permitido: true, leitura: false };
}
