/**
 * =========================================================
 * SIGA — ENCOMENDAS DE CAMISAS
 * Arquivo: EncomendasCamisas.gs
 * Aba: camisas
 * Mesma planilha principal do SIGA
 * =========================================================
 */

const ENCOMENDAS_CAMISAS_SIGA_CONFIG = {
  ABA: 'camisas',
  ABA_COMPROVANTES: 'Comprovante de pagamento',

  // A aba camisas passa a ser somente uma visão/espelho.
  // O SIGA grava os dados exclusivamente em Comprovante de pagamento.
  // Os detalhes operacionais da encomenda ficam somente na aba camisas.
  CAMPOS_CAMISA_COMPROVANTE: [],

  ABA_ALUNOS: 'DimAluno',
  ABA_MATRICULAS: 'DimMatricula',

  PASTA_COMPROVANTES:
    'SIGA - Comprovantes Camisas',

  CABECALHOS: [
    'NOME_ALUNO',
    'TURMA',
    'DATA_PAGAMENTO',
    'MES_ANO',
    'VALOR_PAGO',
    'VALOR_CAMISA',
    'VALOR_FALTANTE',
    'FORMA_PAGAMENTO',
    'COMPROVANTE_PAGAMENTO',
    'TAMANHO',
    'STATUS',
    'MEIO_DA_ENCOMENDA',
    'ENCOMENDA_REALIZADA_POR',
    'ENTREGUE_POR',
    'REMESSA',
    'OBSERVACOES'
  ],

  TAMANHOS: [
    'P',
    'M',
    'G',
    'GG',
    'XGG',
    'G1 - G2',
    'G3',
    '6 ANOS',
    '8 ANOS',
    '10 ANOS',
    '12 ANOS',
    '14 ANOS',
    'P SEM MANGA',
    'M SEM MANGA',
    'G SEM MANGA',
    'GG SEM MANGA',
    'XG SEM MANGA'
  ],

  STATUS: [
    'ACEITO',
    'EM PRODUÇÃO',
    'DISPONÍVEL',
    'ENTREGUE'
  ],

  FORMAS_PAGAMENTO: [
    'DINHEIRO',
    'PIX',
    'CARTÃO'
  ],

  MEIOS_ENCOMENDA: [
    'PRESENCIAL',
    'WHATSAPP'
  ]
};


/**
 * Retorna encomendas + apoio para autocomplete de aluno/turma.
 */
function listarEncomendasCamisasSIGA() {

  const ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  const aba =
    obterAbaCamisasSIGA_(ss);

  const tabela =
    lerTabelaCamisasSIGA_(
      aba
    );

  atualizarValoresFaltantesCamisasSIGA_(aba, tabela);

  const tabelaAtualizada =
    lerTabelaCamisasSIGA_(aba);

  const encomendas =
    tabelaAtualizada.linhas
      .map((linha, indice) =>
        montarEncomendaCamisaSIGA_(
          linha,
          indice + 2,
          tabelaAtualizada.mapa
        )
      )
      .filter(item =>
        item.nomeAluno
      )
      .reverse();

  const apoio =
    obterAlunosTurmasCamisasSIGA_(
      ss
    );

  return {
    sucesso: true,
    encomendas,
    alunos:
      apoio.alunos,
    turmasPorAluno:
      apoio.turmasPorAluno
  };
}



/**
 * Retorna alunos com matrícula ATIVA que ainda não possuem
 * nenhuma encomenda registrada na aba camisas.
 *
 * Um aluno aparece apenas uma vez e suas turmas ativas
 * são agrupadas.
 */
function listarAlunosSemEncomendaCamisasSIGA() {

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const resultado =
    obterListaAlunosSemEncomendaCamisasSIGA_(
      ss
    );

  return {
    sucesso: true,
    alunos: resultado.alunos,
    turmas: resultado.turmas,
    total: resultado.alunos.length
  };
}


/**
 * Gera PDF dos alunos sem encomenda respeitando
 * pesquisa e filtro de turma.
 */
function gerarPdfAlunosSemEncomendaCamisasSIGA(
  filtros
) {

  filtros = filtros || {};

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const resultado =
    obterListaAlunosSemEncomendaCamisasSIGA_(
      ss
    );

  const busca =
    normalizarTextoCamisasSIGA_(
      filtros.busca || ''
    );

  const turmaFiltro =
    normalizarTextoCamisasSIGA_(
      filtros.turma || ''
    );

  const alunos =
    resultado.alunos.filter(item => {

      const nome =
        normalizarTextoCamisasSIGA_(
          item.nomeAluno
        );

      const turmas =
        Array.isArray(item.turmas)
          ? item.turmas
          : [];

      const bateBusca =
        !busca ||
        nome.includes(busca) ||
        turmas.some(t =>
          normalizarTextoCamisasSIGA_(t)
            .includes(busca)
        );

      const bateTurma =
        !turmaFiltro ||
        turmas.some(t =>
          normalizarTextoCamisasSIGA_(t) ===
          turmaFiltro
        );

      return (
        bateBusca &&
        bateTurma
      );
    });

  if (!alunos.length) {
    throw new Error(
      'Não há alunos sem encomenda para os filtros selecionados.'
    );
  }

  const timezone =
    Session.getScriptTimeZone();

  const agora =
    new Date();

  const dataTexto =
    Utilities.formatDate(
      agora,
      timezone,
      'dd/MM/yyyy HH:mm'
    );

  const tituloFiltro =
    filtros.turma
      ? 'Turma: ' +
        escaparHtmlPdfCamisasSIGA_(
          filtros.turma
        )
      : 'Todas as turmas';

  const linhasHtml =
    alunos
      .map((item, indice) => {

        const turmas =
          Array.isArray(item.turmas)
            ? item.turmas.join(' / ')
            : '';

        return `
          <tr>
            <td class="numero">
              ${indice + 1}
            </td>
            <td>
              ${escaparHtmlPdfCamisasSIGA_(
                item.nomeAluno
              )}
            </td>
            <td>
              ${escaparHtmlPdfCamisasSIGA_(
                turmas
              )}
            </td>
          </tr>
        `;
      })
      .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page{
    size:A4;
    margin:18mm 14mm 16mm;
  }

  body{
    font-family:Arial,sans-serif;
    color:#202431;
    font-size:11px;
    margin:0;
  }

  .cabecalho{
    border-bottom:2px solid #6427e8;
    padding-bottom:10px;
    margin-bottom:14px;
  }

  h1{
    margin:0 0 5px;
    font-size:20px;
  }

  .subtitulo{
    color:#667085;
    font-size:10px;
  }

  .resumo{
    display:flex;
    justify-content:space-between;
    margin:0 0 12px;
    padding:9px 10px;
    border:1px solid #e4e7ec;
    background:#f8f9fc;
  }

  table{
    width:100%;
    border-collapse:collapse;
  }

  th{
    text-align:left;
    background:#f0ecff;
    color:#4b2888;
    font-size:9px;
    text-transform:uppercase;
    padding:8px;
    border-bottom:1px solid #d9d3f5;
  }

  td{
    padding:8px;
    border-bottom:1px solid #e7e9ee;
    vertical-align:top;
  }

  .numero{
    width:36px;
    text-align:center;
    color:#667085;
  }

  .rodape{
    margin-top:14px;
    color:#667085;
    font-size:9px;
  }
</style>
</head>
<body>

  <div class="cabecalho">
    <h1>
      Casa de Artes Gabriel Engel
    </h1>

    <div class="subtitulo">
      Alunos sem encomenda de camisa
    </div>
  </div>

  <div class="resumo">
    <span>
      ${tituloFiltro}
    </span>

    <strong>
      Total: ${alunos.length} aluno(s)
    </strong>
  </div>

  <table>
    <thead>
      <tr>
        <th>Nº</th>
        <th>Aluno</th>
        <th>Turma(s)</th>
      </tr>
    </thead>

    <tbody>
      ${linhasHtml}
    </tbody>
  </table>

  <div class="rodape">
    Relatório gerado pelo SIGA em ${dataTexto}.
  </div>

</body>
</html>
  `;

  const blobHtml =
    Utilities.newBlob(
      html,
      'text/html',
      'alunos-sem-encomenda.html'
    );

  const pdf =
    blobHtml
      .getAs(MimeType.PDF)
      .setName(
        'Alunos_sem_encomenda_camisa_' +
        Utilities.formatDate(
          agora,
          timezone,
          'yyyy-MM-dd_HHmm'
        ) +
        '.pdf'
      );

  const pasta =
    obterPastaRelatoriosCamisasSIGA_();

  const arquivo =
    pasta.createFile(pdf);

  /*
   * O app roda como o dono da planilha, entao o PDF nasce
   * privado e o funcionario cai em "Voce precisa de
   * permissao" do Drive.
   */
  arquivo.setSharing(
    DriveApp.Access.ANYONE_WITH_LINK,
    DriveApp.Permission.VIEW
  );

  return {
    sucesso: true,
    url: arquivo.getUrl(),
    nome: arquivo.getName(),
    total: alunos.length
  };
}


/**
 * Monta a lista-base de alunos sem encomenda.
 */
function obterListaAlunosSemEncomendaCamisasSIGA_(
  ss
) {

  const apoio =
    obterAlunosTurmasCamisasSIGA_(ss);

  const abaCamisas =
    obterAbaCamisasSIGA_(ss);

  const tabelaCamisas =
    lerTabelaCamisasSIGA_(
      abaCamisas
    );

  const alunosComEncomenda =
    new Set();

  tabelaCamisas.linhas
    .forEach(linha => {

      const nome =
        textoCampoCamisasSIGA_(
          linha,
          tabelaCamisas.mapa,
          'NOME_ALUNO'
        );

      if (nome) {
        alunosComEncomenda.add(
          normalizarTextoCamisasSIGA_(
            nome
          )
        );
      }
    });

  const alunos =
    apoio.alunos
      .filter(nome => {

        const chave =
          normalizarTextoCamisasSIGA_(
            nome
          );

        return (
          !alunosComEncomenda.has(
            chave
          )
        );
      })
      .map(nome => {

        const chave =
          normalizarTextoCamisasSIGA_(
            nome
          );

        const turmas =
          Array.isArray(
            apoio.turmasPorAluno[chave]
          )
            ? apoio.turmasPorAluno[chave]
            : [];

        return {
          nomeAluno: nome,
          turmas:
            [...new Set(turmas)]
              .sort((a, b) =>
                a.localeCompare(
                  b,
                  'pt-BR'
                )
              )
        };
      })
      .sort((a, b) =>
        a.nomeAluno.localeCompare(
          b.nomeAluno,
          'pt-BR'
        )
      );

  const turmas =
    [...new Set(
      alunos.flatMap(
        item => item.turmas
      )
    )]
      .sort((a, b) =>
        a.localeCompare(
          b,
          'pt-BR'
        )
      );

  return {
    alunos,
    turmas
  };
}


function obterPastaRelatoriosCamisasSIGA_() {

  const nome =
    'SIGA - Relatórios Camisas';

  const pastas =
    DriveApp.getFoldersByName(
      nome
    );

  if (pastas.hasNext()) {
    return pastas.next();
  }

  return DriveApp.createFolder(
    nome
  );
}


function escaparHtmlPdfCamisasSIGA_(
  valor
) {

  return String(
    valor ?? ''
  )
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


/**
 * Salva nova encomenda.
 */
function salvarEncomendaCamisaSIGA(
  dados
) {

  dados = dados || {};

  const nomeAluno =
    String(dados.nomeAluno || '').trim();

  const turma =
    String(dados.turma || '').trim();

  const dataPagamento =
    parseDataCamisasSIGA_(dados.dataPagamento);

  const valorPago =
    numeroCamisasSIGA_(dados.valorPago);

  const valorCamisa =
    numeroCamisasSIGA_(dados.valorCamisa);

  const valorFaltante =
    Math.max(valorCamisa - valorPago, 0);

  const formaPagamento =
    normalizarTextoCamisasSIGA_(dados.formaPagamento);

  const tamanho =
    normalizarTextoCamisasSIGA_(dados.tamanho);

  const status =
    normalizarTextoCamisasSIGA_(
      dados.status || 'ACEITO'
    );

  const meioEncomenda =
    normalizarTextoCamisasSIGA_(dados.meioEncomenda);

  const entreguePor =
    String(dados.entreguePor || '').trim();

  const encomendaRealizadaPor =
    String(dados.encomendaRealizadaPor || '').trim();

  const observacoes =
    String(dados.observacoes || '').trim();

  const remessa =
    Number(dados.remessa || 0);

  if (!nomeAluno) {
    throw new Error('Informe o nome do aluno.');
  }

  if (!turma) {
    throw new Error('Informe a turma.');
  }

  if (!Number.isInteger(remessa) || remessa <= 0) {
    throw new Error('Informe a remessa com um número inteiro maior que zero.');
  }

  if (!dataPagamento) {
    throw new Error('Informe uma data de pagamento válida.');
  }

  if (!(valorPago > 0)) {
    throw new Error('Informe um valor pago maior que zero.');
  }

  if (!(valorCamisa > 0)) {
    throw new Error('Informe o valor total da camisa maior que zero.');
  }

  if (valorPago > valorCamisa) {
    throw new Error('O valor pago não pode ser maior que o valor da camisa.');
  }

  if (!encomendaRealizadaPor) {
    throw new Error('Informe quem realizou a encomenda.');
  }

  if (
    !ENCOMENDAS_CAMISAS_SIGA_CONFIG.FORMAS_PAGAMENTO
      .map(normalizarTextoCamisasSIGA_)
      .includes(formaPagamento)
  ) {
    throw new Error('Forma de pagamento inválida.');
  }

  if (
    !ENCOMENDAS_CAMISAS_SIGA_CONFIG.TAMANHOS
      .map(normalizarTextoCamisasSIGA_)
      .includes(tamanho)
  ) {
    throw new Error('Tamanho de camisa inválido.');
  }

  if (
    !ENCOMENDAS_CAMISAS_SIGA_CONFIG.STATUS
      .map(normalizarTextoCamisasSIGA_)
      .includes(status)
  ) {
    throw new Error('Status inválido.');
  }

  if (
    !ENCOMENDAS_CAMISAS_SIGA_CONFIG.MEIOS_ENCOMENDA
      .map(normalizarTextoCamisasSIGA_)
      .includes(meioEncomenda)
  ) {
    throw new Error('Meio da encomenda inválido.');
  }

  let linkComprovante = '';

  if (
    dados.comprovante &&
    dados.comprovante.base64
  ) {
    linkComprovante =
      salvarComprovanteCamisaSIGA_(
        dados.comprovante,
        nomeAluno,
        dataPagamento
      );
  }

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  /*
   * IMPORTANTE:
   * NÃO grava mais nada diretamente na aba "camisas".
   * A única fonte oficial passa a ser "Comprovante de pagamento".
   */
  const registroComprovante =
    registrarPagamentoCamisaNoComprovanteSIGA_({
      ss,
      nomeAluno,
      turma,
      dataPagamento,
      valorPago,
      formaPagamento,
      linkComprovante,
      tamanho:
        obterValorOriginalCamisasSIGA_(
          dados.tamanho,
          ENCOMENDAS_CAMISAS_SIGA_CONFIG.TAMANHOS
        ),
      status:
        obterValorOriginalCamisasSIGA_(
          dados.status || 'ACEITO',
          ENCOMENDAS_CAMISAS_SIGA_CONFIG.STATUS
        ),
      meioEncomenda:
        obterValorOriginalCamisasSIGA_(
          dados.meioEncomenda,
          ENCOMENDAS_CAMISAS_SIGA_CONFIG.MEIOS_ENCOMENDA
        ),
      entreguePor,
      remessa,
      observacoes
    });

  /*
   * A aba camisas agora voltou a ser uma tabela independente
   * (sem FILTER). Por isso registramos também a encomenda nela.
   */
  gravarEncomendaNaAbaCamisasSIGA_({
    ss,
    nomeAluno,
    turma,
    dataPagamento,
    valorPago,
    valorCamisa,
    valorFaltante,
    formaPagamento,
    linkComprovante,
    tamanho:
      obterValorOriginalCamisasSIGA_(
        dados.tamanho,
        ENCOMENDAS_CAMISAS_SIGA_CONFIG.TAMANHOS
      ),
    status:
      obterValorOriginalCamisasSIGA_(
        dados.status || 'ACEITO',
        ENCOMENDAS_CAMISAS_SIGA_CONFIG.STATUS
      ),
    meioEncomenda:
      obterValorOriginalCamisasSIGA_(
        dados.meioEncomenda,
        ENCOMENDAS_CAMISAS_SIGA_CONFIG.MEIOS_ENCOMENDA
      ),
    encomendaRealizadaPor,
    entreguePor,
    remessa,
    observacoes
  });

  return {
    sucesso: true,
    mensagem:
      'Encomenda de camisa registrada com sucesso.',
    idComprovante:
      registroComprovante.idComprovante || ''
  };
}

/**
 * Atualiza status e, na entrega, quem entregou.
 */
function atualizarStatusEncomendaCamisaSIGA(
  dados
) {

  dados = dados || {};

  const linha =
    Number(dados.linha || 0);

  if (
    !Number.isInteger(linha) ||
    linha < 2
  ) {
    throw new Error(
      'Linha da encomenda inválida.'
    );
  }

  const status =
    normalizarTextoCamisasSIGA_(
      dados.status
    );

  const statusPermitidos =
    ENCOMENDAS_CAMISAS_SIGA_CONFIG
      .STATUS
      .map(
        normalizarTextoCamisasSIGA_
      );

  if (
    !statusPermitidos.includes(status)
  ) {
    throw new Error(
      'Status inválido.'
    );
  }

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const abaCamisas =
    obterAbaCamisasSIGA_(ss);

  if (
    linha >
    abaCamisas.getLastRow()
  ) {
    throw new Error(
      'Encomenda não encontrada.'
    );
  }

  const tabela =
    lerTabelaCamisasSIGA_(
      abaCamisas
    );

  const statusOriginal =
    obterValorOriginalCamisasSIGA_(
      dados.status,
      ENCOMENDAS_CAMISAS_SIGA_CONFIG.STATUS
    );

  const colunaStatus =
    tabela.mapa.STATUS;

  if (colunaStatus < 0) {
    throw new Error(
      'Coluna STATUS não encontrada na aba camisas.'
    );
  }

  /*
   * A tela lê a aba camisas, então ela é atualizada primeiro.
   */
  abaCamisas
    .getRange(
      linha,
      colunaStatus + 1
    )
    .setValue(
      statusOriginal
    );

  const entreguePor =
    String(
      dados.entreguePor || ''
    ).trim();

  const colunaEntreguePor =
    encontrarIndiceCamisasSIGA_(
      tabela.mapa,
      ['ENTREGUE_POR']
    );

  if (status === 'ENTREGUE') {

    if (!entreguePor) {
      throw new Error(
        'Informe quem realizou a entrega.'
      );
    }

    if (
      colunaEntreguePor >= 0
    ) {
      abaCamisas
        .getRange(
          linha,
          colunaEntreguePor + 1
        )
        .setValue(
          entreguePor
        );
    }
  }

  return {
    sucesso: true,
    mensagem:
      'Status atualizado com sucesso.'
  };
}


/**
 * Procura o pagamento de camisa correspondente e atualiza
 * STATUS_CAMISA / ENTREGUE_POR_CAMISA no comprovante.
 */
function atualizarStatusCamisaNoComprovantePorDadosSIGA_(
  dados
) {

  const aba =
    dados.ss.getSheetByName(
      ENCOMENDAS_CAMISAS_SIGA_CONFIG.ABA_COMPROVANTES
    );

  if (!aba) return;

  garantirCamposCamisaNoComprovanteSIGA_(
    aba
  );

  const valores =
    aba.getDataRange().getValues();

  if (valores.length < 2) return;

  const mapa = {};

  valores[0].forEach(
    (cabecalho, indice) => {
      mapa[
        normalizarCabecalhoCamisasSIGA_(
          cabecalho
        )
      ] = indice;
    }
  );

  const idxNome =
    encontrarIndiceCamisasSIGA_(
      mapa,
      ['Nome do Aluno', 'NOME_ALUNO']
    );

  const idxTurma =
    encontrarIndiceCamisasSIGA_(
      mapa,
      ['TURMA']
    );

  const idxData =
    encontrarIndiceCamisasSIGA_(
      mapa,
      ['Data do Pagamento', 'DATA_PAGAMENTO']
    );

  const idxValor =
    encontrarIndiceCamisasSIGA_(
      mapa,
      ['Valor pago Camisa']
    );

  const idxStatus =
    encontrarIndiceCamisasSIGA_(
      mapa,
      ['STATUS_CAMISA']
    );

  const idxEntregue =
    encontrarIndiceCamisasSIGA_(
      mapa,
      ['ENTREGUE_POR_CAMISA']
    );

  const nomeChave =
    normalizarTextoCamisasSIGA_(
      dados.nomeAluno
    );

  const turmaChave =
    normalizarTextoCamisasSIGA_(
      dados.turma
    );

  const dataAlvo =
    parseDataCamisasSIGA_(
      dados.dataPagamento
    );

  const dataChave =
    dataAlvo
      ? Utilities.formatDate(
          dataAlvo,
          Session.getScriptTimeZone(),
          'yyyy-MM-dd'
        )
      : '';

  const valorChave =
    Math.round(
      Number(dados.valorPago || 0) * 100
    ) / 100;

  for (
    let i = valores.length - 1;
    i >= 1;
    i--
  ) {

    const nome =
      idxNome >= 0
        ? normalizarTextoCamisasSIGA_(
            valores[i][idxNome]
          )
        : '';

    const turma =
      idxTurma >= 0
        ? normalizarTextoCamisasSIGA_(
            valores[i][idxTurma]
          )
        : '';

    const data =
      idxData >= 0
        ? parseDataCamisasSIGA_(
            valores[i][idxData]
          )
        : null;

    const dataTexto =
      data
        ? Utilities.formatDate(
            data,
            Session.getScriptTimeZone(),
            'yyyy-MM-dd'
          )
        : '';

    const valor =
      idxValor >= 0
        ? Math.round(
            numeroCamisasSIGA_(
              valores[i][idxValor]
            ) * 100
          ) / 100
        : 0;

    if (
      nome === nomeChave &&
      turma === turmaChave &&
      dataTexto === dataChave &&
      Math.abs(
        valor - valorChave
      ) < 0.01
    ) {

      if (idxStatus >= 0) {
        aba
          .getRange(
            i + 1,
            idxStatus + 1
          )
          .setValue(
            dados.status
          );
      }

      if (
        dados.entreguePor &&
        idxEntregue >= 0
      ) {
        aba
          .getRange(
            i + 1,
            idxEntregue + 1
          )
          .setValue(
            dados.entreguePor
          );
      }

      return;
    }
  }
}

/* =========================================================
   HELPERS
   ========================================================= */

function obterAbaCamisasSIGA_(
  ss
) {

  const aba =
    ss.getSheetByName(
      ENCOMENDAS_CAMISAS_SIGA_CONFIG.ABA
    );

  if (!aba) {
    throw new Error(
      'A aba "camisas" não foi encontrada na planilha do SIGA.'
    );
  }

  garantirCabecalhosCamisasSIGA_(
    aba
  );

  return aba;
}


function garantirCabecalhosCamisasSIGA_(
  aba
) {

  const ultimaColuna =
    Math.max(
      aba.getLastColumn(),
      ENCOMENDAS_CAMISAS_SIGA_CONFIG
        .CABECALHOS
        .length
    );

  let cabecalhos = [];

  if (
    aba.getLastRow() >= 1 &&
    aba.getLastColumn() >= 1
  ) {
    cabecalhos =
      aba
        .getRange(
          1,
          1,
          1,
          ultimaColuna
        )
        .getValues()[0];
  }

  const normalizados =
    cabecalhos.map(
      normalizarCabecalhoCamisasSIGA_
    );

  let alterou = false;

  ENCOMENDAS_CAMISAS_SIGA_CONFIG
    .CABECALHOS
    .forEach(cabecalho => {

      const chave =
        normalizarCabecalhoCamisasSIGA_(
          cabecalho
        );

      if (
        !normalizados.includes(
          chave
        )
      ) {
        cabecalhos.push(
          cabecalho
        );

        normalizados.push(
          chave
        );

        alterou = true;
      }
    });

  if (
    alterou ||
    aba.getLastRow() === 0
  ) {
    aba
      .getRange(
        1,
        1,
        1,
        cabecalhos.length
      )
      .setValues([
        cabecalhos
      ]);
  }
}


function lerTabelaCamisasSIGA_(
  aba
) {

  const valores =
    aba
      .getDataRange()
      .getValues();

  const cabecalhos =
    valores.length
      ? valores[0]
      : [];

  const mapa = {};

  cabecalhos.forEach(
    (cabecalho, indice) => {

      mapa[
        normalizarCabecalhoCamisasSIGA_(
          cabecalho
        )
      ] = indice;
    });

  ENCOMENDAS_CAMISAS_SIGA_CONFIG
    .CABECALHOS
    .forEach(cabecalho => {

      const chave =
        normalizarCabecalhoCamisasSIGA_(
          cabecalho
        );

      if (
        !Object.prototype
          .hasOwnProperty
          .call(
            mapa,
            chave
          )
      ) {
        mapa[chave] = -1;
      }
    });

  return {
    cabecalhos,
    mapa,
    linhas:
      valores.slice(1)
  };
}


function atualizarValoresFaltantesCamisasSIGA_(aba, tabela) {
  if (!tabela || !tabela.linhas.length) return;

  const idxValorCamisa = encontrarIndiceCamisasSIGA_(
    tabela.mapa,
    ['VALOR_CAMISA']
  );
  const idxValorPago = encontrarIndiceCamisasSIGA_(
    tabela.mapa,
    ['VALOR_PAGO']
  );
  const idxFaltante = encontrarIndiceCamisasSIGA_(
    tabela.mapa,
    ['VALOR_FALTANTE']
  );

  if (idxValorCamisa < 0 || idxValorPago < 0 || idxFaltante < 0) return;

  const valoresFaltantes = tabela.linhas.map(linha => {
    const valorCamisa = numeroCamisasSIGA_(linha[idxValorCamisa]);
    const valorPago = numeroCamisasSIGA_(linha[idxValorPago]);
    return [Math.max(valorCamisa - valorPago, 0)];
  });

  aba.getRange(2, idxFaltante + 1, valoresFaltantes.length, 1)
    .setValues(valoresFaltantes)
    .setNumberFormat('R$ #,##0.00');
}


function montarEncomendaCamisaSIGA_(
  linha,
  numeroLinha,
  mapa
) {

  return {
    linha:
      numeroLinha,

    nomeAluno:
      textoCampoCamisasSIGA_(
        linha,
        mapa,
        'NOME_ALUNO'
      ),

    turma:
      textoCampoCamisasSIGA_(
        linha,
        mapa,
        'TURMA'
      ),

    dataPagamento:
      formatarDataCamisasSIGA_(
        valorCampoCamisasSIGA_(
          linha,
          mapa,
          'DATA_PAGAMENTO'
        )
      ),

    mesAno:
      textoCampoCamisasSIGA_(
        linha,
        mapa,
        'MES_ANO'
      ),

    valorPago:
      numeroCamisasSIGA_(
        valorCampoCamisasSIGA_(
          linha,
          mapa,
          'VALOR_PAGO'
        )
      ),

    valorCamisa:
      numeroCamisasSIGA_(
        valorCampoCamisasSIGA_(linha, mapa, 'VALOR_CAMISA')
      ),

    valorFaltante:
      numeroCamisasSIGA_(
        valorCampoCamisasSIGA_(linha, mapa, 'VALOR_FALTANTE')
      ),

    formaPagamento:
      textoCampoCamisasSIGA_(
        linha,
        mapa,
        'FORMA_PAGAMENTO'
      ),

    comprovantePagamento:
      textoCampoCamisasSIGA_(
        linha,
        mapa,
        'COMPROVANTE_PAGAMENTO'
      ),

    tamanho:
      textoCampoCamisasSIGA_(
        linha,
        mapa,
        'TAMANHO'
      ),

    status:
      textoCampoCamisasSIGA_(
        linha,
        mapa,
        'STATUS'
      ),

    meioEncomenda:
      textoCampoCamisasSIGA_(
        linha,
        mapa,
        'MEIO_DA_ENCOMENDA'
      ),

    encomendaRealizadaPor:
      textoCampoCamisasSIGA_(
        linha,
        mapa,
        'ENCOMENDA_REALIZADA_POR'
      ),

    entreguePor:
      textoCampoCamisasSIGA_(
        linha,
        mapa,
        'ENTREGUE_POR'
      ),

    remessa:
      extrairNumeroRemessaCamisasSIGA_(
        valorCampoCamisasSIGA_(
          linha,
          mapa,
          'REMESSA'
        )
      ),

    observacoes:
      textoCampoCamisasSIGA_(
        linha,
        mapa,
        'OBSERVACOES'
      )
  };
}


function obterAlunosTurmasCamisasSIGA_(
  ss
) {

  const alunos = [];
  const mapaTurmas = {};

  const abaMatriculas =
    ss.getSheetByName(
      ENCOMENDAS_CAMISAS_SIGA_CONFIG
        .ABA_MATRICULAS
    );

  if (!abaMatriculas) {
    return {
      alunos,
      turmasPorAluno:
        mapaTurmas
    };
  }

  const valores =
    abaMatriculas
      .getDataRange()
      .getValues();

  if (
    valores.length < 2
  ) {
    return {
      alunos,
      turmasPorAluno:
        mapaTurmas
    };
  }

  const cabecalhos =
    valores[0];

  const mapa = {};

  cabecalhos.forEach(
    (cabecalho, indice) => {
      mapa[
        normalizarCabecalhoCamisasSIGA_(
          cabecalho
        )
      ] = indice;
    });

  const idxNome =
    encontrarIndiceCamisasSIGA_(
      mapa,
      [
        'NOME_ALUNO',
        'NOME DO ALUNO'
      ]
    );

  const idxTurma =
    encontrarIndiceCamisasSIGA_(
      mapa,
      [
        'TURMA'
      ]
    );

  const idxStatus =
    encontrarIndiceCamisasSIGA_(
      mapa,
      [
        'STATUS',
        'STATUS_MATRICULA',
        'SITUACAO',
        'SITUAÇÃO'
      ]
    );

  if (
    idxNome < 0 ||
    idxStatus < 0
  ) {
    throw new Error(
      'A DimMatricula precisa ter as colunas NOME_ALUNO e STATUS.'
    );
  }

  const mapaNomes =
    new Map();

  valores
    .slice(1)
    .forEach(linha => {

      const nome =
        String(
          linha[idxNome] || ''
        ).trim();

      if (!nome) {
        return;
      }

      const status =
        normalizarTextoCamisasSIGA_(
          linha[idxStatus]
        );

      if (!['ATIVO', 'ATIVA'].includes(status)) {
        return;
      }

      const chave =
        normalizarTextoCamisasSIGA_(
          nome
        );

      if (
        !mapaNomes.has(
          chave
        )
      ) {
        mapaNomes.set(
          chave,
          nome
        );
      }

      if (
        !mapaTurmas[chave]
      ) {
        mapaTurmas[chave] = [];
      }

      if (
        idxTurma >= 0
      ) {

        const turma =
          String(
            linha[idxTurma] || ''
          ).trim();

        if (
          turma &&
          !mapaTurmas[chave]
            .includes(
              turma
            )
        ) {
          mapaTurmas[chave]
            .push(
              turma
            );
        }
      }
    });

  const listaAlunos =
    [...mapaNomes.values()]
      .sort(
        (a, b) =>
          a.localeCompare(
            b,
            'pt-BR'
          )
      );

  Object.keys(
    mapaTurmas
  ).forEach(chave => {
    mapaTurmas[chave]
      .sort(
        (a, b) =>
          a.localeCompare(
            b,
            'pt-BR'
          )
      );
  });

  return {
    alunos:
      listaAlunos,

    turmasPorAluno:
      mapaTurmas
  };
}



/**
 * Grava a encomenda na aba operacional "camisas".
 * Bloqueia duplicidade exata por aluno + turma + data +
 * valor + tamanho.
 */
function gravarEncomendaNaAbaCamisasSIGA_(dados) {

  const ss =
    dados.ss ||
    SpreadsheetApp.getActiveSpreadsheet();

  const aba =
    obterAbaCamisasSIGA_(ss);

  const tabela =
    lerTabelaCamisasSIGA_(aba);

  const nomeChave =
    normalizarTextoCamisasSIGA_(
      dados.nomeAluno
    );

  const turmaChave =
    normalizarTextoCamisasSIGA_(
      dados.turma
    );

  const dataChave =
    Utilities.formatDate(
      dados.dataPagamento,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );

  const tamanhoChave =
    normalizarTextoCamisasSIGA_(
      dados.tamanho
    );

  const valorChave =
    Math.round(
      Number(dados.valorPago || 0) * 100
    ) / 100;

  const duplicado =
    tabela.linhas.some(linha => {

      const nome =
        normalizarTextoCamisasSIGA_(
          valorCampoCamisasSIGA_(
            linha,
            tabela.mapa,
            'NOME_ALUNO'
          )
        );

      const turma =
        normalizarTextoCamisasSIGA_(
          valorCampoCamisasSIGA_(
            linha,
            tabela.mapa,
            'TURMA'
          )
        );

      const data =
        parseDataCamisasSIGA_(
          valorCampoCamisasSIGA_(
            linha,
            tabela.mapa,
            'DATA_PAGAMENTO'
          )
        );

      const dataTexto =
        data
          ? Utilities.formatDate(
              data,
              Session.getScriptTimeZone(),
              'yyyy-MM-dd'
            )
          : '';

      const tamanho =
        normalizarTextoCamisasSIGA_(
          valorCampoCamisasSIGA_(
            linha,
            tabela.mapa,
            'TAMANHO'
          )
        );

      const valor =
        Math.round(
          numeroCamisasSIGA_(
            valorCampoCamisasSIGA_(
              linha,
              tabela.mapa,
              'VALOR_PAGO'
            )
          ) * 100
        ) / 100;

      return (
        nome === nomeChave &&
        turma === turmaChave &&
        dataTexto === dataChave &&
        valor === valorChave &&
        tamanho === tamanhoChave
      );
    });

  if (duplicado) {
    return {
      sucesso: true,
      duplicado: true
    };
  }

  const linha =
    new Array(
      tabela.cabecalhos.length
    ).fill('');

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'NOME_ALUNO',
    dados.nomeAluno
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'TURMA',
    dados.turma
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'DATA_PAGAMENTO',
    dados.dataPagamento
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'MES_ANO',
    Utilities.formatDate(
      dados.dataPagamento,
      Session.getScriptTimeZone(),
      'MM/yyyy'
    )
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'VALOR_PAGO',
    dados.valorPago
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'VALOR_CAMISA',
    dados.valorCamisa
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'VALOR_FALTANTE',
    dados.valorFaltante
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'FORMA_PAGAMENTO',
    obterValorOriginalCamisasSIGA_(
      dados.formaPagamento,
      ENCOMENDAS_CAMISAS_SIGA_CONFIG.FORMAS_PAGAMENTO
    )
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'COMPROVANTE_PAGAMENTO',
    dados.linkComprovante || ''
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'TAMANHO',
    dados.tamanho || ''
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'STATUS',
    dados.status || 'ACEITO'
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'MEIO_DA_ENCOMENDA',
    dados.meioEncomenda || ''
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'ENCOMENDA_REALIZADA_POR',
    dados.encomendaRealizadaPor || ''
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'ENTREGUE_POR',
    dados.entreguePor || ''
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'REMESSA',
    dados.remessa || ''
  );

  definirCampoCamisasSIGA_(
    linha,
    tabela.mapa,
    'OBSERVACOES',
    dados.observacoes || ''
  );

  aba
    .getRange(
      aba.getLastRow() + 1,
      1,
      1,
      linha.length
    )
    .setValues([linha]);

  return {
    sucesso: true,
    duplicado: false
  };
}


/**
 * Registra o pagamento da camisa na aba oficial
 * "Comprovante de pagamento".
 *
 * Preenche os campos pertinentes ao pagamento de camisa e
 * deixa os demais campos intactos/em branco.
 */
function registrarPagamentoCamisaNoComprovanteSIGA_(
  dados
) {

  const ss =
    dados.ss ||
    SpreadsheetApp.getActiveSpreadsheet();

  const aba =
    ss.getSheetByName(
      'Comprovante de pagamento'
    );

  if (!aba) {
    throw new Error(
      'A aba "Comprovante de pagamento" não foi encontrada.'
    );
  }

  const valores =
    aba.getDataRange().getValues();

  if (!valores.length) {
    throw new Error(
      'A aba "Comprovante de pagamento" não possui cabeçalhos.'
    );
  }

  const cabecalhos =
    valores[0];

  const mapa = {};

  cabecalhos.forEach(
    (cabecalho, indice) => {
      mapa[
        normalizarCabecalhoCamisasSIGA_(
          cabecalho
        )
      ] = indice;
    }
  );

  const linha =
    new Array(
      cabecalhos.length
    ).fill('');

  const matricula =
    localizarMatriculaAtivaCamisaSIGA_(
      ss,
      dados.nomeAluno,
      dados.turma
    );

  const idComprovante =
    gerarIdComprovanteCamisaSIGA_(
      aba,
      mapa
    );

  const periodo =
    Utilities.formatDate(
      dados.dataPagamento,
      Session.getScriptTimeZone(),
      'MM/yyyy'
    );

  const formaOriginal =
    obterValorOriginalCamisasSIGA_(
      dados.formaPagamento,
      ENCOMENDAS_CAMISAS_SIGA_CONFIG
        .FORMAS_PAGAMENTO
    );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'Carimbo de data/hora',
    new Date()
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'ID_COMPROVANTE',
    idComprovante
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'ID_ALUNO',
    matricula.idAluno
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'ID_MATRICULA',
    matricula.idMatricula
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'TURMA',
    dados.turma
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'Nome do Aluno',
    dados.nomeAluno
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'Tipo de Matrícula',
    matricula.tipoMatricula
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'Data do Pagamento',
    dados.dataPagamento
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'Pagamento referente a qual Período?',
    periodo
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'Valor total pago',
    dados.valorPago
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'Tipo de pagamento   (Selecione mais de uma caixinha se for preciso, caso não tenha a opção desejada, descreva o que está sendo pago)',
    'Camisa'
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'Valor pago Camisa',
    dados.valorPago
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'Forma de pagamento',
    formaOriginal
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'Observação',
    dados.observacoes || 'Encomenda de camisa registrada pelo SIGA.'
  );

  definirCampoComprovanteCamisaSeExistir_(
    linha,
    mapa,
    'Enviar o comprovante de pagamento',
    dados.linkComprovante || ''
  );

  aba
    .getRange(
      aba.getLastRow() + 1,
      1,
      1,
      linha.length
    )
    .setValues([
      linha
    ]);

  return {
    sucesso: true,
    idComprovante
  };
}


/**
 * Garante que os campos exclusivos das camisas existam
 * em "Comprovante de pagamento".
 * Nunca apaga nem sobrescreve colunas existentes.
 */
function garantirCamposCamisaNoComprovanteSIGA_(aba) {

  const ultimaColuna =
    Math.max(aba.getLastColumn(), 1);

  const cabecalhos =
    aba.getRange(
      1,
      1,
      1,
      ultimaColuna
    ).getValues()[0];

  const existentes =
    cabecalhos.map(
      normalizarCabecalhoCamisasSIGA_
    );

  const novos = [];

  ENCOMENDAS_CAMISAS_SIGA_CONFIG
    .CAMPOS_CAMISA_COMPROVANTE
    .forEach(campo => {

      const chave =
        normalizarCabecalhoCamisasSIGA_(campo);

      if (!existentes.includes(chave)) {
        novos.push(campo);
        existentes.push(chave);
      }
    });

  if (!novos.length) {
    return;
  }

  aba.getRange(
    1,
    aba.getLastColumn() + 1,
    1,
    novos.length
  ).setValues([novos]);
}


/**
 * Procura a matrícula ATIVA do aluno/turma para preencher
 * ID_ALUNO, ID_MATRICULA e Tipo de Matrícula.
 */
function localizarMatriculaAtivaCamisaSIGA_(
  ss,
  nomeAluno,
  turma
) {

  const vazio = {
    idAluno: '',
    idMatricula: '',
    tipoMatricula: ''
  };

  const aba =
    ss.getSheetByName(
      ENCOMENDAS_CAMISAS_SIGA_CONFIG
        .ABA_MATRICULAS
    );

  if (!aba) {
    return vazio;
  }

  const valores =
    aba.getDataRange().getValues();

  if (
    valores.length < 2
  ) {
    return vazio;
  }

  const cabecalhos =
    valores[0];

  const mapa = {};

  cabecalhos.forEach(
    (cabecalho, indice) => {
      mapa[
        normalizarCabecalhoCamisasSIGA_(
          cabecalho
        )
      ] = indice;
    }
  );

  const idxNome =
    encontrarIndiceCamisasSIGA_(
      mapa,
      [
        'NOME_ALUNO',
        'NOME DO ALUNO'
      ]
    );

  const idxTurma =
    encontrarIndiceCamisasSIGA_(
      mapa,
      ['TURMA']
    );

  const idxStatus =
    encontrarIndiceCamisasSIGA_(
      mapa,
      [
        'STATUS',
        'STATUS_MATRICULA',
        'SITUACAO',
        'SITUAÇÃO'
      ]
    );

  const idxIdAluno =
    encontrarIndiceCamisasSIGA_(
      mapa,
      ['ID_ALUNO']
    );

  const idxIdMatricula =
    encontrarIndiceCamisasSIGA_(
      mapa,
      ['ID_MATRICULA']
    );

  const idxTipoMatricula =
    encontrarIndiceCamisasSIGA_(
      mapa,
      [
        'TIPO_MATRICULA',
        'TIPO DE MATRÍCULA',
        'TIPO DE MATRICULA'
      ]
    );

  const nomeChave =
    normalizarTextoCamisasSIGA_(
      nomeAluno
    );

  const turmaChave =
    normalizarTextoCamisasSIGA_(
      turma
    );

  for (
    let i =
      valores.length - 1;
    i >= 1;
    i--
  ) {

    const linha =
      valores[i];

    const nomeLinha =
      idxNome >= 0
        ? normalizarTextoCamisasSIGA_(
            linha[idxNome]
          )
        : '';

    const turmaLinha =
      idxTurma >= 0
        ? normalizarTextoCamisasSIGA_(
            linha[idxTurma]
          )
        : '';

    const statusLinha =
      idxStatus >= 0
        ? normalizarTextoCamisasSIGA_(
            linha[idxStatus]
          )
        : 'ATIVO';

    if (
      nomeLinha === nomeChave &&
      turmaLinha === turmaChave &&
      statusLinha === 'ATIVO'
    ) {

      return {
        idAluno:
          idxIdAluno >= 0
            ? String(
                linha[idxIdAluno] || ''
              ).trim()
            : '',

        idMatricula:
          idxIdMatricula >= 0
            ? String(
                linha[idxIdMatricula] || ''
              ).trim()
            : '',

        tipoMatricula:
          idxTipoMatricula >= 0
            ? String(
                linha[idxTipoMatricula] || ''
              ).trim()
            : ''
      };
    }
  }

  return vazio;
}


/**
 * Gera um ID simples e exclusivo para a linha criada pelo SIGA.
 */
function gerarIdComprovanteCamisaSIGA_(
  aba,
  mapa
) {

  const chave =
    normalizarCabecalhoCamisasSIGA_(
      'ID_COMPROVANTE'
    );

  const indice =
    mapa[chave];

  const prefixo =
    'CMP-CAMISA-';

  if (
    indice === undefined ||
    indice < 0 ||
    aba.getLastRow() < 2
  ) {
    return prefixo +
      Utilities.getUuid()
        .slice(0, 8)
        .toUpperCase();
  }

  const ids =
    aba
      .getRange(
        2,
        indice + 1,
        aba.getLastRow() - 1,
        1
      )
      .getDisplayValues()
      .flat();

  let maior = 0;

  ids.forEach(id => {

    const match =
      String(id || '')
        .match(
          /^CMP-CAMISA-(\d+)$/i
        );

    if (match) {
      maior =
        Math.max(
          maior,
          Number(match[1])
        );
    }
  });

  return prefixo +
    String(
      maior + 1
    ).padStart(
      5,
      '0'
    );
}


/**
 * Preenche apenas se o cabeçalho existir na planilha.
 */
function definirCampoComprovanteCamisaSeExistir_(
  linha,
  mapa,
  cabecalho,
  valor
) {

  const chave =
    normalizarCabecalhoCamisasSIGA_(
      cabecalho
    );

  const indice =
    mapa[chave];

  if (
    indice === undefined ||
    indice < 0
  ) {
    return;
  }

  linha[indice] =
    valor;
}


function salvarComprovanteCamisaSIGA_(
  arquivo,
  nomeAluno,
  dataPagamento
) {

  const base64 =
    String(
      arquivo.base64 || ''
    );

  if (!base64) {
    return '';
  }

  const bytes =
    Utilities.base64Decode(
      base64
    );

  const blob =
    Utilities.newBlob(
      bytes,
      String(
        arquivo.mimeType ||
        'application/octet-stream'
      ),
      String(
        arquivo.nome ||
        'comprovante'
      )
    );

  const pasta =
    obterPastaComprovantesCamisasSIGA_();

  const dataTexto =
    Utilities.formatDate(
      dataPagamento,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );

  const nomeSeguro =
    String(nomeAluno || '')
      .replace(
        /[\\/:*?"<>|]/g,
        '-'
      )
      .trim();

  const extensao =
    obterExtensaoCamisasSIGA_(
      arquivo.nome
    );

  const nomeArquivo =
    [
      'CAMISA',
      dataTexto,
      nomeSeguro,
      Utilities.getUuid()
        .slice(0, 8)
    ].join('_') +
    extensao;

  blob.setName(
    nomeArquivo
  );

  const file =
    pasta.createFile(
      blob
    );

  return file.getUrl();
}


function obterPastaComprovantesCamisasSIGA_() {

  const nome =
    ENCOMENDAS_CAMISAS_SIGA_CONFIG
      .PASTA_COMPROVANTES;

  const pastas =
    DriveApp
      .getFoldersByName(
        nome
      );

  if (
    pastas.hasNext()
  ) {
    return pastas.next();
  }

  return DriveApp
    .createFolder(
      nome
    );
}


function valorCampoCamisasSIGA_(
  linha,
  mapa,
  cabecalho
) {

  const chave =
    normalizarCabecalhoCamisasSIGA_(
      cabecalho
    );

  const indice =
    mapa[chave];

  if (
    indice === undefined ||
    indice < 0
  ) {
    return '';
  }

  return linha[indice];
}


function textoCampoCamisasSIGA_(
  linha,
  mapa,
  cabecalho
) {

  return String(
    valorCampoCamisasSIGA_(
      linha,
      mapa,
      cabecalho
    ) || ''
  ).trim();
}


function definirCampoCamisasSIGA_(
  linha,
  mapa,
  cabecalho,
  valor
) {

  const chave =
    normalizarCabecalhoCamisasSIGA_(
      cabecalho
    );

  const indice =
    mapa[chave];

  if (
    indice === undefined ||
    indice < 0
  ) {
    throw new Error(
      'Coluna "' +
      cabecalho +
      '" não encontrada na aba camisas.'
    );
  }

  linha[indice] =
    valor;
}


function encontrarIndiceCamisasSIGA_(
  mapa,
  nomes
) {

  for (
    const nome of nomes
  ) {

    const chave =
      normalizarCabecalhoCamisasSIGA_(
        nome
      );

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          mapa,
          chave
        )
    ) {
      return mapa[chave];
    }
  }

  return -1;
}


function normalizarCabecalhoCamisasSIGA_(
  valor
) {

  return String(valor || '')
    .trim()
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      ''
    );
}


function normalizarTextoCamisasSIGA_(
  valor
) {

  return String(valor || '')
    .trim()
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .toUpperCase()
    .replace(
      /\s*-\s*/g,
      ' - '
    )
    .replace(
      /\s+/g,
      ' '
    );
}


function numeroCamisasSIGA_(
  valor
) {

  if (
    typeof valor ===
    'number'
  ) {
    return Number.isFinite(valor)
      ? valor
      : 0;
  }

  let texto =
    String(valor || '')
      .trim()
      .replace(
        /R\$/gi,
        ''
      )
      .replace(
        /\s/g,
        ''
      );

  if (
    texto.includes(',') &&
    texto.includes('.')
  ) {
    texto =
      texto
        .replace(
          /\./g,
          ''
        )
        .replace(
          ',',
          '.'
        );
  } else if (
    texto.includes(',')
  ) {
    texto =
      texto.replace(
        ',',
        '.'
      );
  }

  const numero =
    Number(texto);

  return Number.isFinite(numero)
    ? numero
    : 0;
}


function parseDataCamisasSIGA_(
  valor
) {

  if (
    valor instanceof Date &&
    !isNaN(
      valor.getTime()
    )
  ) {
    return valor;
  }

  const texto =
    String(valor || '')
      .trim();

  if (!texto) {
    return null;
  }

  let match =
    texto.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      12,
      0,
      0
    );
  }

  match =
    texto.match(
      /^(\d{2})\/(\d{2})\/(\d{4})$/
    );

  if (match) {
    return new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      12,
      0,
      0
    );
  }

  const data =
    new Date(
      texto
    );

  return isNaN(
    data.getTime()
  )
    ? null
    : data;
}


function formatarDataCamisasSIGA_(
  valor
) {

  const data =
    parseDataCamisasSIGA_(
      valor
    );

  if (!data) {
    return '';
  }

  return Utilities
    .formatDate(
      data,
      Session.getScriptTimeZone(),
      'dd/MM/yyyy'
    );
}


function obterValorOriginalCamisasSIGA_(
  valor,
  permitidos
) {

  const normalizado =
    normalizarTextoCamisasSIGA_(
      valor
    );

  const encontrado =
    permitidos.find(
      item =>
        normalizarTextoCamisasSIGA_(
          item
        ) === normalizado
    );

  return encontrado ||
    String(valor || '').trim();
}


function obterExtensaoCamisasSIGA_(
  nomeArquivo
) {

  const nome =
    String(
      nomeArquivo || ''
    );

  const match =
    nome.match(
      /(\.[A-Za-z0-9]{1,8})$/
    );

  return match
    ? match[1]
    : '';
}


/**
 * Diagnóstico rápido para validar aluno/turmas ativas.
 * Execute manualmente no Apps Script e veja o log.
 */
function diagnosticarTurmasAtivasCamisasSIGA(
  nomeAluno
) {

  const ss =
    SpreadsheetApp
      .getActiveSpreadsheet();

  const apoio =
    obterAlunosTurmasCamisasSIGA_(
      ss
    );

  const chave =
    normalizarTextoCamisasSIGA_(
      nomeAluno || ''
    );

  const resultado = {
    nomePesquisado:
      nomeAluno || '',

    chave:
      chave,

    turmasAtivas:
      apoio.turmasPorAluno[chave] || [],

    totalAlunosAtivos:
      apoio.alunos.length
  };

  console.log(
    JSON.stringify(
      resultado,
      null,
      2
    )
  );

  return resultado;
}

function apagarSomenteTestesPietroCamisasSIGA() {

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const aba =
    ss.getSheetByName('camisas');

  if (!aba) {
    throw new Error(
      'A aba "camisas" não foi encontrada.'
    );
  }

  const dados =
    aba.getDataRange().getDisplayValues();

  const cabecalhos =
    dados[0].map(c =>
      String(c)
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]/g, '')
    );

  const idxNome =
    cabecalhos.indexOf('NOMEALUNO');

  const idxData =
    cabecalhos.indexOf('DATAPAGAMENTO');

  const idxValor =
    cabecalhos.indexOf('VALORPAGO');

  const linhasExcluir = [];

  for (
    let i = 1;
    i < dados.length;
    i++
  ) {

    const nome =
      String(
        dados[i][idxNome] || ''
      )
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    const data =
      String(
        dados[i][idxData] || ''
      ).trim();

    const valor =
      Number(
        String(
          dados[i][idxValor] || ''
        )
          .replace(',', '.')
      );

    if (
      nome === 'PIETRO MARSSON SIQUEIRA' &&
      data === '18/08/2026' &&
      (
        valor === 5 ||
        valor === 50
      )
    ) {
      linhasExcluir.push(
        i + 1
      );
    }
  }

  console.log(
    'Linhas que serão excluídas: ' +
    JSON.stringify(
      linhasExcluir
    )
  );

  linhasExcluir
    .sort((a, b) => b - a)
    .forEach(linha => {
      aba.deleteRow(linha);
    });

  SpreadsheetApp.flush();

  console.log(
    linhasExcluir.length +
    ' linha(s) excluída(s).'
  );
}


function salvarEntreguePorCamisaSIGA(dados) {
  dados = dados || {};
  const linha = Number(dados.linha || 0);
  const entreguePor = String(dados.entreguePor || '').trim();

  if (!Number.isInteger(linha) || linha < 2) {
    throw new Error('Linha da encomenda inválida.');
  }
  if (!entreguePor) {
    throw new Error('Informe o nome de quem entregou a camisa.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = obterAbaCamisasSIGA_(ss);
  const tabela = lerTabelaCamisasSIGA_(aba);

  if (linha > aba.getLastRow()) {
    throw new Error('Encomenda não encontrada.');
  }
  const colunaEntreguePor = encontrarIndiceCamisasSIGA_(
    tabela.mapa,
    ['ENTREGUE_POR']
  );

  if (colunaEntreguePor < 0) {
    throw new Error('Coluna ENTREGUE_POR não encontrada na aba camisas.');
  }

  aba.getRange(linha, colunaEntreguePor + 1).setValue(entreguePor);
  return { sucesso: true, mensagem: 'Responsável pela entrega salvo com sucesso.' };
}


function extrairNumeroRemessaCamisasSIGA_(valor) {
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? Math.trunc(valor) : 0;
  }

  const correspondencia = String(valor || '').match(/\d+/);
  return correspondencia ? Number(correspondencia[0]) : 0;
}


/**
 * Gera um PDF das encomendas respeitando os filtros da tela.
 */
function gerarPdfEncomendasCamisasSIGA(filtros) {
  filtros = filtros || {};

  const resultado = listarEncomendasCamisasSIGA();
  const busca = normalizarTextoCamisasSIGA_(filtros.pesquisa || '');
  const status = normalizarTextoCamisasSIGA_(filtros.status || '');
  const tamanho = normalizarTextoCamisasSIGA_(filtros.tamanho || '');
  const remessaTexto = String(filtros.remessa || '').trim();

  const encomendas = (resultado.encomendas || []).filter(item => {
    if (status && normalizarTextoCamisasSIGA_(item.status) !== status) return false;
    if (tamanho && normalizarTextoCamisasSIGA_(item.tamanho) !== tamanho) return false;
    if (
      remessaTexto &&
      extrairNumeroRemessaCamisasSIGA_(item.remessa) !==
        extrairNumeroRemessaCamisasSIGA_(remessaTexto)
    ) return false;

    if (busca) {
      const alvo = normalizarTextoCamisasSIGA_([
        item.nomeAluno,
        item.turma,
        item.tamanho,
        item.status,
        item.formaPagamento,
        item.remessa
      ].join(' '));
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });

  if (!encomendas.length) {
    throw new Error('Não há encomendas para os filtros selecionados.');
  }

  const timezone = Session.getScriptTimeZone();
  const agora = new Date();
  const totalValor = encomendas.reduce((soma, item) => soma + Number(item.valorPago || 0), 0);
  const linhas = encomendas.map(item => `
    <tr>
      <td>${escaparHtmlPdfCamisasSIGA_(item.nomeAluno || '')}</td>
      <td>${escaparHtmlPdfCamisasSIGA_(item.turma || '')}</td>
      <td>${escaparHtmlPdfCamisasSIGA_(item.tamanho || '')}</td>
      <td>${escaparHtmlPdfCamisasSIGA_(item.remessa || '')}</td>
      <td>${escaparHtmlPdfCamisasSIGA_(item.status || '')}</td>
      <td>R$ ${Number(item.valorCamisa || 0).toFixed(2).replace('.', ',')}</td>
      <td>R$ ${Number(item.valorPago || 0).toFixed(2).replace('.', ',')}</td>
      <td>R$ ${Number(item.valorFaltante || 0).toFixed(2).replace('.', ',')}</td>
      <td>${escaparHtmlPdfCamisasSIGA_(item.dataPagamento || '')}</td>
    </tr>`).join('');

  const filtrosAtivos = [
    filtros.status ? `Status: ${filtros.status}` : '',
    filtros.tamanho ? `Tamanho: ${filtros.tamanho}` : '',
    remessaTexto ? `Remessa: ${remessaTexto}` : '',
    filtros.pesquisa ? `Pesquisa: ${filtros.pesquisa}` : ''
  ].filter(Boolean).join(' | ') || 'Todos os pedidos';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    @page{size:A4 landscape;margin:18mm}body{font-family:Arial,sans-serif;color:#172033;font-size:10px}h1{margin:0;color:#4c1d95;font-size:22px}.sub{margin:5px 0 18px;color:#667085}.resumo{display:flex;justify-content:space-between;background:#f4f0ff;padding:10px 12px;margin-bottom:14px;border-radius:8px}table{width:100%;border-collapse:collapse}th{background:#5b2be0;color:#fff;text-align:left;padding:8px}td{padding:7px 8px;border-bottom:1px solid #e4e7ec}tr:nth-child(even){background:#f8f9fc}.rodape{margin-top:14px;color:#667085;font-size:9px}
  </style></head><body>
    <h1>Casa de Artes Gabriel Engel</h1><div class="sub">Encomendas de camisas</div>
    <div class="resumo"><span>${escaparHtmlPdfCamisasSIGA_(filtrosAtivos)}</span><strong>${encomendas.length} pedido(s) | Total: R$ ${totalValor.toFixed(2).replace('.', ',')}</strong></div>
    <table><thead><tr><th>Aluno</th><th>Turma</th><th>Tamanho</th><th>Remessa</th><th>Status</th><th>Valor camisa</th><th>Pago</th><th>Falta</th><th>Pagamento</th></tr></thead><tbody>${linhas}</tbody></table>
    <div class="rodape">Gerado em ${Utilities.formatDate(agora, timezone, 'dd/MM/yyyy HH:mm')}</div>
  </body></html>`;

  const pdf = Utilities.newBlob(html, 'text/html', 'encomendas-camisas.html')
    .getAs(MimeType.PDF)
    .setName(`Encomendas_camisas_${Utilities.formatDate(agora, timezone, 'yyyy-MM-dd_HHmm')}.pdf`);
  const arquivo = obterPastaRelatoriosCamisasSIGA_().createFile(pdf);

  // Sem isto o PDF nasce privado e o funcionario cai em "precisa de permissao".
  arquivo.setSharing(
    DriveApp.Access.ANYONE_WITH_LINK,
    DriveApp.Permission.VIEW
  );

  return { sucesso: true, url: arquivo.getUrl(), nome: arquivo.getName(), total: encomendas.length };
}
