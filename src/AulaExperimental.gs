/**
 * =========================================================
 * SIGA — AULA EXPERIMENTAL
 * Arquivo: AulaExperimental.gs
 * Aba: Aula Experimental - Agenda
 * =========================================================
 */

const AULA_EXPERIMENTAL_SIGA_CONFIG = {

  ABA:
    'Aula Experimental - Agenda',

  CAMPOS: {

    CARIMBO:
      'Carimbo de data/hora',

    EMAIL:
      'Endereço de e-mail',

    NOME_ALUNO:
      'Nome do aluno(a)',

    IDADE:
      'Idade do aluno(a)',

    TELEFONE_ALUNO:
      'Telefone do aluno(a)',

    NOME_RESPONSAVEL:
      'Nome do responsável legal (caso o aluno(a) seja menor de 18 anos)',

    TELEFONE_RESPONSAVEL:
      'Telefone do responsável legal (caso o aluno(a) seja menor de 18 anos)',

    AULA_DESEJADA:
      'Aula experimental desejada',

    DATA_ESCOLHIDA:
      'Data escolhida para a aula experimental',

    OBSERVACAO:
      'Alguma observação que gostaria de fazer? Caso queira compartilhar alguma informação importante como experiência anterior, expectativas ou necessidades específicas.',

    AGENDADO:
      'Agendado',

    CONFIRMACAO_PRESENCA:
      'CONFIRMACAO_PRESENCA',

    COMPARECIMENTO:
      'COMPARECIMENTO',

    FECHOU_MATRICULA:
      'FECHOU_MATRICULA'
  }
};


/**
 * Lista todos os registros do formulário.
 */
function listarAulasExperimentaisSIGA() {

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const aba =
    ss.getSheetByName(
      AULA_EXPERIMENTAL_SIGA_CONFIG.ABA
    );

  if (!aba) {
    throw new Error(
      'A aba "Aula Experimental - Agenda" não foi encontrada.'
    );
  }

  garantirColunasControleAulaExperimentalSIGA_(aba);

  const valores =
    aba.getDataRange().getValues();

  if (valores.length < 2) {
    return {
      sucesso: true,
      registros: [],
      aulas: [],
      resumo: {
        total: 0,
        pendentes: 0,
        agendadas: 0,
        proximas: 0
      }
    };
  }

  const mapa =
    criarMapaCabecalhosAulaExperimentalSIGA_(
      valores[0]
    );

  const idx = {
    carimbo:
      indiceAulaExperimentalSIGA_(
        mapa,
        [
          AULA_EXPERIMENTAL_SIGA_CONFIG
            .CAMPOS.CARIMBO
        ]
      ),

    email:
      indiceAulaExperimentalSIGA_(
        mapa,
        [
          AULA_EXPERIMENTAL_SIGA_CONFIG
            .CAMPOS.EMAIL
        ]
      ),

    nomeAluno:
      indiceAulaExperimentalSIGA_(
        mapa,
        [
          AULA_EXPERIMENTAL_SIGA_CONFIG
            .CAMPOS.NOME_ALUNO
        ]
      ),

    idade:
      indiceAulaExperimentalSIGA_(
        mapa,
        [
          AULA_EXPERIMENTAL_SIGA_CONFIG
            .CAMPOS.IDADE
        ]
      ),

    telefoneAluno:
      indiceAulaExperimentalSIGA_(
        mapa,
        [
          AULA_EXPERIMENTAL_SIGA_CONFIG
            .CAMPOS.TELEFONE_ALUNO
        ]
      ),

    nomeResponsavel:
      indiceAulaExperimentalSIGA_(
        mapa,
        [
          AULA_EXPERIMENTAL_SIGA_CONFIG
            .CAMPOS.NOME_RESPONSAVEL
        ]
      ),

    telefoneResponsavel:
      indiceAulaExperimentalSIGA_(
        mapa,
        [
          AULA_EXPERIMENTAL_SIGA_CONFIG
            .CAMPOS.TELEFONE_RESPONSAVEL
        ]
      ),

    aulaDesejada:
      indiceAulaExperimentalSIGA_(
        mapa,
        [
          AULA_EXPERIMENTAL_SIGA_CONFIG
            .CAMPOS.AULA_DESEJADA
        ]
      ),

    dataEscolhida:
      indiceAulaExperimentalSIGA_(
        mapa,
        [
          AULA_EXPERIMENTAL_SIGA_CONFIG
            .CAMPOS.DATA_ESCOLHIDA
        ]
      ),

    observacao:
      encontrarObservacaoAulaExperimentalSIGA_(
        valores[0]
      ),

    agendado:
      indiceAulaExperimentalSIGA_(
        mapa,
        [
          AULA_EXPERIMENTAL_SIGA_CONFIG
            .CAMPOS.AGENDADO
        ]
      ),

    confirmacaoPresenca:
      indiceAulaExperimentalSIGA_(
        mapa,
        [
          AULA_EXPERIMENTAL_SIGA_CONFIG
            .CAMPOS.CONFIRMACAO_PRESENCA
        ]
      ),

    comparecimento:
      indiceAulaExperimentalSIGA_(
        mapa,
        [
          AULA_EXPERIMENTAL_SIGA_CONFIG
            .CAMPOS.COMPARECIMENTO
        ]
      ),

    fechouMatricula:
      indiceAulaExperimentalSIGA_(
        mapa,
        [
          AULA_EXPERIMENTAL_SIGA_CONFIG
            .CAMPOS.FECHOU_MATRICULA
        ]
      )
  };

  if (idx.nomeAluno < 0) {
    throw new Error(
      'A coluna "Nome do aluno(a)" não foi encontrada.'
    );
  }

  if (idx.agendado < 0) {
    throw new Error(
      'A coluna "Agendado" não foi encontrada.'
    );
  }

  const registros = [];

  const aulasSet =
    new Set();

  const hoje =
    inicioDiaAulaExperimentalSIGA_(
      new Date()
    );

  let agendadas = 0;
  let proximas = 0;
  let confirmar24h = 0;
  let confirmacoesPendentes = 0;
  let compareceram = 0;
  let faltaram = 0;
  let matriculasFechadas = 0;

  const mapaMatriculas =
    obterMapaMatriculasExperimentaisSIGA_(ss);

  for (
    let i = 1;
    i < valores.length;
    i++
  ) {

    const linha =
      valores[i];

    const nomeAluno =
      textoAulaExperimentalSIGA_(
        linha,
        idx.nomeAluno
      );

    if (!nomeAluno) {
      continue;
    }

    const aulaDesejada =
      textoAulaExperimentalSIGA_(
        linha,
        idx.aulaDesejada
      );

    if (aulaDesejada) {
      aulasSet.add(
        aulaDesejada
      );
    }

    const data =
      valorAulaExperimentalSIGA_(
        linha,
        idx.dataEscolhida
      );

    const dataObj =
      parseDataAulaExperimentalSIGA_(
        data
      );

    const agendado =
      booleanAgendadoAulaExperimentalSIGA_(
        valorAulaExperimentalSIGA_(
          linha,
          idx.agendado
        )
      );

    if (agendado) {
      agendadas++;
    }

    if (
      agendado &&
      dataObj &&
      inicioDiaAulaExperimentalSIGA_(
        dataObj
      ) >= hoje
    ) {
      proximas++;
    }

    const confirmacaoPresenca =
      textoAulaExperimentalSIGA_(
        linha,
        idx.confirmacaoPresenca
      ) || 'PENDENTE';

    const statusConfirmacao =
      normalizarTextoAulaExperimentalSIGA_(
        confirmacaoPresenca
      );

    if (
      agendado &&
      dataObj &&
      inicioDiaAulaExperimentalSIGA_(dataObj) >= hoje &&
      statusConfirmacao !== 'CONFIRMADO' &&
      statusConfirmacao !== 'NAO CONFIRMADO'
    ) {
      confirmacoesPendentes++;
    }

    const comparecimento =
      textoAulaExperimentalSIGA_(
        linha,
        idx.comparecimento
      ) || 'PENDENTE';

    const fechouMatricula =
      textoAulaExperimentalSIGA_(
        linha,
        idx.fechouMatricula
      ) || 'PENDENTE';

    const precisaConfirmacao24h =
      calcularAlerta24hAulaExperimentalSIGA_(
        dataObj,
        confirmacaoPresenca,
        agendado
      );

    if (precisaConfirmacao24h) {
      confirmar24h++;
    }

    if (
      normalizarTextoAulaExperimentalSIGA_(
        comparecimento
      ) === 'COMPARECEU'
    ) {
      compareceram++;
    }

    if (
      normalizarTextoAulaExperimentalSIGA_(
        comparecimento
      ) === 'FALTOU'
    ) {
      faltaram++;
    }

    const matriculaEncontrada =
      localizarMatriculaExperimentalSIGA_(
        mapaMatriculas,
        nomeAluno,
        aulaDesejada,
        valorAulaExperimentalSIGA_(
          linha,
          idx.carimbo
        ),
        dataObj
      );

    if (
      matriculaEncontrada ||
      normalizarTextoAulaExperimentalSIGA_(
        fechouMatricula
      ) === 'SIM'
    ) {
      matriculasFechadas++;
    }

    registros.push({

      linha:
        i + 1,

      carimbo:
        formatarDataHoraAulaExperimentalSIGA_(
          valorAulaExperimentalSIGA_(
            linha,
            idx.carimbo
          )
        ),

      email:
        textoAulaExperimentalSIGA_(
          linha,
          idx.email
        ),

      nomeAluno,

      idade:
        textoAulaExperimentalSIGA_(
          linha,
          idx.idade
        ),

      telefoneAluno:
        textoAulaExperimentalSIGA_(
          linha,
          idx.telefoneAluno
        ),

      nomeResponsavel:
        textoAulaExperimentalSIGA_(
          linha,
          idx.nomeResponsavel
        ),

      telefoneResponsavel:
        textoAulaExperimentalSIGA_(
          linha,
          idx.telefoneResponsavel
        ),

      aulaDesejada,

      dataEscolhida:
        formatarDataAulaExperimentalSIGA_(
          data
        ),

      dataEscolhidaISO:
        formatarDataISOAulaExperimentalSIGA_(
          data
        ),

      observacao:
        textoAulaExperimentalSIGA_(
          linha,
          idx.observacao
        ),

      agendado,

      confirmacaoPresenca,

      comparecimento,

      fechouMatricula,

      precisaConfirmacao24h,

      matriculaEncontrada
    });
  }

  registros.sort(
    (a, b) => {

      const da =
        a.dataEscolhidaISO || '9999-12-31';

      const db =
        b.dataEscolhidaISO || '9999-12-31';

      if (da !== db) {
        return da.localeCompare(db);
      }

      return a.nomeAluno.localeCompare(
        b.nomeAluno,
        'pt-BR'
      );
    }
  );

  const aulas =
    [...aulasSet]
      .sort(
        (a, b) =>
          a.localeCompare(
            b,
            'pt-BR'
          )
      );

  return {
    sucesso: true,
    registros,
    aulas,
    resumo: {
      total:
        registros.length,

      pendentes:
        registros.length -
        agendadas,

      agendadas,

      proximas,

      confirmar24h,

      confirmacoesPendentes,

      compareceram,

      faltaram,

      matriculasFechadas
    }
  };
}


/**
 * Atualiza somente o campo Agendado.
 */
function atualizarAgendadoAulaExperimentalSIGA(
  dados
) {

  dados =
    dados || {};

  const linha =
    Number(
      dados.linha || 0
    );

  if (
    !Number.isInteger(linha) ||
    linha < 2
  ) {
    throw new Error(
      'Linha da solicitação inválida.'
    );
  }

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const aba =
    ss.getSheetByName(
      AULA_EXPERIMENTAL_SIGA_CONFIG.ABA
    );

  if (!aba) {
    throw new Error(
      'A aba "Aula Experimental - Agenda" não foi encontrada.'
    );
  }

  if (
    linha >
    aba.getLastRow()
  ) {
    throw new Error(
      'Solicitação não encontrada.'
    );
  }

  garantirColunasControleAulaExperimentalSIGA_(aba);

  const cabecalhos =
    aba
      .getRange(
        1,
        1,
        1,
        aba.getLastColumn()
      )
      .getValues()[0];

  const mapa =
    criarMapaCabecalhosAulaExperimentalSIGA_(
      cabecalhos
    );

  const idxAgendado =
    indiceAulaExperimentalSIGA_(
      mapa,
      [
        AULA_EXPERIMENTAL_SIGA_CONFIG
          .CAMPOS.AGENDADO
      ]
    );

  if (idxAgendado < 0) {
    throw new Error(
      'A coluna "Agendado" não foi encontrada.'
    );
  }

  const agendado =
    dados.agendado === true;

  aba
    .getRange(
      linha,
      idxAgendado + 1
    )
    .setValue(
      agendado
        ? 'SIM'
        : 'NÃO'
    );

  return {
    sucesso: true,
    agendado
  };
}



/**
 * Atualiza CONFIRMACAO_PRESENCA, COMPARECIMENTO
 * ou FECHOU_MATRICULA.
 */
function atualizarEtapaAulaExperimentalSIGA(
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
      'Linha da solicitação inválida.'
    );
  }

  const campo =
    normalizarTextoAulaExperimentalSIGA_(
      dados.campo
    );

  const permitidos = {
    CONFIRMACAO_PRESENCA: [
      'PENDENTE',
      'CONFIRMADO',
      'NAO CONFIRMADO'
    ],
    COMPARECIMENTO: [
      'PENDENTE',
      'COMPARECEU',
      'FALTOU'
    ],
    FECHOU_MATRICULA: [
      'PENDENTE',
      'SIM',
      'NAO'
    ]
  };

  if (
    !Object.prototype
      .hasOwnProperty
      .call(
        permitidos,
        campo
      )
  ) {
    throw new Error(
      'Campo de controle inválido.'
    );
  }

  const valor =
    normalizarTextoAulaExperimentalSIGA_(
      dados.valor
    );

  if (
    !permitidos[campo]
      .includes(valor)
  ) {
    throw new Error(
      'Valor inválido para ' +
      campo +
      '.'
    );
  }

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const aba =
    ss.getSheetByName(
      AULA_EXPERIMENTAL_SIGA_CONFIG.ABA
    );

  if (!aba) {
    throw new Error(
      'A aba "Aula Experimental - Agenda" não foi encontrada.'
    );
  }

  garantirColunasControleAulaExperimentalSIGA_(aba);

  if (
    linha >
    aba.getLastRow()
  ) {
    throw new Error(
      'Solicitação não encontrada.'
    );
  }

  const cabecalhos =
    aba
      .getRange(
        1,
        1,
        1,
        aba.getLastColumn()
      )
      .getValues()[0];

  const mapa =
    criarMapaCabecalhosAulaExperimentalSIGA_(
      cabecalhos
    );

  const indice =
    indiceAulaExperimentalSIGA_(
      mapa,
      [campo]
    );

  if (indice < 0) {
    throw new Error(
      'Coluna "' +
      campo +
      '" não encontrada.'
    );
  }

  let valorGravar =
    String(dados.valor || '')
      .trim();

  if (valor === 'NAO') {
    valorGravar = 'NÃO';
  }

  if (valor === 'NAO CONFIRMADO') {
    valorGravar = 'NÃO CONFIRMADO';
  }

  aba
    .getRange(
      linha,
      indice + 1
    )
    .setValue(
      valorGravar
    );

  return {
    sucesso: true,
    campo,
    valor:
      valorGravar
  };
}


/**
 * Cria uma solicitação manualmente — ex.: pedido recebido por telefone
 * ou WhatsApp, que não passou pelo formulário do Google. Grava direto
 * na mesma aba do formulário, usando os mesmos cabeçalhos, então
 * listarAulasExperimentaisSIGA lê o registro normalmente, sem precisar
 * de nenhum tratamento especial.
 */
function criarAulaExperimentalManualSIGA(
  dados
) {

  dados = dados || {};

  const nomeAluno =
    String(dados.nomeAluno || '').trim();

  const aulaDesejada =
    String(dados.aulaDesejada || '').trim();

  if (!nomeAluno) {
    throw new Error(
      'Informe o nome do aluno.'
    );
  }

  if (!aulaDesejada) {
    throw new Error(
      'Informe a aula experimental desejada.'
    );
  }

  const dataEscolhidaObj =
    parseDataAulaExperimentalSIGA_(
      dados.dataEscolhida
    );

  if (!dataEscolhidaObj) {
    throw new Error(
      'Informe uma data válida para a aula experimental.'
    );
  }

  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const aba =
    ss.getSheetByName(
      AULA_EXPERIMENTAL_SIGA_CONFIG.ABA
    );

  if (!aba) {
    throw new Error(
      'A aba "Aula Experimental - Agenda" não foi encontrada.'
    );
  }

  garantirColunasControleAulaExperimentalSIGA_(aba);

  const cabecalhos =
    aba
      .getRange(
        1,
        1,
        1,
        aba.getLastColumn()
      )
      .getValues()[0];

  const mapa =
    criarMapaCabecalhosAulaExperimentalSIGA_(
      cabecalhos
    );

  const linha =
    new Array(cabecalhos.length).fill('');

  const definir = (nomeCampo, valor) => {

    if (
      valor === '' ||
      valor === null ||
      valor === undefined
    ) {
      return;
    }

    const indice =
      indiceAulaExperimentalSIGA_(
        mapa,
        [nomeCampo]
      );

    if (indice >= 0) {
      linha[indice] = valor;
    }
  };

  definir(
    AULA_EXPERIMENTAL_SIGA_CONFIG.CAMPOS.CARIMBO,
    new Date()
  );

  definir(
    AULA_EXPERIMENTAL_SIGA_CONFIG.CAMPOS.EMAIL,
    String(dados.email || '').trim()
  );

  definir(
    AULA_EXPERIMENTAL_SIGA_CONFIG.CAMPOS.NOME_ALUNO,
    nomeAluno
  );

  definir(
    AULA_EXPERIMENTAL_SIGA_CONFIG.CAMPOS.IDADE,
    String(dados.idade || '').trim()
  );

  definir(
    AULA_EXPERIMENTAL_SIGA_CONFIG.CAMPOS.TELEFONE_ALUNO,
    String(dados.telefoneAluno || '').trim()
  );

  definir(
    AULA_EXPERIMENTAL_SIGA_CONFIG.CAMPOS.NOME_RESPONSAVEL,
    String(dados.nomeResponsavel || '').trim()
  );

  definir(
    AULA_EXPERIMENTAL_SIGA_CONFIG.CAMPOS.TELEFONE_RESPONSAVEL,
    String(dados.telefoneResponsavel || '').trim()
  );

  definir(
    AULA_EXPERIMENTAL_SIGA_CONFIG.CAMPOS.AULA_DESEJADA,
    aulaDesejada
  );

  definir(
    AULA_EXPERIMENTAL_SIGA_CONFIG.CAMPOS.DATA_ESCOLHIDA,
    dataEscolhidaObj
  );

  // O cabeçalho de observação do formulário é longo e pode vir com
  // quebra de linha — por isso usa a mesma busca parcial da leitura
  // (encontrarObservacaoAulaExperimentalSIGA_) em vez de indiceAula
  // ExperimentalSIGA_, que exige igualdade exata e não acharia a coluna.
  const observacao =
    String(dados.observacao || '').trim();

  if (observacao) {
    const idxObservacao =
      encontrarObservacaoAulaExperimentalSIGA_(
        cabecalhos
      );

    if (idxObservacao >= 0) {
      linha[idxObservacao] = observacao;
    }
  }

  // Inserido manualmente = a escola já sabe do agendamento (recebido
  // por telefone/WhatsApp), então já entra como Agendado — confirmação
  // de presença, comparecimento e matrícula continuam PENDENTE, iguais
  // a qualquer solicitação nova.
  definir(
    AULA_EXPERIMENTAL_SIGA_CONFIG.CAMPOS.AGENDADO,
    'SIM'
  );

  aba.appendRow(linha);

  return {
    sucesso: true,
    linha: aba.getLastRow()
  };
}


/**
 * Cria automaticamente as colunas de acompanhamento
 * caso ainda não existam.
 */
function garantirColunasControleAulaExperimentalSIGA_(
  aba
) {

  const campos = [
    'CONFIRMACAO_PRESENCA',
    'COMPARECIMENTO',
    'FECHOU_MATRICULA'
  ];

  const ultimaColuna =
    Math.max(
      aba.getLastColumn(),
      1
    );

  const cabecalhos =
    aba
      .getRange(
        1,
        1,
        1,
        ultimaColuna
      )
      .getValues()[0];

  const existentes =
    cabecalhos.map(
      normalizarCabecalhoAulaExperimentalSIGA_
    );

  const novos = [];

  campos.forEach(campo => {

    const chave =
      normalizarCabecalhoAulaExperimentalSIGA_(
        campo
      );

    if (
      !existentes.includes(chave)
    ) {
      novos.push(campo);
      existentes.push(chave);
    }
  });

  if (!novos.length) {
    return;
  }

  aba
    .getRange(
      1,
      aba.getLastColumn() + 1,
      1,
      novos.length
    )
    .setValues([novos]);
}


/**
 * Como o formulário não possui horário, o alerta de 24h
 * usa a data da aula. Ele sinaliza hoje as aulas de hoje
 * e do dia seguinte que ainda aguardam confirmação.
 */
function calcularAlerta24hAulaExperimentalSIGA_(
  dataAula,
  confirmacao,
  agendado
) {

  if (
    !agendado ||
    !dataAula
  ) {
    return false;
  }

  const status =
    normalizarTextoAulaExperimentalSIGA_(
      confirmacao
    );

  if (
    status === 'CONFIRMADO' ||
    status === 'NAO CONFIRMADO'
  ) {
    return false;
  }

  const hoje =
    inicioDiaAulaExperimentalSIGA_(
      new Date()
    );

  const aula =
    inicioDiaAulaExperimentalSIGA_(
      dataAula
    );

  const diferencaDias =
    Math.round(
      (
        aula.getTime() -
        hoje.getTime()
      ) /
      86400000
    );

  return (
    diferencaDias >= 0 &&
    diferencaDias <= 1
  );
}


/**
 * Mapa de matrículas para detectar conversão automática.
 * Só considera correspondência de aluno + turma/aula.
 */
function obterMapaMatriculasExperimentaisSIGA_(
  ss
) {

  const aba =
    ss.getSheetByName(
      'DimMatricula'
    );

  const mapaResultado =
    new Map();

  if (!aba) {
    return mapaResultado;
  }

  const valores =
    aba.getDataRange().getValues();

  if (valores.length < 2) {
    return mapaResultado;
  }

  const mapa =
    criarMapaCabecalhosAulaExperimentalSIGA_(
      valores[0]
    );

  const idxNome =
    indiceAulaExperimentalSIGA_(
      mapa,
      [
        'NOME_ALUNO',
        'NOME DO ALUNO'
      ]
    );

  const idxTurma =
    indiceAulaExperimentalSIGA_(
      mapa,
      ['TURMA']
    );

  const idxData =
    indiceAulaExperimentalSIGA_(
      mapa,
      [
        'DATA_ALTERACAO/MATRICULA',
        'DATA_MATRICULA',
        'DATA ALTERACAO MATRICULA'
      ]
    );

  if (
    idxNome < 0 ||
    idxTurma < 0
  ) {
    return mapaResultado;
  }

  for (
    let i = 1;
    i < valores.length;
    i++
  ) {

    const nome =
      normalizarTextoAulaExperimentalSIGA_(
        valores[i][idxNome]
      );

    const turma =
      normalizarTextoAulaExperimentalSIGA_(
        valores[i][idxTurma]
      );

    if (
      !nome ||
      !turma
    ) {
      continue;
    }

    const chave =
      nome + '|' + turma;

    const data =
      idxData >= 0
        ? parseDataAulaExperimentalSIGA_(
            valores[i][idxData]
          )
        : null;

    if (
      !mapaResultado.has(chave)
    ) {
      mapaResultado.set(
        chave,
        []
      );
    }

    mapaResultado
      .get(chave)
      .push(data);
  }

  return mapaResultado;
}


function localizarMatriculaExperimentalSIGA_(
  mapaMatriculas,
  nomeAluno,
  aulaDesejada,
  carimbo,
  dataAula
) {

  const nome =
    normalizarTextoAulaExperimentalSIGA_(
      nomeAluno
    );

  const turma =
    normalizarTextoAulaExperimentalSIGA_(
      aulaDesejada
    );

  if (
    !nome ||
    !turma
  ) {
    return false;
  }

  const lista =
    mapaMatriculas.get(
      nome + '|' + turma
    ) || [];

  if (!lista.length) {
    return false;
  }

  const referencia =
    parseDataAulaExperimentalSIGA_(
      carimbo
    ) ||
    dataAula ||
    null;

  if (!referencia) {
    return true;
  }

  const inicioRef =
    inicioDiaAulaExperimentalSIGA_(
      referencia
    ).getTime();

  return lista.some(data => {

    if (!data) {
      return true;
    }

    return (
      inicioDiaAulaExperimentalSIGA_(
        data
      ).getTime() >=
      inicioRef
    );
  });
}


/* =========================================================
   HELPERS
   ========================================================= */


function criarMapaCabecalhosAulaExperimentalSIGA_(
  cabecalhos
) {

  const mapa = {};

  cabecalhos.forEach(
    (cabecalho, indice) => {

      mapa[
        normalizarCabecalhoAulaExperimentalSIGA_(
          cabecalho
        )
      ] = indice;
    }
  );

  return mapa;
}


function indiceAulaExperimentalSIGA_(
  mapa,
  nomes
) {

  for (const nome of nomes) {

    const chave =
      normalizarCabecalhoAulaExperimentalSIGA_(
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


/**
 * O cabeçalho de observação do Google Forms pode vir
 * com quebra de linha. Por isso procuramos pelo começo
 * do texto em vez de exigir igualdade absoluta.
 */
function encontrarObservacaoAulaExperimentalSIGA_(
  cabecalhos
) {

  for (
    let i = 0;
    i < cabecalhos.length;
    i++
  ) {

    const texto =
      normalizarTextoAulaExperimentalSIGA_(
        cabecalhos[i]
      );

    if (
      texto.includes(
        'ALGUMA OBSERVACAO QUE GOSTARIA DE FAZER'
      )
    ) {
      return i;
    }
  }

  return -1;
}


function normalizarCabecalhoAulaExperimentalSIGA_(
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


function normalizarTextoAulaExperimentalSIGA_(
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
      /\s+/g,
      ' '
    );
}


function valorAulaExperimentalSIGA_(
  linha,
  indice
) {

  if (
    indice === undefined ||
    indice < 0
  ) {
    return '';
  }

  return linha[indice];
}


function textoAulaExperimentalSIGA_(
  linha,
  indice
) {

  return String(
    valorAulaExperimentalSIGA_(
      linha,
      indice
    ) ?? ''
  ).trim();
}


function booleanAgendadoAulaExperimentalSIGA_(
  valor
) {

  if (valor === true) {
    return true;
  }

  const texto =
    normalizarTextoAulaExperimentalSIGA_(
      valor
    );

  return [
    'SIM',
    'AGENDADO',
    'OK',
    'TRUE',
    'VERDADEIRO',
    'CONFIRMADO'
  ].includes(texto);
}


function parseDataAulaExperimentalSIGA_(
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
    String(valor || '').trim();

  if (!texto) {
    return null;
  }

  let m =
    texto.match(
      /^(\d{2})\/(\d{2})\/(\d{4})$/
    );

  if (m) {
    return new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      12,
      0,
      0
    );
  }

  m =
    texto.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (m) {
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      12,
      0,
      0
    );
  }

  const data =
    new Date(texto);

  return isNaN(
    data.getTime()
  )
    ? null
    : data;
}


function formatarDataAulaExperimentalSIGA_(
  valor
) {

  const data =
    parseDataAulaExperimentalSIGA_(
      valor
    );

  if (!data) {
    return '';
  }

  return Utilities.formatDate(
    data,
    Session.getScriptTimeZone(),
    'dd/MM/yyyy'
  );
}


function formatarDataISOAulaExperimentalSIGA_(
  valor
) {

  const data =
    parseDataAulaExperimentalSIGA_(
      valor
    );

  if (!data) {
    return '';
  }

  return Utilities.formatDate(
    data,
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );
}


function formatarDataHoraAulaExperimentalSIGA_(
  valor
) {

  const data =
    parseDataAulaExperimentalSIGA_(
      valor
    );

  if (!data) {
    return '';
  }

  return Utilities.formatDate(
    data,
    Session.getScriptTimeZone(),
    'dd/MM/yyyy HH:mm'
  );
}


function inicioDiaAulaExperimentalSIGA_(
  data
) {

  return new Date(
    data.getFullYear(),
    data.getMonth(),
    data.getDate()
  );
}
