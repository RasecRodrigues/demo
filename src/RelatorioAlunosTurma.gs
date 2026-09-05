/**
 * SIGA - Relatório em PDF dos alunos da turma
 *
 * Alimenta o botão "Exportar PDF" do modal "Ver alunos"
 * (modalHistoricoTurmaSIGA).
 *
 * A tela já buscou e filtrou os alunos com
 * obterHistoricoAlunosTurmaSIGA(). Em vez de refazer esse
 * cálculo aqui — que varre as chamadas e é a parte lenta —,
 * o modal manda as linhas que estão na tela e este arquivo
 * só desenha o PDF. O relatório sai igual ao que a pessoa
 * está vendo, inclusive o recorte dos filtros.
 */

const CONFIG_RELATORIO_ALUNOS_TURMA_SIGA = {
  NOME_ESCOLA: 'Casa de Artes Gabriel Engel',
  NOME_PASTA: 'SIGA - Relatórios de Turmas',
  LIMITE_RISCO: 75,
  DIAS_PARA_LIMPEZA: 7
};


/**
 * Gera o PDF dos alunos da turma.
 *
 * dados = {
 *   turma, busca, filtroStatus,
 *   resumo: { total, ativos, historico },
 *   alunos: [ { nomeAluno, status, dataMatricula,
 *               dataInicioTurma, dataSaida, totalAulas,
 *               presencas, faltas, percentual } ]
 * }
 */
function gerarPdfAlunosTurmaSIGA(dados) {

  dados = dados || {};

  const turma =
    String(dados.turma || '').trim();

  if (!turma) {
    throw new Error(
      'Turma não informada.'
    );
  }

  const alunos =
    Array.isArray(dados.alunos)
      ? dados.alunos
      : [];

  if (!alunos.length) {
    throw new Error(
      'Não há alunos para os filtros selecionados.'
    );
  }

  const resumo =
    dados.resumo || {};

  const timezone =
    Session.getScriptTimeZone();

  const agora =
    new Date();

  const linhasHtml =
    alunos
      .map(aluno => {

        const percentual =
          numeroAlunosTurmaSIGA_(
            aluno.percentual
          );

        const baixa =
          percentual <
          CONFIG_RELATORIO_ALUNOS_TURMA_SIGA.LIMITE_RISCO;

        const ativo =
          ['ATIVO', 'ATIVA'].includes(
            String(aluno.status || '')
              .trim()
              .toUpperCase()
          );

        return '<tr>' +
          '<td><strong>' +
          escaparAlunosTurmaSIGA_(aluno.nomeAluno) +
          '</strong></td>' +

          '<td><span class="selo ' +
          (ativo ? 'selo-ativo' : 'selo-historico') +
          '">' +
          escaparAlunosTurmaSIGA_(
            aluno.status || 'SEM STATUS'
          ) +
          '</span></td>' +

          '<td>' +
          escaparAlunosTurmaSIGA_(
            dataAlunosTurmaSIGA_(aluno.dataMatricula)
          ) +
          '</td>' +

          '<td>' +
          escaparAlunosTurmaSIGA_(
            dataAlunosTurmaSIGA_(aluno.dataInicioTurma)
          ) +
          '</td>' +

          '<td>' +
          escaparAlunosTurmaSIGA_(
            dataAlunosTurmaSIGA_(aluno.dataSaida)
          ) +
          '</td>' +

          '<td class="numero">' +
          numeroAlunosTurmaSIGA_(aluno.totalAulas) +
          '</td>' +

          '<td class="numero">' +
          numeroAlunosTurmaSIGA_(aluno.presencas) +
          '</td>' +

          '<td class="numero">' +
          numeroAlunosTurmaSIGA_(aluno.faltas) +
          '</td>' +

          '<td class="numero freq' +
          (baixa ? ' freq-baixa' : '') +
          '">' +
          percentualAlunosTurmaSIGA_(percentual) +
          '</td>' +
        '</tr>';
      })
      .join('');

  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
    '@page{size:A4 landscape;margin:14mm}' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#172033;font-size:10px;margin:0}' +
    'h1{margin:0;color:#4c1d95;font-size:21px}' +
    '.sub{margin:4px 0 14px;color:#667085;font-size:11px}' +
    '.cards{display:table;width:100%;table-layout:fixed;border-spacing:4mm 0;margin:0 -4mm 12px}' +
    '.card{display:table-cell;padding:8px 10px;border:1px solid #e4e7ec;border-top:3px solid #5b2be0;border-radius:6px;vertical-align:top}' +
    '.card span{display:block;color:#667085;font-size:8px;font-weight:900;text-transform:uppercase}' +
    '.card strong{display:block;margin-top:3px;font-size:19px}' +
    '.recorte{padding:8px 10px;margin-bottom:12px;border:1px solid #e4e7ec;border-left:3px solid #5b2be0;border-radius:5px;background:#f8f9fc;color:#475467}' +
    'table{width:100%;border-collapse:collapse}' +
    'th{background:#5b2be0;color:#fff;text-align:left;padding:7px 8px;font-size:9px;text-transform:uppercase}' +
    'td{padding:6px 8px;border-bottom:1px solid #e4e7ec;vertical-align:top}' +
    'tr:nth-child(even) td{background:#f8f9fc}' +
    'tr{page-break-inside:avoid}' +
    'thead{display:table-header-group}' +
    '.numero{text-align:center}' +
    '.freq{font-weight:900}' +
    '.freq-baixa{color:#dc2626}' +
    '.selo{display:inline-block;padding:2px 6px;border-radius:999px;background:#f3f4f6;color:#475467;font-size:8px;font-weight:900}' +
    '.selo-ativo{background:#dcfce7;color:#166534}' +
    '.rodape{margin-top:12px;color:#667085;font-size:8px}' +
    '</style></head><body>' +

    '<h1>' +
    escaparAlunosTurmaSIGA_(
      CONFIG_RELATORIO_ALUNOS_TURMA_SIGA.NOME_ESCOLA
    ) +
    '</h1>' +

    '<div class="sub">Alunos da turma ' +
    escaparAlunosTurmaSIGA_(turma) +
    '</div>' +

    '<div class="cards">' +
    '<div class="card"><span>Total da turma</span><strong>' +
    numeroAlunosTurmaSIGA_(resumo.total) +
    '</strong></div>' +
    '<div class="card"><span>Ativos</span><strong>' +
    numeroAlunosTurmaSIGA_(resumo.ativos) +
    '</strong></div>' +
    '<div class="card"><span>Já passaram</span><strong>' +
    numeroAlunosTurmaSIGA_(resumo.historico) +
    '</strong></div>' +
    '<div class="card"><span>Neste relatório</span><strong>' +
    alunos.length +
    '</strong></div>' +
    '</div>' +

    '<div class="recorte">' +
    escaparAlunosTurmaSIGA_(
      descreverFiltroAlunosTurmaSIGA_(dados)
    ) +
    '</div>' +

    '<table><thead><tr>' +
    '<th>Aluno</th>' +
    '<th>Status</th>' +
    '<th>Data da matrícula</th>' +
    '<th>Início na turma</th>' +
    '<th>Saída</th>' +
    '<th>Aulas</th>' +
    '<th>Presenças</th>' +
    '<th>Faltas</th>' +
    '<th>Frequência</th>' +
    '</tr></thead><tbody>' +
    linhasHtml +
    '</tbody></table>' +

    '<div class="rodape">Frequência abaixo de ' +
    CONFIG_RELATORIO_ALUNOS_TURMA_SIGA.LIMITE_RISCO +
    '% aparece em vermelho. Relatório gerado pelo SIGA em ' +
    Utilities.formatDate(
      agora,
      timezone,
      'dd/MM/yyyy HH:mm'
    ) +
    '.</div>' +

    '</body></html>';

  const nomeArquivo =
    'Alunos_' +
    slugAlunosTurmaSIGA_(turma) +
    '_' +
    Utilities.formatDate(
      agora,
      timezone,
      'yyyy-MM-dd_HHmm'
    ) +
    '.pdf';

  const pdf =
    Utilities
      .newBlob(
        html,
        'text/html',
        'alunos-turma.html'
      )
      .getAs(MimeType.PDF)
      .setName(nomeArquivo);

  const arquivo =
    obterPastaRelatoriosTurmasSIGA_()
      .createFile(pdf);

  /*
   * O app roda como o dono da planilha, então o PDF nasce
   * privado. Sem esta linha o funcionário cai na tela
   * "Você precisa de permissão" do Drive.
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
 * Descreve, em uma linha, o recorte que gerou o relatório.
 */
function descreverFiltroAlunosTurmaSIGA_(dados) {

  const partes = [];

  const filtro =
    String(dados.filtroStatus || '')
      .trim()
      .toUpperCase();

  if (filtro === 'ATIVO') {
    partes.push('Somente alunos ativos');
  } else if (filtro === 'HISTORICO') {
    partes.push('Somente alunos que já passaram pela turma');
  } else {
    partes.push('Todos os alunos da turma');
  }

  const busca =
    String(dados.busca || '').trim();

  if (busca) {
    partes.push('Pesquisa: ' + busca);
  }

  return partes.join(' · ');
}


function obterPastaRelatoriosTurmasSIGA_() {

  const propriedades =
    PropertiesService.getScriptProperties();

  const idSalvo =
    propriedades.getProperty(
      'PASTA_RELATORIOS_TURMAS_ID'
    );

  if (idSalvo) {
    try {
      return DriveApp.getFolderById(idSalvo);
    } catch (erro) {
      // Caso a pasta tenha sido apagada, cria outra.
    }
  }

  const pastas =
    DriveApp.getFoldersByName(
      CONFIG_RELATORIO_ALUNOS_TURMA_SIGA.NOME_PASTA
    );

  const pasta =
    pastas.hasNext()
      ? pastas.next()
      : DriveApp.createFolder(
          CONFIG_RELATORIO_ALUNOS_TURMA_SIGA.NOME_PASTA
        );

  propriedades.setProperty(
    'PASTA_RELATORIOS_TURMAS_ID',
    pasta.getId()
  );

  return pasta;
}


/**
 * Apaga os relatórios antigos da pasta.
 *
 * Cada clique gera um PDF novo, que fica no Drive do dono
 * para sempre. Esta função não é chamada por ninguém: ligue
 * num acionador de tempo diário se quiser limpeza automática.
 */
function limparRelatoriosTurmasAntigosSIGA() {

  const limite =
    new Date().getTime() -
    CONFIG_RELATORIO_ALUNOS_TURMA_SIGA.DIAS_PARA_LIMPEZA *
      24 * 60 * 60 * 1000;

  const arquivos =
    obterPastaRelatoriosTurmasSIGA_()
      .getFiles();

  let removidos = 0;

  while (arquivos.hasNext()) {
    const arquivo = arquivos.next();

    if (
      arquivo.getDateCreated().getTime() < limite
    ) {
      arquivo.setTrashed(true);
      removidos++;
    }
  }

  return removidos;
}


function escaparAlunosTurmaSIGA_(valor) {

  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


/**
 * A tela manda as datas já formatadas em texto. Se alguma
 * vier como Date, formata aqui — senão o PDF sairia com
 * "Wed Aug 19 2026...".
 */
function dataAlunosTurmaSIGA_(valor) {

  if (valor instanceof Date && !isNaN(valor.getTime())) {
    return Utilities.formatDate(
      valor,
      Session.getScriptTimeZone(),
      'dd/MM/yyyy'
    );
  }

  const texto = String(valor == null ? '' : valor).trim();

  return texto || '—';
}

function numeroAlunosTurmaSIGA_(valor) {

  const numero = Number(valor || 0);

  return Number.isFinite(numero) ? numero : 0;
}


function percentualAlunosTurmaSIGA_(valor) {

  return numeroAlunosTurmaSIGA_(valor)
    .toLocaleString(
      'pt-BR',
      { maximumFractionDigits: 1 }
    ) + '%';
}


function slugAlunosTurmaSIGA_(texto) {

  return String(texto || 'Turma')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
