# Modelo: cláusulas de tratamento de dados (controlador ↔ operador)

**Partes:** [EMPRESA CONTRATANTE] (controladora) e [PRESTADOR] (operador).

1. **Objeto.** O operador trata dados pessoais exclusivamente para operar, a pedido da controladora, um assistente que consulta e, mediante confirmação humana, altera registros do ERP da controladora.
2. **Categorias de dados.** Identificação e contato de clientes e fornecedores da controladora (nome, documento, e-mail), valores e datas financeiras. Não há dado sensível previsto.
3. **Instruções.** O operador só trata conforme instrução documentada da controladora. Toda alteração no ERP exige confirmação de pessoa autorizada pela controladora, registrada em trilha.
4. **Suboperadores.** [Provedor do modelo de linguagem], [provedor de hospedagem], [canal de mensagens]. Mudança exige aviso prévio de [N] dias.
5. **Proibições.** Vedado usar os dados para treinar modelos, para outra finalidade ou para formar base derivada.
6. **Segurança.** Credenciais fora do código; arquivos de trilha com acesso restrito; escrita atrás de kill-switch e liberação por ferramenta.
7. **Incidentes.** Comunicação à controladora em até [N] horas da ciência.
8. **Retenção e devolução.** Trilhas mantidas por [PRAZO]; ao fim do contrato, eliminação conforme o runbook, com evidência.
9. **Auditoria.** A controladora pode solicitar a trilha de escritas e o rastro de leituras do período.
