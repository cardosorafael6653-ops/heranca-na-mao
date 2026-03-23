import { Type } from "@google/genai";

export interface HeirState {
  married: boolean | null;
  regime: string | null;
  hasChildren: boolean | null;
  childrenCount: number;
  hasParents: boolean | null;
}

export const INITIAL_HEIR_STATE: HeirState = {
  married: null,
  regime: null,
  hasChildren: null,
  childrenCount: 0,
  hasParents: null,
};

export const ITCMD_RATES: Record<string, number> = {
  "SP": 4,
  "RJ": 8,
  "MG": 5,
  "RS": 6,
  "PR": 4,
  "SC": 8,
  "BA": 8,
  "PE": 8,
  "DF": 4,
};

export const ASSET_TYPES = [
  { id: 'imoveis', label: 'Imóveis' },
  { id: 'veiculos', label: 'Veículos' },
  { id: 'contas', label: 'Contas Bancárias' },
  { id: 'investimentos', label: 'Investimentos' },
  { id: 'empresas', label: 'Empresas' },
];

export const DYNAMIC_DOCUMENTS: Record<string, { id: string, label: string, category: string }[]> = {
  geral: [
    { id: 'death_cert', label: 'Certidão de Óbito', category: 'Geral' },
    { id: 'id_deceased', label: 'RG e CPF do Falecido', category: 'Geral' },
    { id: 'birth_certs', label: 'Certidão de Nascimento dos Herdeiros', category: 'Geral' },
  ],
  imoveis: [
    { id: 'prop_matricula', label: 'Matrícula atualizada', category: 'Imóveis' },
    { id: 'prop_onus', label: 'Certidão de ônus reais', category: 'Imóveis' },
    { id: 'prop_iptu', label: 'IPTU do último ano', category: 'Imóveis' },
    { id: 'prop_escritura', label: 'Escritura/Contrato', category: 'Imóveis' },
    { id: 'prop_aval', label: 'Avaliação de mercado', category: 'Imóveis' },
  ],
  veiculos: [
    { id: 'vei_crlv', label: 'CRLV', category: 'Veículos' },
    { id: 'vei_compra', label: 'Documento de compra e venda', category: 'Veículos' },
    { id: 'vei_ipva', label: 'Comprovante de quitação de IPVA', category: 'Veículos' },
    { id: 'vei_fipe', label: 'Avaliação FIPE', category: 'Veículos' },
  ],
  contas: [
    { id: 'bank_extrato', label: 'Extrato dos últimos 90 dias', category: 'Contas Bancárias' },
    { id: 'bank_saldo', label: 'Declaração de saldo na data do óbito', category: 'Contas Bancárias' },
    { id: 'bank_titular', label: 'Comprovante de titularidade', category: 'Contas Bancárias' },
  ],
  investimentos: [
    { id: 'inv_extrato', label: 'Extrato da corretora', category: 'Investimentos' },
    { id: 'inv_rendimentos', label: 'Informe de rendimentos', category: 'Investimentos' },
    { id: 'inv_consolidada', label: 'Declaração consolidada', category: 'Investimentos' },
  ],
  empresas: [
    { id: 'emp_contrato', label: 'Contrato social atualizado', category: 'Empresas' },
    { id: 'emp_alteracoes', label: 'Alterações contratuais', category: 'Empresas' },
    { id: 'emp_balanco', label: 'Balanço patrimonial', category: 'Empresas' },
    { id: 'emp_junta', label: 'Certidão simplificada da Junta Comercial', category: 'Empresas' },
  ],
};
