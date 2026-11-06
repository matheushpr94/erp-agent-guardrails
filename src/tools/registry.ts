import { getConfig } from '../config.js';
import { allowlistDe, TOOLS_DE_ESCRITA } from '../http/bloqueio.js';
import { TOOL_DA_CLASSE } from '../escrita/papel.js';
import type { ToolDef } from './types.js';
import { leituraTools } from './leitura.js';
import { escritaTools } from './escrita.js';
import { pessoasEscritaTools } from './pessoas-escrita.js';

/** Superficie minima: cada definicao a mais ocupa contexto e piora a escolha de tool. */
export const TODAS: ToolDef[] = [...leituraTools, ...escritaTools, ...pessoasEscritaTools];

/** A PROCEDENCIA da escrita: arquivo novo de tool de escrita entra aqui. */
const PROCEDENCIA_ESCRITA: ToolDef[] = [...escritaTools, ...pessoasEscritaTools];

export function checarNomesDuplicados(tools: ToolDef[] = TODAS): void {
  const vistos = new Set<string>();
  const dup = tools.filter((t) => (vistos.has(t.name) ? true : (vistos.add(t.name), false))).map((t) => t.name);
  if (dup.length) throw new Error(`Tools com nome duplicado: ${dup.join(', ')}`);
}

/**
 * Anotacao que mente e pior que anotacao ausente. Casamento por PROCEDENCIA,
 * nao por nome: tudo que sai dos arquivos de escrita declara efeito, e nada
 * fora deles pode declarar. Falha a inicializacao (aviso em log ninguem le).
 */
export function checarAnotacoes(tools: ToolDef[] = TODAS, procedencia: ToolDef[] = PROCEDENCIA_ESCRITA): void {
  const erros: string[] = [];
  const nomes = new Set(procedencia.map((t) => t.name));
  for (const t of procedencia) if ((t.efeito ?? 'leitura') === 'leitura') erros.push(`${t.name}: esta na procedencia de escrita e se declara leitura`);
  for (const t of tools) if (!nomes.has(t.name) && t.efeito && t.efeito !== 'leitura') erros.push(`${t.name}: declara '${t.efeito}' fora da procedencia de escrita`);
  const executores = tools.filter((t) => t.efeito === 'escrita').map((t) => t.name);
  if (executores.length !== 1 || executores[0] !== 'confirmar_acao') erros.push(`deve existir exatamente UM executor (confirmar_acao); achei: ${executores.join(', ') || 'nenhum'}`);
  if (erros.length) throw new Error(`Anotacao de tool inconsistente:\n  ${erros.join('\n  ')}`);
}

/**
 * Nome errado na allowlist derruba o boot. `ERP_ESCRITA_TOOLS=propor_dar_biaxa`
 * nao e "lista sem efeito": e o operador achando que liberou algo.
 */
export function checarAllowlistDaEscrita(valor: string = getConfig().ERP_ESCRITA_TOOLS): void {
  const existentes = new Set(TODAS.filter((t) => t.efeito === 'proposta').map((t) => t.name));
  const errados = [...allowlistDe(valor)].filter((n) => !existentes.has(n));
  if (errados.length) throw new Error(`ERP_ESCRITA_TOOLS contem nome que nao e tool de escrita: ${errados.join(', ')}. Nada foi liberado.`);
}

/** Tres lugares nomeiam as tools de escrita (parede HTTP, papel, registry); os tres tem de concordar. */
export function checarTresListas(): string[] {
  const doRegistry = new Set(TODAS.filter((t) => t.efeito === 'proposta').map((t) => t.name));
  const daParede = new Set(TOOLS_DE_ESCRITA);
  const doPapel = new Set(Object.values(TOOL_DA_CLASSE));
  const erros: string[] = [];
  for (const n of doRegistry) {
    if (!daParede.has(n)) erros.push(`${n}: no registry, sem rota na parede HTTP`);
    if (!doPapel.has(n)) erros.push(`${n}: no registry, sem classe em papel.ts`);
  }
  for (const n of daParede) if (!doRegistry.has(n)) erros.push(`${n}: rota liberavel na parede sem tool no registry`);
  for (const n of doPapel) if (!doRegistry.has(n)) erros.push(`${n}: classe em papel.ts sem tool no registry`);
  return erros;
}
