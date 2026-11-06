import { z } from 'zod';
import { getClient } from '../http/client.js';
import { podeEscrever } from '../escrita/papel.js';
import { criar, rodape } from '../escrita/propostas.js';
import { normalizarEnvelope } from '../util/envelope.js';
import { mensagemDoCliente } from './common.js';
import { defineTool } from './types.js';

const soDigitos = (s?: string) => (s ?? '').replace(/\D/g, '');
const normalizarNome = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\b(ltda|me|eireli|s\/?a|epp)\b/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const pessoasEscritaTools = [
  defineTool({
    name: 'propor_criar_cliente',
    efeito: 'proposta',
    description:
      'Prepara o CADASTRO de um cliente ou fornecedor novo e devolve o texto para MOSTRAR ao cliente. NAO cadastra: exige confirmar_acao depois. '
      + 'Antes de propor, BUSCA no cadastro: documento repetido recusa; nome parecido recusa listando os candidatos, '
      + 'e so segue com confirmo_que_e_novo=true DEPOIS de perguntar ao dono. Cadastro nao se apaga por aqui.',
    input: {
      nome: z.string().min(3).max(120),
      documento: z.string().optional().describe('CNPJ ou CPF, com ou sem pontuacao. Informe sempre que tiver'),
      perfil: z.enum(['Cliente', 'Fornecedor']).default('Cliente'),
      email: z.string().email().optional(),
      confirmo_que_e_novo: z.boolean().optional(),
      mensagem_do_cliente: mensagemDoCliente,
    },
    handler: async (a) => {
      const perm = podeEscrever('criacao_pessoa');
      if (!perm.ok) return { proposta: null, recusado: perm.motivo };
      const doc = soDigitos(a.documento);
      if (doc && doc.length !== 11 && doc.length !== 14) {
        return { proposta: null, recusado: `o documento "${a.documento}" nao tem 11 (CPF) nem 14 (CNPJ) digitos. Confira com o cliente.` };
      }
      if (doc) {
        const iguais = normalizarEnvelope(await getClient().get('/v1/pessoas', { busca: doc, tamanho_pagina: 10 })).itens as Array<{ nome: string; documento?: string }>;
        const mesmo = iguais.find((p) => soDigitos(p.documento) === doc);
        if (mesmo) return { proposta: null, recusado: `ja existe cadastro com este documento: "${mesmo.nome}". Use o existente.` };
      }
      if (!a.confirmo_que_e_novo) {
        const alvo = normalizarNome(a.nome);
        const primeira = alvo.split(' ')[0] ?? alvo;
        const candidatos = (normalizarEnvelope(await getClient().get('/v1/pessoas', { busca: primeira, tamanho_pagina: 20 })).itens as Array<{ id: string; nome: string }>)
          .filter((p) => { const n = normalizarNome(p.nome); return n === alvo || n.includes(alvo) || alvo.includes(n); });
        if (candidatos.length) {
          return { proposta: null, recusado: 'ha cadastro(s) com nome parecido. Mostre ao dono e pergunte se e outra empresa; se for, chame de novo com confirmo_que_e_novo=true.', candidatos };
        }
      }
      const c = await criar({
        faixa: 2,
        acao: 'cadastrar cliente',
        classe: 'criacao_pessoa',
        resumo: `Vou cadastrar:\n\n• *${a.nome}*\n• ${doc ? `documento ${a.documento}` : 'sem documento (nao da para detectar duplicata depois)'}\n• perfil: ${a.perfil}`
          + (a.email ? `\n• e-mail: ${a.email}` : ''),
        metodo: 'POST',
        endpoint: '/v1/pessoas',
        corpo: { nome: a.nome, ...(doc ? { documento: doc } : {}), perfil: a.perfil, ...(a.email ? { email: a.email } : {}) },
        mensagem: a.mensagem_do_cliente,
        desfazer: 'cadastro nao se apaga por aqui; se sair errado, da para inativar pela tela do ERP.',
      });
      return {
        proposta: c.proposta.id,
        faixa: c.proposta.faixa,
        mostrar_ao_cliente: c.proposta.resumo + rodape(c.proposta),
        instrucao: 'Mostre mostrar_ao_cliente SEM mudar nada e espere a resposta dele.',
      };
    },
  }),
];
