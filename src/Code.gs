const CONFIG = {
  ABAS: {
    ALUNOS: 'DimAluno',
    MATRICULAS: 'DimMatricula',
    TURMAS: 'DimTurma'
  },

  PREFIXOS: {
    ALUNO: 'ALU-',
    MATRICULA: 'MAT-'
  },

  TAMANHO_ID: 5
};


/**
 * Abre a interface web.
 */
/**
 * Monta a interface do SIGA usando arquivos HTML modulares.
 *
 * IMPORTANTE:
 * Deve existir apenas uma função doGet() em todo o projeto.
 */
const TOKEN_PORTAL_PROFESSOR = 'PORTAL-GE-2026';
const TOKEN_PORTAL_ALUNO = 'ALUNO-GE-2026';

function doGet(e) {
  const pagina = String(
    e &&
    e.parameter &&
    e.parameter.pagina
      ? e.parameter.pagina
      : ''
  )
    .trim()
    .toLowerCase();

  // Endpoint de dados do Power BI. Vem antes das telas porque responde
  // JSON (ContentService), não HTML — ver PowerBI.gs.
  if (pagina === 'powerbi') {
    return powerBIResponderSIGA_(e);
  }

  if (pagina === 'professor') {

    const token = String(
      e &&
      e.parameter &&
      e.parameter.token
        ? e.parameter.token
        : ''
    ).trim();

    if (token !== TOKEN_PORTAL_PROFESSOR) {
      return HtmlService
        .createHtmlOutput(`
          <!DOCTYPE html>
          <html lang="pt-BR">
            <head>
              <meta charset="UTF-8">
              <meta
                name="viewport"
                content="width=device-width, initial-scale=1"
              >

              <title>Acesso negado</title>

              <style>
                body {
                  margin: 0;
                  min-height: 100vh;
                  display: grid;
                  place-items: center;
                  font-family: Arial, sans-serif;
                  background: #f5f6fa;
                  color: #222;
                }

                .aviso {
                  width: min(
                    420px,
                    calc(100% - 32px)
                  );

                  padding: 28px;
                  background: #fff;
                  border-radius: 14px;

                  box-shadow:
                    0 12px 32px
                    rgba(0, 0, 0, .10);

                  text-align: center;
                }
              </style>
            </head>

            <body>
              <section class="aviso">
                <h2>Acesso negado</h2>
                <p>O link informado é inválido.</p>
              </section>
            </body>
          </html>
        `)
        .setTitle('Acesso negado');
    }

    return HtmlService
      .createTemplateFromFile(
        'ProfessorIndex'
      )
      .evaluate()
      .setTitle(
        'SIGA - Portal do Professor'
      )
      .setXFrameOptionsMode(
        HtmlService
          .XFrameOptionsMode
          .ALLOWALL
      );
  }
    if (pagina === 'aluno') {
    const token = String(
      e &&
      e.parameter &&
      e.parameter.token
        ? e.parameter.token
        : ''
    ).trim();

    if (token !== TOKEN_PORTAL_ALUNO) {
      return HtmlService
        .createHtmlOutput(`
          <!DOCTYPE html>
          <html lang="pt-BR">
            <head>
              <meta charset="UTF-8">
              <meta
                name="viewport"
                content="width=device-width, initial-scale=1"
              >

              <title>Acesso negado</title>

              <style>
                body {
                  min-height: 100vh;
                  margin: 0;
                  display: grid;
                  place-items: center;
                  background: #f5f6fa;
                  font-family: Arial, sans-serif;
                }

                .aviso {
                  padding: 35px;
                  border-radius: 20px;
                  background: white;
                  text-align: center;
                }
              </style>
            </head>

            <body>
              <section class="aviso">
                <h2>Acesso negado</h2>
                <p>O link informado é inválido.</p>
              </section>
            </body>
          </html>
        `)
        .setTitle('Acesso negado');
    }

    return HtmlService
      .createTemplateFromFile('PortalAlunoIndex')
      .evaluate()
      .setTitle('SIGA - Portal do Aluno')
      .setXFrameOptionsMode(
        HtmlService.XFrameOptionsMode.ALLOWALL
      );
  }
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('SIGA')
    .setXFrameOptionsMode(
      HtmlService
        .XFrameOptionsMode
        .ALLOWALL
    );
}

/**
 * Inclui o conteúdo de outro arquivo HTML dentro do Index.html.
 *
 * Exemplo no HTML:
 * <?!= include('Styles'); ?>
 */
function include(nomeArquivo) {
  return HtmlService
    .createTemplateFromFile(nomeArquivo)
    .evaluate()
    .getContent();
}



/**
 * Retorna as turmas cadastradas na DimTurma.
 */
function listarTurmas() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const aba = planilha.getSheetByName(CONFIG.ABAS.TURMAS);

  if (!aba) {
    throw new Error('A aba DimTurma não foi encontrada.');
  }

  const dados = aba.getDataRange().getValues();

  if (dados.length < 2) {
    return [];
  }

  const mapa = criarMapaCabecalhos(dados[0]);

  const indiceTurma = localizarIndiceCabecalho(mapa, [
    'TURMA',
    'TIPOMATRICULA',
    'TIPO_MATRICULA'
  ]);

  const indiceStatus = localizarIndiceCabecalho(mapa, [
    'STATUS',
    'STATUS_TURMA',
    'SITUACAO',
    'SITUAÇÃO'
  ]);

  const indiceDataInicio = localizarIndiceCabecalho(mapa, [
    'DATA INICIO',
    'DATA_INICIO',
    'DATA DE INICIO',
    'DATA DE INÍCIO',
    'DATA INÍCIO'
  ]);

  const indiceModalidade = localizarIndiceCabecalho(mapa, [
    'MODALIDADE'
  ]);

  if (indiceTurma === -1) {
    throw new Error(
      'Não encontrei a coluna TURMA ou TipoMatricula na DimTurma.'
    );
  }

  if (indiceStatus === -1) {
    throw new Error(
      'Não encontrei a coluna STATUS da turma na DimTurma.'
    );
  }

  return dados
    .slice(1)
    .map(linha => {
      const turma = String(linha[indiceTurma] || '').trim();
      const status = normalizarTexto(linha[indiceStatus]);

      const dataInicio =
        indiceDataInicio >= 0
          ? formatarDataParaExibicao(linha[indiceDataInicio])
          : '';

      const modalidade =
        indiceModalidade >= 0
          ? String(linha[indiceModalidade] || '').trim()
          : '';

      return {
        turma,
        status,
        dataInicio,
        modalidade
      };
    })
    .filter(item =>
      item.turma &&
      ['EM ANDAMENTO', 'EM ESPERA'].includes(item.status)
    )
    .sort((a, b) =>
      a.turma.localeCompare(b.turma, 'pt-BR')
    );
}




/**
 * Salva aluno e matrícula.
 */
function salvarCadastro(formulario) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);
    validarFormulario(formulario);

    const planilha = SpreadsheetApp.getActiveSpreadsheet();
    const abaAlunos = planilha.getSheetByName(CONFIG.ABAS.ALUNOS);
    const abaMatriculas = planilha.getSheetByName(CONFIG.ABAS.MATRICULAS);

    if (!abaAlunos) {
      throw new Error('A aba DimAluno não foi encontrada.');
    }

    if (!abaMatriculas) {
      throw new Error('A aba DimMatricula não foi encontrada.');
    }

    const aluno = localizarOuCadastrarAluno(abaAlunos, formulario);

    verificarMatriculaDuplicada(
      abaMatriculas,
      aluno.idAluno,
      formulario.turma
    );

    const idMatricula = gerarProximoId(
      abaMatriculas,
      'ID_MATRICULA',
      CONFIG.PREFIXOS.MATRICULA
    );

    const dadosMatricula = {
      ID_ALUNO: aluno.idAluno,
      ID_MATRICULA: idMatricula,
      NOME_ALUNO: formulario.nomeAluno,
      TURMA: formulario.turma,
      STATUS: formulario.status || 'ATIVO',
      'TIPO_MATRICULA/ALTERACAO': 'NOVA',
      MOTIVO_ALTERACAO:formulario.motivoAlteracao || '',
      'TIPO_MATRICULA/ALTERACAO': formulario.tipoMatricula || 'NOVA',
      'DATA_ALTERACAO/MATRICULA': converterData(formulario.dataMatricula),
      'DATA_CANCELAMENTO/FINALIZACAO': '',
      DATA_EFETIVO_TURMA:converterData(formulario.dataEfetivoTurma),
      ISENTO_MATRICULA: formulario.isentoMatricula || 'NÃO',
      BOLSISTA: formulario.bolsista || 'NÃO',
      SEM_COMBO_ANTES_VENCIMENTO:
        converterNumero(formulario.semComboAntes),
      SEM_COMBO_APOS_VENCIMENTO:
        converterNumero(formulario.semComboDepois),
      COM_COMBO_ANTES_VENCIMENTO:
        converterNumero(formulario.comComboAntes),
      COM_COMBO_APOS_VENCIMENTO:
        converterNumero(formulario.comComboDepois)
    };

    adicionarLinhaPorCabecalho(abaMatriculas, dadosMatricula);
    return {
      sucesso: true,
      novoAluno: aluno.novoAluno,
      idAluno: aluno.idAluno,
      idMatricula,
      mensagem: aluno.novoAluno
        ? 'Aluno e matrícula cadastrados com sucesso.'
        : 'Aluno localizado e nova matrícula cadastrada com sucesso.'
    };

  } catch (erro) {
    throw new Error(erro.message || 'Não foi possível salvar o cadastro.');
  } finally {
    lock.releaseLock();
  }
}


/**
 * Localiza o aluno por CPF ou nome.
 * Caso não exista, cria uma nova linha na DimAluno.
 */
function localizarOuCadastrarAluno(aba, formulario) {
  const dados = aba.getDataRange().getValues();
  const cabecalhos = dados[0];
  const mapa = criarMapaCabecalhos(cabecalhos);

  const indiceId = localizarIndiceCabecalho(mapa, ['ID_ALUNO']);
  const indiceNome = localizarIndiceCabecalho(mapa, ['NOME_ALUNO']);
  const indiceCpf = localizarIndiceCabecalho(mapa, ['CPF']);

  if (indiceId === -1 || indiceNome === -1) {
    throw new Error(
      'A DimAluno precisa ter as colunas ID_ALUNO e NOME_ALUNO.'
    );
  }

  const nomeNormalizado = normalizarTexto(formulario.nomeAluno);
  const cpfNormalizado = somenteNumeros(formulario.cpf);

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];

    const idAluno = String(linha[indiceId] || '').trim();
    const nomePlanilha = normalizarTexto(linha[indiceNome]);

    const cpfPlanilha =
      indiceCpf >= 0
        ? somenteNumeros(linha[indiceCpf])
        : '';

    const encontrouPorCpf =
      cpfNormalizado &&
      cpfPlanilha &&
      cpfNormalizado === cpfPlanilha;

    const encontrouPorNome =
      nomeNormalizado &&
      nomeNormalizado === nomePlanilha;

    if (encontrouPorCpf || encontrouPorNome) {
      return {
        idAluno,
        novoAluno: false
      };
    }
  }

  const idAluno = calcularProximoIdDeDados_(
    dados,
    indiceId,
    CONFIG.PREFIXOS.ALUNO
  );

  const dadosAluno = {
    ID_ALUNO: idAluno,
    NOME_ALUNO: formulario.nomeAluno,
    NOME_SOCIAL: formulario.nomeSocial,
    DATA_NASCIMENTO: converterData(formulario.dataNascimento),
    EMAIL: formulario.email,
    CPF: formatarCpf(formulario.cpf),
    'TELEFONE ALUNO': formulario.telefoneAluno,
    'TELEFONE RESPONSAVEL': formulario.telefoneResponsavel,
    NOME_RESPONSAVEL: formulario.nomeResponsavel,
    ENDERECO: formulario.endereco,
    OBSERVACAO: formulario.observacao
  };

  adicionarLinhaPorCabecalho(aba, dadosAluno);

  return {
    idAluno,
    novoAluno: true
  };
}


/**
 * Impede matrícula duplicada na mesma turma.
 */
function verificarMatriculaDuplicada(aba, idAluno, turma) {
  const dados = aba.getDataRange().getValues();

  if (dados.length < 2) {
    return;
  }

  const mapa = criarMapaCabecalhos(dados[0]);

  const indiceIdAluno = localizarIndiceCabecalho(mapa, ['ID_ALUNO']);
  const indiceTurma = localizarIndiceCabecalho(mapa, ['TURMA']);
  const indiceStatus = localizarIndiceCabecalho(mapa, ['STATUS']);

  if (indiceIdAluno === -1 || indiceTurma === -1) {
    return;
  }

  const turmaNormalizada = normalizarTexto(turma);

  const statusEncerrados = [
    'CANCELADO',
    'CANCELADA',
    'FINALIZADO',
    'FINALIZADA',
    'ABANDONO'
  ];

  const duplicada = dados.slice(1).some(linha => {
    const mesmoAluno =
      String(linha[indiceIdAluno] || '').trim() === idAluno;

    const mesmaTurma =
      normalizarTexto(linha[indiceTurma]) === turmaNormalizada;

    const status =
      indiceStatus >= 0
        ? normalizarTexto(linha[indiceStatus])
        : 'ATIVO';

    const estaEncerrada = statusEncerrados.includes(status);

    return mesmoAluno && mesmaTurma && !estaEncerrada;
  });

  if (duplicada) {
    throw new Error(
      'O aluno já possui uma matrícula ativa nessa turma.'
    );
  }
}


/**
 * Adiciona uma linha respeitando a ordem dos cabeçalhos.
 */
function adicionarLinhaPorCabecalho(aba, objetoDados) {
  const ultimaColuna = aba.getLastColumn();

  if (ultimaColuna === 0) {
    throw new Error(
      `A aba ${aba.getName()} não possui cabeçalhos.`
    );
  }

  const cabecalhos = aba
    .getRange(1, 1, 1, ultimaColuna)
    .getValues()[0];

  const mapaDados = {};

  Object.keys(objetoDados).forEach(chave => {
    mapaDados[normalizarCabecalho(chave)] = objetoDados[chave];
  });

  const novaLinha = cabecalhos.map(cabecalho => {
    const chaveNormalizada = normalizarCabecalho(cabecalho);

    return Object.prototype.hasOwnProperty.call(
      mapaDados,
      chaveNormalizada
    )
      ? mapaDados[chaveNormalizada]
      : '';
  });

  aba.appendRow(novaLinha);
}


/**
 * Gera o próximo ID com base no maior número encontrado.
 */
function gerarProximoId(aba, nomeColuna, prefixo) {
  const dados = aba.getDataRange().getValues();

  if (dados.length === 0) {
    throw new Error(
      `A aba ${aba.getName()} não possui cabeçalhos.`
    );
  }

  const mapa = criarMapaCabecalhos(dados[0]);
  const indice = localizarIndiceCabecalho(mapa, [nomeColuna]);

  if (indice === -1) {
    throw new Error(
      `A coluna ${nomeColuna} não foi encontrada na aba ${aba.getName()}.`
    );
  }

  return calcularProximoIdDeDados_(dados, indice, prefixo);
}


/**
 * Calcula o próximo ID a partir de dados já carregados em memória,
 * evitando uma nova leitura da planilha quando o chamador já tem
 * os dados em mãos (ex.: localizarOuCadastrarAluno).
 */
function calcularProximoIdDeDados_(dados, indice, prefixo) {
  let maiorNumero = 0;

  dados.slice(1).forEach(linha => {
    const valor = String(linha[indice] || '').trim();

    const numero = Number(
      valor
        .replace(prefixo, '')
        .replace(/\D/g, '')
    );

    if (!isNaN(numero) && numero > maiorNumero) {
      maiorNumero = numero;
    }
  });

  return prefixo +
    String(maiorNumero + 1).padStart(
      CONFIG.TAMANHO_ID,
      '0'
    );
}


/**
 * Valida os campos obrigatórios.
 */
function validarFormulario(formulario) {
  if (!formulario) {
    throw new Error('Nenhum dado foi enviado.');
  }

  if (!String(formulario.nomeAluno || '').trim()) {
    throw new Error('Informe o nome do aluno.');
  }

  if (!String(formulario.turma || '').trim()) {
    throw new Error('Selecione uma turma.');
  }

  if (!formulario.dataMatricula) {
    throw new Error('Informe a data da matrícula.');
  }

  if (
    formulario.cpf &&
    somenteNumeros(formulario.cpf).length !== 11
  ) {
    throw new Error('O CPF informado é inválido.');
  }
}


/**
 * Cria um mapa dos cabeçalhos da planilha.
 */
function criarMapaCabecalhos(cabecalhos) {
  const mapa = {};

  cabecalhos.forEach((cabecalho, indice) => {
    mapa[normalizarCabecalho(cabecalho)] = indice;
  });

  return mapa;
}


/**
 * Localiza o índice de uma coluna.
 */
function localizarIndiceCabecalho(mapa, possibilidades) {
  for (const nome of possibilidades) {
    const chave = normalizarCabecalho(nome);

    if (Object.prototype.hasOwnProperty.call(mapa, chave)) {
      return mapa[chave];
    }
  }

  return -1;
}


/**
 * Normaliza cabeçalhos.
 */
function normalizarCabecalho(valor) {
  return normalizarTexto(valor)
    .replace(/[^A-Z0-9]/g, '');
}


/**
 * Normaliza textos para comparação.
 */
function normalizarTexto(valor) {
  return String(valor || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}


/**
 * Mantém somente números.
 */
function somenteNumeros(valor) {
  return String(valor || '').replace(/\D/g, '');
}


/**
 * Formata CPF.
 */
function formatarCpf(valor) {
  const numeros = somenteNumeros(valor);

  if (numeros.length !== 11) {
    return String(valor || '').trim();
  }

  return numeros.replace(
    /(\d{3})(\d{3})(\d{3})(\d{2})/,
    '$1.$2.$3-$4'
  );
}


/**
 * Converte uma data HTML para Date.
 */
function converterData(valor) {
  if (!valor) {
    return '';
  }

  const partes = String(valor).split('-');

  if (partes.length !== 3) {
    return valor;
  }

  const ano = Number(partes[0]);
  const mes = Number(partes[1]) - 1;
  const dia = Number(partes[2]);

  return new Date(ano, mes, dia);
}


/**
 * Converte valores monetários do formato brasileiro.
 */
function converterNumero(valor) {
  if (
    valor === null ||
    valor === undefined ||
    String(valor).trim() === ''
  ) {
    return '';
  }

  const texto = String(valor)
    .replace(/\s/g, '')
    .replace('R$', '')
    .replace(/\./g, '')
    .replace(',', '.');

  const numero = Number(texto);

  return isNaN(numero) ? '' : numero;
}
function formatarDataParaExibicao(valor) {
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

  return String(valor).trim();
}
