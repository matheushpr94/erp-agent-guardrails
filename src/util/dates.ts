/** Datas no fuso de Sao Paulo: o ERP pensa em dia local, nao em UTC. */
const TZ = 'America/Sao_Paulo';

function partesSP(d: Date): { ano: number; mes: number; dia: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { ano: Number(p.year), mes: Number(p.month), dia: Number(p.day) };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dataSP(d: Date = new Date()): string {
  const { ano, mes, dia } = partesSP(d);
  return `${ano}-${pad(mes)}-${pad(dia)}`;
}

export function mesCorrente(hoje: Date = new Date()): { de: string; ate: string } {
  const { ano, mes } = partesSP(hoje);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { de: `${ano}-${pad(mes)}-01`, ate: `${ano}-${pad(mes)}-${pad(ultimo)}` };
}

export function somaDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export const diaBR = (iso: string) => iso.split('-').reverse().join('/');

export const dinheiro = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
