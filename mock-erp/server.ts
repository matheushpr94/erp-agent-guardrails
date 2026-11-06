/**
 * ERP SIMULADO: servidor HTTP proprio, escrito a partir do COMPORTAMENTO que o
 * cliente MCP precisa exercitar (nao de nenhuma especificacao de terceiro).
 *
 * Reproduz de proposito as armadilhas de integracao que um ERP real tem:
 *   - OAuth2 com refresh_token ROTATIVO (o anterior morre a cada renovacao);
 *   - access_token que expira (TTL configuravel) -> 401;
 *   - limite de taxa por segundo -> 429 com Retry-After;
 *   - escrita ASSINCRONA: POST devolve {protocolo, status: PENDING};
 *   - envelopes de listagem diferentes por rota (itens/items/array cru).
 *
 * Rotas de controle para testes em /__mock/* (reset, estado, caos).
 *
 *   npm run mock                       # 127.0.0.1:8787
 *   MOCK_PORT=9000 npm run mock
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { seed, type Estado, type Parcela } from './seed.js';

const CLIENT_ID = 'mock-client';
const CLIENT_SECRET = 'mock-secret';
const CODIGO_DEV = 'mock-dev-code';

export interface OpcoesMock { port?: number; host?: string; tokenTtlS?: number; limitePorSegundo?: number }

export interface Mock {
  server: Server;
  url: string;
  estado: () => Estado;
  contadores: Record<string, number>;
  caos: { forcar429: number; forcar401: number; protocoloFalha: boolean };
  reset: () => void;
  fechar: () => Promise<void>;
}

export async function iniciarMock(op: OpcoesMock = {}): Promise<Mock> {
  let db = seed();
  const ttl = op.tokenTtlS ?? Number(process.env.MOCK_TOKEN_TTL_S ?? 3600);
  const limite = op.limitePorSegundo ?? 10;
  const tokens = new Map<string, number>(); // access -> expira (ms)
  let refreshVivo: string | null = null;
  const protocolos = new Map<string, { polls: number; id_recurso: string; falha: boolean }>();
  const hits: number[] = [];
  const contadores: Record<string, number> = { requisicoes: 0, r429: 0, r401: 0, token: 0, escritas: 0 };
  const caos = { forcar429: 0, forcar401: 0, protocoloFalha: false };

  const json = (res: ServerResponse, status: number, corpo: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(corpo === undefined ? '' : JSON.stringify(corpo));
  };
  const lerCorpo = (req: IncomingMessage) => new Promise<string>((ok) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => ok(b));
  });
  const emitirTokens = () => {
    const access = `mock-at-${randomUUID()}`;
    refreshVivo = `mock-rt-${randomUUID()}`;
    tokens.set(access, Date.now() + ttl * 1000);
    contadores.token! += 1;
    return { access_token: access, refresh_token: refreshVivo, token_type: 'Bearer', expires_in: ttl };
  };
  const pessoaDe = (id: string) => db.pessoas.find((p) => p.id === id);
  const vistaParcela = (p: Parcela) => {
    const pessoa = pessoaDe(p.id_pessoa);
    const status = p.nao_pago === 0 ? 'QUITADO' : p.data_vencimento < new Date().toISOString().slice(0, 10) ? 'ATRASADO' : 'EM_ABERTO';
    return { ...p, status, [p.tipo === 'pagar' ? 'fornecedor' : 'cliente']: pessoa ? { id: pessoa.id, nome: pessoa.nome } : null };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const path = url.pathname;
    const q = url.searchParams;
    contadores.requisicoes! += 1;
    try {
      /* ── controle de teste ─────────────────────────────────────── */
      if (path === '/__mock/reset' && req.method === 'POST') { db = seed(); protocolos.clear(); return json(res, 200, { ok: true }); }
      if (path === '/__mock/estado') return json(res, 200, { contadores, parcelas: db.parcelas.length, pessoas: db.pessoas.length });

      /* ── OAuth2 ───────────────────────────────────────────────── */
      if (path === '/oauth2/token' && req.method === 'POST') {
        const auth = req.headers.authorization ?? '';
        const esperado = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
        if (auth !== esperado) return json(res, 401, { error: 'invalid_client' });
        const form = new URLSearchParams(await lerCorpo(req));
        if (form.get('grant_type') === 'authorization_code' && form.get('code') === CODIGO_DEV) return json(res, 200, emitirTokens());
        if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === refreshVivo && refreshVivo) return json(res, 200, emitirTokens());
        return json(res, 400, { error: 'invalid_grant' });
      }

      /* ── taxa e autenticacao ──────────────────────────────────── */
      const agora = Date.now();
      while (hits.length && hits[0]! <= agora - 1000) hits.shift();
      if (caos.forcar429 > 0 || hits.length >= limite) {
        if (caos.forcar429 > 0) caos.forcar429 -= 1;
        contadores.r429! += 1;
        return json(res, 429, { erro: 'limite de requisicoes por segundo' }, { 'Retry-After': '1' });
      }
      hits.push(agora);
      const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const exp = tokens.get(bearer);
      if (caos.forcar401 > 0 || !exp || exp < agora) {
        if (caos.forcar401 > 0) { caos.forcar401 -= 1; tokens.delete(bearer); }
        contadores.r401! += 1;
        return json(res, 401, { erro: 'token invalido ou expirado' });
      }

      /* ── leitura ──────────────────────────────────────────────── */
      if (req.method === 'GET') {
        if (path === '/v1/conta-financeira') {
          return json(res, 200, { itens: db.contas.map(({ saldo: _s, ...c }) => c), itens_totais: db.contas.length });
        }
        let m = path.match(/^\/v1\/conta-financeira\/([^/]+)\/saldo-atual$/);
        if (m) {
          const c = db.contas.find((x) => x.id === m![1]);
          return c ? json(res, 200, { saldo_atual: c.saldo }) : json(res, 404, undefined);
        }
        m = path.match(/^\/v1\/financeiro\/eventos-financeiros\/contas-a-(pagar|receber)\/buscar$/);
        if (m) {
          const tipo = m[1];
          const de = q.get('data_vencimento_de') ?? '0000-00-00';
          const ate = q.get('data_vencimento_ate') ?? '9999-99-99';
          if (de > ate) return json(res, 400, { erro: 'data inicial maior que a final' });
          const busca = (q.get('busca') ?? '').toLowerCase();
          const filtradas = db.parcelas.filter((p) => p.tipo === tipo && p.data_vencimento >= de && p.data_vencimento <= ate)
            .map(vistaParcela)
            .filter((p) => !q.get('status') || p.status === q.get('status'))
            .filter((p) => !busca || `${p.descricao} ${pessoaDe(p.id_pessoa)?.nome ?? ''}`.toLowerCase().includes(busca))
            .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento));
          const tam = Number(q.get('tamanho_pagina') ?? 20);
          if (![10, 20, 50, 100].includes(tam)) return json(res, 400, { erro: 'tamanho da pagina deve ser 10, 20, 50 ou 100' });
          const pag = Number(q.get('pagina') ?? 1);
          const soma = (k: 'total' | 'pago' | 'nao_pago') => Math.round(filtradas.reduce((s, p) => s + p[k], 0) * 100) / 100;
          return json(res, 200, {
            itens: filtradas.slice((pag - 1) * tam, pag * tam),
            itens_totais: filtradas.length,
            totais: { total: soma('total'), pago: soma('pago'), aberto: soma('nao_pago'), atrasado: Math.round(filtradas.filter((p) => p.status === 'ATRASADO').reduce((s, p) => s + p.nao_pago, 0) * 100) / 100 },
          });
        }
        m = path.match(/^\/v1\/financeiro\/eventos-financeiros\/parcelas\/([^/]+)$/);
        if (m) {
          const p = db.parcelas.find((x) => x.id === m![1]);
          return p ? json(res, 200, vistaParcela(p)) : json(res, 404, undefined);
        }
        if (path === '/v1/pessoas') {
          const busca = (q.get('busca') ?? '').toLowerCase();
          const lista = db.pessoas
            .filter((p) => !q.get('perfil') || p.perfil === q.get('perfil'))
            .filter((p) => !busca || p.nome.toLowerCase().includes(busca) || (p.documento ?? '').includes(busca.replace(/\D/g, '') || '§'));
          const tam = Number(q.get('tamanho_pagina') ?? 20);
          const pag = Number(q.get('pagina') ?? 1);
          // envelope DIFERENTE do financeiro, de proposito
          return json(res, 200, { items: lista.slice((pag - 1) * tam, pag * tam), totalItems: lista.length });
        }
        m = path.match(/^\/v1\/pessoas\/([^/]+)$/);
        if (m) {
          const p = pessoaDe(m[1]!);
          return p ? json(res, 200, p) : json(res, 404, undefined);
        }
        if (path === '/v1/categorias') return json(res, 200, db.categorias); // array cru
        m = path.match(/^\/v1\/protocolo\/([^/]+)$/);
        if (m) {
          const p = protocolos.get(m[1]!);
          if (!p) return json(res, 404, undefined);
          p.polls += 1;
          if (p.polls < 2) return json(res, 200, { id: m[1], status: 'PENDING' });
          return json(res, 200, { id: m[1], status: p.falha ? 'ERROR' : 'SUCCESS', ...(p.falha ? {} : { id_recurso: p.id_recurso }) });
        }
        return json(res, 404, { erro: `rota GET desconhecida no mock: ${path}` });
      }

      /* ── escrita ──────────────────────────────────────────────── */
      if (req.method === 'POST') {
        const corpo = JSON.parse((await lerCorpo(req)) || '{}') as Record<string, unknown>;
        let m = path.match(/^\/v1\/financeiro\/eventos-financeiros\/contas-a-(pagar|receber)$/);
        if (m) {
          if (typeof corpo.valor !== 'number' || !corpo.descricao || !corpo.contato || !corpo.categoria) return json(res, 400, { erro: 'campos obrigatorios: descricao, valor, contato, categoria' });
          contadores.escritas! += 1;
          const id = randomUUID();
          db.parcelas.push({
            id, id_evento: randomUUID(), tipo: m[1] as 'pagar' | 'receber', descricao: String(corpo.descricao),
            data_vencimento: String(corpo.data_vencimento), total: corpo.valor, pago: 0, nao_pago: corpo.valor,
            id_pessoa: String(corpo.contato), id_categoria: String(corpo.categoria), data_criacao: new Date().toISOString().slice(0, 10),
          });
          const protocolo = randomUUID();
          protocolos.set(protocolo, { polls: 0, id_recurso: id, falha: caos.protocoloFalha });
          return json(res, 200, { protocolo, status: 'PENDING' });
        }
        m = path.match(/^\/v1\/financeiro\/eventos-financeiros\/parcelas\/([^/]+)\/baixa$/);
        if (m) {
          const p = db.parcelas.find((x) => x.id === m![1]);
          if (!p) return json(res, 404, undefined);
          const valor = Number(corpo.valor);
          const conta = db.contas.find((c) => c.id === corpo.conta_financeira);
          if (!conta || !(valor > 0)) return json(res, 400, { erro: 'conta_financeira e valor sao obrigatorios' });
          contadores.escritas! += 1;
          p.pago = Math.round((p.pago + valor) * 100) / 100;
          p.nao_pago = Math.max(0, Math.round((p.total - p.pago) * 100) / 100);
          conta.saldo = Math.round((conta.saldo + (p.tipo === 'pagar' ? -valor : valor)) * 100) / 100;
          return json(res, 200, { id: randomUUID(), parcela: vistaParcela(p) });
        }
        if (path === '/v1/pessoas') {
          const doc = String(corpo.documento ?? '');
          if (!corpo.nome) return json(res, 400, { erro: 'nome obrigatorio' });
          if (doc && db.pessoas.some((p) => p.documento === doc)) return json(res, 409, { erro: 'documento ja cadastrado' });
          contadores.escritas! += 1;
          const nova = { id: randomUUID(), nome: String(corpo.nome), perfil: (corpo.perfil === 'Fornecedor' ? 'Fornecedor' : 'Cliente') as 'Cliente' | 'Fornecedor', ficticio: true as const, ...(doc ? { documento: doc } : {}) };
          db.pessoas.push(nova);
          return json(res, 201, { id: nova.id });
        }
      }
      return json(res, 405, { erro: `metodo/rota nao suportado no mock: ${req.method} ${path}` });
    } catch (e) {
      return json(res, 500, { erro: String(e) });
    }
  });

  await new Promise<void>((ok) => server.listen(op.port ?? 0, op.host ?? '127.0.0.1', ok));
  const addr = server.address();
  const porta = typeof addr === 'object' && addr ? addr.port : op.port;
  return {
    server,
    url: `http://127.0.0.1:${porta}`,
    estado: () => db,
    contadores,
    caos,
    reset: () => { db = seed(); protocolos.clear(); },
    fechar: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.MOCK_PORT ?? 8787);
  iniciarMock({ port }).then((m) => {
    process.stdout.write(`mock-erp ouvindo em ${m.url} (empresa ficticia: ${m.estado().empresa.nome})\n`);
  });
}
