/**
 * Limitador de duas janelas deslizantes simultaneas (por segundo E por minuto).
 *
 * Precisa das duas: so a de segundo deixaria passar o teto do minuto
 * distribuido, e so a de minuto deixaria um burst inteiro no primeiro segundo.
 * O ERP responde 429 ao estourar qualquer uma.
 *
 * Serializa em fila FIFO: chamadas concorrentes esperam a vez em vez de falhar.
 * As janelas sao injetaveis para o gate medir o comportamento em milissegundos.
 */
export class RateLimiter {
  private hits: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly porJanelaCurta: number,
    private readonly porJanelaLonga: number,
    private readonly janelaCurtaMs = 1_000,
    private readonly janelaLongaMs = 60_000,
  ) {}

  private prune(now: number): void {
    const corte = now - this.janelaLongaMs;
    if (this.hits.length && this.hits[0]! <= corte) {
      this.hits = this.hits.filter((t) => t > corte);
    }
  }

  private waitMs(now: number): number {
    this.prune(now);
    const naCurta = this.hits.filter((t) => t > now - this.janelaCurtaMs);
    let espera = 0;
    if (naCurta.length >= this.porJanelaCurta) {
      espera = Math.max(espera, naCurta[0]! + this.janelaCurtaMs - now);
    }
    if (this.hits.length >= this.porJanelaLonga) {
      espera = Math.max(espera, this.hits[0]! + this.janelaLongaMs - now);
    }
    return espera;
  }

  /** Resolve quando for seguro disparar a proxima requisicao. */
  acquire(): Promise<void> {
    const vez = this.chain.then(async () => {
      for (;;) {
        const now = Date.now();
        const espera = this.waitMs(now);
        if (espera <= 0) {
          this.hits.push(now);
          return;
        }
        await new Promise((r) => setTimeout(r, espera + 2));
      }
    });
    this.chain = vez.catch(() => {});
    return vez;
  }

  stats(): { janelaCurta: number; janelaLonga: number } {
    const now = Date.now();
    this.prune(now);
    return {
      janelaCurta: this.hits.filter((t) => t > now - this.janelaCurtaMs).length,
      janelaLonga: this.hits.length,
    };
  }
}
