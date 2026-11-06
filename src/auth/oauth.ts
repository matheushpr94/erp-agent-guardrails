import { basicAuthHeader, getConfig, type Config } from '../config.js';
import { perfilDoProvedor } from '../provider.js';
import {
  EXPIRY_SKEW_MS, isExpired, readTokens, withTokenLock, writeTokens, type StoredTokens,
} from './token-store.js';

export class AuthError extends Error {}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in: number;
}

/** Contador exposto ao gate: quantas vezes este processo foi ao endpoint de token. */
export const _metricas = { chamadasAoToken: 0 };

async function postToken(cfg: Config, form: Record<string, string>): Promise<TokenResponse> {
  if (!cfg.ERP_CLIENT_ID || !cfg.ERP_CLIENT_SECRET) {
    throw new AuthError('ERP_CLIENT_ID/ERP_CLIENT_SECRET ausentes no ambiente.');
  }
  _metricas.chamadasAoToken += 1;
  const res = await fetch(new URL(cfg.tokenPath, cfg.authBase), {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(cfg),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    const dica = text.includes('invalid_grant')
      ? ' -> refresh_token ja usado/rotacionado por outro processo, ou codigo vencido.'
      : '';
    throw new AuthError(`Endpoint de token devolveu HTTP ${res.status}: ${text.slice(0, 200)}${dica}`);
  }
  const json = JSON.parse(text) as TokenResponse;
  if (!json.access_token || !json.refresh_token) {
    throw new AuthError('Resposta sem access_token/refresh_token.');
  }
  return json;
}

function toStored(cfg: Config, r: TokenResponse): StoredTokens {
  const now = Date.now();
  return {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    token_type: r.token_type || 'Bearer',
    expires_at: now + Math.max(1_000, r.expires_in * 1000 - EXPIRY_SKEW_MS),
    rotated_at: now,
    provedor: cfg.provedor,
  };
}

/** URL de autorizacao (fluxo authorization_code) para o provedor real. */
export function urlDeAutorizacao(cfg: Config, autorizeUrl: string, state: string): string {
  const u = new URL(autorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.ERP_CLIENT_ID);
  u.searchParams.set('redirect_uri', cfg.ERP_REDIRECT_URI);
  u.searchParams.set('state', state);
  return u.toString();
}

export async function trocarCodigo(code: string, cfg = getConfig()): Promise<StoredTokens> {
  const r = await postToken(cfg, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.ERP_REDIRECT_URI,
  });
  const t = toStored(cfg, r);
  await withTokenLock(cfg.tokenFileAbs, () => writeTokens(cfg.tokenFileAbs, t));
  return t;
}

/**
 * Renova o par de tokens.
 *
 * `rejeitado` e o access_token que acabou de tomar 401. Dentro do lock, se o
 * token gravado JA e outro, alguem renovou enquanto esperavamos: usa o novo em
 * vez de queimar o refresh_token recem-gravado (que mataria o outro processo).
 */
export async function refreshTokens(cfg = getConfig(), rejeitado?: string): Promise<StoredTokens> {
  return withTokenLock(cfg.tokenFileAbs, async () => {
    const current = await readTokens(cfg.tokenFileAbs);
    if (!current) throw new AuthError('Nenhum token salvo. Autorize o aplicativo primeiro.');
    const precisa = isExpired(current) || (rejeitado !== undefined && current.access_token === rejeitado);
    if (!precisa) return current;
    const r = await postToken(cfg, { grant_type: 'refresh_token', refresh_token: current.refresh_token });
    const next = toStored(cfg, r);
    await writeTokens(cfg.tokenFileAbs, next);
    return next;
  });
}

export async function getAccessToken(cfg = getConfig()): Promise<string> {
  let t = await readTokens(cfg.tokenFileAbs);
  if (!t) {
    const codigo = perfilDoProvedor(cfg.provedor).codigoDeDesenvolvimento;
    if (!codigo) {
      throw new AuthError(
        `Sem token em ${cfg.tokenFileAbs}. Para o provedor "${cfg.provedor}", rode `
          + '"npm run auth" e siga o fluxo OAuth da documentacao oficial.',
      );
    }
    // Mock: troca o codigo fixo de desenvolvimento, sem navegador.
    t = await withTokenLock(cfg.tokenFileAbs, async () => {
      const ja = await readTokens(cfg.tokenFileAbs);
      if (ja) return ja;
      const r = await postToken(cfg, { grant_type: 'authorization_code', code: codigo, redirect_uri: cfg.ERP_REDIRECT_URI });
      const novo = toStored(cfg, r);
      await writeTokens(cfg.tokenFileAbs, novo);
      return novo;
    });
  }
  if (t.provedor !== cfg.provedor) {
    throw new AuthError(`O token em ${cfg.tokenFileAbs} e do provedor "${t.provedor}", nao de "${cfg.provedor}".`);
  }
  if (isExpired(t)) t = await refreshTokens(cfg);
  return t.access_token;
}
