/**
 * Gate da ESCRITA: parede HTTP, kill-switch mestre, allowlist por tool, e as
 * tres listas (parede, papel, registry) nomeando as mesmas tools.
 *
 *   npm run gate:escrita
 *   npm run gate:escrita -- --known-bad   # sabotagem: a parede ignora o kill-switch
 */
import { Gate, KNOWN_BAD, sandbox } from '../lib/gate.js';

const dir = sandbox('gate-escrita');
const { iniciarMock } = await import('../../mock-erp/server.js');
const mock = await iniciarMock();
process.env.ERP_API_BASE = mock.url;
process.env.ERP_AUTH_BASE = mock.url;
process.env.ERP_ESCRITA = 'desabilitada';
process.env.ERP_ESCRITA_TOOLS = 'propor_dar_baixa';
process.env.CANAL_PAPEL = 'dono';

const bloqueio = await import('../../src/http/bloqueio.js');
const { checarTresListas, checarAllowlistDaEscrita } = await import('../../src/tools/registry.js');
const { ErpClient } = await import('../../src/http/client.js');
const { getConfig } = await import('../../src/config.js');
const { ler } = await import('../../src/auditoria/registro.js');

const avaliar: typeof bloqueio.avaliar = KNOWN_BAD
  ? (m, c, _escrita, tools) => bloqueio.avaliar(m, c, true, tools) // SABOTAGEM: ignora o kill-switch
  : bloqueio.avaliar;

const g = new Gate('escrita-gate');
const tudo = new Set(['propor_lancar_conta', 'propor_dar_baixa', 'propor_criar_cliente']);
const BAIXA = '/v1/financeiro/eventos-financeiros/parcelas/11111111-2222-4333-8444-555555555555/baixa';
const LANC = '/v1/financeiro/eventos-financeiros/contas-a-pagar';

g.checar('GET sempre passa, mesmo com tudo desligado', avaliar('GET', '/v1/pessoas', false, new Set()).permitido);
g.checar('kill-switch desligado bloqueia baixa MESMO com a tool na allowlist', !avaliar('POST', BAIXA, false, tudo).permitido, 'o mestre vem antes da lista');
g.checar('kill-switch desligado bloqueia lancamento', !avaliar('POST', LANC, false, tudo).permitido);
g.checar('a recusa do mestre nomeia o kill-switch', /kill-switch/.test(avaliar('POST', BAIXA, false, tudo).motivo ?? ''));
g.checar('mestre ligado + tool fora da allowlist: bloqueia', !avaliar('POST', LANC, true, new Set(['propor_dar_baixa'])).permitido);
g.checar('mestre ligado + allowlist vazia: bloqueia tudo', !avaliar('POST', BAIXA, true, new Set()).permitido);
g.checar('allowlist undefined (chamador JS antigo) bloqueia, nunca libera', !avaliar('POST', BAIXA, true, undefined as never).permitido);
g.checar('mestre ligado + tool na allowlist: passa', avaliar('POST', BAIXA, true, new Set(['propor_dar_baixa'])).permitido);
g.checar('rota de escrita sem tool mapeada: bloqueia', !avaliar('POST', '/v1/financeiro/transferencias', true, tudo).permitido);
g.checar('rota de exclusao nomeada: bloqueia mesmo com tudo ligado', !avaliar('POST', '/v1/pessoas/excluir', true, tudo).permitido);
g.checar('DELETE fora da lista nominal: bloqueia', !avaliar('DELETE', '/v1/pessoas/abc', true, tudo).permitido);
g.checar('metodo desconhecido: bloqueia', !avaliar('PURGE', '/v1/pessoas', true, tudo).permitido);
g.checar('as tres listas (parede, papel, registry) nomeiam as mesmas tools', checarTresListas().length === 0, checarTresListas().join('; '));
let derrubou = false;
try { checarAllowlistDaEscrita('propor_dar_biaxa'); } catch { derrubou = true; }
g.checar('nome errado na allowlist derruba o boot', derrubou, 'o operador acharia que liberou algo');

// Ponta a ponta: a parede no CLIENTE HTTP, contra o mock, com o kill-switch desligado.
if (!KNOWN_BAD) {
  const cli = new ErpClient(getConfig());
  const antes = mock.contadores.escritas;
  let barrou = false;
  try { await cli.escrever('POST', BAIXA, { valor: 1 }, { tool: 'teste' }); } catch (e) { barrou = (e as Error).name === 'BloqueioError'; }
  g.checar('cliente HTTP: kill-switch desligado nao deixa a chamada sair', barrou && mock.contadores.escritas === antes);
  const trilha = await ler();
  g.checar('a recusa vira linha "bloqueio" na trilha de auditoria', trilha.some((l) => l.tipo === 'bloqueio'));
}

await mock.fechar();
g.fim(dir);
