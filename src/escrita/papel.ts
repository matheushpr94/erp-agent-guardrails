/**
 * Portao 3: ALCADA POR PAPEL (e onda de liberacao).
 *
 * "Qual dos oito Silva?" qualquer funcionario resolve. "Lanco esse
 * pagamento?" nao e duvida, e autorizacao. Se a regra vivesse no prompt
 * ("voce e funcionario, nao escreva"), seria instrucao, e instrucao se esquece
 * no meio de conversa longa. Aqui e o SERVIDOR que recusa, e o papel vem do
 * AMBIENTE do processo (o gateway injeta `CANAL_PAPEL`), nunca de argumento de
 * tool que o modelo preenche.
 */
import { getConfig } from '../config.js';
import { allowlistDe } from '../http/bloqueio.js';

export type Papel = 'dono' | 'funcionario' | 'dev';
const PAPEIS: readonly Papel[] = ['dono', 'funcionario', 'dev'];

/**
 * Classe da acao, e NAO o texto que o cliente le. Decidir permissao lendo prosa
 * acopla seguranca a rotulo: alguem reescreve "dar baixa" para "registrar
 * pagamento" e a regra deixa de casar, em silencio.
 */
export type Classe = 'baixa' | 'lancamento' | 'criacao_pessoa';

/** Onda de liberacao, por reversibilidade: 1 tem desfazer pela API; 2 nao tem. */
export const ONDA_DA_CLASSE: Record<Classe, number> = {
  baixa: 1,
  lancamento: 2,
  criacao_pessoa: 2,
};

/** Classe -> nome da tool que a propoe. O gate confere que bate com a parede HTTP e o registry. */
export const TOOL_DA_CLASSE: Record<Classe, string> = {
  baixa: 'propor_dar_baixa',
  lancamento: 'propor_lancar_conta',
  criacao_pessoa: 'propor_criar_cliente',
};

const ONDA_PADRAO = 2;

export function papelDoAmbiente(): Papel | null {
  const v = (process.env.CANAL_PAPEL ?? '').trim().toLowerCase();
  return (PAPEIS as readonly string[]).includes(v) ? (v as Papel) : null;
}

function ondaAtiva(): number {
  const n = Number.parseInt(process.env.CANAL_ONDA ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : ONDA_PADRAO;
}

export interface Veredito { ok: boolean; motivo?: string }

/** Papel primeiro, onda depois, allowlist por ultimo. Roda ao PROPOR e ao CONFIRMAR. */
export function podeEscrever(classe: Classe): Veredito {
  const papel = papelDoAmbiente();
  if (papel === null) {
    return { ok: false, motivo: 'nao sei em que papel voce esta falando (o canal nao informou), entao nao vou alterar nada. Isso e cadastro faltando no gateway.' };
  }
  if (papel === 'funcionario') {
    return { ok: false, motivo: 'voce esta falando como funcionario, e alterar a contabilidade e do dono. Posso consultar e ajudar a achar o lancamento certo; quem autoriza e ele.' };
  }
  if (papel === 'dev' && (process.env.CANAL_DEV_ESCREVE ?? '').trim().toLowerCase() !== 'sim') {
    return { ok: false, motivo: 'voce esta como dev, e a escrita do dev esta desligada nesta instalacao. Leitura continua liberada.' };
  }
  const exige = ONDA_DA_CLASSE[classe];
  if (exige > ondaAtiva()) {
    return { ok: false, motivo: `esta acao esta na onda ${exige} de liberacao e a instalacao esta na onda ${ondaAtiva()}.` };
  }
  // Recusar tambem aqui (alem da parede HTTP) e para nao queimar o ritual: sem
  // isto o cliente leria a proposta, confirmaria, e so entao levaria um erro.
  const tool = TOOL_DA_CLASSE[classe];
  if (!allowlistDe(getConfig().ERP_ESCRITA_TOOLS).has(tool)) {
    return { ok: false, motivo: `esta acao ainda nao esta liberada nesta instalacao (a escrita e ligada uma ferramenta por vez; esta e "${tool}").` };
  }
  return { ok: true };
}
