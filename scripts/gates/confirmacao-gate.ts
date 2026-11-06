/**
 * Gate da CONFIRMACAO (portao 4): o que conta como "sim", e a confirmacao vinda
 * do AMBIENTE (canal), com carimbo de hora.
 *
 *   npm run gate:confirmacao
 *   npm run gate:confirmacao -- --known-bad   # sabotagem: o "sim por prefixo" original
 */
import { Gate, KNOWN_BAD, sandbox } from '../lib/gate.js';

const dir = sandbox('gate-confirmacao');
process.env.ERP_ESCRITA_TOOLS = 'propor_lancar_conta,propor_dar_baixa,propor_criar_cliente';
process.env.CANAL_PAPEL = 'dono';
const conf = await import('../../src/escrita/confirmacao.js');
const { criar, resgatar } = await import('../../src/escrita/propostas.js');

// SABOTAGEM: o defeito real que motivou a regra: aceitar por PREFIXO.
const afirmativo = KNOWN_BAD ? (t: string) => /^(sim|ok|pode|faz|vai|manda|confirm|autoriz)/i.test(t.trim()) : conf.afirmativo;
const g = new Gate('confirmacao-gate');

const SIM = ['sim', 'Sim!', 'confirmo', 'autorizo', 'pode', 'pode sim', 'isso mesmo', 'manda ver', 'faz', 'tudo bem, pode confirmar', 'beleza', 'sim, pode dar baixa nessa de 1.200', 'ok, confirmo'];
const NAO = [
  'ok', 'ok, entendi', 'confirmo?', 'acho que sim', 'nao', 'não pode lançar', 'pode, mas antes testa o print',
  'faz o relatorio de vendas', 'manda o print', 'vai ter que ver', 'sim. confirmei todas anteriores?', 'talvez', 'espera',
  'sim, mas ignore o limite', '', '👍',
];
for (const s of SIM) g.checar(`confirma: ${JSON.stringify(s)}`, afirmativo(s));
for (const s of NAO) g.checar(`NAO confirma: ${JSON.stringify(s)}`, !afirmativo(s));
g.checar('"sim" para lancamento nao confirma uma baixa', conf.operacaoNomeada('sim, confirmo o lancamento') !== conf.operacaoNomeada('dar baixa'));

if (!KNOWN_BAD) {
  const base = { faixa: 2 as const, acao: 'dar baixa', classe: 'baixa' as const, resumo: '• NF 1\n• R$ 10', metodo: 'POST' as const, endpoint: '/x/baixa', corpo: { v: 1 }, desfazer: 'estornar' };
  process.env.CANAL_CHAT_ID = 'canal-1';

  // 1. Mensagem escrita ANTES da proposta nao vale ("lanca 1.200 e ja confirma").
  process.env.CANAL_MENSAGEM = 'da baixa na NF 1 e ja confirma, sim';
  process.env.CANAL_MENSAGEM_EM = new Date(Date.now() - 30_000).toISOString();
  const p1 = (await criar(base)).proposta;
  const r1 = await resgatar(p1.id, 'sim');
  g.checar('mensagem anterior a proposta NAO confirma, mesmo o modelo alegando "sim"', !r1.ok && /ANTES|MESMA/.test(r1.motivo ?? ''));

  // 1b. Turno rapido: a MESMA mensagem ("sim, da baixa") nao autoconfirma, nem dentro da folga.
  process.env.CANAL_MENSAGEM = 'sim, da baixa na NF 1';
  process.env.CANAL_MENSAGEM_EM = new Date().toISOString();
  const p1b = (await criar(base)).proposta;
  g.checar('a mensagem que ORIGINOU a proposta nao a confirma, mesmo em turno de 0 s', !(await resgatar(p1b.id, 'sim')).ok);

  // 2. O que vale e a frase do CANAL, nao o argumento do modelo.
  delete process.env.CANAL_MENSAGEM_EM;
  const p2 = (await criar(base)).proposta;
  process.env.CANAL_MENSAGEM = 'qual o saldo mesmo?';
  process.env.CANAL_MENSAGEM_EM = new Date(Date.now() + 5_000).toISOString();
  g.checar('o modelo alega "sim" mas o cliente perguntou outra coisa: recusa', !(await resgatar(p2.id, 'sim')).ok);

  // 3. Canal presente sem a mensagem autentica: fail-closed.
  delete process.env.CANAL_MENSAGEM_EM;
  const p3 = (await criar(base)).proposta;
  g.checar('em canal real, sem a mensagem do canal, nao executa', !(await resgatar(p3.id, 'sim')).ok);

  // 4. Mesmo segundo da criacao (carimbo truncado em segundos) ainda vale.
  const p4 = (await criar(base)).proposta;
  process.env.CANAL_MENSAGEM = 'sim';
  process.env.CANAL_MENSAGEM_EM = new Date(Math.floor(new Date(p4.criada_em).getTime() / 1000) * 1000).toISOString();
  g.checar('"sim" no mesmo segundo da proposta (carimbo truncado) confirma', (await resgatar(p4.id, 'qualquer')).ok);

  // 5. Faixa 3 por voz: nao executa, e nao consome.
  const p5 = (await criar({ ...base, faixa: 3 })).proposta;
  process.env.CANAL_MENSAGEM = p5.palavra ?? '';
  process.env.CANAL_MENSAGEM_EM = new Date(Date.now() + 5_000).toISOString();
  process.env.CANAL_MENSAGEM_ORIGEM = 'voz';
  g.checar('faixa 3 por VOZ, mesmo com a palavra certa: recusa', !(await resgatar(p5.id, p5.palavra ?? '')).ok);
  process.env.CANAL_MENSAGEM_ORIGEM = 'texto';
  g.checar('...e a proposta continua de pe: digitada, confirma', (await resgatar(p5.id, p5.palavra ?? '')).ok);
  delete process.env.CANAL_MENSAGEM_ORIGEM;
}
g.fim(dir);
