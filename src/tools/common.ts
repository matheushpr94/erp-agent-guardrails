import { z } from 'zod';

export const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato YYYY-MM-DD');
export const uuid = z.string().uuid('precisa ser um UUID');
export const pagina = z.number().int().positive().default(1).describe('Numero da pagina (comeca em 1)');
export const tamanhoPagina = z
  .union([z.literal(10), z.literal(20), z.literal(50), z.literal(100)])
  .default(20)
  .describe('Itens por pagina. Valores aceitos: 10, 20, 50, 100 (enum fechado no ERP)');

/** Campos que o MODELO preenche e vao para a trilha; nao autenticam nada. */
export const mensagemDoCliente = z.string().min(1).describe('A frase LITERAL que o cliente escreveu. Nao parafraseie: vai para a auditoria.');
