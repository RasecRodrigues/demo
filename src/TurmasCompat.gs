/**
 * SIGA — leitura tolerante da DimTurma
 *
 * O listarTurmas original exigia uma coluna de status com um
 * nome exato e, se não achasse, lançava erro — o que derrubava
 * a tela inteira ("Não encontrei a coluna STATUS da turma na
 * DimTurma") e deixava o seletor de turmas travado em
 * "Carregando turmas...".
 *
 * Esta versão:
 *   - aceita vários nomes possíveis para a coluna de status;
 *   - se não achar nenhum, LISTA TODAS as turmas em vez de
 *     quebrar. Melhor mostrar turma a mais do que travar a tela;
 *   - mantém o filtro EM ANDAMENTO / EM ESPERA quando a coluna
 *     existe, exatamente como antes.
 *
 * Depende de listarTurmasAntigo_ ter sido renomeada no Code.gs
 * apenas para liberar o nome. A antiga não é mais chamada.
 */

const NOMES_COLUNA_TURMA_SIGA_ = [
  'TURMA',
  'TIPOMATRICULA',
  'TIPO_MATRICULA',
  'TIPO DE MATRICULA',
  'NOME_TURMA',
  'NOME DA TURMA'
];

const NOMES_COLUNA_STATUS_TURMA_SIGA_ = [
  'STATUS',
  'STATUS_TURMA',
  'STATUSTURMA',
  'STATUS DA TURMA',
  'SITUACAO',
  'SITUAÇÃO',
  'SITUACAO_TURMA',
  'SITUAÇÃO DA TURMA',
  'SITUACAO DA TURMA',
  'ESTADO',
  'ATIVA'
];

const NOMES_COLUNA_INICIO_TURMA_SIGA_ = [
  'DATA INICIO',
  'DATA_INICIO',
  'DATAINICIO',
  'DATA DE INICIO',
  'DATA DE INÍCIO',
  'DATA INÍCIO',
  'INICIO'
];

const STATUS_TURMA_VISIVEIS_SIGA_ = [
  'EM ANDAMENTO',
  'EM ESPERA'
];


function listarTurmas() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const aba = planilha.getSheetByName(CONFIG.ABAS.TURMAS);

  if (!aba) {
    throw new Error('A aba ' + CONFIG.ABAS.TURMAS + ' não foi encontrada.');
  }

  const dados = aba.getDataRange().getValues();

  if (dados.length < 2) {
    return [];
  }

  /*
   * A linha de títulos nem sempre é a primeira: a aba pode ter
   * uma linha em branco ou mesclada acima. Procura nas cinco
   * primeiras a que realmente tem a coluna da turma.
   */
  const cabecalho = localizarCabecalhoTurmaSIGA_(dados);

  if (!cabecalho) {
    throw new Error(
      'Não encontrei a coluna da turma na ' + CONFIG.ABAS.TURMAS +
      '. Primeira linha lida: ' + (dados[0] || []).join(' | ')
    );
  }

  const mapa = cabecalho.mapa;
  const indiceTurma = cabecalho.indiceTurma;

  const indiceStatus =
    localizarIndiceCabecalho(mapa, NOMES_COLUNA_STATUS_TURMA_SIGA_);

  const indiceDataInicio =
    localizarIndiceCabecalho(mapa, NOMES_COLUNA_INICIO_TURMA_SIGA_);

  const indiceModalidade =
    localizarIndiceCabecalho(mapa, ['MODALIDADE']);

  /*
   * Sem coluna de status não dá para saber quais turmas estão
   * em andamento — então mostra todas. Antes, este caso lançava
   * erro e a tela não abria.
   */
  const filtrarPorStatus = indiceStatus >= 0;

  if (!filtrarPorStatus) {
    console.log(
      'DimTurma sem coluna de status reconhecida. ' +
      'Listando todas as turmas. Cabeçalhos: ' +
      cabecalho.valores.join(' | ')
    );
  }

  return dados
    .slice(cabecalho.linha + 1)
    .map(linha => {
      const turma = String(linha[indiceTurma] || '').trim();

      const status = filtrarPorStatus
        ? normalizarTexto(linha[indiceStatus])
        : '';

      const dataInicio =
        indiceDataInicio >= 0
          ? formatarDataParaExibicao(linha[indiceDataInicio])
          : '';

      const modalidade =
        indiceModalidade >= 0
          ? String(linha[indiceModalidade] || '').trim()
          : '';

      return { turma, status, dataInicio, modalidade };
    })
    .filter(item => {
      if (!item.turma) {
        return false;
      }

      if (!filtrarPorStatus) {
        return true;
      }

      return STATUS_TURMA_VISIVEIS_SIGA_.includes(item.status);
    })
    .sort((a, b) => a.turma.localeCompare(b.turma, 'pt-BR'));
}


/**
 * Procura, nas primeiras linhas da aba, aquela que funciona como
 * cabeçalho — ou seja, a que contém a coluna da turma.
 */
function localizarCabecalhoTurmaSIGA_(dados) {
  const limite = Math.min(5, dados.length);

  for (let i = 0; i < limite; i++) {
    const valores = dados[i] || [];
    const mapa = criarMapaCabecalhos(valores);
    const indiceTurma =
      localizarIndiceCabecalho(mapa, NOMES_COLUNA_TURMA_SIGA_);

    if (indiceTurma >= 0) {
      return { linha: i, valores, mapa, indiceTurma };
    }
  }

  return null;
}


/**
 * Diagnóstico: execute pelo editor e veja no log os cabeçalhos
 * reais da DimTurma e o que foi reconhecido.
 */
function diagnosticarDimTurmaSIGA() {
  const aba = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(CONFIG.ABAS.TURMAS);

  if (!aba) {
    console.log('Aba ' + CONFIG.ABAS.TURMAS + ' não encontrada.');
    return;
  }

  const dados = aba.getDataRange().getValues();
  const cabecalho = localizarCabecalhoTurmaSIGA_(dados);

  const resultado = {
    aba: CONFIG.ABAS.TURMAS,
    primeiraLinha: dados[0] || [],
    linhaDoCabecalho: cabecalho ? cabecalho.linha + 1 : 'não encontrada',
    cabecalhos: cabecalho ? cabecalho.valores : [],
    indiceTurma: cabecalho ? cabecalho.indiceTurma : -1,
    indiceStatus: cabecalho
      ? localizarIndiceCabecalho(cabecalho.mapa, NOMES_COLUNA_STATUS_TURMA_SIGA_)
      : -1,
    totalLinhas: aba.getLastRow() - 1,
    turmasListadas: listarTurmas().length
  };

  console.log(JSON.stringify(resultado, null, 2));
  return resultado;
}
