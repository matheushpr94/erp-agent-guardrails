#!/usr/bin/env tsx
/**
 * EXEMPLO OPCIONAL, DESLIGADO POR PADRAO: gateway Telegram minimo.
 *
 * So existe para mostrar O QUE o gateway faz, e e pouco:
 *   1. long-poll do Telegram;
 *   2. allowlist de chats (CANAL_PAPEIS='{"<chat_id>":"dono"}'): chat fora dela e ignorado;
 *   3. antes de cada turno, injeta no ambiente o CANAL (chat), o PAPEL e a
 *      MENSAGEM com o carimbo de hora do proprio Telegram. E isso que os
 *      portoes 2, 3 e 4 julgam; nada disso passa pela mao do modelo.
 *
 * Nao ha IDs, tokens nem config real aqui. Para ligar:
 *   TELEGRAM_HABILITADO=1 TELEGRAM_BOT_TOKEN=... CANAL_PAPEIS='{"123":"dono"}' ANTHROPIC_API_KEY=... npx tsx agente/telegram-exemplo.ts
 */
import { join } from 'node:path';
import { RAIZ } from '../scripts/lib/gate.js';
import { canal, conectar } from '../scripts/lib/mcp-em-processo.js';

if (process.env.TELEGRAM_HABILITADO !== '1') {
  console.log('gateway Telegram de exemplo DESLIGADO (TELEGRAM_HABILITADO != 1). Nada a fazer.');
  process.exit(0);
}
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN ausente');
const papeis = JSON.parse(process.env.CANAL_PAPEIS ?? '{}') as Record<string, string>;
const api = (m: string, corpo: unknown) => fetch(`https://api.telegram.org/bot${token}/${m}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
}).then((r) => r.json() as Promise<{ ok: boolean; result: Array<{ update_id: number; message?: { chat: { id: number }; text?: string; date: number } }> }>);

const { iniciarMock } = await import('../mock-erp/server.js');
const mock = await iniciarMock();
Object.assign(process.env, { ERP_IGNORAR_DOTENV: '1', ERP_API_BASE: mock.url, ERP_AUTH_BASE: mock.url, ERP_TOKEN_FILE: join(RAIZ, '.estado', 'tg-tokens.json') });
const { montarServidor } = await import('../src/server.js');
const { Agente } = await import('./agente.js');
const mcp = await conectar(montarServidor());
const agentes = new Map<string, InstanceType<typeof Agente>>();

let offset = 0;
for (;;) {
  const r = await api('getUpdates', { offset, timeout: 30 });
  for (const u of r.result ?? []) {
    offset = u.update_id + 1;
    const m = u.message;
    if (!m?.text) continue;
    const chat = String(m.chat.id);
    if (!papeis[chat]) continue; // allowlist
    canal(chat, papeis[chat], { texto: m.text, em: new Date(m.date * 1000) });
    let ag = agentes.get(chat);
    if (!ag) { ag = new Agente(mcp); await ag.iniciar(); agentes.set(chat, ag); }
    const t = await ag.turno(m.text);
    await api('sendMessage', { chat_id: m.chat.id, text: t.resposta });
  }
}
