/**
 * Gate da INTEGRACAO: o que nao aparece no type-check e so aparece rodando.
 *   - throttle de DUAS janelas (medido com janelas em ms)
 *   - refresh_token rotativo: 5 renovacoes concorrentes = 1 ida ao endpoint
 *   - escrita atomica do token store
 *   - 401 -> refresh -> retry; 429 -> Retry-After -> retry
 *   - escrita assincrona: protocolo PENDING -> SUCCESS / ERROR
 *   - idempotencia e estado incerto na trilha
 *
 *   npm run gate:integracao
 *   npm run gate:integracao -- --known-bad   # sabotagem: limitador so com a janela curta
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Gate, KNOWN_BAD, sandbox } from '../lib/gate.js';

const dir = sandbox('gate-integracao');
const { iniciarMock } = await import('../../mock-erp/server.js');
const mock = await iniciarMock({ limitePorSegundo: 1000 });
Object.assign(process.env, {
  ERP_API_BASE: mock.url, ERP_AUTH_BASE: mock.url, ERP_ESCRITA: 'habilitada',
  ERP_ESCRITA_TOOLS: 'propor_lancar_conta,propor_dar_baixa,propor_criar_cliente', ERP_PROTOCOLO_ESPERA_MS: '20',
});
const { RateLimiter } = await import('../../src/http/throttle.js');
const { getConfig } = await import('../../src/config.js');
const { getAccessToken, refreshTokens, _metricas } = await import('../../src/auth/oauth.js');
const { readTokens, writeTokens } = await import('../../src/auth/token-store.js');
const { ErpClient, ApiError } = await import('../../src/http/client.js');
const { ler } = await import('../../src/auditoria/registro.js');

const g = new Gate('integracao-gate');
const cfg = getConfig();

/* ── throttle: 3 por 100 ms E 5 por 1000 ms ─────────────────────── */
{
  const lim = KNOWN_BAD ? new RateLimiter(3, Number.MAX_SAFE_INTEGER, 100, 1000) : new RateLimiter(3, 5, 100, 1000);
  const t0 = Date.now();
  const marcas: number[] = [];
  for (let i = 0; i < 6; i += 1) { await lim.acquire(); marcas.push(Date.now() - t0); }
  g.checar('janela curta: a 4a chamada espera a janela de 100 ms', marcas[3]! >= 95, `marcas=${marcas.join(',')}`);
  g.checar('janela longa: a 6a chamada espera a janela de 1 s', marcas[5]! >= 990, `marcas=${marcas.join(',')}`);
}

/* ── token: obtencao, rotacao concorrente, escrita atomica ──────── */
await g.checarAsync('mock: primeiro acesso troca o codigo de desenvolvimento por tokens', async () => (await getAccessToken(cfg)).startsWith('mock-at-'));
{
  const t = (await readTokens(cfg.tokenFileAbs))!;
  await writeTokens(cfg.tokenFileAbs, { ...t, expires_at: Date.now() - 1 });
  const antes = _metricas.chamadasAoToken;
  const r = await Promise.allSettled(Array.from({ length: 5 }, () => refreshTokens(cfg)));
  g.checar('5 renovacoes concorrentes: todas resolvem', r.every((x) => x.status === 'fulfilled'), JSON.stringify(r.filter((x) => x.status === 'rejected')));
  g.checar('...e o endpoint de token e chamado UMA vez (o lock serializa; ninguem queima o refresh rotativo)', _metricas.chamadasAoToken - antes === 1, `chamadas=${_metricas.chamadasAoToken - antes}`);
  const sobras = readdirSync(dirname(cfg.tokenFileAbs)).filter((f) => f.endsWith('.tmp') || f.endsWith('.lock'));
  g.checar('escrita atomica: nenhum .tmp/.lock sobrando e o JSON e valido', sobras.length === 0 && !!JSON.parse(readFileSync(cfg.tokenFileAbs, 'utf8')).refresh_token);
  const modo = (await import('node:fs')).statSync(cfg.tokenFileAbs).mode & 0o777;
  g.checar('token store gravado com permissao 0600', modo === 0o600, modo.toString(8));
}
{
  // refresh_token rotativo: o anterior morre (o mock recusa reusar).
  const velho = (await readTokens(cfg.tokenFileAbs))!.refresh_token;
  await writeTokens(cfg.tokenFileAbs, { ...(await readTokens(cfg.tokenFileAbs))!, expires_at: Date.now() - 1 });
  await refreshTokens(cfg);
  const res = await fetch(`${mock.url}/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from('mock-client:mock-secret').toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: velho }).toString(),
  });
  g.checar('o refresh_token anterior e recusado depois da rotacao (invalid_grant)', res.status === 400);
}

/* ── 401 e 429 no meio da leitura ──────────────────────────────── */
const cli = new ErpClient(cfg);
{
  mock.caos.forcar401 = 1;
  const antes = _metricas.chamadasAoToken;
  const contas = await cli.get<{ itens: unknown[] }>('/v1/conta-financeira');
  g.checar('401 -> refresh -> retry devolve os dados', contas.itens.length > 0 && _metricas.chamadasAoToken - antes === 1);
  mock.caos.forcar401 = 2;
  let erro401 = 0;
  try { await cli.get('/v1/conta-financeira'); } catch (e) { erro401 = e instanceof ApiError ? e.status : -1; }
  g.checar('401 de novo depois de renovar: desiste (nao queima refresh em loop)', erro401 === 401);
  mock.caos.forcar401 = 0;
}
{
  mock.caos.forcar429 = 1;
  const t0 = Date.now();
  const r = await cli.get<unknown[]>('/v1/categorias');
  g.checar('429 com Retry-After: espera e repete', Array.isArray(r) && Date.now() - t0 >= 900);
}
await g.checarAsync('funil: UUID de zeros na rota e recusado antes de sair', async () => {
  try { await cli.get('/v1/pessoas/00000000-0000-0000-0000-000000000000'); return false; } catch (e) { return /zeros/.test(String(e)); }
});
await g.checarAsync('funil: intervalo invertido e recusado antes de sair', async () => {
  try { await cli.get('/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar', { data_vencimento_de: '2026-12-31', data_vencimento_ate: '2026-01-01' }); return false; } catch (e) { return /impossivel/.test(String(e)); }
});

/* ── escrita assincrona, idempotencia, estado incerto ───────────── */
const est = mock.estado();
const corpo = { descricao: 'Teste de protocolo', valor: 10, data_vencimento: '2026-12-01', contato: est.pessoas[0]!.id, categoria: est.categorias[0]!.id, conta_financeira: est.contas[0]!.id };
const rota = '/v1/financeiro/eventos-financeiros/contas-a-receber';
{
  const r = await cli.escrever<{ status: string }>('POST', rota, corpo, { origem: { mensagem: 'lanca 10' } });
  g.checar('protocolo PENDING e acompanhado ate SUCCESS', r.status === 'SUCCESS');
  const antes = mock.contadores.escritas;
  await cli.escrever('POST', rota, corpo, { origem: { mensagem: 'lanca 10' } });
  g.checar('mesma acao repetida: idempotencia devolve o resultado anterior SEM chamar o ERP', mock.contadores.escritas === antes);
}
{
  mock.caos.protocoloFalha = true;
  let status = 0;
  try { await cli.escrever('POST', rota, { ...corpo, valor: 11 }, { origem: { mensagem: 'lanca 11' } }); } catch (e) { status = e instanceof ApiError ? e.status : -1; }
  mock.caos.protocoloFalha = false;
  const desfechos = (await ler()).filter((l) => l.tipo === 'desfecho');
  g.checar('protocolo ERROR vira 502 e a trilha grava 502 (nao o 200 do "recebi")', status === 502 && desfechos.some((d) => d.status === 502));
}
{
  // Tentativa orfa: linha de tentativa sem desfecho (processo morreu no meio).
  const { chaveDe } = await import('../../src/auditoria/registro.js');
  const chave = chaveDe('POST', rota, 'desconhecida', 'lanca 12', { ...corpo, valor: 12 });
  const arq = process.env.AUDITORIA_ARQUIVO!;
  writeFileSync(arq, readFileSync(arq, 'utf8') + JSON.stringify({ tipo: 'tentativa', chave }) + '\n');
  let barrou = false;
  try { await cli.escrever('POST', rota, { ...corpo, valor: 12 }, { origem: { mensagem: 'lanca 12' } }); } catch (e) { barrou = (e as Error).name === 'BloqueioError'; }
  g.checar('tentativa orfa: recusa repetir as cegas e manda conferir', barrou);
}
g.checar('trilha existe e tem tentativa + desfecho', existsSync(process.env.AUDITORIA_ARQUIVO!) && (await ler()).some((l) => l.tipo === 'tentativa'));

await mock.fechar();
g.fim(dir);
