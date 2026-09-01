/**
 * Cadastra uma nova matrícula para um aluno que já existe na DimAluno.
 *
 * Este arquivo utiliza CONFIG e funções auxiliares que já existem no projeto.
 * NÃO declare CONFIG novamente.
 */
function cadastrarMatriculaAlunoExistente(formulario) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    if (!formulario) {
      throw new Error('Nenhum dado foi enviado.');
    }

    const idAluno = String(formulario.idAluno || '').trim();
    const nomeAluno = String(formulario.nomeAluno || '').trim();
    const turma = String(formulario.turma || '').trim();

    if (!idAluno) {
      throw new Error('ID do aluno não informado.');
    }

    if (!nomeAluno) {
      throw new Error('Nome do aluno não informado.');
    }

    if (!turma) {
      throw new Error('Selecione uma turma.');
    }

    if (!formulario.tipoMatricula) {
      throw new Error('Informe o tipo de matrícula.');
    }

    if (!formulario.dataMatricula) {
      throw new Error('Informe a data da matrícula.');
    }

    if (!formulario.dataEfetivoTurma) {
      throw new Error(
        'Informe a data em que o aluno iniciará na turma.'
      );
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const abaAlunos =
      ss.getSheetByName(CONFIG.ABAS.ALUNOS);

    const abaMatriculas =
      ss.getSheetByName(CONFIG.ABAS.MATRICULAS);

    if (!abaAlunos) {
      throw new Error('A aba DimAluno não foi encontrada.');
    }

    if (!abaMatriculas) {
      throw new Error('A aba DimMatricula não foi encontrada.');
    }

    validarAlunoParaNovaMatricula(
      abaAlunos,
      idAluno
    );

    verificarMatriculaDuplicada(
      abaMatriculas,
      idAluno,
      turma
    );

    const dataInicioTurma =
      buscarDataInicioTurma(turma);

    const dataEfetivoTurma =
      converterData(formulario.dataEfetivoTurma);

    if (
      dataInicioTurma &&
      dataEfetivoTurma &&
      dataEfetivoTurma < converterData(dataInicioTurma)
    ) {
      throw new Error(
        'A data em que o aluno iniciará na turma deve ser maior ou igual à data de início da turma.'
      );
    }

    const idMatricula =
      gerarProximoId(
        abaMatriculas,
        'ID_MATRICULA',
        CONFIG.PREFIXOS.MATRICULA
      );

    adicionarLinhaPorCabecalho(
      abaMatriculas,
      {
        ID_ALUNO: idAluno,
        ID_MATRICULA: idMatricula,
        NOME_ALUNO: nomeAluno,
        TURMA: turma,
        STATUS: formulario.status || 'ATIVO',
        'TIPO_MATRICULA/ALTERACAO':
          formulario.tipoMatricula,
        MOTIVO_ALTERACAO:
          formulario.motivoAlteracao || '',
        APPAI: formulario.appai || 'NÃO',
        'DATA_ALTERACAO/MATRICULA':
          converterData(formulario.dataMatricula),
        DATA_EFETIVO_TURMA: dataEfetivoTurma,
        'DATA_CANCELAMENTO/FINALIZACAO': '',
        ISENTO_MATRICULA:
          formulario.isentoMatricula || 'NÃO',
        BOLSISTA:
          formulario.bolsista || 'NÃO',
        SEM_COMBO_ANTES_VENCIMENTO:
          converterNumero(formulario.semComboAntes),
        SEM_COMBO_APOS_VENCIMENTO:
          converterNumero(formulario.semComboDepois),
        COM_COMBO_ANTES_VENCIMENTO:
          converterNumero(formulario.comComboAntes),
        COM_COMBO_APOS_VENCIMENTO:
          converterNumero(formulario.comComboDepois)
      }
    );

    return {
      sucesso: true,
      idAluno,
      idMatricula,
      mensagem: 'Nova matrícula cadastrada com sucesso.'
    };
  } catch (erro) {
    console.error(erro);
    throw erro;
  } finally {
    lock.releaseLock();
  }
}


/**
 * Confirma que o ID_ALUNO realmente existe na DimAluno.
 */
function validarAlunoParaNovaMatricula(
  abaAlunos,
  idAluno
) {
  const dados = abaAlunos.getDataRange().getValues();

  if (dados.length < 2) {
    throw new Error(
      'A DimAluno não possui alunos cadastrados.'
    );
  }

  const mapa = criarMapaCabecalhos(dados[0]);
  const indiceId = localizarIndiceCabecalho(
    mapa,
    ['ID_ALUNO']
  );

  if (indiceId === -1) {
    throw new Error(
      'A coluna ID_ALUNO não foi encontrada na DimAluno.'
    );
  }

  const existe = dados
    .slice(1)
    .some(linha =>
      String(linha[indiceId] || '').trim() === idAluno
    );

  if (!existe) {
    throw new Error(
      'O aluno selecionado não foi encontrado na DimAluno.'
    );
  }
}
