# Modelo: runbook de eliminação

Quando a controladora repassar um pedido de eliminação de um titular:

1. **Confirmar o pedido** por escrito com a controladora (o operador não atende o titular diretamente).
2. **No ERP:** a eliminação ou inativação do cadastro é da controladora, pela tela do sistema (o assistente não exclui cadastro de propósito).
3. **Na trilha de escritas** (`auditoria/escritas.jsonl`): substituir nome, documento e e-mail do titular por `[ELIMINADO <data>]` nas linhas que o citam, preservando valores e carimbos (a trilha continua provando o que foi feito, sem identificar a pessoa).
4. **No rastro de leituras:** não há conteúdo, só rota e filtro; remover filtros que contenham o nome ou documento.
5. **Propostas pendentes:** apagar as que citam o titular.
6. **Evidência:** registrar data, quem executou e a contagem de linhas alteradas, e devolver à controladora.
