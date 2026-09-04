/**
 * SIGA - Relatórios de Frequência em PDF
 *
 * DEPENDÊNCIAS JÁ EXISTENTES NO PROJETO:
 * - obterPainelFrequenciaTurma(filtros)
 * - listarTurmasPainelFrequencia()
 *
 * Este arquivo pode ser criado como:
 * RelatoriosFrequencia.gs
 */

const CONFIG_RELATORIO_FREQUENCIA = {
  NOME_ESCOLA: 'Casa de Artes Gabriel Engel',
  NOME_PASTA: 'SIGA - Relatórios de Frequência',
  LIMITE_RISCO: 75,
  DIAS_PARA_LIMPEZA: 7
};


/**
 * Gera o PDF da turma atualmente selecionada.
 */
function gerarPdfFrequenciaTurma(filtros) {
  validarFiltrosRelatorioFrequencia_(filtros);

  const painel = obterPainelFrequenciaTurma({
    turma: filtros.turma,
    mesInicial: filtros.mesInicial,
    mesFinal: filtros.mesFinal
  });

  const turmaPreparada =
    prepararTurmaRelatorioFrequencia_(painel);

  const modelo = {
    tipo: 'TURMA',
    escola: CONFIG_RELATORIO_FREQUENCIA.NOME_ESCOLA,
    titulo: 'Relatório de Frequência',
    subtitulo: turmaPreparada.turma,
    periodo: turmaPreparada.periodoFormatado,
    emitidoEm: formatarDataHoraRelatorio_(new Date()),
    resumoGeral: null,
    turmas: [turmaPreparada]
  };

  return criarArquivoPdfRelatorioFrequencia_(
    modelo,
    `Relatorio_Frequencia_${slugArquivoRelatorio_(painel.turma)}`
  );
}


/**
 * Gera um único PDF com todas as turmas em andamento.
 * O período utilizado é o mesmo selecionado no painel.
 */
function gerarPdfFrequenciaTurmasAtivas(filtros) {
  if (
    !filtros ||
    !/^\d{4}-\d{2}$/.test(String(filtros.mesInicial || '')) ||
    !/^\d{4}-\d{2}$/.test(String(filtros.mesFinal || ''))
  ) {
    throw new Error(
      'Informe o mês inicial e o mês final antes de gerar o relatório.'
    );
  }

  if (filtros.mesInicial > filtros.mesFinal) {
    throw new Error(
      'O mês inicial não pode ser posterior ao mês final.'
    );
  }

  const turmasDisponiveis =
    listarTurmasPainelFrequencia();

  const turmasAtivas =
    (Array.isArray(turmasDisponiveis)
      ? turmasDisponiveis
      : []
    ).filter(item =>
      typeof item === 'string' ||
      item.emAndamento !== false
    );

  if (!turmasAtivas.length) {
    throw new Error(
      'Nenhuma turma em andamento foi encontrada.'
    );
  }

  const turmasPreparadas = [];

  turmasAtivas.forEach(item => {
    const turma =
      typeof item === 'string'
        ? item
        : item.turma;

    if (!turma) {
      return;
    }

    const painel =
      obterPainelFrequenciaTurma({
        turma,
        mesInicial: filtros.mesInicial,
        mesFinal: filtros.mesFinal
      });

    turmasPreparadas.push(
      prepararTurmaRelatorioFrequencia_(painel)
    );
  });

  turmasPreparadas.sort((a, b) =>
    a.turma.localeCompare(
      b.turma,
      'pt-BR'
    )
  );

  const resumoGeral =
    criarResumoGeralRelatorioFrequencia_(
      turmasPreparadas
    );

  const modelo = {
    tipo: 'GERAL',
    escola: CONFIG_RELATORIO_FREQUENCIA.NOME_ESCOLA,
    titulo: 'Relatório Geral de Frequência',
    subtitulo: 'Turmas em andamento',
    periodo:
      `${formatarMesRelatorio_(filtros.mesInicial)} até ` +
      `${formatarMesRelatorio_(filtros.mesFinal)}`,
    emitidoEm: formatarDataHoraRelatorio_(new Date()),
    resumoGeral,
    turmas: turmasPreparadas
  };

  return criarArquivoPdfRelatorioFrequencia_(
    modelo,
    `Relatorio_Geral_Frequencia_${filtros.mesFinal.replace('-', '_')}`
  );
}


/**
 * Organiza e classifica os dados de uma turma.
 */
function prepararTurmaRelatorioFrequencia_(painel) {
  const resumo =
    painel && painel.resumo
      ? painel.resumo
      : {};

  const alunos =
    painel && Array.isArray(painel.alunos)
      ? painel.alunos
      : [];

  const alunosPreparados =
    alunos.map(aluno => {
      const percentual =
        Number(aluno.percentual || 0);

      const status =
        String(aluno.status || 'SEM STATUS')
          .trim()
          .toUpperCase();

      const ativo =
        ['ATIVO', 'ATIVA'].includes(status);

      const emRisco =
        ativo &&
        Number(aluno.totalAulas || 0) > 0 &&
        percentual <
          CONFIG_RELATORIO_FREQUENCIA.LIMITE_RISCO;

      return {
        nomeAluno:
          String(aluno.nomeAluno || ''),
        status,
        totalAulas:
          Number(aluno.totalAulas || 0),
        presencas:
          Number(aluno.presencas || 0),
        faltas:
          Number(aluno.faltas || 0),
        percentual,
        percentualTexto:
          formatarPercentualRelatorio_(percentual),
        classificacao:
          classificarFrequenciaRelatorio_(
            percentual,
            aluno.totalAulas,
            ativo
          ),
        classe:
          classeFrequenciaRelatorio_(percentual),
        ativo,
        emRisco
      };
    });

  /*
   * As tabelas e o gráfico do PDF exibem somente
   * alunos cujo status mais recente na turma é ATIVO/ATIVA.
   */
  const alunosAtivos =
    alunosPreparados
      .filter(aluno => aluno.ativo);

  const alunosEmRisco =
    alunosAtivos
      .filter(aluno => aluno.emRisco)
      .sort((a, b) =>
        a.percentual - b.percentual ||
        a.nomeAluno.localeCompare(
          b.nomeAluno,
          'pt-BR'
        )
      );

  const alunosOrdenados =
    [...alunosAtivos].sort((a, b) =>
      a.nomeAluno.localeCompare(
        b.nomeAluno,
        'pt-BR'
      )
    );

  const totalPresencas =
    alunosAtivos.reduce(
      (soma, aluno) =>
        soma + aluno.presencas,
      0
    );

  const totalFaltas =
    alunosAtivos.reduce(
      (soma, aluno) =>
        soma + aluno.faltas,
      0
    );

  const percentuaisComAula =
    alunosAtivos
      .filter(aluno => aluno.totalAulas > 0)
      .map(aluno => aluno.percentual);

  const maiorFrequencia =
    percentuaisComAula.length
      ? Math.max(...percentuaisComAula)
      : 0;

  const menorFrequencia =
    percentuaisComAula.length
      ? Math.min(...percentuaisComAula)
      : 0;

  return {
    turma:
      String(painel.turma || 'Turma'),
    periodoFormatado:
      String(painel.periodoFormatado || ''),
    totalAulas:
      Number(resumo.totalAulas || 0),
    totalAlunos:
      Number(
        resumo.totalAlunos != null
          ? resumo.totalAlunos
          : alunosPreparados.length
      ),
    totalAtivos:
      Number(resumo.totalAtivosStatus || 0),
    totalDesligados:
      Number(
        resumo.totalCanceladosAbandonoStatus || 0
      ),
    totalFinalizados:
      Number(resumo.totalFinalizadosStatus || 0),
    mediaFrequencia:
      Number(resumo.mediaFrequencia || 0),
    mediaFrequenciaTexto:
      formatarPercentualRelatorio_(
        resumo.mediaFrequencia
      ),
    totalEmRisco:
      alunosEmRisco.length,
    percentualRiscoTexto:
      formatarPercentualRelatorio_(
        Number(resumo.totalAtivosStatus || 0) > 0
          ? (
              alunosEmRisco.length /
              Number(resumo.totalAtivosStatus)
            ) * 100
          : 0
      ),
    totalPresencas,
    totalFaltas,
    maiorFrequenciaTexto:
      formatarPercentualRelatorio_(
        maiorFrequencia
      ),
    menorFrequenciaTexto:
      formatarPercentualRelatorio_(
        menorFrequencia
      ),
    alunosEmRisco,
    alunos: alunosOrdenados
  };
}


/**
 * Consolida os indicadores do relatório geral.
 * A contagem é por vínculo na turma; um aluno em duas turmas
 * pode aparecer uma vez em cada turma.
 */
function criarResumoGeralRelatorioFrequencia_(
  turmas
) {
  const totalTurmas =
    turmas.length;

  const totalAtivos =
    turmas.reduce(
      (soma, turma) =>
        soma + turma.totalAtivos,
      0
    );

  const totalEmRisco =
    turmas.reduce(
      (soma, turma) =>
        soma + turma.totalEmRisco,
      0
    );

  const totalPresencas =
    turmas.reduce(
      (soma, turma) =>
        soma + turma.totalPresencas,
      0
    );

  const totalAulasAlunos =
    turmas.reduce(
      (soma, turma) =>
        soma +
        turma.alunos.reduce(
          (subtotal, aluno) =>
            subtotal + aluno.totalAulas,
          0
        ),
      0
    );

  const mediaGeral =
    totalAulasAlunos > 0
      ? (
          totalPresencas /
          totalAulasAlunos
        ) * 100
      : 0;

  const turmasComRisco =
    turmas.filter(
      turma => turma.totalEmRisco > 0
    ).length;

  return {
    totalTurmas,
    totalAtivos,
    totalEmRisco,
    turmasComRisco,
    mediaGeral,
    mediaGeralTexto:
      formatarPercentualRelatorio_(mediaGeral),
    percentualRiscoTexto:
      formatarPercentualRelatorio_(
        totalAtivos > 0
          ? (
              totalEmRisco /
              totalAtivos
            ) * 100
          : 0
      )
  };
}


/**
 * Renderiza o template HTML, converte em PDF e salva no Drive.
 */
function criarArquivoPdfRelatorioFrequencia_(
  modelo,
  nomeBase
) {
  const template =
    HtmlService.createTemplateFromFile(
      'RelatorioFrequenciaTemplate'
    );

  template.modelo = modelo;

  const html =
    template
      .evaluate()
      .getContent();

  const nomeArquivo =
    `${nomeBase}_${Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyyMMdd_HHmmss'
    )}.pdf`;

  const blobHtml =
    Utilities.newBlob(
      html,
      MimeType.HTML,
      `${nomeBase}.html`
    );

  const blobPdf =
    blobHtml
      .getAs(MimeType.PDF)
      .setName(nomeArquivo);

  const pasta =
    obterPastaRelatoriosFrequencia_();

  const arquivo =
    pasta.createFile(blobPdf);

  /*
   * O app roda como o dono da planilha, então o PDF nasce
   * privado: quem clica no botão e não é o dono cai na tela
   * "Você precisa de permissão" do Drive.
   *
   * Liberar por link resolve para qualquer funcionário, esteja
   * ele logado numa conta Google ou não. É o mesmo padrão já
   * usado nas fotos do Portal do Aluno (PortalAluno.gs).
   */
  arquivo.setSharing(
    DriveApp.Access.ANYONE_WITH_LINK,
    DriveApp.Permission.VIEW
  );

  const arquivoId =
    arquivo.getId();

  return {
    sucesso: true,
    mensagem:
      'Relatório PDF gerado com sucesso.',
    nomeArquivo,
    arquivoId,
    url:
      arquivo.getUrl(),

    /*
     * getUrl() abre o visualizador do Drive. Para o botão de
     * download o link precisa apontar para o arquivo em si,
     * senão o funcionário só vê a pré-visualização.
     */
    urlDownload:
      `https://drive.google.com/uc?export=download&id=${arquivoId}`
  };
}


/**
 * Apaga os relatórios antigos da pasta.
 *
 * Cada clique nos botões gera um PDF novo, que fica no Drive
 * do dono para sempre. Esta função não é chamada por ninguém:
 * ligue-a num acionador de tempo (diário) se quiser a limpeza
 * automática.
 *
 * Retorna quantos arquivos foram para a lixeira.
 */
function limparRelatoriosFrequenciaAntigos() {
  const limite =
    new Date().getTime() -
    CONFIG_RELATORIO_FREQUENCIA.DIAS_PARA_LIMPEZA *
      24 * 60 * 60 * 1000;

  const arquivos =
    obterPastaRelatoriosFrequencia_()
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


function obterPastaRelatoriosFrequencia_() {
  const propriedades =
    PropertiesService.getScriptProperties();

  const idSalvo =
    propriedades.getProperty(
      'PASTA_RELATORIOS_FREQUENCIA_ID'
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
      CONFIG_RELATORIO_FREQUENCIA.NOME_PASTA
    );

  const pasta =
    pastas.hasNext()
      ? pastas.next()
      : DriveApp.createFolder(
          CONFIG_RELATORIO_FREQUENCIA.NOME_PASTA
        );

  propriedades.setProperty(
    'PASTA_RELATORIOS_FREQUENCIA_ID',
    pasta.getId()
  );

  return pasta;
}


function validarFiltrosRelatorioFrequencia_(
  filtros
) {
  if (!filtros) {
    throw new Error(
      'Nenhum filtro foi informado.'
    );
  }

  if (!String(filtros.turma || '').trim()) {
    throw new Error(
      'Selecione uma turma.'
    );
  }

  if (
    !/^\d{4}-\d{2}$/.test(
      String(filtros.mesInicial || '')
    ) ||
    !/^\d{4}-\d{2}$/.test(
      String(filtros.mesFinal || '')
    )
  ) {
    throw new Error(
      'Informe um período válido.'
    );
  }

  if (
    filtros.mesInicial >
    filtros.mesFinal
  ) {
    throw new Error(
      'O mês inicial não pode ser posterior ao mês final.'
    );
  }
}


function classificarFrequenciaRelatorio_(
  percentual,
  totalAulas,
  ativo
) {
  if (!ativo) {
    return 'Fora da análise de risco';
  }

  if (Number(totalAulas || 0) <= 0) {
    return 'Sem aulas válidas no período';
  }

  if (percentual < 50) {
    return 'Risco crítico';
  }

  if (percentual < 70) {
    return 'Risco de evasão';
  }

  if (percentual < 90) {
    return 'Frequência adequada';
  }

  return 'Frequência excelente';
}


function classeFrequenciaRelatorio_(
  percentual
) {
  if (Number(percentual || 0) >= 90) {
    return 'alta';
  }

  if (Number(percentual || 0) >= 70) {
    return 'media';
  }

  return 'baixa';
}


function formatarPercentualRelatorio_(
  valor
) {
  return Number(valor || 0)
    .toLocaleString(
      'pt-BR',
      {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }
    ) + '%';
}


function formatarMesRelatorio_(valor) {
  const texto =
    String(valor || '');

  if (!/^\d{4}-\d{2}$/.test(texto)) {
    return texto;
  }

  const [ano, mes] =
    texto.split('-');

  const meses = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro'
  ];

  return `${meses[Number(mes) - 1]} de ${ano}`;
}


function formatarDataHoraRelatorio_(data) {
  return Utilities.formatDate(
    data,
    Session.getScriptTimeZone(),
    'dd/MM/yyyy HH:mm'
  );
}


function slugArquivoRelatorio_(texto) {
  return String(texto || 'Turma')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
