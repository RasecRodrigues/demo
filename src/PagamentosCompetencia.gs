/**
 * SIGA — a competência é cobrada pela vigência, não pelo status de hoje
 *
 * PROBLEMA
 * --------
 * A obrigação do mês só nascia se o STATUS ATUAL da matrícula fosse
 * ATIVO. O status é o do momento da consulta, não o da competência:
 * assim que a matrícula é encerrada, TODOS os meses passados em que o
 * aluno esteve na turma param de gerar obrigação — e o pagamento
 * daqueles meses fica sem destino.
 *
 * Caso real: Caio Costa Chaves, agosto/2026.
 *   MAT-00224 FORMAÇÃO I22        encerrada em 23/08/2026
 *   MAT-00400 FORMAÇÃO INTERMED1  ativa
 * Ele pagou R$ 260 em 10/08 (R$ 180 da INTERMED1 e R$ 80 da I22), mas
 * a tela mostrava só a INTERMED1, com devido de R$ 180 e os R$ 260
 * inteiros jogados nela.
 *
 * REGRA
 * -----
 * Quem decide é a vigência: DATA_EFETIVO_TURMA até
 * DATA_CANCELAMENTO/FINALIZACAO.
 *
 * Encerrada COM data de fim cobra os meses até essa data.
 * Encerrada SEM data de fim continua fora — sem o limite, passaria a
 * cobrar para sempre de quem já saiu.
 * EM ESPERA e SUSPENSO seguem sem cobrança, como antes.
 *
 * É o mesmo defeito já corrigido uma vez no Analises.gs (commit
 * "atribuição usava status ATUAL do aluno, não vigência histórica").
 */

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
  if (!m || !ref) {
    return false;
  }

  /* Fora da vigência não cobra, qualquer que seja o status. */
  if (!vigenteNoMesPagUnif_(m, ref)) {
    return false;
  }

  const status = normalizarPagUnif_(m.status || '');

  if (status === 'ATIVO' || status === 'ATIVA') {
    return true;
  }

  /*
   * Encerrada: a data de encerramento manda. O aluno esteve na turma
   * até ela, então os meses dentro da vigência são devidos. Sem data
   * de fim não há limite, e cobrar para sempre seria pior.
   */
  if (STATUS_ENCERRADOS_PAG_UNIF_.includes(status)) {
    return Boolean(m.fim);
  }

  /* EM ESPERA, SUSPENSO e afins continuam sem cobrança. */
  return false;
}


/**
 * Diagnóstico: execute pelo editor informando o ID do aluno e a
 * competência, e veja no log quais matrículas são cobradas.
 *
 * Exemplo: diagnosticarCompetenciaAlunoSIGA('ALU-00123', '2026-08')
 */
function diagnosticarCompetenciaAlunoSIGA(idAluno, competencia) {
  const aba = SpreadsheetApp
    .getActive()
    .getSheetByName('DimMatricula');

  if (!aba) {
    throw new Error('DimMatricula não encontrada.');
  }

  const partes = String(competencia || '').split('-').map(Number);

  if (partes.length < 2 || !partes[0] || !partes[1]) {
    throw new Error('Competência inválida. Use AAAA-MM.');
  }

  const ref = new Date(partes[0], partes[1] - 1, 1);

  const alvo = normalizarPagUnif_(idAluno || '');

  const resultado = lerMatriculasPagUnif_(aba)
    .filter(m =>
      normalizarPagUnif_(m.idAluno) === alvo ||
      normalizarPagUnif_(m.nome) === alvo
    )
    .map(m => ({
      turma: m.turma,
      status: m.status,
      inicio: m.inicio ? dataIsoPagUnif_(m.inicio) : '',
      fim: m.fim ? dataIsoPagUnif_(m.fim) : '',
      vigenteNoMes: vigenteNoMesPagUnif_(m, ref),
      cobradaNaCompetencia: matriculaCobravelNaCompetenciaPagUnif_(m, ref)
    }));

  console.log(JSON.stringify({ competencia, matriculas: resultado }, null, 2));
  return resultado;
}
