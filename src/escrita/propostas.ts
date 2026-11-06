/**
 * PROPOSE / CONFIRM: o coracao do repositorio.
 *
 * NAO HA TOOL QUE EXECUTE ESCRITA A PARTIR DE LINGUAGEM NATURAL. O agente so tem
 * `propor_*` (monta o corpo, grava a proposta, devolve o texto a mostrar) e
 * `confirmar_acao(id)`, a unica que chama o ERP, e so com o id de uma proposta
 * viva. Instrucao no prompt se esquece sob pressao de conversa; caminho
 * ausente, nao.
 *
 * Os quatro portoes:
 *   1. FAIXA DE RISCO .... 1: "sim" simples | 2: sim + saldo antes/depois no
 *                          texto | 3: palavra ditada, digitada (voz nao vale)
 *   2. UMA PROPOSTA VIVA . por canal: a nova substitui a anterior, entao "pode
 *                          confirmar" nunca e ambiguo
 *   3. ALCADA POR PAPEL .. ver papel.ts (fail-closed sem papel)
 *   4. CONFIRMACAO DO AMBIENTE: a frase julgada e a que o CANAL entregou, com o
 *                          carimbo de hora do canal; mensagem escrita ANTES da
 *                          proposta nao vale como autorizacao dela
 *
 * Tudo atras do kill-switch mestre e da allowlist por tool (http/bloqueio.ts).
 * A proposta e PERSISTIDA em arquivo (escrita atomica): cada mensagem do canal
 * pode ser um processo novo, e proposta em memoria morreria entre a pergunta e
 * o "sim".
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { RAIZ_PROJETO } from '../config.js';
import { origemDoAmbiente } from '../auditoria/leitura.js';
import { podeEscrever, type Classe } from './papel.js';
import { afirmativo, operacaoNomeada } from './confirmacao.js';

export type Faixa = 1 | 2 | 3;

export interface Proposta {
  id: string;
  criada_em: string;
  expira_em: string;
  faixa: Faixa;
  acao: string;
  classe: Classe;
  /** o texto mostrado ao cliente, palavra por palavra */
  resumo: string;
  /** faixa 3: a palavra que o cliente precisa digitar */
  palavra?: string;
  metodo: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  endpoint: string;
  corpo: unknown;
  /** a frase que originou a proposta (vai para a trilha) */
  mensagem?: string;
  /** estado anterior: caminho de volta */
  antes?: unknown;
  /** como desfazer, em portugues */
  desfazer: string;
  /** quem pediu segundo o GATEWAY. Escopo da substituicao. */
  canal: string;
  /** carimbo da mensagem do canal que ORIGINOU a proposta (ausente sem canal) */
  origem_em?: string;
}

export const MINUTOS_DA_FAIXA: Record<Faixa, number> = { 1: 60, 2: 60, 3: 60 };

/**
 * Folga na comparacao "a mensagem veio antes da proposta?". O carimbo do canal
 * costuma vir em SEGUNDOS inteiros (truncado) e `criada_em` tem milissegundos:
 * um "sim" no mesmo segundo da criacao parece anterior por ate 999 ms. Dois
 * segundos cobrem isso, e nao chegam perto de engolir a mensagem que ORIGINOU
 * a proposta (que vem dezenas de segundos antes: o turno inteiro roda no meio).
 */
const FOLGA_DO_CARIMBO_MS = 2_000;

export type OrigemDaMensagem = 'texto' | 'voz' | 'botao';

export interface MensagemDoCanal {
  texto: string;
  em: string;
  origem: OrigemDaMensagem;
}

/**
 * A mensagem do cliente como o CANAL entregou. `null` sem canal (CLI, gate).
 * Origem desconhecida cai em `texto` (falha fechada: nao vira voz nem botao).
 */
export function mensagemDoAmbiente(): MensagemDoCanal | null {
  const em = (process.env.CANAL_MENSAGEM_EM ?? '').trim();
  if (!em) return null;
  const bruta = (process.env.CANAL_MENSAGEM_ORIGEM ?? '').trim().toLowerCase();
  const origem: OrigemDaMensagem = bruta === 'voz' || bruta === 'botao' ? bruta : 'texto';
  return { texto: (process.env.CANAL_MENSAGEM ?? '').trim(), em, origem };
}

interface Saida { acao: string; identidade: string; motivo: string; esquece_em: string }
interface Estado {
  propostas: Record<string, Proposta>;
  /** substituidas e vencidas deixam recibo, para a recusa dizer a verdade */
  saidas: Record<string, Saida>;
}

function arquivo(): string {
  return process.env.PROPOSTAS_ARQUIVO ?? join(RAIZ_PROJETO, '.estado', 'propostas.json');
}

async function carregar(): Promise<Estado> {
  const p = arquivo();
  if (!existsSync(p)) return { propostas: {}, saidas: {} };
  try {
    const b = JSON.parse(await readFile(p, 'utf8')) as Partial<Estado>;
    return { propostas: b.propostas ?? {}, saidas: b.saidas ?? {} };
  } catch {
    return { propostas: {}, saidas: {} };
  }
}

async function gravar(e: Estado): Promise<void> {
  const p = arquivo();
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(e, null, 2), { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, p);
}

/** Como a proposta e NOMEADA: id + acao + os dois primeiros bullets (alvo e valor). */
export function identidade(p: Pick<Proposta, 'id' | 'acao' | 'resumo'>): string {
  const bullets = p.resumo.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('•')).slice(0, 2).map((l) => l.replace(/^•\s*/, '').replace(/\*/g, ''));
  return bullets.length ? `${p.id}, ${p.acao}: ${bullets.join(' / ')}` : `${p.id}, ${p.acao}`;
}

const horaLocal = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

function limpar(e: Estado): Estado {
  const agora = Date.now();
  const propostas: Record<string, Proposta> = {};
  const saidas: Record<string, Saida> = {};
  for (const [id, s] of Object.entries(e.saidas)) if (new Date(s.esquece_em).getTime() > agora) saidas[id] = s;
  for (const [id, p] of Object.entries(e.propostas)) {
    if (new Date(p.expira_em).getTime() > agora) { propostas[id] = p; continue; }
    saidas[id] ??= {
      acao: p.acao, identidade: identidade(p),
      motivo: `venceu as ${horaLocal(p.expira_em)} (valia ${MINUTOS_DA_FAIXA[p.faixa]} min). Nada foi feito; monte de novo com os dados de agora.`,
      esquece_em: new Date(new Date(p.expira_em).getTime() + 24 * 3_600_000).toISOString(),
    };
  }
  return { propostas, saidas };
}

/** Rodape: COMO DESFAZER aparece em TODAS as faixas (faixa mede estrago, nao reversibilidade). */
export function rodape(p: Proposta): string {
  const volta = `\n\n↩️ Se precisar desfazer: ${p.desfazer}`;
  const vale = `vale ${MINUTOS_DA_FAIXA[p.faixa]} min`;
  if (p.faixa === 3) return `${volta}\n\nPara confirmar, escreva exatamente: *${p.palavra}*\n(proposta ${p.id}, ${vale})`;
  return `${volta}\n\nConfirma? (proposta ${p.id}, ${vale})`;
}

/** Varre o corpo atras do UUID de zeros ("nenhum" no ERP): a proposta nao nasce com ele. */
function acharUuidZero(v: unknown, caminho = 'corpo'): string | null {
  if (typeof v === 'string') return v === '00000000-0000-0000-0000-000000000000' ? caminho : null;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i += 1) { const a = acharUuidZero(v[i], `${caminho}[${i}]`); if (a) return a; }
    return null;
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { const a = acharUuidZero(x, k); if (a) return a; }
  }
  return null;
}

const PALAVRAS_FAIXA3 = ['QUITAR', 'CONFIRMO-BAIXA', 'AUTORIZO-PAGAMENTO'];

export interface Criada { proposta: Proposta; substituiu?: string }

/**
 * Cria a proposta e SUBSTITUI a que estava viva no mesmo canal (portao 2).
 * O escopo e o CANAL do ambiente, nunca um chat_id que o modelo passou.
 */
export async function criar(dados: Omit<Proposta, 'id' | 'criada_em' | 'expira_em' | 'canal' | 'palavra' | 'origem_em'>): Promise<Criada> {
  // Segunda camada do portao 3: tool nova que esqueca o guard nao abre buraco.
  const v = podeEscrever(dados.classe);
  if (!v.ok) throw new Error(v.motivo ?? 'escrita nao autorizada para este papel');
  const zeros = acharUuidZero(dados.corpo);
  if (zeros) throw new Error(`A proposta NAO foi criada: "${zeros}" veio com o UUID de zeros, que significa "nenhum".`);

  const agora = new Date();
  const canal = origemDoAmbiente();
  const p: Proposta = {
    ...dados,
    canal,
    ...(mensagemDoAmbiente()?.em ? { origem_em: mensagemDoAmbiente()!.em } : {}),
    id: randomUUID().slice(0, 8),
    criada_em: agora.toISOString(),
    expira_em: new Date(agora.getTime() + MINUTOS_DA_FAIXA[dados.faixa] * 60_000).toISOString(),
    ...(dados.faixa === 3 ? { palavra: PALAVRAS_FAIXA3[agora.getTime() % PALAVRAS_FAIXA3.length] } : {}),
  };
  const e = limpar(await carregar());
  let substituiu: string | undefined;
  for (const [id, viva] of Object.entries(e.propostas)) {
    if (viva.canal !== canal) continue;
    substituiu = identidade(viva);
    delete e.propostas[id];
    e.saidas[id] = {
      acao: viva.acao, identidade: identidade(viva),
      motivo: `foi substituida pela proposta ${p.id} (voce pediu outra coisa depois dela). Confirme a ${p.id}, ou peca para eu mostrar o que esta aberto.`,
      esquece_em: new Date(agora.getTime() + 3_600_000).toISOString(),
    };
  }
  e.propostas[p.id] = p;
  await gravar(e);
  return { proposta: p, ...(substituiu ? { substituiu } : {}) };
}

export interface Resgate { ok: boolean; proposta?: Proposta; motivo?: string; origem?: OrigemDaMensagem | 'sem-canal' }

/**
 * Valida a confirmacao e CONSOME a proposta (antes de executar: se a execucao
 * falhar, refazer exige propor de novo, e o cliente ve de novo o que vai
 * acontecer).
 *
 * A CONFIRMACAO VEM DO AMBIENTE, NAO DO ARGUMENTO. Quem escolhe a string
 * `resposta` e o modelo; enquanto a validacao olhar o argumento, o portao so
 * verifica o que o proprio confirmando escreveu. `resposta` continua indo para
 * a trilha: divergir do que o cliente escreveu e em si um sinal.
 */
export async function resgatar(id: string, resposta: string): Promise<Resgate> {
  const e = limpar(await carregar());
  const p = e.propostas[id];
  if (!p) {
    const s = e.saidas[id];
    if (s) return { ok: false, motivo: `essa proposta (${s.identidade}) ${s.motivo}` };
    return { ok: false, motivo: 'proposta nao encontrada. Me peca de novo o que voce quer e eu monto a proposta.' };
  }
  if (p.canal !== origemDoAmbiente()) {
    return { ok: false, motivo: 'essa proposta foi feita em outra conversa e so pode ser confirmada la.' };
  }

  const doCanal = mensagemDoAmbiente();
  const emCanal = origemDoAmbiente() !== 'desconhecida';
  if (emCanal && !doCanal) {
    // Fail-closed: em conversa real, sem a mensagem autentica nao ha como saber quem confirmou.
    return { ok: false, motivo: 'nao consegui verificar a sua confirmacao (o canal nao me entregou a sua mensagem original). Nao vou executar assim.' };
  }
  if (doCanal) {
    const escritaEm = new Date(doCanal.em).getTime();
    const propostaEm = new Date(p.criada_em).getTime();
    // A mensagem que confirma tem de ser OUTRA, posterior a que originou a
    // proposta: "da baixa e ja confirma" nao se autoconfirma no mesmo turno,
    // por mais rapido que o turno rode.
    const origemEm = p.origem_em ? new Date(p.origem_em).getTime() : Number.NEGATIVE_INFINITY;
    if (Number.isFinite(escritaEm) && escritaEm <= origemEm) {
      return { ok: false, motivo: `essa e a MESMA mensagem que pediu a acao; ela nao pode confirmar a proposta ${p.id}. Leia a proposta e responda em outra mensagem.` };
    }
    if (!Number.isFinite(escritaEm) || escritaEm < propostaEm - FOLGA_DO_CARIMBO_MS) {
      return { ok: false, motivo: `essa mensagem foi escrita ANTES de eu mostrar a proposta ${p.id}, entao nao pode valer como confirmacao dela. Leia a proposta e responda depois.` };
    }
  }

  const dita = (doCanal?.texto ?? resposta ?? '').trim();
  if (p.faixa === 3) {
    if (doCanal?.origem === 'voz') {
      // Nao consome: ele disse que quer, so pelo canal errado.
      return { ok: false, motivo: `por audio eu nao executo esta acao. Escreva "${p.palavra}" digitado e eu sigo. A proposta ${p.id} continua de pe.` };
    }
    if (dita.toUpperCase() !== (p.palavra ?? '').toUpperCase()) {
      return { ok: false, motivo: `esta acao exige que voce escreva exatamente "${p.palavra}".` };
    }
  } else {
    if (!afirmativo(dita)) {
      return {
        ok: false,
        motivo: dita.includes('?')
          ? `na mesma mensagem veio uma pergunta, entao nao tratei como confirmacao. Depois, se for para executar, mande so "sim" (proposta ${p.id}).`
          : `nao recebi uma confirmacao clara. Um "sim", "confirmo" ou "autorizo" basta; a proposta ${p.id} continua de pe ate vencer.`,
      };
    }
    const nomeada = operacaoNomeada(dita);
    const alvo = operacaoNomeada(p.acao);
    if (nomeada && alvo && nomeada !== alvo) {
      return { ok: false, motivo: `voce disse "${dita}", que fala de ${nomeada}, mas a proposta aberta e de ${alvo}. Nao executo uma coisa com o sim dito para outra.` };
    }
  }

  delete e.propostas[id];
  await gravar(e);
  return { ok: true, proposta: p, origem: doCanal?.origem ?? 'sem-canal' };
}

/** Propostas vivas do canal atual. */
export async function pendentes(): Promise<Proposta[]> {
  const canal = origemDoAmbiente();
  return Object.values(limpar(await carregar()).propostas).filter((p) => p.canal === canal);
}
