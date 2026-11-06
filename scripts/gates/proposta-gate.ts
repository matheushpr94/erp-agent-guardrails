/**
 * Gate da PROPOSTA: ciclo de vida (portao 2: uma proposta viva por canal) e
 * consumo.
 *
 *   npm run gate:proposta
 *   npm run gate:proposta -- --known-bad   # sabotagem: store ingenuo em memoria
 */
import { Gate, KNOWN_BAD, sandbox } from '../lib/gate.js';

const dir = sandbox('gate-proposta');
process.env.ERP_ESCRITA_TOOLS = 'propor_lancar_conta,propor_dar_baixa,propor_criar_cliente';
process.env.CANAL_PAPEL = 'dono';
const real = await import('../../src/escrita/propostas.js');
type Impl = Pick<typeof real, 'criar' | 'resgatar' | 'pendentes'>;

/** O store que "parece funcionar": guarda tudo, confirma qualquer coisa, nunca consome. */
function ingenuo(): Impl {
  const m = new Map<string, Awaited<ReturnType<typeof real.criar>>['proposta']>();
  let n = 0;
  return {
    criar: async (d) => {
      const p = { ...d, id: `p${(n += 1)}`, canal: process.env.CANAL_CHAT_ID ?? 'desconhecida', criada_em: new Date().toISOString(), expira_em: new Date(Date.now() + 3_600_000).toISOString() };
      m.set(p.id, p);
      return { proposta: p };
    },
    resgatar: async (id) => (m.get(id) ? { ok: true, proposta: m.get(id) } : { ok: false, motivo: 'nao encontrada' }),
    pendentes: async () => [...m.values()],
  };
}

const impl: Impl = KNOWN_BAD ? ingenuo() : real;
const g = new Gate('proposta-gate');
const base = (valor: number) => ({
  faixa: 2 as const, acao: 'dar baixa', classe: 'baixa' as const,
  resumo: `Vou registrar:\n\n• NF ${valor}\n• R$ ${valor}`, metodo: 'POST' as const,
  endpoint: `/v1/financeiro/eventos-financeiros/parcelas/${valor}/baixa`, corpo: { valor }, desfazer: 'estornar',
});

delete process.env.CANAL_CHAT_ID; // sem canal: CLI/gate, o argumento do modelo e julgado
const a = await impl.criar(base(100));
const b = await impl.criar(base(200));
g.checar('segunda proposta no mesmo canal SUBSTITUI a primeira', (await impl.pendentes()).length === 1, 'duas vivas tornam "pode confirmar" ambiguo');
const rA = await impl.resgatar(a.proposta.id, 'sim');
g.checar('confirmar a substituida e recusado', !rA.ok);
g.checar('...e a recusa diz que foi SUBSTITUIDA (nao "nao encontrada")', /substitu/i.test(rA.motivo ?? ''), 'o cliente le "nao encontrada" como defeito e insiste');
const rB = await impl.resgatar(b.proposta.id, 'sim');
g.checar('a viva confirma com "sim"', rB.ok);
const rB2 = await impl.resgatar(b.proposta.id, 'sim');
g.checar('proposta e CONSUMIDA: o mesmo id nao confirma duas vezes', !rB2.ok, 'falha na execucao exige propor de novo, e o cliente ve de novo');

process.env.CANAL_CHAT_ID = 'canal-A';
const doA = await impl.criar(base(300));
process.env.CANAL_CHAT_ID = 'canal-B';
await impl.criar(base(400));
process.env.CANAL_CHAT_ID = 'canal-A';
g.checar('proposta de OUTRO canal nao substitui a deste', (await impl.pendentes()).some((p) => p.id === doA.proposta.id));
process.env.CANAL_CHAT_ID = 'canal-B';
process.env.CANAL_MENSAGEM = 'sim';
process.env.CANAL_MENSAGEM_EM = new Date(Date.now() + 5_000).toISOString();
const cruzada = await impl.resgatar(doA.proposta.id, 'sim');
g.checar('proposta do canal A nao pode ser confirmada no canal B', !cruzada.ok);
delete process.env.CANAL_MENSAGEM; delete process.env.CANAL_MENSAGEM_EM; delete process.env.CANAL_CHAT_ID;

let zeroBarrado = false;
try { await impl.criar({ ...base(500), corpo: { conta_financeira: '00000000-0000-0000-0000-000000000000' } }); } catch { zeroBarrado = true; }
g.checar('UUID de zeros no corpo: a proposta nao nasce', zeroBarrado);

const r3 = await impl.criar({ ...base(20_000), faixa: 3 });
g.checar('faixa 3 recebe palavra de confirmacao', !!r3.proposta.palavra);
g.checar('faixa 3: "sim" NAO basta', !(await impl.resgatar(r3.proposta.id, 'sim')).ok);
g.checar('faixa 3: a palavra exata confirma', (await impl.resgatar(r3.proposta.id, r3.proposta.palavra ?? '')).ok);

const rodapeTxt = KNOWN_BAD ? '' : real.rodape({ ...(await impl.criar(base(600))).proposta });
g.checar('rodape mostra COMO DESFAZER em toda faixa', /desfazer/.test(rodapeTxt));
g.fim(dir);
