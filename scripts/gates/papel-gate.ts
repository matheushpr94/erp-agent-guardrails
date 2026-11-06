/**
 * Gate do PAPEL (alcada) e da ONDA. O papel vem do AMBIENTE (gateway), nunca de
 * argumento de tool.
 *
 *   npm run gate:papel
 *   npm run gate:papel -- --known-bad    # sabotagem: funcionario passa a escrever
 */
import { Gate, KNOWN_BAD, sandbox } from '../lib/gate.js';

const dir = sandbox('gate-papel');
process.env.ERP_ESCRITA_TOOLS = 'propor_lancar_conta,propor_dar_baixa,propor_criar_cliente';
const papel = await import('../../src/escrita/papel.js');
const { criar } = await import('../../src/escrita/propostas.js');

const podeEscrever: typeof papel.podeEscrever = KNOWN_BAD
  ? (c) => (process.env.CANAL_PAPEL === 'funcionario' ? { ok: true } : papel.podeEscrever(c)) // SABOTAGEM
  : papel.podeEscrever;

const cenario = (p?: string, onda?: string, dev?: string) => {
  for (const [k, v] of [['CANAL_PAPEL', p], ['CANAL_ONDA', onda], ['CANAL_DEV_ESCREVE', dev]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
};
const classes = Object.keys(papel.ONDA_DA_CLASSE) as Array<keyof typeof papel.ONDA_DA_CLASSE>;
const g = new Gate('papel-gate');

cenario('funcionario', '9');
for (const c of classes) g.checar(`funcionario NAO escreve: ${c}`, !podeEscrever(c).ok, 'autorizacao e do dono');
g.checar('a recusa do funcionario aponta o dono', /dono/.test(podeEscrever('baixa').motivo ?? ''));

for (const p of [undefined, '', 'chefe', 'admin', 'DONO_DA_EMPRESA']) {
  cenario(p, '9');
  g.checar(`papel ${JSON.stringify(p)} NAO escreve (fail-closed)`, !podeEscrever('baixa').ok);
}
cenario('dev', '9');
g.checar('dev sem CANAL_DEV_ESCREVE=sim NAO escreve', !podeEscrever('baixa').ok);
cenario('dev', '9', 'sim');
g.checar('dev com a chave ligada escreve', podeEscrever('baixa').ok);
cenario('dono', '1');
g.checar('dono na onda 1: baixa (onda 1) liberada', podeEscrever('baixa').ok);
g.checar('dono na onda 1: lancamento (onda 2) barrado', !podeEscrever('lancamento').ok);
cenario('dono', '2');
for (const c of classes) g.checar(`dono na onda 2 escreve: ${c}`, podeEscrever(c).ok);
process.env.ERP_ESCRITA_TOOLS = 'propor_dar_baixa';
const { _resetConfig } = await import('../../src/config.js');
_resetConfig();
g.checar('allowlist sem a tool: dono e recusado AO PROPOR (nao queima o ritual)', !podeEscrever('lancamento').ok);

// Segunda camada: criar() reforca o papel mesmo se a tool esquecer o guard.
if (!KNOWN_BAD) {
  cenario('funcionario', '9');
  let barrou = false;
  try {
    await criar({ faixa: 2, acao: 'dar baixa', classe: 'baixa', resumo: 'x', metodo: 'POST', endpoint: '/x', corpo: {}, desfazer: 'x' });
  } catch { barrou = true; }
  g.checar('criar() recusa funcionario mesmo sem guard na tool', barrou);
}
g.fim(dir);
