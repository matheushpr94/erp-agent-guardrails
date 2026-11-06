import { z } from 'zod';
import { getConfig } from '../config.js';
import { getClient } from '../http/client.js';
import { podeEscrever } from '../escrita/papel.js';
import { criar, resgatar, rodape, type Criada } from '../escrita/propostas.js';
import { normalizarEnvelope } from '../util/envelope.js';
import { dataSP, diaBR, dinheiro } from '../util/dates.js';
import { dataISO, mensagemDoCliente, uuid } from './common.js';
import { contasFinanceiras, saldoDe } from './leitura.js';
import { defineTool } from './types.js';

/** Conta a usar + saldo atual. Escolha automatica e DITA ao cliente. */
async function contaEsaldo(id?: string) {
  const contas = await contasFinanceiras();
  const conta = id ? contas.find((c) => c.id === id) : contas[0];
  if (!conta) throw new Error(id ? `conta financeira ${id} nao encontrada` : 'nenhuma conta financeira cadastrada');
  return {
    conta,
    saldo: await saldoDe(conta.id),
    escolhaAutomatica: id ? '' : `_Usei a conta "${conta.nome}" porque nenhuma foi indicada._`,
  };
}

export function blocoSaldo(nome: string, saldo: number | null, delta: number): string {
  if (saldo === null) return `\n\n⚠️ *Nao consegui ler o saldo de ${nome}*; confira antes de confirmar.`;
  const depois = saldo + delta;
  const alerta = saldo >= 0 && depois < 0 ? '\n\n⚠️ *O saldo desta conta FICA NEGATIVO com esta operacao.*' : '';
  return `\n\nSaldo de *${nome}*: ${dinheiro(saldo)} → *${dinheiro(depois)}*${alerta}`;
}

const saida = (c: Criada) => ({
  proposta: c.proposta.id,
  faixa: c.proposta.faixa,
  mostrar_ao_cliente: c.proposta.resumo + rodape(c.proposta)
    + (c.substituiu ? `\n\n_(a proposta anterior, ${c.substituiu}, foi substituida por esta.)_` : ''),
  instrucao: 'Mostre mostrar_ao_cliente SEM mudar nada e espere a resposta dele. NAO chame confirmar_acao nesta mesma vez.',
});

export const escritaTools = [
  /* ── FAIXA 1: so registra a previsao ─────────────────────────────── */
  defineTool({
    name: 'propor_lancar_conta',
    efeito: 'proposta',
    description:
      'Prepara o lancamento de uma conta a pagar ou a receber e devolve o texto para MOSTRAR ao cliente. '
      + 'NAO lanca nada: so depois que o cliente confirmar e que se chama confirmar_acao.',
    input: {
      tipo: z.enum(['pagar', 'receber']),
      descricao: z.string().min(1).max(200),
      valor: z.number().positive().describe('Valor em reais'),
      data_vencimento: dataISO.optional().describe('Padrao: hoje'),
      id_contato: uuid.describe('Id da pessoa (listar_clientes)'),
      id_categoria: uuid.describe('Id da categoria (listar_categorias)'),
      id_conta_financeira: uuid.optional(),
      mensagem_do_cliente: mensagemDoCliente,
    },
    handler: async (a) => {
      const perm = podeEscrever('lancamento');
      if (!perm.ok) return { proposta: null, recusado: perm.motivo };
      const venc = a.data_vencimento ?? dataSP();
      const { conta, escolhaAutomatica } = await contaEsaldo(a.id_conta_financeira);
      let pessoa = a.id_contato;
      try {
        pessoa = String((await getClient().get<{ nome?: string }>(`/v1/pessoas/${a.id_contato}`)).nome ?? a.id_contato);
      } catch {
        return { proposta: null, recusado: `nao achei a pessoa ${a.id_contato} no cadastro. Busque com listar_clientes.` };
      }
      const categorias = normalizarEnvelope(await getClient().get('/v1/categorias')).itens as Array<{ id: string; nome: string; tipo: string }>;
      const cat = categorias.find((c) => c.id === a.id_categoria);
      if (!cat) return { proposta: null, recusado: `categoria ${a.id_categoria} nao existe. Use listar_categorias.` };
      const esperado = a.tipo === 'pagar' ? 'DESPESA' : 'RECEITA';
      const divergencia = cat.tipo !== esperado
        ? `\n\n⚠️ *A categoria "${cat.nome}" e de ${cat.tipo.toLowerCase()}, mas a conta e a ${a.tipo}.* Confira antes de confirmar.`
        : '';
      const c = await criar({
        faixa: 1,
        acao: `lancar conta a ${a.tipo}`,
        classe: 'lancamento',
        resumo:
          `Vou lancar uma conta a *${a.tipo}*:\n\n• ${a.descricao}\n• ${dinheiro(a.valor)}\n• vence ${diaBR(venc)}\n`
          + `• ${a.tipo === 'pagar' ? 'fornecedor' : 'cliente'}: *${pessoa}*\n• categoria: *${cat.nome}*\n• conta: ${conta.nome}\n`
          + (escolhaAutomatica ? `\n${escolhaAutomatica}\n` : '')
          + '\n_So registra a previsao. Nao da baixa nem mexe em saldo._' + divergencia,
        metodo: 'POST',
        endpoint: `/v1/financeiro/eventos-financeiros/contas-a-${a.tipo}`,
        corpo: { descricao: a.descricao, valor: a.valor, data_vencimento: venc, contato: a.id_contato, categoria: a.id_categoria, conta_financeira: conta.id },
        mensagem: a.mensagem_do_cliente,
        desfazer: 'lancamento nao se apaga por aqui; para remover, e pela tela do ERP.',
      });
      return saida(c);
    },
  }),

  /* ── FAIXA 2 (ou 3 acima do limite): muda a verdade financeira ───── */
  defineTool({
    name: 'propor_dar_baixa',
    efeito: 'proposta',
    description:
      'Prepara a baixa de uma parcela (registrar que foi paga/recebida) e devolve o texto para MOSTRAR ao cliente, '
      + 'com o saldo antes e depois. NAO da baixa: exige confirmar_acao depois.',
    input: {
      id_parcela: uuid,
      valor: z.number().positive().describe('Valor pago/recebido'),
      data_pagamento: dataISO.optional().describe('Padrao: hoje'),
      id_conta_financeira: uuid.optional(),
      mensagem_do_cliente: mensagemDoCliente,
    },
    handler: async (a) => {
      const perm = podeEscrever('baixa');
      if (!perm.ok) return { proposta: null, recusado: perm.motivo };
      let real: Record<string, unknown>;
      try {
        real = await getClient().get(`/v1/financeiro/eventos-financeiros/parcelas/${a.id_parcela}`);
      } catch {
        return { proposta: null, recusado: `nao achei a parcela ${a.id_parcela}. Liste as contas para pegar o id certo.` };
      }
      const ehPagar = real.tipo === 'pagar';
      const aberto = Number(real.nao_pago);
      if (aberto === 0) {
        return { proposta: null, recusado: 'esta parcela ja esta quitada (nada em aberto). Dar baixa de novo criaria um segundo pagamento.' };
      }
      const dia = a.data_pagamento ?? dataSP();
      const { conta, saldo, escolhaAutomatica } = await contaEsaldo(a.id_conta_financeira);
      const residual = aberto - a.valor;
      const divergencia = Math.abs(residual) >= 0.01
        ? `\n\n⚠️ *Os valores nao batem.* Em aberto: *${dinheiro(aberto)}*; voce esta baixando *${dinheiro(a.valor)}* (${residual < 0 ? 'a mais' : 'a menos'} ${dinheiro(Math.abs(residual))}).`
        : '';
      const quem = (real.fornecedor ?? real.cliente) as { nome?: string } | undefined;
      const faixa = a.valor >= getConfig().ERP_FAIXA3_A_PARTIR_DE ? 3 : 2;
      const c = await criar({
        faixa,
        acao: 'dar baixa',
        classe: 'baixa',
        resumo:
          `Vou registrar como ${ehPagar ? '*paga*' : '*recebida*'}:\n\n• ${String(real.descricao ?? '')}\n• ${dinheiro(a.valor)}\n`
          + (quem?.nome ? `• ${ehPagar ? 'fornecedor' : 'cliente'}: *${quem.nome}*\n` : '')
          + `• vencia em ${diaBR(String(real.data_vencimento))}\n• pagamento em ${diaBR(dia)}`
          + divergencia
          + blocoSaldo(conta.nome, saldo, ehPagar ? -a.valor : a.valor)
          + (escolhaAutomatica ? `\n\n${escolhaAutomatica}` : ''),
        metodo: 'POST',
        endpoint: `/v1/financeiro/eventos-financeiros/parcelas/${a.id_parcela}/baixa`,
        corpo: { data_pagamento: dia, valor: a.valor, conta_financeira: conta.id },
        antes: { saldo_antes: saldo, parcela_antes: real },
        mensagem: a.mensagem_do_cliente,
        desfazer: 'me peca para estornar a baixa e o saldo volta (estorno e feito pela tela do ERP nesta versao).',
      });
      return saida(c);
    },
  }),

  /* ── O UNICO EXECUTOR ─────────────────────────────────────────────── */
  defineTool({
    name: 'confirmar_acao',
    efeito: 'escrita',
    description:
      'Executa uma proposta APOS o cliente confirmar, em outra mensagem dele. Passe o id da proposta e a resposta LITERAL dele. '
      + 'Se ele nao confirmou claramente, nao chame esta tool: pergunte de novo.',
    input: {
      proposta: z.string().describe('Id devolvido por propor_*'),
      resposta_do_cliente: z.string().describe('O que ele respondeu, palavra por palavra. Nao interprete.'),
    },
    handler: async (a) => {
      const r = await resgatar(a.proposta, a.resposta_do_cliente);
      if (!r.ok || !r.proposta) return { executado: false, motivo: r.motivo };
      const p = r.proposta;
      // Papel e allowlist de novo, NO MOMENTO DE AGIR: lista editada entre propor e confirmar vale.
      const agora = podeEscrever(p.classe);
      if (!agora.ok) return { executado: false, motivo: agora.motivo };
      if (getConfig().ERP_ESCRITA !== 'habilitada') {
        return { executado: false, motivo: 'a escrita esta desligada nesta instalacao (kill-switch). Nada foi alterado.' };
      }
      const resultado = await getClient().escrever(p.metodo, p.endpoint, p.corpo, {
        tool: `confirmar:${p.acao}`,
        antes: p.antes,
        origem: {
          mensagem: p.mensagem,
          proposta: p.resumo,
          confirmacao_alegada: a.resposta_do_cliente,
          confirmacao_do_canal: process.env.CANAL_MENSAGEM,
          confirmado_por: r.origem,
        },
      });
      return { executado: true, acao: p.acao, resultado, dizer_ao_cliente: `Pronto: ${p.acao} concluida. Se precisar desfazer: ${p.desfazer}` };
    },
  }),
];
