import { getConfig, type Config } from '../config.js';
import { getAccessToken, refreshTokens } from '../auth/oauth.js';
import { RateLimiter } from './throttle.js';
import { allowlistDe, avaliar, BloqueioError } from './bloqueio.js';
import {
  chaveDe, estadoIncerto, jaExecutada, registrarBloqueio, registrarDesfecho, registrarTentativa, type Origem,
} from '../auditoria/registro.js';
import { auditarLeitura, origemDoAmbiente } from '../auditoria/leitura.js';

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: string, readonly endpoint: string) {
    super(`ERP ${status} em ${endpoint}: ${body.slice(0, 300)}`);
    this.name = 'ApiError';
  }
}

export type QueryValue = string | number | boolean | Array<string | number> | undefined | null;
export type Query = Record<string, QueryValue>;

const MAX_429_RETRIES = 4;
const UUID_ZERO = '00000000-0000-0000-0000-000000000000';
const PARES: ReadonlyArray<readonly [string, string]> = [['_de', '_ate'], ['_inicio', '_fim'], ['_inicial', '_final']];

/**
 * Cliente HTTP do ERP. Dois pontos de saida, e so dois:
 *
 *   get()       Bearer, throttle de duas janelas, 401 -> refresh -> retry UMA
 *               vez, 429 -> Retry-After ou backoff exponencial.
 *   escrever()  o unico caminho para metodo != GET: parede (kill-switch +
 *               allowlist), idempotencia, trilha ANTES da chamada, desfecho
 *               SEMPRE, e acompanhamento de protocolo assincrono.
 */
export class ErpClient {
  private readonly limiter: RateLimiter;

  /**
   * Sem config explicita, cada chamada le o config VIVO: o kill-switch e a
   * allowlist valem no momento de agir, nao no momento em que o cliente nasceu
   * (o cliente e compartilhado e vive o processo inteiro). Achado do eval
   * `kill-switch-desligado` com o confirmar ingenuo: a parede usava a copia
   * congelada no construtor.
   */
  constructor(private readonly cfgFixa?: Config) {
    const c = cfgFixa ?? getConfig();
    this.limiter = new RateLimiter(c.ERP_RPS, c.ERP_RPM);
  }

  private get cfg(): Config {
    return this.cfgFixa ?? getConfig();
  }

  /**
   * Entrada sintaticamente valida que devolve ZERO com cara de fato e o pior
   * erro de um agente financeiro: ninguem questiona "R$ 0,00". Duas recusas no
   * funil, valendo para toda tool:
   *   - UUID de zeros (no ERP significa "nenhum", nao e um id);
   *   - intervalo invertido (`valor_de` > `valor_ate`), que nao pode ter resposta.
   */
  private recusarUuidZero(onde: string, valor: string): void {
    if (valor === UUID_ZERO) {
      throw new Error(`O valor em "${onde}" e o UUID de zeros, que significa "nenhum" e nao e um id. A consulta NAO foi feita: a resposta seria um zero silencioso.`);
    }
  }

  private recusarIntervaloInvertido(query: Query): void {
    for (const [a, b] of PARES) {
      for (const chave of Object.keys(query)) {
        if (!chave.endsWith(a)) continue;
        const par = chave.slice(0, -a.length) + b;
        const de = query[chave];
        const ate = query[par];
        if (de == null || de === '' || ate == null || ate === '') continue;
        const nDe = Number(de);
        const nAte = Number(ate);
        const invertido = Number.isFinite(nDe) && Number.isFinite(nAte) ? nDe > nAte : String(de) > String(ate);
        if (invertido) {
          throw new Error(`Intervalo impossivel: "${chave}" (${String(de)}) e maior que "${par}" (${String(ate)}). A consulta NAO foi feita; inverta os valores.`);
        }
      }
    }
  }

  private buildUrl(path: string, query?: Query): URL {
    this.recusarUuidZero('id na rota', path.split('?')[0]!.split('/').pop() ?? '');
    if (query) this.recusarIntervaloInvertido(query);
    const url = new URL(path, this.cfg.apiBase);
    for (const [chave, valor] of Object.entries(query ?? {})) {
      if (valor === undefined || valor === null || valor === '') continue;
      for (const v of Array.isArray(valor) ? valor : [valor]) {
        this.recusarUuidZero(chave, String(v));
        url.searchParams.append(chave, String(v));
      }
    }
    return url;
  }

  async get<T = unknown>(path: string, query?: Query): Promise<T> {
    const inicio = Date.now();
    try {
      const dados = await this.fazerGet<T>(path, query);
      await auditarLeitura(path, query as Record<string, unknown> | undefined, inicio, 200, dados);
      return dados;
    } catch (e) {
      await auditarLeitura(path, query as Record<string, unknown> | undefined, inicio, e instanceof ApiError ? e.status : 'erro');
      throw e;
    }
  }

  private async fazerGet<T>(path: string, query?: Query): Promise<T> {
    const url = this.buildUrl(path, query);
    let token = await getAccessToken(this.cfg);
    let jaRenovou = false;
    let tentativas429 = 0;
    for (;;) {
      await this.limiter.acquire();
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });

      // 401 UMA vez: se continuar 401 depois de renovar, nao e expiracao
      // (escopo, conta desconectada) e insistir so queima refresh_token.
      if (res.status === 401 && !jaRenovou) {
        jaRenovou = true;
        token = (await refreshTokens(this.cfg, token)).access_token;
        continue;
      }
      if (res.status === 429) {
        if (tentativas429 >= MAX_429_RETRIES) throw new ApiError(429, await res.text(), url.pathname);
        const ra = Number(res.headers.get('retry-after'));
        const espera = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(30_000, 250 * 2 ** tentativas429);
        tentativas429 += 1;
        await new Promise((r) => setTimeout(r, espera));
        continue;
      }
      if (!res.ok) throw new ApiError(res.status, await res.text(), url.pathname);
      return (await res.json()) as T;
    }
  }

  /**
   * ESCRITA. A ordem dos passos nao e arbitraria:
   *   1. PAREDE antes de tudo (recusa vira linha de bloqueio na trilha);
   *   2. IDEMPOTENCIA: chave com desfecho 2xx devolve o resultado anterior;
   *   3. ESTADO INCERTO: tentativa orfa ou protocolo pendente recusam repetir;
   *   4. TENTATIVA gravada ANTES da chamada;
   *   5. chamada; 6. DESFECHO sempre, com o resultado final (nao o "recebi").
   */
  async escrever<T = unknown>(
    metodo: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    corpo: unknown,
    ctx: { tool?: string; origem?: Origem; antes?: unknown } = {},
  ): Promise<T> {
    const origem: Origem = { ...(ctx.origem ?? {}), origem_canal: origemDoAmbiente() };
    const v = avaliar(metodo, path, this.cfg.ERP_ESCRITA === 'habilitada', allowlistDe(this.cfg.ERP_ESCRITA_TOOLS));
    if (!v.permitido) {
      await registrarBloqueio(metodo, path, v.motivo ?? 'sem motivo', origem);
      throw new BloqueioError(metodo, path, v.motivo ?? 'sem motivo');
    }

    const chave = chaveDe(metodo, path, origem.origem_canal, origem.mensagem, corpo);
    const anterior = await jaExecutada(chave);
    if (anterior) {
      await registrarDesfecho(chave, { ...anterior, duracao_ms: 0, repetida: true });
      return anterior.resposta as T;
    }
    const incerto = await estadoIncerto(chave);
    if (incerto) {
      await registrarBloqueio(metodo, path, incerto.frase, origem);
      throw new BloqueioError(metodo, path, incerto.frase);
    }

    await registrarTentativa({
      instante: new Date().toISOString(), provedor: this.cfg.provedor, chave, tool: ctx.tool,
      metodo, endpoint: path, corpo, antes: ctx.antes, origem,
    });

    const inicio = Date.now();
    const url = this.buildUrl(path);
    try {
      await this.limiter.acquire();
      let token = await getAccessToken(this.cfg);
      let res = await this.enviar(url, metodo, corpo, token);
      if (res.status === 401) {
        token = (await refreshTokens(this.cfg, token)).access_token;
        res = await this.enviar(url, metodo, corpo, token);
      }
      const texto = await res.text();
      let dados: unknown = texto;
      try { dados = texto ? JSON.parse(texto) : null; } catch { /* fica texto */ }

      if (!res.ok) {
        await registrarDesfecho(chave, { status: res.status, resposta: dados, duracao_ms: Date.now() - inicio });
        throw new ApiError(res.status, texto, url.pathname);
      }

      // API ASSINCRONA: 200 com {protocolo, status: PENDING} significa "recebi o
      // pedido", nao "lancei". So o protocolo diz se deu certo.
      const obj = (dados ?? {}) as Record<string, unknown>;
      const protocolo = typeof obj.protocolo === 'string' ? obj.protocolo : undefined;
      if (protocolo) {
        const conf = await this.confirmarProtocolo(protocolo);
        const venceu = conf.status === 'SUCCESS';
        await registrarDesfecho(chave, {
          status: venceu ? res.status : 502,
          resposta: { aceite: dados, protocolo: conf },
          id_erp: conf.id_recurso ?? protocolo,
          duracao_ms: Date.now() - inicio,
          ...(venceu ? {} : { erro: `protocolo ${conf.status}` }),
        });
        if (!venceu) {
          throw new ApiError(502, `protocolo ${protocolo} terminou em ${conf.status}. NAO repita por conta propria: confira no ERP se a acao existe. Repetir as cegas duplica.`, url.pathname);
        }
        return conf as T;
      }

      await registrarDesfecho(chave, { status: res.status, resposta: dados, id_erp: typeof obj.id === 'string' ? obj.id : undefined, duracao_ms: Date.now() - inicio });
      return dados as T;
    } catch (e) {
      if (!(e instanceof ApiError)) {
        await registrarDesfecho(chave, { erro: e instanceof Error ? e.message : String(e), duracao_ms: Date.now() - inicio });
      }
      throw e;
    }
  }

  private enviar(url: URL, metodo: string, corpo: unknown, token: string): Promise<Response> {
    return fetch(url, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(corpo == null ? {} : { body: JSON.stringify(corpo) }),
    });
  }

  /** Espera curta e limitada: do outro lado ha uma pessoa esperando resposta. */
  private async confirmarProtocolo(protocolo: string, tentativas = 5): Promise<{ status: string; id_recurso?: string }> {
    let espera = Number(process.env.ERP_PROTOCOLO_ESPERA_MS ?? 200);
    for (let i = 0; i < tentativas; i += 1) {
      await new Promise((r) => setTimeout(r, espera));
      try {
        const p = await this.get<{ status?: string; id_recurso?: string }>(`/v1/protocolo/${protocolo}`);
        if (p?.status && p.status !== 'PENDING') return { ...p, status: p.status };
      } catch { /* ainda nao indexado */ }
      espera = Math.min(3000, espera * 2);
    }
    return { status: 'PENDING' };
  }

  stats() {
    return this.limiter.stats();
  }
}

let shared: ErpClient | null = null;
export function getClient(): ErpClient {
  if (!shared) shared = new ErpClient();
  return shared;
}
/** So para gates. */
export function _resetClient(): void {
  shared = null;
}
