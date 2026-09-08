/**
 * SIGA — Análises: cartão "Alunos e matrículas ativas por mês" e a
 * reconciliação do gráfico "Matrículas vs. cancelamentos" com a DimMatricula.
 *
 * COMO INSTALAR
 * No editor do Apps Script: + → Script → nome "AnalisesMovimentacao" →
 * cole este arquivo inteiro. Não apague nada de Analises.gs: nenhuma
 * função daqui tem o mesmo nome de uma que já existe.
 *
 *
 * POR QUE O CARTÃO ESTAVA VAZIO
 *
 * A tela chama obterMovimentacaoTurmaAnalisesSIGA e exige, de cada mês,
 * dois campos:
 *
 *     x.alunosAtivos      alunos ÚNICOS ativos no mês
 *     x.matriculasAtivas  linhas de matrícula ativas no mês
 *
 * O endpoint que está no Analises.gs devolve só `ativos` — que é a
 * contagem de LINHAS, não de pessoas. Falta `matriculasAtivas`, então a
 * validação da tela reprova a resposta inteira e mostra
 * "O backend ainda não enviou a contagem de matrículas".
 *
 * A tela está certa em recusar: um aluno em duas turmas é 1 aluno e 2
 * matrículas. Exibir o mesmo número nas duas séries seria mentira, e
 * exibir zero seria pior.
 *
 * A correção vem com NOME NOVO (…V2…) de propósito: assim você não
 * precisa apagar a função antiga de um arquivo de 1.700 linhas. A antiga
 * fica no projeto sem ser chamada por ninguém.
 */


/**
 * Entradas, saídas, alunos únicos e matrículas ativas por mês —
 * opcionalmente de UMA turma.
 *
 * Fora do cache de Análises de propósito: lê só a DimMatricula (nada de
 * TodosBoletos), roda em segundos e reflete o cadastro de agora, sem
 * esperar o recálculo de 6 horas.
 *
 * Entrada = matrícula cuja data de início cai no mês.
 * Saída   = matrícula cuja data de encerramento cai no mês.
 *
 * Matrícula encerrada SEM data de encerramento não entra em mês nenhum —
 * não há como saber quando saiu. O total volta em `saidasSemData` para a
 * tela avisar em vez de fingir que o histórico está completo.
 */
function obterMovimentacaoTurmaV2AnalisesSIGA(filtros) {
  filtros = filtros || {};
  validarPermissaoPagamentosSIGA_(filtros.token);

  const meses = Math.max(1, Math.min(36, Number(filtros.meses || 12)));
  const turmaAlvo = String(filtros.turma || '').trim();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const matriculas = lerMatriculasPagUnif_(ss.getSheetByName('DimMatricula'));

  const periodos = analisesGerarPeriodos_(meses);

  /*
   * Um Set de alunos por mês, não um contador: é o que separa "quantas
   * pessoas" de "quantas matrículas". Sem isso, um aluno matriculado em
   * teatro e em formação apareceria como duas pessoas.
   */
  const porMes = new Map();
  const limites = periodos.map(p => {
    const { chave } = analisesMesRotulo_(p);
    porMes.set(chave, {
      entradas: 0,
      saidas: 0,
      matriculasAtivas: 0,
      alunos: new Set()
    });
    return {
      chave,
      inicio: p,
      fim: new Date(p.getFullYear(), p.getMonth() + 1, 0, 23, 59, 59, 999)
    };
  });

  const turmas = new Set();
  let saidasSemData = 0;

  matriculas.forEach(m => {
    const turma = String(m.turma || '').trim();
    if (turma) turmas.add(turma);
    if (turmaAlvo && turma !== turmaAlvo) return;

    const aluno = analisesChaveAlunoMovimentacaoV2_(m);

    if (m.inicio instanceof Date) {
      const registro = porMes.get(analisesMesRotulo_(m.inicio).chave);
      if (registro) registro.entradas++;
    }

    if (m.fim instanceof Date) {
      const registro = porMes.get(analisesMesRotulo_(m.fim).chave);
      if (registro) registro.saidas++;
    } else if (!analisesEmCursoMovimentacaoV2_(m)) {
      saidasSemData++;
    }

    limites.forEach(lim => {
      if (!analisesAtivoNoMesV2_(m, lim.inicio, lim.fim)) return;
      const registro = porMes.get(lim.chave);
      registro.matriculasAtivas++;
      if (aluno) registro.alunos.add(aluno);
    });
  });

  const serie = periodos.map(p => {
    const { chave, rotulo } = analisesMesRotulo_(p);
    const registro = porMes.get(chave);
    return {
      periodo: rotulo,
      alunosAtivos: registro.alunos.size,
      matriculasAtivas: registro.matriculasAtivas,
      // Mantido pelo nome antigo para não quebrar nada que ainda leia
      // `ativos`. É a contagem de LINHAS, igual a matriculasAtivas.
      ativos: registro.matriculasAtivas,
      entradas: registro.entradas,
      saidas: registro.saidas,
      saldo: registro.entradas - registro.saidas
    };
  });

  return {
    sucesso: true,
    turma: turmaAlvo,
    turmas: Array.from(turmas).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    serie,
    saidasSemData
  };
}

/**
 * Identidade do aluno para contar pessoas únicas.
 *
 * ID_ALUNO manda quando existe. Sem ele, o nome normalizado — imperfeito
 * (dois homônimos viram um), mas melhor que contar a mesma pessoa duas
 * vezes só porque ela está em duas turmas.
 */
function analisesChaveAlunoMovimentacaoV2_(m) {
  const id = String(m && m.idAluno || '').trim();
  if (id) return 'ID:' + id;
  const nome = normalizarPagUnif_(m && m.nome || '');
  return nome ? 'NOME:' + nome : '';
}

/** Matrícula que ainda não é uma saída: em curso, em espera ou suspensa. */
function analisesEmCursoMovimentacaoV2_(m) {
  const status = normalizarPagUnif_(m && m.status || '');
  return status === 'ATIVO' || status === 'ATIVA'
    || status === 'EM ESPERA'
    || status === 'SUSPENSO' || status === 'SUSPENSA';
}

/**
 * A matrícula estava ativa NAQUELE mês?
 *
 * Conta por VIGÊNCIA, não pelo status de hoje. É a diferença para
 * calcularSerieMatriculasAnalisesSIGA_, que exige status ativo AGORA —
 * por isso lá quem já saiu some até dos meses em que ainda estava na
 * turma, e a série histórica fica menor do que foi de verdade.
 *
 * Sem data de fim não dá para saber quando saiu: aí o status atual decide.
 */
function analisesAtivoNoMesV2_(m, inicioMes, fimMes) {
  if (!m || !(m.inicio instanceof Date)) return false;
  if (m.inicio > fimMes) return false;
  if (m.fim instanceof Date) return m.fim >= inicioMes;
  return analisesEmCursoMovimentacaoV2_(m);
}


/* =========================================================
 * RECONCILIAÇÃO — "os valores do gráfico não batem com a DimMatricula"
 *
 * Rode analisesReconciliarMatriculasSIGA(12) pelo editor do Apps Script e
 * leia o JSON. Ele responde as três perguntas, mês a mês, sem chute:
 *
 *   1. O que a DimMatricula tem de verdade (linha crua, sem nenhum filtro).
 *   2. O que o sistema consegue LER dela (lerMatriculasPagUnif_ descarta
 *      linha sem NOME_ALUNO ou sem TURMA — se sobrar diferença aqui, é
 *      cadastro, não código).
 *   3. O que o gráfico está MOSTRANDO (lido do AnalisesCache_Geral, que é
 *      de onde a tela tira os números).
 *
 * Se 1 ≠ 2 → falta preencher nome/turma em algumas linhas.
 * Se 2 ≠ 3 → o cache está velho (recalcule) ou a correção do TIPO/STATUS
 *            não está valendo (veja diagnosticarInstalacaoCorrecoesSIGA).
 * ========================================================= */

function analisesReconciliarMatriculasSIGA(meses) {
  const janela = Math.max(1, Math.min(36, Number(meses) || 12));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName('DimMatricula');
  if (!aba || aba.getLastRow() < 2) {
    throw new Error('DimMatricula não encontrada ou vazia.');
  }

  const dados = aba.getDataRange().getValues();
  const mapa = mapaGenericoPagUnif_(dados[0]);
  const periodos = analisesGerarPeriodos_(janela);

  const linhasPorMes = new Map();
  periodos.forEach(p => {
    linhasPorMes.set(analisesMesRotulo_(p).chave, {
      mes: analisesMesRotulo_(p).rotulo,
      dimEntradasQualquerTipo: 0,
      dimEntradasTipoValido: 0,
      dimEntradasPorDataDeEdicao: 0,
      dimSaidasQualquerStatus: 0,
      dimSaidasStatusValido: 0,
      lidasEntradas: 0,
      lidasSaidas: 0
    });
  });

  const tipos = new Map();
  const status = new Map();
  let linhasTotais = 0;
  let descartadasSemNome = 0;
  let descartadasSemTurma = 0;
  let tipoEmBranco = 0;
  let semDataEfetivoTurma = 0;
  let saidasSemDataForaDoGrafico = 0;

  const contar = (mapaContagem, valor, entra) => {
    const chave = String(valor || '').trim() || '(em branco)';
    if (!mapaContagem.has(chave)) {
      mapaContagem.set(chave, { valor: chave, linhas: 0, contaNoGrafico: entra ? 'SIM' : 'NAO' });
    }
    mapaContagem.get(chave).linhas++;
  };

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];

    const nome = String(campoPagUnif_(linha, mapa, ['NOME_ALUNO', 'NOME ALUNO']) || '').trim();
    const turma = String(campoPagUnif_(linha, mapa, ['TURMA']) || '').trim();
    // Linha totalmente vazia no fim da aba não é dado; não entra na conta.
    if (!nome && !turma && !String(campoPagUnif_(linha, mapa, ['ID_MATRICULA']) || '').trim()) {
      continue;
    }
    linhasTotais++;

    const tipoBruto = campoPagUnif_(linha, mapa, [
      'TIPO_MATRICULA/ALTERACAO', 'TIPO_MATRICULA', 'TIPO DE MATRÍCULA'
    ]);
    const statusBruto = campoPagUnif_(linha, mapa, ['STATUS']);

    if (!String(tipoBruto || '').trim()) tipoEmBranco++;

    contar(tipos, tipoBruto, analisesTipoEntradaMatricula_(tipoBruto));
    contar(status, statusBruto, analisesStatusSaidaMatricula_(statusBruto));

    const dataEfetivo = parseDataPagUnif_(
      campoPagUnif_(linha, mapa, ['DATA_EFETIVO_TURMA', 'DATA EFETIVO TURMA'])
    );
    const dataAlteracao = parseDataPagUnif_(
      campoPagUnif_(linha, mapa, ['DATA_ALTERACAO/MATRICULA', 'DATA ALTERACAO/MATRICULA'])
    );
    // Mesma precedência de lerMatriculasPagUnif_.
    const inicio = dataEfetivo || dataAlteracao;
    if (!dataEfetivo) semDataEfetivoTurma++;

    const fim = parseDataPagUnif_(campoPagUnif_(linha, mapa, [
      'DATA_CANCELAMENTO/FINALIZACAO', 'DATA CANCELAMENTO/FINALIZACAO'
    ]));

    // É esta a linha que lerMatriculasPagUnif_ deixaria passar?
    const lida = !!(nome && turma);
    if (!nome) descartadasSemNome++;
    else if (!turma) descartadasSemTurma++;

    if (inicio) {
      const registro = linhasPorMes.get(analisesMesRotulo_(inicio).chave);
      if (registro) {
        registro.dimEntradasQualquerTipo++;
        if (analisesTipoEntradaMatricula_(tipoBruto)) {
          registro.dimEntradasTipoValido++;
          if (!dataEfetivo) registro.dimEntradasPorDataDeEdicao++;
          if (lida) registro.lidasEntradas++;
        }
      }
    }

    if (fim) {
      const registro = linhasPorMes.get(analisesMesRotulo_(fim).chave);
      if (registro) {
        registro.dimSaidasQualquerStatus++;
        if (analisesStatusSaidaMatricula_(statusBruto)) {
          registro.dimSaidasStatusValido++;
          if (lida) registro.lidasSaidas++;
        }
      }
    } else if (analisesStatusSaidaMatricula_(statusBruto)) {
      saidasSemDataForaDoGrafico++;
    }
  }

  // O que a TELA mostra hoje: vem do cache, não deste cálculo.
  const cache = analisesLerCacheGeral_();
  const hoje = analisesMesRotulo_(new Date()).chave;

  const linhas = Array.from(linhasPorMes.entries()).map(([chave, r]) => {
    const noCache = cache.get(chave);
    const graficoEntradas = noCache ? Number(noCache.novas || 0) : null;
    const graficoSaidas = noCache ? Number(noCache.canceladas || 0) : null;
    const alertas = [];

    if (r.dimEntradasQualquerTipo !== r.dimEntradasTipoValido) {
      alertas.push((r.dimEntradasQualquerTipo - r.dimEntradasTipoValido) +
        ' entrada(s) da DimMatricula com TIPO fora de ATIVAÇÃO/NOVA/UPGRADE');
    }
    if (r.dimEntradasTipoValido !== r.lidasEntradas) {
      alertas.push((r.dimEntradasTipoValido - r.lidasEntradas) +
        ' linha(s) descartada(s) por falta de NOME_ALUNO ou TURMA');
    }
    if (graficoEntradas !== null && graficoEntradas !== r.lidasEntradas) {
      alertas.push('CACHE DIVERGENTE nas entradas: gráfico ' + graficoEntradas +
        ' x recalculado agora ' + r.lidasEntradas);
    }
    if (graficoSaidas !== null && graficoSaidas !== r.lidasSaidas) {
      alertas.push('CACHE DIVERGENTE nas saídas: gráfico ' + graficoSaidas +
        ' x recalculado agora ' + r.lidasSaidas);
    }
    if (r.dimEntradasPorDataDeEdicao > 0) {
      alertas.push(r.dimEntradasPorDataDeEdicao +
        ' entrada(s) datada(s) por DATA_ALTERACAO/MATRICULA (sem DATA_EFETIVO_TURMA)');
    }
    if (chave === hoje) alertas.push('MÊS EM CURSO — ainda vai crescer');

    return {
      mes: r.mes,
      dimMatricula: {
        entradasQualquerTipo: r.dimEntradasQualquerTipo,
        entradasComTipoValido: r.dimEntradasTipoValido,
        saidasQualquerStatus: r.dimSaidasQualquerStatus,
        saidasComStatusValido: r.dimSaidasStatusValido
      },
      recalculadoAgora: { entradas: r.lidasEntradas, saidas: r.lidasSaidas },
      noGraficoHoje: { entradas: graficoEntradas, saidas: graficoSaidas },
      alertas
    };
  });

  const diagnostico = {
    janelaMeses: janela,
    atualizadoEmDoCache:
      PropertiesService.getScriptProperties().getProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM) || '(nunca)',
    linhasNaDimMatricula: linhasTotais,
    linhasQueOSistemaNaoLe: {
      semNomeAluno: descartadasSemNome,
      semTurma: descartadasSemTurma
    },
    tipoEmBranco: tipoEmBranco,
    semDataEfetivoTurma: semDataEfetivoTurma,
    saidasSemDataForaDoGrafico: saidasSemDataForaDoGrafico,
    tiposEncontrados: Array.from(tipos.values()).sort((a, b) => b.linhas - a.linhas),
    statusEncontrados: Array.from(status.values()).sort((a, b) => b.linhas - a.linhas),
    meses: linhas
  };

  console.log(JSON.stringify(diagnostico, null, 2));
  return diagnostico;
}


/**
 * "De onde saiu esse número?" — lista NOME por NOME as matrículas que o
 * gráfico contou como entrada num mês.
 *
 * Uso, no editor do Apps Script:
 *     listarEntradasDoMesSIGA('2026-09')
 *
 * Devolve a lista e, no fim, a conferência com a célula que a tela lê
 * (AnalisesCache_Geral, coluna Novas). Se a lista tiver 57 linhas e o
 * cache disser 57, o número é esse mesmo e o assunto vira "essas 57
 * linhas estão certas no cadastro?". Se divergir, o cache está velho:
 * rode recalcularCacheAnalisesSIGA().
 *
 * Cada linha mostra QUAL data foi usada. `dataUsada: 'DATA_ALTERACAO'`
 * quer dizer que a matrícula caiu neste mês porque a LINHA foi editada
 * neste mês — não porque o aluno entrou nele.
 */
function listarEntradasDoMesSIGA(chaveMes) {
  const alvo = String(chaveMes || '').trim();
  if (!/^\d{4}-\d{2}$/.test(alvo)) {
    throw new Error('Informe o mês no formato aaaa-mm. Ex.: listarEntradasDoMesSIGA("2026-09")');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName('DimMatricula');
  if (!aba || aba.getLastRow() < 2) throw new Error('DimMatricula não encontrada ou vazia.');

  const dados = aba.getDataRange().getValues();
  const mapa = mapaGenericoPagUnif_(dados[0]);
  const fusoDaPlanilha = Session.getScriptTimeZone();
  const dia = d => d ? Utilities.formatDate(d, fusoDaPlanilha, 'dd/MM/yyyy') : '';

  const entradas = [];
  const forasPorTipo = [];
  const forasPorCadastro = [];

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const nome = String(campoPagUnif_(linha, mapa, ['NOME_ALUNO', 'NOME ALUNO']) || '').trim();
    const turma = String(campoPagUnif_(linha, mapa, ['TURMA']) || '').trim();
    const tipo = String(campoPagUnif_(linha, mapa, [
      'TIPO_MATRICULA/ALTERACAO', 'TIPO_MATRICULA', 'TIPO DE MATRÍCULA'
    ]) || '').trim();
    const status = String(campoPagUnif_(linha, mapa, ['STATUS']) || '').trim();

    const dataEfetivo = parseDataPagUnif_(
      campoPagUnif_(linha, mapa, ['DATA_EFETIVO_TURMA', 'DATA EFETIVO TURMA'])
    );
    const dataAlteracao = parseDataPagUnif_(
      campoPagUnif_(linha, mapa, ['DATA_ALTERACAO/MATRICULA', 'DATA ALTERACAO/MATRICULA'])
    );
    const inicio = dataEfetivo || dataAlteracao;
    if (!inicio || analisesMesRotulo_(inicio).chave !== alvo) continue;

    const registro = {
      linhaNaPlanilha: i + 1,
      nome: nome || '(sem nome)',
      turma: turma || '(sem turma)',
      tipo: tipo || '(em branco)',
      status: status || '(em branco)',
      dataUsada: dataEfetivo ? 'DATA_EFETIVO_TURMA' : 'DATA_ALTERACAO',
      dataEfetivoTurma: dia(dataEfetivo),
      dataAlteracao: dia(dataAlteracao)
    };

    // O sistema descarta a linha inteira antes de qualquer conta.
    if (!nome || !turma) {
      forasPorCadastro.push(registro);
      continue;
    }
    // Passa no cadastro, mas o TIPO não é entrada.
    if (!analisesTipoEntradaMatricula_(tipo)) {
      forasPorTipo.push(registro);
      continue;
    }
    entradas.push(registro);
  }

  const noCache = analisesLerCacheGeral_().get(alvo);
  const contaDoGrafico = noCache ? Number(noCache.novas || 0) : null;
  const comFiltroDeTipo = entradas.length;
  const semFiltroDeTipo = entradas.length + forasPorTipo.length;

  let veredito;
  if (contaDoGrafico === null) {
    veredito = 'O mês ' + alvo + ' não existe no AnalisesCache_Geral — a tela mostraria 0.';
  } else if (contaDoGrafico === comFiltroDeTipo) {
    veredito = 'BATE com o filtro de TIPO. O gráfico está contando o que promete.';
  } else if (contaDoGrafico === semFiltroDeTipo) {
    veredito = 'BATE com a conta SEM filtro de TIPO (' + semFiltroDeTipo + '). ' +
      'A legenda diz ATIVAÇÃO/NOVA/UPGRADE, mas a versão antiga de ' +
      'calcularSerieMatriculasAnalisesSIGA_ ainda está valendo. ' +
      'Apague a antiga do Analises.gs e rode recalcularCacheAnalisesSIGA().';
  } else {
    veredito = 'NÃO bate com nenhuma das duas contas — o cache está velho. ' +
      'Rode recalcularCacheAnalisesSIGA() e repita.';
  }

  const resultado = {
    mes: alvo,
    contaQueATelaMostra: contaDoGrafico,
    recalculadoAgoraComFiltroDeTipo: comFiltroDeTipo,
    recalculadoAgoraSemFiltroDeTipo: semFiltroDeTipo,
    veredito,
    cacheAtualizadoEm:
      PropertiesService.getScriptProperties().getProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM) || '(nunca)',
    entradasContadas: entradas,
    // Caíram no mês, mas o TIPO não é entrada.
    ignoradasPeloTipo: forasPorTipo,
    // Nem chegaram a ser lidas: falta NOME_ALUNO ou TURMA.
    ignoradasPorCadastroIncompleto: forasPorCadastro,
    entrouPelaDataDeEdicao: entradas.filter(x => x.dataUsada === 'DATA_ALTERACAO').length
  };

  console.log(JSON.stringify(resultado, null, 2));
  return resultado;
}
