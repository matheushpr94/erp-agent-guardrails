import type { z, ZodRawShape } from 'zod';

/**
 * O que a tool faz com o mundo; vira `annotations` no MCP (o host usa
 * `readOnlyHint` para decidir o que roda sem perguntar, entao anotacao que
 * mente e permissao que ninguem concedeu).
 *
 *   leitura   so GET. Nao muda nada em lugar nenhum.
 *   proposta  nao toca no ERP, mas GRAVA uma proposta duravel em disco.
 *   escrita   altera o ERP. So `confirmar_acao`.
 */
export type ToolEfeito = 'leitura' | 'proposta' | 'escrita';

export interface ToolDef<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  /** E prompt, nao comentario: e o texto que o modelo le para escolher a tool. */
  description: string;
  input: Shape;
  efeito?: ToolEfeito;
  handler: (args: z.objectOutputType<Shape, z.ZodTypeAny>) => Promise<unknown>;
}

export function defineTool<Shape extends ZodRawShape>(def: ToolDef<Shape>): ToolDef<ZodRawShape> {
  return def as unknown as ToolDef<ZodRawShape>;
}
