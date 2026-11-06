/**
 * Provedores de ERP.
 *
 * O codigo do servidor (cliente HTTP, portoes de escrita, tools) e um so. O que
 * muda entre provedores e para onde as chamadas vao e como o par de tokens
 * nasce.
 *
 *   mock       ERP simulado deste repositorio (`npm run mock`). Padrao. Tudo
 *              roda offline, com dados ficticios.
 *   contaazul  adaptador para a API publica v2 da Conta Azul. Opt-in explicito
 *              (ERP_PROVIDER=contaazul). Este repositorio NAO inclui nem
 *              redistribui a documentacao da Conta Azul: o contrato da API esta
 *              na documentacao oficial, em https://developers.contaazul.com.
 *              Projeto nao oficial, sem vinculo com a Conta Azul.
 */
export type NomeProvedor = 'mock' | 'contaazul';

export interface PerfilProvedor {
  apiBase: string;
  authBase: string;
  tokenPath: string;
  documentacao: string;
  /** mock aceita credencial fixa; provedor real exige as suas */
  clientIdPadrao: string;
  clientSecretPadrao: string;
  /** o mock troca um codigo fixo por tokens sem navegador */
  codigoDeDesenvolvimento?: string;
}

const PERFIS: Record<NomeProvedor, PerfilProvedor> = {
  mock: {
    apiBase: 'http://127.0.0.1:8787',
    authBase: 'http://127.0.0.1:8787',
    tokenPath: '/oauth2/token',
    documentacao: 'mock-erp/README.md',
    clientIdPadrao: 'mock-client',
    clientSecretPadrao: 'mock-secret',
    codigoDeDesenvolvimento: 'mock-dev-code',
  },
  contaazul: {
    apiBase: 'https://api-v2.contaazul.com',
    authBase: 'https://auth.contaazul.com',
    tokenPath: '/oauth2/token',
    documentacao: 'https://developers.contaazul.com',
    clientIdPadrao: '',
    clientSecretPadrao: '',
  },
};

export function perfilDoProvedor(nome: NomeProvedor): PerfilProvedor {
  return PERFIS[nome];
}
