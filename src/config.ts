/**
 * Configuracao do servidor MCP.
 *
 * Tudo vem do ambiente. O `.env` (se existir) e lido com `process.loadEnvFile`,
 * nativo do Node: nada escreve em stdout, porque stdout e o canal JSON-RPC do
 * MCP e qualquer banner ali corrompe o protocolo em silencio.
 */
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { perfilDoProvedor, type NomeProvedor } from './provider.js';

function acharRaiz(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const pai = dirname(dir);
    if (pai === dir) break;
    dir = pai;
  }
  return process.cwd();
}

export const RAIZ_PROJETO = acharRaiz();

const envFile = join(RAIZ_PROJETO, '.env');
if (existsSync(envFile) && !process.env.ERP_IGNORAR_DOTENV) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* .env malformado: segue com o ambiente do processo */
  }
}

const Schema = z.object({
  ERP_PROVIDER: z.enum(['mock', 'contaazul']).default('mock'),
  ERP_API_BASE: z.string().url().optional(),
  ERP_AUTH_BASE: z.string().url().optional(),
  ERP_CLIENT_ID: z.string().default(''),
  ERP_CLIENT_SECRET: z.string().default(''),
  ERP_REDIRECT_URI: z.string().default('http://localhost:8737/callback'),
  ERP_TOKEN_FILE: z.string().default(''),
  ERP_RPS: z.coerce.number().int().positive().max(10).default(8),
  ERP_RPM: z.coerce.number().int().positive().max(600).default(550),
  ERP_ESCRITA: z.string().default('desabilitada'),
  ERP_ESCRITA_TOOLS: z.string().default(''),
  /** baixa a partir deste valor sobe para a faixa 3 (palavra ditada) */
  ERP_FAIXA3_A_PARTIR_DE: z.coerce.number().positive().default(10_000),
});

export type Config = z.infer<typeof Schema> & {
  provedor: NomeProvedor;
  apiBase: string;
  authBase: string;
  tokenPath: string;
  tokenFileAbs: string;
};

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const problemas = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuracao invalida:\n${problemas}`);
  }
  const d = parsed.data;
  const perfil = perfilDoProvedor(d.ERP_PROVIDER);
  const arquivo = d.ERP_TOKEN_FILE || `.tokens.${d.ERP_PROVIDER}.json`;
  cached = {
    ...d,
    ERP_CLIENT_ID: d.ERP_CLIENT_ID || perfil.clientIdPadrao,
    ERP_CLIENT_SECRET: d.ERP_CLIENT_SECRET || perfil.clientSecretPadrao,
    provedor: d.ERP_PROVIDER,
    apiBase: d.ERP_API_BASE ?? perfil.apiBase,
    authBase: d.ERP_AUTH_BASE ?? perfil.authBase,
    tokenPath: perfil.tokenPath,
    tokenFileAbs: isAbsolute(arquivo) ? arquivo : resolve(RAIZ_PROJETO, arquivo),
  };
  return cached;
}

/** So para gates: forca reler o ambiente. */
export function _resetConfig(): void {
  cached = null;
}

export function basicAuthHeader(cfg: Config): string {
  const raw = `${cfg.ERP_CLIENT_ID}:${cfg.ERP_CLIENT_SECRET}`;
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
}
