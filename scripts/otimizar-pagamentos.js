/**
 * SIGA — otimização da tela de Pagamentos.
 *
 * Rode dentro da pasta do clasp:
 *   node otimizar-pagamentos.js
 *
 * Edita Pagamentos.js no lugar, guardando Pagamentos.js.bak antes.
 * Nenhuma regra de negócio muda: são caches e uma saída antecipada.
 */

const fs = require('fs');
const path = require('path');

const ARQUIVO = process.argv[2] || 'Pagamentos.js';

const CORRECOES = [
  {
    nome: 'Cache da DATA INICIO da DimTurma',
    porque:
      'obterDataInicioTurmaPagUnif_ lia a DimTurma inteira a cada chamada, ' +
      'e ela roda por matrícula × competência × 2. É o maior gargalo.',
    de: 'function obterDataInicioTurmaPagUnif_(turma) {',
    para: 'function obterDataInicioTurmaPagUnifSemCache_(turma) {',
    anexo: `

/* ============================================================
 * CACHE DA DATA DE INÍCIO DA TURMA
 *
 * A versão sem cache varre a DimTurma inteira a cada chamada.
 * Como o valor não muda durante a execução, guardamos por turma.
 * Devolve uma cópia para ninguém alterar a data guardada.
 * ============================================================ */
const CACHE_INICIO_TURMA_PAG_UNIF_ = new Map();

function obterDataInicioTurmaPagUnif_(turma) {
  const chave = normalizarPagUnif_(turma || '');
  if (!chave) return null;

  if (!CACHE_INICIO_TURMA_PAG_UNIF_.has(chave)) {
    CACHE_INICIO_TURMA_PAG_UNIF_.set(
      chave,
      obterDataInicioTurmaPagUnifSemCache_(turma)
    );
  }

  const data = CACHE_INICIO_TURMA_PAG_UNIF_.get(chave);
  return data ? new Date(data.getTime()) : null;
}
`
  },

  {
    nome: 'Memoriza normalizarCabecalhoPagamentosSIGA_',
    porque:
      'É chamada ~25 vezes por boleto, sempre com os mesmos nomes de coluna, ' +
      'e cada chamada faz normalize(NFD) + duas regex.',
    de: 'function normalizarCabecalhoPagamentosSIGA_(\n  valor\n) {',
    para: 'function normalizarCabecalhoPagamentosSemCacheSIGA_(\n  valor\n) {',
    anexo: `

/* Os nomes de coluna se repetem o tempo todo: normaliza uma vez só. */
const CACHE_CABECALHO_PAG_SIGA_ = new Map();

function normalizarCabecalhoPagamentosSIGA_(valor) {
  const chave = String(valor == null ? '' : valor);

  if (!CACHE_CABECALHO_PAG_SIGA_.has(chave)) {
    CACHE_CABECALHO_PAG_SIGA_.set(
      chave,
      normalizarCabecalhoPagamentosSemCacheSIGA_(valor)
    );
  }

  return CACHE_CABECALHO_PAG_SIGA_.get(chave);
}
`
  },

  {
    nome: 'Memoriza normalizarPagUnif_',
    porque:
      'Roda em quase toda comparação de nome, turma e status. ' +
      'Os mesmos textos voltam milhares de vezes.',
    de: 'function normalizarPagUnif_(v) {',
    para: 'function normalizarPagUnifSemCache_(v) {',
    anexo: `

/* Mesma ideia: os textos comparados se repetem muito. */
const CACHE_NORM_PAG_UNIF_ = new Map();

function normalizarPagUnif_(v) {
  const chave = String(v == null ? '' : v);

  if (!CACHE_NORM_PAG_UNIF_.has(chave)) {
    CACHE_NORM_PAG_UNIF_.set(chave, normalizarPagUnifSemCache_(v));
  }

  return CACHE_NORM_PAG_UNIF_.get(chave);
}
`
  },

  {
    nome: 'Abre a planilha financeira uma vez por execução',
    porque:
      'openById é chamado toda vez que se busca a aba de boletos ou extrato.',
    de: 'function obterPlanilhaFinanceiraPagamentosSIGA_() {',
    para: 'function obterPlanilhaFinanceiraSemCachePagamentosSIGA_() {',
    anexo: `

/* openById é caro e a planilha é sempre a mesma dentro da execução. */
let CACHE_PLANILHA_FINANCEIRA_PAG_SIGA_ = null;

function obterPlanilhaFinanceiraPagamentosSIGA_() {
  if (!CACHE_PLANILHA_FINANCEIRA_PAG_SIGA_) {
    CACHE_PLANILHA_FINANCEIRA_PAG_SIGA_ =
      obterPlanilhaFinanceiraSemCachePagamentosSIGA_();
  }

  return CACHE_PLANILHA_FINANCEIRA_PAG_SIGA_;
}
`
  },

  {
    nome: 'Inadimplentes: só monta o boleto depois de saber que venceu',
    porque:
      'É a correção que já estava escrita em ' +
      'Pagamentos_listarInadimplentes_otimizacao.md e nunca foi aplicada. ' +
      'A função foi medida em 18-25 s.',
    de:
      '        const boleto =\n' +
      '          montarBoletoPagamentosSIGA_(\n' +
      '            linha,\n' +
      '            mapa\n' +
      '          );\n' +
      '        const vencimento =\n' +
      '          dataPagamentosSIGA_(\n' +
      '            boleto.vencimentoOriginal ||\n' +
      '            boleto.vencimento\n' +
      '          );\n' +
      '        if (!vencimento) {\n' +
      '          return;\n' +
      '        }\n' +
      '        if (\n' +
      '          vencimento >=\n' +
      '          hojeInadimplencia\n' +
      '        ) {\n' +
      '          return;\n' +
      '        }',
    para:
      '        /*\n' +
      '         * Lê só a data de vencimento primeiro. Boleto ainda a vencer\n' +
      '         * não interessa aqui, e montar o objeto completo (~25 campos,\n' +
      '         * com parsing de datas e valores) para depois descartar era o\n' +
      '         * grosso do tempo desta função.\n' +
      '         */\n' +
      '        const vencimento =\n' +
      '          dataPagamentosSIGA_(\n' +
      '            valorMapaPagamentosSIGA_(\n' +
      '              linha,\n' +
      '              mapa,\n' +
      '              [\'Data do Vencimento\']\n' +
      '            )\n' +
      '          );\n' +
      '        if (!vencimento) {\n' +
      '          return;\n' +
      '        }\n' +
      '        if (\n' +
      '          vencimento >=\n' +
      '          hojeInadimplencia\n' +
      '        ) {\n' +
      '          return;\n' +
      '        }\n' +
      '        const boleto =\n' +
      '          montarBoletoPagamentosSIGA_(\n' +
      '            linha,\n' +
      '            mapa,\n' +
      '            true\n' +
      '          );'
  }
];

if (!fs.existsSync(ARQUIVO)) {
  console.error('Não achei ' + path.resolve(ARQUIVO) + '.');
  console.error('Rode este script dentro da pasta do clasp.');
  process.exit(1);
}

let texto = fs.readFileSync(ARQUIVO, 'utf8');
const original = texto;

let aplicadas = 0;
const pulos = [];

CORRECOES.forEach((correcao, i) => {
  const ocorrencias = texto.split(correcao.de).length - 1;

  if (ocorrencias !== 1) {
    pulos.push(
      (i + 1) + '. ' + correcao.nome +
      ' — trecho esperado apareceu ' + ocorrencias + ' vez(es), não 1.'
    );
    return;
  }

  texto = texto.replace(correcao.de, correcao.para);
  if (correcao.anexo) texto += correcao.anexo;

  aplicadas++;
  console.log('OK  ' + (i + 1) + '. ' + correcao.nome);
});

if (!aplicadas) {
  console.error('\nNenhuma correção foi aplicada. Arquivo intocado.');
  pulos.forEach(p => console.error('    ' + p));
  process.exit(1);
}

try {
  new Function(texto);
} catch (erro) {
  console.error('\nO resultado não compila: ' + erro.message);
  console.error('Arquivo NÃO foi alterado.');
  process.exit(1);
}

fs.writeFileSync(ARQUIVO + '.bak', original);
fs.writeFileSync(ARQUIVO, texto);

console.log('\n' + aplicadas + ' de ' + CORRECOES.length + ' aplicadas.');

if (pulos.length) {
  console.log('\nNÃO aplicadas (o trecho no arquivo está diferente do esperado):');
  pulos.forEach(p => console.log('  ' + p));
  console.log('\nMe mande essas linhas do seu arquivo que eu ajusto o script.');
}

console.log('\nBackup: ' + ARQUIVO + '.bak');
console.log('Sintaxe conferida. Agora rode:  clasp push');
