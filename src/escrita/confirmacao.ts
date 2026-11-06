/**
 * O que conta como "sim". Lista FECHADA de proposito: o custo de recusar a toa
 * e uma mensagem a mais; o custo de aceitar a toa e uma escrita irreversivel
 * na contabilidade de alguem.
 *
 * Regras, nesta ordem:
 *   1. pergunta nunca confirma ("confirmo?" e duvida);
 *   2. negacao vence ("nao pode lancar");
 *   3. hesitacao vence ("acho que sim");
 *   4. frase que carrega OUTRO pedido nunca confirma ("faz o relatorio");
 *   5. sim explicito vale em qualquer tamanho; verbo ambiguo ("faz", "manda")
 *      so em frase curta;
 *   6. "ok" sozinho NAO confirma: em portugues ele tanto aceita quanto so
 *      reconhece ("ok, entendi").
 */
const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const EXPLICITOS = ['sim', 'confirmo', 'confirmado', 'confirma', 'autorizo', 'autorizado', 'positivo', 'isso mesmo', 'pode sim', 'pode lancar'];
const BRANDOS = ['pode', 'manda', 'isso', 'exato', 'correto', 'faz', 'faca', 'vai', 'beleza', 'certo', 'perfeito'];
const MAX_PALAVRAS_BRANDO = 3;
const CORTESIA = ['tudo bem', 'tudo certo', 'ta bom', 'ta certo', 'esta bem', 'ok', 'beleza', 'entao'].sort((a, b) => b.length - a.length);

const OUTRO_PEDIDO = /\b(test[ae]r?|teste|verifica|confere|conferir|checa|veja|olha|mostra|mostrar|lista|listar|calcula|explica|pesquisa|busca|procura|abre|manda o|envia|enviar|print|depois|antes de|primeiro|tambem|refaz|repete|ignore|ignora)\b/i;
const NEGACAO = /\b(nao|nunca|jamais|nem|deixa|cancela|para|espera|aguarda)\b/i;
const HESITACAO = /\b(acho|talvez|sei la|possivelmente|provavelmente|seria|sera|se for|se voce|antes|melhor)\b/i;

function semCortesia(t: string): string {
  for (const c of CORTESIA) {
    if (t === c) return '';
    if (t.startsWith(`${c} `)) return t.slice(c.length + 1).trim();
  }
  return t;
}

export function afirmativo(texto: string): boolean {
  const t = semAcento(texto ?? '').toLowerCase().replace(/[!.,;]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (t.includes('?')) return false;
  if (NEGACAO.test(t) || HESITACAO.test(t) || OUTRO_PEDIDO.test(t)) return false;
  const julga = (frase: string): boolean => {
    if (!frase) return false;
    const comeca = (a: string) => frase === a || frase.startsWith(`${a} `);
    if (EXPLICITOS.some(comeca)) return true;
    return frase.split(' ').length <= MAX_PALAVRAS_BRANDO && BRANDOS.some(comeca);
  };
  // A frase inteira primeiro; so depois descarta UMA cortesia de abertura. Assim
  // o descarte so ACRESCENTA casos, nunca tira.
  return julga(t) || julga(semCortesia(t));
}

/**
 * Que operacao uma frase NOMEIA. Um "sim" para A nao pode executar B: se a
 * frase do cliente nomeia uma operacao e a proposta e de outra, recusa.
 * Ordem importa: o mais especifico primeiro.
 */
const OPERACOES: ReadonlyArray<[RegExp, string]> = [
  [/\bestorn/i, 'estorno'],
  [/\b(exclu|apag|delet|remov)/i, 'exclusao'],
  [/\b(cadastr|cliente novo)/i, 'cadastro'],
  [/\bbaix/i, 'baixa'],
  [/\blanc/i, 'lancamento'],
];

export function operacaoNomeada(frase: string): string | null {
  const t = semAcento(frase ?? '');
  for (const [re, nome] of OPERACOES) if (re.test(t)) return nome;
  return null;
}
