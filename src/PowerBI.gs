/**
 * SIGA — Conexão com o Power BI
 *
 * Expõe os dados do SIGA como JSON num endpoint público do próprio Web
 * App (o mesmo /exec já publicado), pra que o Power BI Desktop/Service
 * consuma com o conector "Web" — sem precisar dar acesso à planilha pra
 * ninguém e sem exportar arquivo na mão.
 *
 *   .../exec?pagina=powerbi&token=<TOKEN>&dataset=<NOME>
 *
 * Sem "dataset" (ou com dataset=catalogo) devolve o catálogo com todos
 * os conjuntos disponíveis — é por ele que se começa no Power BI.
 *
 * POR QUE JSON E NÃO A PLANILHA DIRETO:
 * conectar o Power BI na planilha exigiria compartilhar a planilha
 * inteira (inclusive CPF, abas de pagamento e as abas operacionais) com
 * a conta que faz a atualização. Aqui o token controla o acesso, e só
 * sai o que está declarado em POWERBI_DATASETS.
 *
 * FORMATO DA RESPOSTA (sempre o mesmo, pra facilitar do lado do BI):
 *   {
 *     "dataset": "dimMatricula",
 *     "geradoEm": "2026-09-06T12:00:00.000Z",
 *     "atualizadoEm": "...",   // só nos datasets vindos do cache de Análises
 *     "total": 1234,           // linhas disponíveis no dataset inteiro
 *     "offset": 0,
 *     "limite": 0,             // 0 = sem paginação
 *     "temMais": false,        // true quando ainda há página seguinte
 *     "colunas": ["ID_ALUNO", ...],
 *     "linhas": [ { "ID_ALUNO": "ALU-00001", ... } ]
 *   }
 *
 * Datas saem SEMPRE como texto ISO (yyyy-MM-dd) e números como número
 * de verdade — sem isso o Power BI interpreta "01/02/2026" conforme a
 * localidade do arquivo .pbix e troca dia por mês silenciosamente.
 */

const TOKEN_POWERBI = 'POWERBI-GE-2026';

/**
 * Datasets publicados. Cada entrada é uma aba da planilha; "colunas"
 * vazio significa "todas as colunas da aba, com o nome do cabeçalho".
 *
 * - aba: nome fixo da aba, ou função que devolve a aba (usado no
 *   TodosBoletos, cuja aba é resolvida por Pagamentos.gs).
 * - colunas: quando preenchido, limita e renomeia o que é publicado —
 *   é o filtro que impede um dado novo na planilha de vazar sem
 *   ninguém decidir.
 * - derivar: função opcional que ajusta/acrescenta campos por linha.
 * - cacheAnalises: marca os datasets que vêm das abas AnalisesCache_*,
 *   pra garantir o cache antes de responder e informar atualizadoEm.
 */
const POWERBI_DATASETS = {
  dimAluno: {
    descricao: 'Cadastro de alunos (DimAluno).',
    aba: 'DimAluno'
  },

  dimTurma: {
    descricao: 'Cadastro de turmas (DimTurma).',
    aba: 'DimTurma'
  },

  dimMatricula: {
    descricao: 'Matrículas, com status, datas e valores (DimMatricula).',
    aba: 'DimMatricula'
  },

  fatoComprovantePagamento: {
    descricao: 'Comprovantes de pagamento lançados pela secretaria.',
    aba: 'Comprovante de pagamento'
  },

  fatoPagamentoProfessor: {
    descricao: 'Custo de professor por aula (Pagamentos Professores).',
    aba: 'Pagamentos Professores'
  },

  fatoBoleto: {
    descricao: 'Boletos emitidos (TodosBoletos). Aba grande — use limite/offset.',
    aba: powerBIAbaTodosBoletos_
  },

  fatoResumoMensal: {
    descricao: 'Série mensal consolidada: ativos, novas, cancelamentos e receita.',
    aba: 'AnalisesCache_Geral',
    cacheAnalises: true,
    colunas: [
      { origem: 'Mes', nome: 'Mes' },
      { origem: 'Ativos', nome: 'Ativos', tipo: 'numero' },
      { origem: 'Novas', nome: 'Novas', tipo: 'numero' },
      { origem: 'Cancelamentos', nome: 'Cancelamentos', tipo: 'numero' },
      { origem: 'Receita', nome: 'Receita', tipo: 'numero' }
    ],
    derivar: function (linha) {
      linha.Saldo = Number(linha.Novas || 0) - Number(linha.Cancelamentos || 0);
      linha.PrimeiroDiaMes = powerBIChaveMesParaData_(linha.Mes);
      return linha;
    }
  },

  fatoTurmaMes: {
    descricao: 'Receita paga e custo de professor por turma e mês, com o lucro já calculado.',
    aba: 'AnalisesCache_Turma',
    cacheAnalises: true,
    colunas: [
      { origem: 'Mes', nome: 'Mes' },
      { origem: 'Turma', nome: 'Turma' },
      { origem: 'Receita', nome: 'Receita', tipo: 'numero' },
      { origem: 'CustoProfessor', nome: 'CustoProfessor', tipo: 'numero' }
    ],
    derivar: function (linha) {
      linha.Lucro = Number(linha.Receita || 0) - Number(linha.CustoProfessor || 0);
      linha.PrimeiroDiaMes = powerBIChaveMesParaData_(linha.Mes);
      return linha;
    }
  },

  dimTurmaIndicadores: {
    descricao: 'Indicadores por turma: ativos, saídas, taxa de evasão e frequência média.',
    aba: 'AnalisesCache_ComparativoTurmas',
    cacheAnalises: true,
    colunas: [
      { origem: 'Turma', nome: 'Turma' },
      { origem: 'Ativos', nome: 'Ativos', tipo: 'numero' },
      { origem: 'Saidas', nome: 'Saidas', tipo: 'numero' },
      { origem: 'Total', nome: 'Total', tipo: 'numero' },
      { origem: 'TaxaEvasao', nome: 'TaxaEvasao', tipo: 'numero' },
      { origem: 'FrequenciaMedia', nome: 'FrequenciaMedia', tipo: 'numero' }
    ]
  },

  fatoPagamentoAluno: {
    descricao: 'Valor efetivamente pago por aluno, mês e turma.',
    aba: 'AnalisesCache_PagamentoAluno',
    cacheAnalises: true,
    colunas: [
      { origem: 'ChaveAlunoMes', nome: 'ChaveAlunoMes' },
      { origem: 'Turma', nome: 'Turma' },
      { origem: 'Valor', nome: 'Valor', tipo: 'numero' }
    ],
    // A aba guarda aluno e mês grudados numa chave só ("chaveAluno|yyyy-MM").
    // O Power BI precisa deles separados pra relacionar com o calendário.
    derivar: function (linha) {
      const partes = String(linha.ChaveAlunoMes || '').split('|');
      linha.ChaveAluno = partes[0] || '';
      linha.Mes = partes[1] || '';
      linha.PrimeiroDiaMes = powerBIChaveMesParaData_(linha.Mes);
      return linha;
    }
  }
};


/**
 * Ponto de entrada chamado pelo doGet quando pagina=powerbi.
 * Nunca lança: erro vira JSON com "erro", senão o Power BI recebe uma
 * página HTML de exceção do Apps Script e falha com uma mensagem que
 * não ajuda ninguém a descobrir o que houve.
 */
function powerBIResponderSIGA_(e) {
  const parametro = nome => String(
    (e && e.parameter && e.parameter[nome]) || ''
  ).trim();

  try {
    if (parametro('token') !== TOKEN_POWERBI) {
      return powerBIJson_({ erro: 'Token inválido.' });
    }

    const dataset = parametro('dataset') || 'catalogo';

    if (dataset === 'catalogo') {
      return powerBIJson_(powerBICatalogo_());
    }

    const definicao = POWERBI_DATASETS[dataset];

    if (!definicao) {
      return powerBIJson_({
        erro: 'Dataset desconhecido: ' + dataset,
        datasetsDisponiveis: Object.keys(POWERBI_DATASETS)
      });
    }

    return powerBIJson_(powerBIMontarDataset_(
      dataset,
      definicao,
      Math.max(0, Number(parametro('limite')) || 0),
      Math.max(0, Number(parametro('offset')) || 0)
    ));

  } catch (erro) {
    return powerBIJson_({ erro: String((erro && erro.message) || erro) });
  }
}


/**
 * Catálogo — é o que o Power BI busca primeiro pra saber o que existe.
 */
function powerBICatalogo_() {
  return {
    sistema: 'SIGA',
    geradoEm: new Date().toISOString(),
    atualizadoEm: powerBIAtualizadoEmAnalises_(),
    comoUsar: 'Repita esta URL trocando dataset=<nome>. Opcionais: limite e offset.',
    datasets: Object.keys(POWERBI_DATASETS).map(nome => ({
      dataset: nome,
      descricao: POWERBI_DATASETS[nome].descricao
    }))
  };
}


/**
 * Lê a aba do dataset e devolve o envelope padrão.
 */
function powerBIMontarDataset_(nome, definicao, limite, offset) {
  if (definicao.cacheAnalises) {
    powerBIGarantirCacheAnalises_();
  }

  const aba = powerBIResolverAba_(definicao.aba);

  if (!aba) {
    throw new Error(
      'A aba do dataset "' + nome + '" não foi encontrada na planilha.'
    );
  }

  const valores = aba.getDataRange().getValues();
  const cabecalhos = valores.length ? valores[0] : [];

  // Descarta linha em branco (sobra de aba com formatação) ANTES de
  // paginar: se o corte fosse feito sobre as linhas cruas, uma página
  // inteira de linhas vazias voltaria sem nenhum registro e o laço de
  // atualização do Power BI pararia achando que os dados acabaram.
  const corpo = valores.slice(1).filter(linha => !powerBILinhaVazia_(linha));

  const colunas = powerBIResolverColunas_(cabecalhos, definicao.colunas);

  // Recorta ANTES de montar os objetos: em aba grande (TodosBoletos),
  // montar objeto de linha que vai ser descartado é o que mais custa.
  const total = corpo.length;
  const inicio = Math.min(offset, total);
  const fim = limite > 0 ? Math.min(inicio + limite, total) : total;

  const linhas = [];

  for (let i = inicio; i < fim; i++) {
    const bruta = corpo[i];
    const linha = {};

    colunas.forEach(coluna => {
      linha[coluna.nome] = powerBIValor_(bruta[coluna.indice], coluna.tipo);
    });

    linhas.push(definicao.derivar ? definicao.derivar(linha) : linha);
  }

  const resposta = {
    dataset: nome,
    geradoEm: new Date().toISOString(),
    total: total,
    offset: inicio,
    limite: limite,
    temMais: fim < total,
    colunas: linhas.length ? Object.keys(linhas[0]) : colunas.map(c => c.nome),
    linhas: linhas
  };

  if (definicao.cacheAnalises) {
    resposta.atualizadoEm = powerBIAtualizadoEmAnalises_();
  }

  return resposta;
}


/**
 * Casa as colunas declaradas no dataset com os cabeçalhos reais da aba.
 * Sem declaração, publica todas as colunas com cabeçalho preenchido.
 */
function powerBIResolverColunas_(cabecalhos, declaradas) {
  if (!declaradas || !declaradas.length) {
    const usados = {};

    return cabecalhos
      .map((cabecalho, indice) => ({ cabecalho, indice }))
      .filter(item => String(item.cabecalho || '').trim())
      .map(item => {
        // Cabeçalho repetido viraria uma chave só no JSON e a segunda
        // coluna sumiria sem aviso — numera a repetida.
        let nome = String(item.cabecalho).trim();

        if (usados[nome]) {
          nome = nome + '_' + (++usados[nome]);
        } else {
          usados[nome] = 1;
        }

        return { nome, indice: item.indice, tipo: 'auto' };
      });
  }

  const mapa = criarMapaCabecalhos(cabecalhos);

  return declaradas
    .map(coluna => ({
      nome: coluna.nome || coluna.origem,
      indice: localizarIndiceCabecalho(mapa, [coluna.origem]),
      tipo: coluna.tipo || 'auto'
    }))
    .filter(coluna => coluna.indice >= 0);
}


/**
 * Converte o valor da célula pro tipo que o Power BI entende sem
 * depender da localidade do arquivo .pbix.
 */
function powerBIValor_(valor, tipo) {
  if (valor === null || valor === undefined || valor === '') {
    return tipo === 'numero' ? 0 : '';
  }

  if (valor instanceof Date) {
    return Utilities.formatDate(
      valor,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );
  }

  if (tipo === 'numero') {
    const numero = Number(valor);
    return isNaN(numero) ? 0 : numero;
  }

  if (typeof valor === 'number' || typeof valor === 'boolean') {
    return valor;
  }

  return String(valor).trim();
}


/**
 * Linha totalmente em branco (sobra de aba com formatação) não vira
 * registro — no BI ela viraria uma categoria vazia em todo gráfico.
 */
function powerBILinhaVazia_(linha) {
  return linha.every(celula =>
    celula === '' || celula === null || celula === undefined
  );
}


/**
 * "2026-09" -> "2026-09-01". Dá ao Power BI uma coluna de data de
 * verdade pra relacionar com a tabela de calendário.
 */
function powerBIChaveMesParaData_(chave) {
  return /^\d{4}-\d{2}$/.test(String(chave || '')) ? chave + '-01' : '';
}


function powerBIResolverAba_(aba) {
  if (typeof aba === 'function') {
    return aba();
  }

  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(aba);
}


/**
 * A aba de boletos é resolvida por Pagamentos.gs (o nome varia entre
 * ambientes); só cai no nome fixo se aquela função não existir.
 */
function powerBIAbaTodosBoletos_() {
  if (typeof obterAbaTodosBoletosPagamentosSIGA_ === 'function') {
    return obterAbaTodosBoletosPagamentosSIGA_();
  }

  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName('TodosBoletos');
}


/**
 * Garante que as abas AnalisesCache_* existam antes de responder — sem
 * isso, a primeira atualização do Power BI feita antes do gatilho rodar
 * traria tabela vazia.
 */
function powerBIGarantirCacheAnalises_() {
  if (typeof garantirCacheAnalisesSIGA_ === 'function') {
    garantirCacheAnalisesSIGA_();
  }
}


function powerBIAtualizadoEmAnalises_() {
  // A constante vem de Analises.gs; o typeof evita que o catálogo
  // inteiro quebre caso aquele arquivo não esteja no projeto.
  const chave = typeof ANALISES_CACHE_PROP_ATUALIZADO_EM !== 'undefined'
    ? ANALISES_CACHE_PROP_ATUALIZADO_EM
    : 'ANALISES_CACHE_ATUALIZADO_EM';

  return PropertiesService
    .getScriptProperties()
    .getProperty(chave) || '';
}


function powerBIJson_(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}
