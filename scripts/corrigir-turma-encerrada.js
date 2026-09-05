/**
 * SIGA — mensalidade some quando a matrícula é encerrada.
 *
 * Rode dentro da pasta do clasp, DEPOIS de otimizar-pagamentos.js:
 *   node corrigir-turma-encerrada.js
 *
 * PROBLEMA
 * --------
 * Em montarBaseMensalidadesPagasSIGA_ a obrigação do mês só nascia se
 * a matrícula estivesse com STATUS ATUAL = ATIVO. O status é do momento
 * da consulta, não da competência: assim que a matrícula é encerrada,
 * TODOS os meses passados em que o aluno esteve na turma param de gerar
 * obrigação — inclusive os que ele pagou.
 *
 * Caso real: Caio Costa Chaves, agosto/2026.
 *   MAT-00224 FORMAÇÃO I22        — encerrada em 23/08/2026
 *   MAT-00400 FORMAÇÃO INTERMED1  — ativa
 * Ele pagou R$ 260 em 10/08 (R$ 180 INTERMED1 + R$ 80 I22), mas a tela
 * mostrava só INTERMED1, com devido de R$ 180 e o pagamento inteiro
 * jogado nela.
 *
 * CORREÇÃO
 * --------
 * Quem decide é a vigência (DATA_EFETIVO_TURMA até
 * DATA_CANCELAMENTO/FINALIZACAO), não o status de hoje. Matrícula
 * encerrada COM data de fim cobra normalmente os meses até essa data.
 *
 * Encerrada SEM data de fim continua fora: sem a data não há como saber
 * até quando cobrar, e passaria a cobrar para sempre. EM ESPERA e
 * SUSPENSO seguem sem cobrança, como antes.
 */

const fs = require('fs');
const path = require('path');

const ARQUIVO = process.argv[2] || 'Pagamentos.js';

const HELPER = `

/* ============================================================
 * A COMPETÊNCIA É COBRADA PELA VIGÊNCIA, NÃO PELO STATUS DE HOJE
 *
 * O status da DimMatricula é o de agora. Usá-lo para decidir se
 * um mês passado gera obrigação faz o histórico do aluno sumir
 * assim que ele sai da turma — junto com os pagamentos dele.
 * ============================================================ */
const STATUS_ENCERRADOS_PAG_UNIF_ = [
  'CANCELADO',
  'CANCELADA',
  'FINALIZADO',
  'FINALIZADA',
  'ABANDONO',
  'TRANSFERIDO',
  'TRANSFERIDA'
];

function matriculaCobravelNaCompetenciaPagUnif_(m, ref) {
  if (!m || !ref) return false;

  /* Fora da vigência não cobra, qualquer que seja o status. */
  if (!vigenteNoMesPagUnif_(m, ref)) return false;

  const status = normalizarPagUnif_(m.status || '');

  if (status === 'ATIVO' || status === 'ATIVA') return true;

  /*
   * Encerrada: a data de encerramento manda. O aluno esteve na
   * turma até ela, então os meses dentro da vigência são devidos.
   * Sem data de fim não dá para saber o limite, e cobrar para
   * sempre seria pior — nesse caso segue de fora.
   */
  if (STATUS_ENCERRADOS_PAG_UNIF_.includes(status)) {
    return Boolean(m.fim);
  }

  /* EM ESPERA, SUSPENSO e afins continuam sem cobrança. */
  return false;
}
`;

const CORRECOES = [
  {
    nome: 'Obrigações do mês (montarBaseMensalidadesPagasSIGA_)',
    de:
      '        const ativas =\n' +
      '          matsAluno.filter(m => {\n' +
      '            const status =\n' +
      '              normalizarPagUnif_(\n' +
      '                m.status || \'\'\n' +
      '              );\n' +
      '            return (\n' +
      '              status === \'ATIVO\' &&\n' +
      '              vigenteNoMesPagUnif_(\n' +
      '                m,\n' +
      '                ref\n' +
      '              )\n' +
      '            );\n' +
      '          });',
    para:
      '        const ativas =\n' +
      '          matsAluno.filter(m =>\n' +
      '            matriculaCobravelNaCompetenciaPagUnif_(m, ref)\n' +
      '          );'
  },

  {
    nome: 'Turmas e valor devido (obterTurmasEValorDevidoDimPagUnif_)',
    de:
      '  const ativas =\n' +
      '    (matriculasAluno || [])\n' +
      '      .filter(m => {\n' +
      '        const status =\n' +
      '          normalizarPagUnif_(\n' +
      '            m.status || \'\'\n' +
      '          );\n' +
      '        return (\n' +
      '          status === \'ATIVO\' &&\n' +
      '          vigenteNoMesPagUnif_(m, ref)\n' +
      '        );\n' +
      '      });',
    para:
      '  const ativas =\n' +
      '    (matriculasAluno || [])\n' +
      '      .filter(m =>\n' +
      '        matriculaCobravelNaCompetenciaPagUnif_(m, ref)\n' +
      '      );'
  }
];

if (!fs.existsSync(ARQUIVO)) {
  console.error('Não achei ' + path.resolve(ARQUIVO) + '.');
  process.exit(1);
}

let texto = fs.readFileSync(ARQUIVO, 'utf8');
const original = texto;

if (texto.includes('matriculaCobravelNaCompetenciaPagUnif_')) {
  console.error('A correção já está aplicada neste arquivo. Nada a fazer.');
  process.exit(0);
}

let aplicadas = 0;
const pulos = [];

CORRECOES.forEach((c, i) => {
  const ocorrencias = texto.split(c.de).length - 1;

  if (ocorrencias !== 1) {
    pulos.push(
      (i + 1) + '. ' + c.nome +
      ' — trecho apareceu ' + ocorrencias + ' vez(es), não 1.'
    );
    return;
  }

  texto = texto.replace(c.de, c.para);
  aplicadas++;
  console.log('OK  ' + (i + 1) + '. ' + c.nome);
});

if (aplicadas !== CORRECOES.length) {
  console.error('\nAs duas correções precisam ser aplicadas juntas.');
  console.error('Aplicar só uma deixaria a obrigação e o valor devido');
  console.error('com regras diferentes. Arquivo NÃO foi alterado.\n');
  pulos.forEach(p => console.error('  ' + p));
  process.exit(1);
}

texto += HELPER;

try {
  new Function(texto);
} catch (erro) {
  console.error('\nO resultado não compila: ' + erro.message);
  console.error('Arquivo NÃO foi alterado.');
  process.exit(1);
}

fs.writeFileSync(ARQUIVO + '.bak-turma-encerrada', original);
fs.writeFileSync(ARQUIVO, texto);

console.log('\n2 de 2 aplicadas.');
console.log('Backup: ' + ARQUIVO + '.bak-turma-encerrada');
console.log('Sintaxe conferida. Agora rode:  clasp push');
console.log('\nATENÇÃO: meses que estavam invisíveis vão reaparecer.');
console.log('Quem saiu no meio do mês e não pagou passa a constar como');
console.log('devendo aquele mês. É dívida real, mas os totais mudam.');
