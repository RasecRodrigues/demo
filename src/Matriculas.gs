/**
 * SIGA - Histórico, edição e cancelamento de matrículas.
 * Este arquivo usa a constante CONFIG já existente no projeto.
 * NÃO declare CONFIG novamente.
 */

function listarMatriculasAluno(idAluno) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName(CONFIG.ABAS.MATRICULAS);

  if (!aba) {
    throw new Error('A aba DimMatricula não foi encontrada.');
  }

  const dados = aba.getDataRange().getValues();

  if (dados.length < 2) {
    return [];
  }

  const mapa = criarMapaCabecalhos(dados[0]);
  const indiceIdAluno = localizarIndiceCabecalho(mapa, ['ID_ALUNO']);

  if (indiceIdAluno === -1) {
    throw new Error(
      'A coluna ID_ALUNO não foi encontrada na DimMatricula.'
    );
  }

  return dados
    .slice(1)
    .filter(linha =>
      String(linha[indiceIdAluno] || '').trim() ===
      String(idAluno || '').trim()
    )
    .map(linha => montarMatriculaResposta_(linha, mapa))
    .sort((a, b) =>
      String(b.dataMatriculaHtml || '').localeCompare(
        String(a.dataMatriculaHtml || '')
      )
    );
}


function obterMatriculaPorId(idMatricula) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName(CONFIG.ABAS.MATRICULAS);

  if (!aba) {
    throw new Error('A aba DimMatricula não foi encontrada.');
  }

  const dados = aba.getDataRange().getValues();

  if (dados.length < 2) {
    throw new Error('A DimMatricula não possui registros.');
  }

  const mapa = criarMapaCabecalhos(dados[0]);
  const indiceId = localizarIndiceCabecalho(mapa, ['ID_MATRICULA']);

  if (indiceId === -1) {
    throw new Error(
      'A coluna ID_MATRICULA não foi encontrada na DimMatricula.'
    );
  }

  const linha = dados
    .slice(1)
    .find(item =>
      String(item[indiceId] || '').trim() ===
      String(idMatricula || '').trim()
    );

  if (!linha) {
    throw new Error('Matrícula não encontrada.');
  }

  return montarMatriculaResposta_(linha, mapa);
}


function atualizarMatricula(formulario) {
  if (!formulario || !formulario.idMatricula) {
    throw new Error('ID da matrícula não informado.');
  }

  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(CONFIG.ABAS.MATRICULAS);

    if (!aba) {
      throw new Error('A aba DimMatricula não foi encontrada.');
    }

    const dados = aba.getDataRange().getValues();
    const mapa = criarMapaCabecalhos(dados[0]);

    const indiceId = localizarIndiceCabecalho(
      mapa,
      ['ID_MATRICULA']
    );

    const indiceLinha = dados.findIndex((linha, indice) =>
      indice > 0 &&
      String(linha[indiceId] || '').trim() ===
        String(formulario.idMatricula).trim()
    );

    if (indiceLinha === -1) {
      throw new Error('Matrícula não encontrada.');
    }

    const atualizacoes = {
      TURMA: formulario.turma,
      STATUS: formulario.status || 'ATIVO',
      'TIPO_MATRICULA/ALTERACAO': formulario.tipoMatricula,
      MOTIVO_ALTERACAO: formulario.motivoAlteracao || '',
      'DATA_ALTERACAO/MATRICULA':
        converterData(formulario.dataMatricula),
      DATA_EFETIVO_TURMA:
        converterData(formulario.dataEfetivoTurma),
      ISENTO_MATRICULA: formulario.isentoMatricula || 'NÃO',
      BOLSISTA: normalizarBolsaSIGA_(formulario.bolsista),
      APPAI: formulario.appai || 'NÃO',
      SEM_COMBO_ANTES_VENCIMENTO:
        converterNumero(formulario.semComboAntes),
      SEM_COMBO_APOS_VENCIMENTO:
        converterNumero(formulario.semComboDepois),
      COM_COMBO_ANTES_VENCIMENTO:
        converterNumero(formulario.comComboAntes),
      COM_COMBO_APOS_VENCIMENTO:
        converterNumero(formulario.comComboDepois)
    };

    Object.entries(atualizacoes).forEach(([cabecalho, valor]) => {
      const indiceColuna = localizarIndiceCabecalho(
        mapa,
        [cabecalho]
      );

      if (indiceColuna !== -1) {
        aba
          .getRange(indiceLinha + 1, indiceColuna + 1)
          .setValue(valor);
      }
    });

    return {
      sucesso: true,
      idMatricula: formulario.idMatricula,
      mensagem: 'Matrícula atualizada com sucesso.'
    };
  } finally {
    lock.releaseLock();
  }
}


function cancelarMatricula(dadosCancelamento) {
  if (!dadosCancelamento || !dadosCancelamento.idMatricula) {
    throw new Error('ID da matrícula não informado.');
  }

  if (!dadosCancelamento.dataCancelamento) {
    throw new Error('Informe a data do cancelamento.');
  }

  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const aba = ss.getSheetByName(CONFIG.ABAS.MATRICULAS);

    if (!aba) {
      throw new Error('A aba DimMatricula não foi encontrada.');
    }

    const dados = aba.getDataRange().getValues();
    const mapa = criarMapaCabecalhos(dados[0]);

    const indiceId = localizarIndiceCabecalho(mapa, ['ID_MATRICULA']);
    const indiceStatus = localizarIndiceCabecalho(mapa, ['STATUS']);
    const indiceDataCancelamento = localizarIndiceCabecalho(mapa, [
      'DATA_CANCELAMENTO/FINALIZACAO'
    ]);

    if (
      indiceId === -1 ||
      indiceStatus === -1 ||
      indiceDataCancelamento === -1
    ) {
      throw new Error(
        'Confira os cabeçalhos ID_MATRICULA, STATUS e DATA_CANCELAMENTO/FINALIZACAO.'
      );
    }

    const indiceLinha = dados.findIndex((linha, indice) =>
      indice > 0 &&
      String(linha[indiceId] || '').trim() ===
        String(dadosCancelamento.idMatricula).trim()
    );

    if (indiceLinha === -1) {
      throw new Error('Matrícula não encontrada.');
    }

    const statusAtual = normalizarTexto(
      dados[indiceLinha][indiceStatus]
    );

    if (
      [
        'CANCELADO',
        'CANCELADA',
        'FINALIZADO',
        'FINALIZADA'
      ].includes(statusAtual)
    ) {
      throw new Error('Essa matrícula já está encerrada.');
    }

    aba
      .getRange(indiceLinha + 1, indiceStatus + 1)
      .setValue('CANCELADO');

    aba
      .getRange(indiceLinha + 1, indiceDataCancelamento + 1)
      .setValue(
        converterData(dadosCancelamento.dataCancelamento)
      );

    return {
      sucesso: true,
      mensagem: 'Matrícula cancelada com sucesso.'
    };
  } finally {
    lock.releaseLock();
  }
}


function montarMatriculaResposta_(linha, mapa) {
  const dataMatricula = obterValorLinha(
    linha,
    mapa,
    ['DATA_ALTERACAO/MATRICULA']
  );

  const dataEfetivo = obterValorLinha(
    linha,
    mapa,
    ['DATA_EFETIVO_TURMA']
  );

  const dataCancelamento = obterValorLinha(
    linha,
    mapa,
    ['DATA_CANCELAMENTO/FINALIZACAO']
  );

  return {
    idAluno: obterValorLinha(linha, mapa, ['ID_ALUNO']),
    idMatricula: obterValorLinha(linha, mapa, ['ID_MATRICULA']),
    nomeAluno: obterValorLinha(linha, mapa, ['NOME_ALUNO']),
    turma: obterValorLinha(linha, mapa, ['TURMA']),
    status: obterValorLinha(linha, mapa, ['STATUS']),
    tipoMatricula: obterValorLinha(linha, mapa, [
      'TIPO_MATRICULA/ALTERACAO',
      'TIPO_MATRICULA'
    ]),
    motivoAlteracao: obterValorLinha(linha, mapa, ['MOTIVO_ALTERACAO']),
    captacao: obterValorLinha(linha, mapa, ['CAPTACAO', 'CAPTAÇÃO']),
    appai: obterValorLinha(linha, mapa, ['APPAI']),
    dataMatricula: formatarDataExibicaoMatricula_(dataMatricula),
    dataMatriculaHtml: formatarDataHtmlMatricula_(dataMatricula),
    dataEfetivoTurma: formatarDataExibicaoMatricula_(dataEfetivo),
    dataEfetivoTurmaHtml: formatarDataHtmlMatricula_(dataEfetivo),
    dataCancelamento: formatarDataExibicaoMatricula_(dataCancelamento),
    dataCancelamentoHtml: formatarDataHtmlMatricula_(dataCancelamento),
    bolsista: obterValorLinha(linha, mapa, ['BOLSISTA']),
    isentoMatricula: obterValorLinha(
      linha,
      mapa,
      ['ISENTO_MATRICULA']
    ),
    semComboAntes: obterValorLinha(
      linha,
      mapa,
      ['SEM_COMBO_ANTES_VENCIMENTO']
    ),
    semComboDepois: obterValorLinha(
      linha,
      mapa,
      ['SEM_COMBO_APOS_VENCIMENTO']
    ),
    comComboAntes: obterValorLinha(
      linha,
      mapa,
      ['COM_COMBO_ANTES_VENCIMENTO']
    ),
    comComboDepois: obterValorLinha(
      linha,
      mapa,
      ['COM_COMBO_APOS_VENCIMENTO']
    )
  };
}


function formatarDataHtmlMatricula_(valor) {
  if (!valor) {
    return '';
  }

  if (valor instanceof Date) {
    return Utilities.formatDate(
      valor,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );
  }

  const texto = String(valor).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return texto;
  }

  const partes = texto.split('/');

  if (partes.length === 3) {
    return `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
  }

  return '';
}


function formatarDataExibicaoMatricula_(valor) {
  if (!valor) {
    return '';
  }

  if (valor instanceof Date) {
    return Utilities.formatDate(
      valor,
      Session.getScriptTimeZone(),
      'dd/MM/yyyy'
    );
  }

  const html = formatarDataHtmlMatricula_(valor);

  if (!html) {
    return String(valor);
  }

  const [ano, mes, dia] = html.split('-');
  return `${dia}/${mes}/${ano}`;
}


/**
 * Percentual de bolsa, na regra da escola:
 *
 *   em branco  -> não é bolsista (grava vazio)
 *   0          -> não é bolsista (grava vazio, igual ao em branco)
 *   1 a 100    -> é o percentual
 *   resto      -> erro, com a mensagem dizendo o que fazer
 *
 * Por que 0 vira vazio em vez de zero: quem lê essa coluna depois
 * (ehMatriculaIsentaPagUnif_ no Pagamentos, o cálculo de mensalidade)
 * trata "sem bolsa" como célula vazia. Gravar 0 criaria um segundo jeito
 * de dizer a mesma coisa, e todo leitor teria que aprender os dois. A
 * TELA aceita 0, a PLANILHA guarda vazio.
 *
 * Aceita "50", 50, "50%", "50,5" e " 50 ". O símbolo e a vírgula existem
 * porque quem digita está lendo "percentual", não "número decimal com
 * ponto" — rejeitar isso é rejeitar a pessoa, não o dado.
 *
 * Number('') devolve 0, que passa em `>= 0` sem ser um número digitado:
 * é por isso que o vazio é decidido ANTES da conversão, e não por
 * comparação numérica.
 */
function normalizarBolsaSIGA_(valor) {
  if (valor === null || valor === undefined) {
    return '';
  }

  const texto = String(valor).trim().replace('%', '').replace(',', '.');
  if (texto === '') {
    return '';
  }

  const numero = Number(texto);
  if (!Number.isFinite(numero)) {
    throw new Error(
      'Percentual de bolsa inválido: "' + valor + '". ' +
      'Informe um número de 1 a 100, ou deixe o campo em branco (ou 0) se o aluno não for bolsista.'
    );
  }

  if (numero === 0) {
    return '';
  }

  if (numero < 0 || numero > 100) {
    throw new Error(
      'Percentual de bolsa fora da faixa: ' + numero + '. ' +
      'Informe um número de 1 a 100, ou deixe o campo em branco (ou 0) se o aluno não for bolsista.'
    );
  }

  return numero;
}
