/**
 * SIGA — Motivos de saída
 *
 * Responde uma pergunta que a tela de Análises não respondia: POR QUE os
 * alunos saem. A coluna MOTIVO_ALTERACAO da DimMatricula já é preenchida
 * pela secretaria e não era lida em lugar nenhum das Análises — a tela
 * mostrava a taxa de evasão (quanto) sem nunca mostrar a causa (por quê),
 * e "saiu por preço" e "saiu por horário" pedem ações opostas.
 *
 * Arquivo separado de propósito: não depende de nada do cache de
 * Análises e lê SÓ a DimMatricula (nada de TodosBoletos/Comprovante),
 * então roda em segundos e sempre reflete o cadastro atual, sem esperar
 * o recálculo de 6 horas — mesma decisão já tomada em
 * obterMovimentacaoTurmaAnalisesSIGA.
 *
 * Usa de Analises.gs/Pagamentos.gs: validarPermissaoPagamentosSIGA_,
 * mapaGenericoPagUnif_, campoPagUnif_, parseDataPagUnif_,
 * normalizarPagUnif_, arredPagUnif_, analisesGerarPeriodos_,
 * analisesMesRotulo_, analisesChaveParaRotulo_ e
 * analisesEmCursoParaMovimentacao_.
 */

/**
 * Saídas do período agrupadas por motivo.
 *
 * Saída = matrícula cujo status não é mais "em curso" E cuja data de
 * encerramento cai dentro da janela.
 *
 * Dois furos de cadastro são CONTADOS E DEVOLVIDOS em vez de escondidos,
 * porque os dois distorcem o ranking em silêncio:
 *
 *  - semData:   encerrada sem DATA_CANCELAMENTO/FINALIZACAO. Não dá pra
 *               saber em que mês saiu, então fica fora de qualquer
 *               período — é a mesma limitação que
 *               obterMovimentacaoTurmaAnalisesSIGA já avisa na tela.
 *  - semMotivo: saiu dentro do período, mas com MOTIVO_ALTERACAO em
 *               branco. Entra no ranking como "Não informado", nunca
 *               descartada: sumir com ela faria os outros motivos
 *               parecerem responder por 100% das saídas.
 *
 * O agrupamento é por texto NORMALIZADO (normalizarPagUnif_), senão
 * "Mudou de cidade" e "MUDOU DE CIDADE" viram dois motivos diferentes e
 * o ranking se pulveriza. O rótulo exibido é a primeira grafia vista.
 */
function obterMotivosSaidaAnalisesSIGA(filtros) {
  filtros = filtros || {};
  validarPermissaoPagamentosSIGA_(filtros.token);

  const meses = Math.max(1, Math.min(36, Number(filtros.meses || 12)));
  const turmaAlvo = String(filtros.turma || '').trim();

  const periodos = analisesGerarPeriodos_(meses);
  const chaves = periodos.map(p => analisesMesRotulo_(p).chave);
  const indicePorChave = new Map(chaves.map((chave, i) => [chave, i]));

  const vazio = {
    sucesso: true,
    turma: turmaAlvo,
    turmas: [],
    periodos: chaves.map(analisesChaveParaRotulo_),
    motivos: [],
    totalSaidas: 0,
    semMotivo: 0,
    semData: 0
  };

  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('DimMatricula');
  if (!aba || aba.getLastRow() < 2) {
    return vazio;
  }

  const dados = aba.getDataRange().getValues();
  const mapa = mapaGenericoPagUnif_(dados[0]);

  const porMotivo = new Map();
  const turmas = new Set();
  let totalSaidas = 0;
  let semMotivo = 0;
  let semData = 0;

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const turma = String(campoPagUnif_(linha, mapa, ['TURMA']) || '').trim();
    if (turma) {
      turmas.add(turma);
    }

    // Quem ainda está na escola não é saída. Note que
    // analisesEmCursoParaMovimentacao_ trata SUSPENSO como em curso —
    // diferente de analisesStatusAtivo_, que o conta como saída no
    // cálculo da taxa de evasão. Aqui a regra certa é a primeira: aluno
    // suspenso não saiu, e contá-lo criaria uma saída sem motivo real.
    const status = String(campoPagUnif_(linha, mapa, ['STATUS']) || '');
    if (analisesEmCursoParaMovimentacao_({ status: status })) {
      continue;
    }

    if (turmaAlvo && turma !== turmaAlvo) {
      continue;
    }

    const fim = parseDataPagUnif_(campoPagUnif_(linha, mapa, [
      'DATA_CANCELAMENTO/FINALIZACAO',
      'DATA CANCELAMENTO FINALIZACAO',
      'DATA_CANCELAMENTO',
      'DATA DE CANCELAMENTO',
      'DATA DE FINALIZACAO',
      'DATA DE FINALIZAÇÃO'
    ]));

    if (!fim) {
      semData++;
      continue;
    }

    const indiceMes = indicePorChave.get(analisesMesRotulo_(fim).chave);
    if (indiceMes === undefined) {
      continue; // saiu fora da janela escolhida
    }

    totalSaidas++;

    const motivoBruto = String(campoPagUnif_(linha, mapa, [
      'MOTIVO_ALTERACAO',
      'MOTIVO DA ALTERACAO',
      'MOTIVO DA ALTERAÇÃO',
      'MOTIVO_SAIDA',
      'MOTIVO'
    ]) || '').trim();

    if (!motivoBruto) {
      semMotivo++;
    }

    const rotulo = motivoBruto || 'Não informado';
    const chave = normalizarPagUnif_(rotulo);

    if (!porMotivo.has(chave)) {
      porMotivo.set(chave, {
        motivo: rotulo,
        total: 0,
        porMes: chaves.map(() => 0)
      });
    }

    const registro = porMotivo.get(chave);
    registro.total++;
    registro.porMes[indiceMes]++;
  }

  const motivos = Array.from(porMotivo.values())
    .map(item => Object.assign({}, item, {
      percentual: totalSaidas > 0 ? arredPagUnif_((item.total / totalSaidas) * 100) : 0
    }))
    .sort((a, b) => b.total - a.total || a.motivo.localeCompare(b.motivo, 'pt-BR'));

  return {
    sucesso: true,
    turma: turmaAlvo,
    turmas: Array.from(turmas).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    periodos: chaves.map(analisesChaveParaRotulo_),
    motivos: motivos,
    totalSaidas: totalSaidas,
    semMotivo: semMotivo,
    semData: semData
  };
}
