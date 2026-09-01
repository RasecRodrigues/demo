/**
 * SIGA — Análises comparativas e estratégicas
 *
 * Reaproveita os leitores e helpers já existentes no projeto
 * (lerMatriculasPagUnif_, mapaGenericoPagUnif_, parseDataPagUnif_,
 * normalizarPagUnif_, arredPagUnif_, numeroPagUnif_, obterAbaTodosBoletosPagamentosSIGA_,
 * montarBoletoPagamentosSIGA_, dataPagamentosSIGA_) definidos em Code.gs/Pagamentos.gs.
 * Não redeclara nada que já exista nesses arquivos.
 *
 * ARQUITETURA DE CACHE — por que existe:
 * Calcular os dados de Análises do zero exige varrer DimMatricula,
 * TodosBoletos (a maior aba do sistema) e Pagamentos Professores por
 * inteiro. Fazer isso a cada abertura da tela levava dezenas de segundos.
 * Em vez disso, o cálculo pesado roda em segundo plano (gatilho de tempo,
 * ver configurarGatilhoCacheAnalisesSIGA) e grava o resultado em 3 abas
 * pequenas (AnalisesCache_*). A tela só LÊ essas abas — leitura de
 * algumas dezenas/centenas de linhas é quase instantânea.
 */

const ANALISES_CACHE_SHEETS = {
  GERAL: 'AnalisesCache_Geral',
  TURMA: 'AnalisesCache_Turma',
  COMPARATIVO: 'AnalisesCache_ComparativoTurmas'
};
const ANALISES_CACHE_PROP_ATUALIZADO_EM = 'ANALISES_CACHE_ATUALIZADO_EM';
const ANALISES_CACHE_MESES_MAX = 36;

/**
 * Endpoint principal chamado pela tela. Só LÊ o cache — não faz nenhuma
 * varredura pesada. Na primeiríssima chamada (cache ainda não existe),
 * recalcula uma vez de forma síncrona (lento só dessa vez).
 */
function obterAnalisesSIGA(filtros) {
  filtros = filtros || {};
  validarPermissaoPagamentosSIGA_(filtros.token);

  const mesesJanela = Math.min(ANALISES_CACHE_MESES_MAX, Math.max(3, Number(filtros.meses) || 12));
  const periodos = analisesGerarPeriodos_(mesesJanela);
  const chaves = periodos.map(p => analisesMesRotulo_(p).chave);
  const chavesSet = new Set(chaves);

  garantirCacheAnalisesSIGA_();

  const geral = analisesLerCacheGeral_();
  const turma = analisesLerCacheTurma_();
  const comparativoBruto = analisesLerCacheComparativoTurmas_();

  const serieMatriculas = chaves.map(chave => {
    const linha = geral.get(chave);
    const novas = linha ? linha.novas : 0;
    const canceladas = linha ? linha.canceladas : 0;
    return {
      periodo: analisesChaveParaRotulo_(chave),
      novas,
      canceladas,
      ativos: linha ? linha.ativos : 0,
      saldo: novas - canceladas
    };
  });

  const serieFinanceira = chaves.map(chave => {
    const linha = geral.get(chave);
    return { periodo: analisesChaveParaRotulo_(chave), receita: linha ? linha.receita : 0 };
  });

  // Agrega lucro por turma somando só os meses dentro da janela selecionada.
  const acumuladoPorTurma = new Map();
  turma.forEach(item => {
    if (!chavesSet.has(item.mes)) {
      return;
    }
    if (!acumuladoPorTurma.has(item.turma)) {
      acumuladoPorTurma.set(item.turma, { receita: 0, custo: 0, pontos: new Map() });
    }
    const acc = acumuladoPorTurma.get(item.turma);
    acc.receita += item.receita;
    acc.custo += item.custo;
    acc.pontos.set(item.mes, { periodo: analisesChaveParaRotulo_(item.mes), receita: item.receita, custo: item.custo, lucro: item.lucro });
  });

  const resumoPorTurma = Array.from(acumuladoPorTurma.entries())
    .map(([nomeTurma, acc]) => ({
      turma: nomeTurma,
      receita: arredPagUnif_(acc.receita),
      custo: arredPagUnif_(acc.custo),
      lucro: arredPagUnif_(acc.receita - acc.custo),
      margem: acc.receita > 0 ? arredPagUnif_(((acc.receita - acc.custo) / acc.receita) * 100) : 0
    }))
    .sort((a, b) => b.lucro - a.lucro);

  // Manda mais turmas do que o gráfico vai destacar: a tela mostra as 3
  // primeiras em cor e o restante como linhas de contexto (cinza, sem
  // legenda) — assim dá pra ver a forma geral sem competir com 8+ cores.
  const serieLucroPorTurma = resumoPorTurma.slice(0, 20).map(item => {
    const acc = acumuladoPorTurma.get(item.turma);
    return {
      turma: item.turma,
      pontos: chaves.map(chave => acc.pontos.get(chave) || { periodo: analisesChaveParaRotulo_(chave), receita: 0, custo: 0, lucro: 0 })
    };
  });

  // Linha por turma x mês (não só o top 20 do gráfico) — usado pela tabela
  // "Lucro por turma no período", que mostra o detalhamento mensal completo.
  const detalheMensalLucroPorTurma = [];
  resumoPorTurma.forEach(item => {
    const acc = acumuladoPorTurma.get(item.turma);
    chaves.forEach(chave => {
      const ponto = acc.pontos.get(chave);
      const receita = ponto ? ponto.receita : 0;
      const lucro = ponto ? ponto.lucro : 0;
      detalheMensalLucroPorTurma.push({
        turma: item.turma,
        periodo: analisesChaveParaRotulo_(chave),
        lucro,
        margem: receita > 0 ? arredPagUnif_((lucro / receita) * 100) : 0
      });
    });
  });

  // Só turmas com aluno ativo — uma turma zerada não ajuda a comparação
  // nem o detalhamento, só polui a lista.
  const comparativoAtivo = comparativoBruto.filter(item => item.ativos > 0);
  const comparativoTurmas = comparativoAtivo
    .slice()
    .sort((a, b) => b.ativos - a.ativos)
    .slice(0, 30)
    .map(item => {
      const acc = acumuladoPorTurma.get(item.turma);
      return Object.assign({}, item, {
        receitaPeriodo: acc ? arredPagUnif_(acc.receita) : 0
      });
    });

  const ultimaChaveComDados = chaves.slice().reverse().find(chave => geral.has(chave));
  const alunosAtivos = ultimaChaveComDados ? geral.get(ultimaChaveComDados).ativos : 0;

  return {
    sucesso: true,
    periodos: chaves.map(analisesChaveParaRotulo_),
    mesInicial: chaves[0],
    mesFinal: chaves[chaves.length - 1],
    serieMatriculas,
    serieFinanceira,
    comparativoTurmas,
    serieLucroPorTurma,
    detalheMensalLucroPorTurma,
    atualizadoEm: PropertiesService.getScriptProperties().getProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM) || null,
    resumo: {
      alunosAtivos,
      turmasComparadas: comparativoTurmas.length,
      lucroTotalPeriodo: arredPagUnif_(resumoPorTurma.reduce((s, x) => s + Number(x.lucro || 0), 0))
    }
  };
}

/**
 * Alunos de uma turma e o quanto cada um pagou (valor devido) no período
 * selecionado — chamado sob demanda quando o usuário clica numa turma na
 * tabela de lucro. Não faz parte do cache: é um recorte de UMA turma só,
 * então é rápido o bastante para rodar na hora.
 */
function obterAlunosPagamentosPorTurmaAnalisesSIGA(filtros) {
  filtros = filtros || {};
  validarPermissaoPagamentosSIGA_(filtros.token);

  const turmaAlvo = String(filtros.turma || '').trim();
  const periodos = analisesPeriodosEntreChaves_(filtros.mesInicial, filtros.mesFinal);
  if (!turmaAlvo || !periodos.length) {
    return { sucesso: true, turma: turmaAlvo, alunos: [] };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abaMat = ss.getSheetByName('DimMatricula');
  const matriculas = lerMatriculasPagUnif_(abaMat);
  criarIndiceIdentidadePagamentosSIGA_(ss, matriculas);

  const matriculasPorAluno = new Map();
  matriculas.forEach(m => {
    const chave = m.chaveAluno || normalizarPagUnif_(m.idAluno || m.nome);
    if (!chave) return;
    if (!matriculasPorAluno.has(chave)) {
      matriculasPorAluno.set(chave, []);
    }
    matriculasPorAluno.get(chave).push(m);
  });

  const hoje = new Date();
  const inicioMesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const totalPorAluno = new Map();

  periodos.forEach(ref => {
    let dataCalculo;
    if (ref < inicioMesAtual) {
      dataCalculo = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    } else if (ref.getFullYear() === hoje.getFullYear() && ref.getMonth() === hoje.getMonth()) {
      dataCalculo = hoje;
    } else {
      dataCalculo = new Date(ref.getFullYear(), ref.getMonth(), 1);
    }

    matriculasPorAluno.forEach(matsAluno => {
      const ativas = matsAluno.filter(m =>
        normalizarPagUnif_(m.status) === 'ATIVO' && vigenteNoMesPagUnif_(m, ref)
      );
      if (!ativas.length) return;

      const matriculaDaTurma = ativas.find(m => String(m.turma || '').trim() === turmaAlvo);
      if (!matriculaDaTurma) return;

      const combo = ativas.length > 1;
      const valor = Number(calcularValorMatriculaPagUnif_(matriculaDaTurma, combo, ref, dataCalculo) || 0);
      const chaveAluno = matriculaDaTurma.chaveAluno || normalizarPagUnif_(matriculaDaTurma.idAluno || matriculaDaTurma.nome);
      const nome = matriculaDaTurma.nome || matriculaDaTurma.idAluno || '(sem nome)';

      if (!totalPorAluno.has(chaveAluno)) {
        totalPorAluno.set(chaveAluno, { aluno: nome, total: 0 });
      }
      totalPorAluno.get(chaveAluno).total += valor;
    });
  });

  const alunos = Array.from(totalPorAluno.values())
    .map(x => ({ aluno: x.aluno, total: arredPagUnif_(x.total) }))
    .sort((a, b) => b.total - a.total);

  return { sucesso: true, turma: turmaAlvo, alunos };
}

function analisesPeriodosEntreChaves_(mesInicial, mesFinal) {
  if (!mesInicial || !mesFinal) {
    return [];
  }
  const partesIni = String(mesInicial).split('-');
  const partesFim = String(mesFinal).split('-');
  let d = new Date(Number(partesIni[0]), Number(partesIni[1]) - 1, 1);
  const fim = new Date(Number(partesFim[0]), Number(partesFim[1]) - 1, 1);
  const periodos = [];
  while (d <= fim) {
    periodos.push(new Date(d));
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return periodos;
}

/**
 * Força um recálculo imediato (chamado pelo botão "Recalcular dados" da
 * tela). É a operação lenta — o usuário decide quando vale a pena esperar.
 */
function recalcularCacheAnalisesManualSIGA(filtros) {
  filtros = filtros || {};
  validarPermissaoPagamentosSIGA_(filtros.token);
  recalcularCacheAnalisesSIGA();
  return {
    sucesso: true,
    atualizadoEm: PropertiesService.getScriptProperties().getProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM)
  };
}

/**
 * Execute esta função UMA VEZ manualmente pelo editor do Apps Script
 * (selecione "configurarGatilhoCacheAnalisesSIGA" no seletor de funções,
 * ao lado do botão Executar, e rode) para agendar a atualização automática
 * do cache de Análises a cada 6 horas. Sem isso, o cache só é recalculado
 * na primeira abertura da tela ou quando alguém clica em "Recalcular dados".
 */
function configurarGatilhoCacheAnalisesSIGA() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'recalcularCacheAnalisesSIGA')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('recalcularCacheAnalisesSIGA')
    .timeBased()
    .everyHours(6)
    .create();
}

function garantirCacheAnalisesSIGA_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(ANALISES_CACHE_SHEETS.GERAL)) {
    recalcularCacheAnalisesSIGA();
  }
}

/**
 * A única função que faz a varredura pesada (DimMatricula, TodosBoletos,
 * Pagamentos Professores). Deve rodar em segundo plano via gatilho de
 * tempo — nunca no caminho de uma requisição da tela.
 */
function recalcularCacheAnalisesSIGA() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const periodos = analisesGerarPeriodos_(ANALISES_CACHE_MESES_MAX);

  const abaMat = ss.getSheetByName('DimMatricula');
  const matriculas = lerMatriculasPagUnif_(abaMat);

  // Preenche m.chaveAluno em cada matrícula usando a mesma resolução de
  // identidade do módulo financeiro — garante que "combo" (aluno com mais
  // de uma turma ativa) seja calculado com a MESMA regra usada no restante
  // do sistema.
  criarIndiceIdentidadePagamentosSIGA_(ss, matriculas);

  const serieMatriculas = calcularSerieMatriculasAnalisesSIGA_(matriculas, periodos);
  const serieFinanceira = calcularSerieFinanceiraAnalisesSIGA_(ss, periodos);
  const lucroPorTurma = calcularLucroPorTurmaAnalisesSIGA_(ss, matriculas, periodos);
  const comparativoTurmas = calcularComparativoTurmasAnalisesSIGA_(matriculas, true);

  // obterPainelFrequenciaTurma é cara (por isso nunca rodava de forma
  // confiável no caminho da tela) — aqui ela roda em segundo plano, uma vez
  // a cada recálculo, só para turmas com aluno ativo.
  const frequenciaPorTurma = analisesCalcularFrequenciaPorTurma_(comparativoTurmas);

  analisesGravarCacheGeral_(ss, periodos, serieMatriculas, serieFinanceira);
  analisesGravarCacheTurma_(ss, periodos, lucroPorTurma.detalhesPorTurma);
  analisesGravarCacheComparativoTurmas_(ss, comparativoTurmas, frequenciaPorTurma);

  PropertiesService.getScriptProperties().setProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM, new Date().toISOString());
}

function analisesGerarPeriodos_(mesesJanela) {
  const hoje = new Date();
  const fimJanela = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const inicioJanela = new Date(fimJanela.getFullYear(), fimJanela.getMonth() - (mesesJanela - 1), 1);
  const periodos = [];
  for (let d = new Date(inicioJanela); d <= fimJanela; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    periodos.push(new Date(d));
  }
  return periodos;
}

function analisesChaveParaRotulo_(chave) {
  const partes = String(chave).split('-');
  return partes[1] + '/' + partes[0];
}

function analisesObterOuCriarAbaCache_(ss, nome, cabecalhos) {
  let aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
  } else {
    aba.clearContents();
  }
  aba.getRange(1, 1, 1, cabecalhos.length).setValues([cabecalhos]);
  return aba;
}

function analisesGravarCacheGeral_(ss, periodos, serieMatriculas, serieFinanceira) {
  const aba = analisesObterOuCriarAbaCache_(ss, ANALISES_CACHE_SHEETS.GERAL, ['Mes', 'Ativos', 'Novas', 'Cancelamentos', 'Receita']);
  const linhas = periodos.map((p, i) => {
    const chave = analisesMesRotulo_(p).chave;
    const mat = serieMatriculas[i] || {};
    const fin = serieFinanceira[i] || {};
    return [chave, Number(mat.ativos || 0), Number(mat.novas || 0), Number(mat.canceladas || 0), Number(fin.receita || 0)];
  });
  if (linhas.length) {
    aba.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  }
}

function analisesGravarCacheTurma_(ss, periodos, detalhesPorTurma) {
  const aba = analisesObterOuCriarAbaCache_(ss, ANALISES_CACHE_SHEETS.TURMA, ['Mes', 'Turma', 'Receita', 'Custo', 'Lucro']);
  const linhas = [];
  detalhesPorTurma.forEach((pontos, turma) => {
    periodos.forEach((p, i) => {
      const chave = analisesMesRotulo_(p).chave;
      const ponto = pontos[i] || {};
      linhas.push([chave, turma, Number(ponto.receita || 0), Number(ponto.custo || 0), Number(ponto.lucro || 0)]);
    });
  });
  if (linhas.length) {
    aba.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  }
}

function analisesGravarCacheComparativoTurmas_(ss, comparativoTurmas, frequenciaPorTurma) {
  const aba = analisesObterOuCriarAbaCache_(ss, ANALISES_CACHE_SHEETS.COMPARATIVO, ['Turma', 'Ativos', 'Cancelados', 'Total', 'TaxaEvasao', 'FrequenciaMedia']);
  const linhas = comparativoTurmas.map(x => {
    const freq = frequenciaPorTurma.get(x.turma);
    return [
      x.turma,
      Number(x.ativos || 0),
      Number(x.cancelados || 0),
      Number(x.total || 0),
      Number(x.taxaEvasao || 0),
      (freq === null || freq === undefined) ? '' : Number(freq)
    ];
  });
  if (linhas.length) {
    aba.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  }
}

/**
 * Frequência média por turma, calculada só para turmas com aluno ativo
 * (turma encerrada não interessa aqui). Roda dentro do recálculo em
 * segundo plano — nunca no caminho de uma requisição da tela.
 */
function analisesCalcularFrequenciaPorTurma_(comparativoTurmas) {
  const mapa = new Map();
  if (typeof obterPainelFrequenciaTurma !== 'function') {
    return mapa;
  }

  const periodosFreq = analisesGerarPeriodos_(3);
  const mesInicial = analisesMesRotulo_(periodosFreq[0]).chave;
  const mesFinal = analisesMesRotulo_(periodosFreq[periodosFreq.length - 1]).chave;

  comparativoTurmas
    .filter(item => item.ativos > 0)
    .forEach(item => {
      try {
        const painel = obterPainelFrequenciaTurma({ turma: item.turma, mesInicial, mesFinal });
        mapa.set(item.turma, Number(painel && painel.resumo && painel.resumo.mediaFrequencia || 0));
      } catch (erro) {
        mapa.set(item.turma, null);
      }
    });

  return mapa;
}

function analisesLerCacheGeral_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName(ANALISES_CACHE_SHEETS.GERAL);
  const mapa = new Map();
  if (!aba || aba.getLastRow() < 2) {
    return mapa;
  }
  const dados = aba.getRange(2, 1, aba.getLastRow() - 1, 5).getValues();
  dados.forEach(linha => {
    const chave = String(linha[0] || '').trim();
    if (!chave) {
      return;
    }
    mapa.set(chave, {
      ativos: Number(linha[1] || 0),
      novas: Number(linha[2] || 0),
      canceladas: Number(linha[3] || 0),
      receita: Number(linha[4] || 0)
    });
  });
  return mapa;
}

function analisesLerCacheTurma_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName(ANALISES_CACHE_SHEETS.TURMA);
  const lista = [];
  if (!aba || aba.getLastRow() < 2) {
    return lista;
  }
  const dados = aba.getRange(2, 1, aba.getLastRow() - 1, 5).getValues();
  dados.forEach(linha => {
    const mes = String(linha[0] || '').trim();
    const turma = String(linha[1] || '').trim();
    if (!mes || !turma) {
      return;
    }
    lista.push({
      mes,
      turma,
      receita: Number(linha[2] || 0),
      custo: Number(linha[3] || 0),
      lucro: Number(linha[4] || 0)
    });
  });
  return lista;
}

function analisesLerCacheComparativoTurmas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName(ANALISES_CACHE_SHEETS.COMPARATIVO);
  const lista = [];
  if (!aba || aba.getLastRow() < 2) {
    return lista;
  }
  const dados = aba.getRange(2, 1, aba.getLastRow() - 1, 6).getValues();
  dados.forEach(linha => {
    const turma = String(linha[0] || '').trim();
    if (!turma) {
      return;
    }
    const freqBruta = linha[5];
    lista.push({
      turma,
      ativos: Number(linha[1] || 0),
      cancelados: Number(linha[2] || 0),
      total: Number(linha[3] || 0),
      taxaEvasao: Number(linha[4] || 0),
      frequenciaMedia: (freqBruta === '' || freqBruta === null || freqBruta === undefined) ? null : Number(freqBruta)
    });
  });
  return lista;
}

/**
 * Receita (valor devido, por matrícula) menos custo de professores
 * (Pagamentos Professores), agrupado por turma e por mês.
 * Usado só por recalcularCacheAnalisesSIGA — retorna TODAS as turmas
 * (o corte para as top N usado na tela acontece na leitura do cache).
 */
function calcularLucroPorTurmaAnalisesSIGA_(ss, matriculas, periodos) {
  const custoPorTurma = calcularCustoProfessoresPorTurmaAnalisesSIGA_(ss, periodos);

  const matriculasPorAluno = new Map();
  matriculas.forEach(m => {
    const chave = m.chaveAluno || normalizarPagUnif_(m.idAluno || m.nome);
    if (!chave) return;
    if (!matriculasPorAluno.has(chave)) {
      matriculasPorAluno.set(chave, []);
    }
    matriculasPorAluno.get(chave).push(m);
  });

  const hoje = new Date();
  const inicioMesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const receitaPorTurmaMes = new Map();

  periodos.forEach(ref => {
    let dataCalculo;
    if (ref < inicioMesAtual) {
      dataCalculo = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    } else if (ref.getFullYear() === hoje.getFullYear() && ref.getMonth() === hoje.getMonth()) {
      dataCalculo = hoje;
    } else {
      dataCalculo = new Date(ref.getFullYear(), ref.getMonth(), 1);
    }

    const chaveMes = analisesMesRotulo_(ref).chave;

    matriculasPorAluno.forEach(matsAluno => {
      const ativas = matsAluno.filter(m =>
        normalizarPagUnif_(m.status) === 'ATIVO' && vigenteNoMesPagUnif_(m, ref)
      );
      if (!ativas.length) {
        return;
      }

      const combo = ativas.length > 1;

      ativas.forEach(m => {
        const turma = String(m.turma || '').trim();
        if (!turma) {
          return;
        }

        const valor = Number(calcularValorMatriculaPagUnif_(m, combo, ref, dataCalculo) || 0);

        if (!receitaPorTurmaMes.has(turma)) {
          receitaPorTurmaMes.set(turma, new Map());
        }
        const mapaMes = receitaPorTurmaMes.get(turma);
        mapaMes.set(chaveMes, (mapaMes.get(chaveMes) || 0) + valor);
      });
    });
  });

  const turmas = new Set([...receitaPorTurmaMes.keys(), ...custoPorTurma.keys()]);
  const resumoPorTurma = [];
  const detalhesPorTurma = new Map();

  turmas.forEach(turma => {
    const mapaReceita = receitaPorTurmaMes.get(turma) || new Map();
    const mapaCusto = custoPorTurma.get(turma) || new Map();

    let totalReceita = 0;
    let totalCusto = 0;

    const pontos = periodos.map(p => {
      const chaveMes = analisesMesRotulo_(p).chave;
      const receita = arredPagUnif_(mapaReceita.get(chaveMes) || 0);
      const custo = arredPagUnif_(mapaCusto.get(chaveMes) || 0);
      totalReceita += receita;
      totalCusto += custo;
      return {
        periodo: analisesMesRotulo_(p).rotulo,
        receita,
        custo,
        lucro: arredPagUnif_(receita - custo)
      };
    });

    detalhesPorTurma.set(turma, pontos);
    resumoPorTurma.push({
      turma,
      receita: arredPagUnif_(totalReceita),
      custo: arredPagUnif_(totalCusto),
      lucro: arredPagUnif_(totalReceita - totalCusto),
      margem: totalReceita > 0
        ? arredPagUnif_(((totalReceita - totalCusto) / totalReceita) * 100)
        : 0
    });
  });

  resumoPorTurma.sort((a, b) => b.lucro - a.lucro);

  return { resumoPorTurma, detalhesPorTurma };
}

function calcularCustoProfessoresPorTurmaAnalisesSIGA_(ss, periodos) {
  const porTurma = new Map();
  const aba = ss.getSheetByName('Pagamentos Professores');
  if (!aba || aba.getLastRow() < 2) {
    return porTurma;
  }

  const chavesValidas = new Set(periodos.map(p => analisesMesRotulo_(p).chave));
  const dados = aba.getRange(2, 1, aba.getLastRow() - 1, 6).getValues();

  dados.forEach(linha => {
    const turma = String(linha[2] || '').trim();
    if (!turma) {
      return;
    }

    const dataAula = typeof converterDataPagamentoProfessorSIGA_ === 'function'
      ? converterDataPagamentoProfessorSIGA_(linha[1])
      : parseDataPagUnif_(linha[1]);
    if (!dataAula) {
      return;
    }

    const chaveMes = analisesMesRotulo_(dataAula).chave;
    if (!chavesValidas.has(chaveMes)) {
      return;
    }

    const horas = numeroPagUnif_(linha[3]);
    const valorHora = numeroPagUnif_(linha[4]);
    const custo = horas * valorHora;

    if (!porTurma.has(turma)) {
      porTurma.set(turma, new Map());
    }
    const mapaMes = porTurma.get(turma);
    mapaMes.set(chaveMes, (mapaMes.get(chaveMes) || 0) + custo);
  });

  return porTurma;
}

function analisesMesRotulo_(data) {
  const chave = Utilities.formatDate(data, Session.getScriptTimeZone(), 'yyyy-MM');
  const rotulo = Utilities.formatDate(data, Session.getScriptTimeZone(), 'MM/yyyy');
  return { chave, rotulo };
}

function calcularSerieMatriculasAnalisesSIGA_(matriculas, periodos) {
  return periodos.map(periodo => {
    const inicioMes = periodo;
    const fimMes = new Date(periodo.getFullYear(), periodo.getMonth() + 1, 0, 23, 59, 59, 999);

    let novas = 0;
    let canceladas = 0;
    let ativos = 0;

    matriculas.forEach(m => {
      if (m.inicio && m.inicio >= inicioMes && m.inicio <= fimMes) {
        novas++;
      }
      if (m.fim && m.fim >= inicioMes && m.fim <= fimMes) {
        canceladas++;
      }
      if (
        normalizarPagUnif_(m.status) === 'ATIVO' &&
        vigenteNoMesPagUnif_(m, periodo)
      ) {
        ativos++;
      }
    });

    return {
      periodo: analisesMesRotulo_(periodo).rotulo,
      novas,
      canceladas,
      ativos,
      saldo: novas - canceladas
    };
  });
}

/**
 * `incluirTodas` controla se a lista completa é retornada (usado ao gravar
 * o cache) ou só o top 20 por ativos (comportamento antigo, não usado mais
 * diretamente pela tela — o corte agora acontece na leitura do cache).
 */
function calcularComparativoTurmasAnalisesSIGA_(matriculas, incluirTodas) {
  const porTurma = new Map();

  matriculas.forEach(m => {
    const turma = String(m.turma || '').trim();
    if (!turma) {
      return;
    }

    if (!porTurma.has(turma)) {
      porTurma.set(turma, { turma, ativos: 0, cancelados: 0, total: 0 });
    }

    const item = porTurma.get(turma);
    item.total++;

    const status = normalizarPagUnif_(m.status);
    if (status === 'ATIVO') {
      item.ativos++;
    } else if (['CANCELADO', 'CANCELADA', 'ABANDONO'].includes(status)) {
      item.cancelados++;
    }
  });

  const lista = Array.from(porTurma.values())
    .map(item => Object.assign({}, item, {
      taxaEvasao: item.total > 0 ? arredPagUnif_((item.cancelados / item.total) * 100) : 0
    }))
    .sort((a, b) => b.ativos - a.ativos);

  return incluirTodas ? lista : lista.slice(0, 20);
}

function calcularSerieFinanceiraAnalisesSIGA_(ss, periodos) {
  const porMes = new Map();
  periodos.forEach(p => porMes.set(analisesMesRotulo_(p).chave, 0));

  const abaComp = ss.getSheetByName('Comprovante de pagamento');
  if (abaComp && abaComp.getLastRow() >= 2) {
    const dados = abaComp.getDataRange().getValues();
    const mapa = mapaGenericoPagUnif_(dados[0]);

    dados.slice(1).forEach(linha => {
      const dataPagamento = parseDataPagUnif_(
        campoPagUnif_(linha, mapa, ['Data do Pagamento', 'DATA DO PAGAMENTO'])
      );
      if (!dataPagamento) {
        return;
      }

      const chave = analisesMesRotulo_(dataPagamento).chave;
      if (!porMes.has(chave)) {
        return;
      }

      const valor =
        numeroPagUnif_(campoPagUnif_(linha, mapa, ['Valor total pago'])) ||
        (
          numeroPagUnif_(campoPagUnif_(linha, mapa, ['Valor pago Mensalidade'])) +
          numeroPagUnif_(campoPagUnif_(linha, mapa, [
            'Valor pago resíduo de mensalidade',
            'VALOR PAGO RESIDUO DE MENSALIDADE'
          ]))
        );

      porMes.set(chave, porMes.get(chave) + valor);
    });
  }

  const abaBol = obterAbaTodosBoletosPagamentosSIGA_();
  if (abaBol && abaBol.getLastRow() >= 2) {
    const dados = abaBol.getDataRange().getValues();
    const mapa = mapaCabecalhosPagamentosSIGA_(dados[0]);

    dados.slice(1).forEach(linha => {
      const boleto = montarBoletoPagamentosSIGA_(linha, mapa, true);
      if (boleto.statusNormalizado !== 'PAGO') {
        return;
      }

      const dataPagamento = dataPagamentosSIGA_(boleto.dataPagamento);
      if (!dataPagamento) {
        return;
      }

      const chave = analisesMesRotulo_(dataPagamento).chave;
      if (!porMes.has(chave)) {
        return;
      }

      porMes.set(
        chave,
        porMes.get(chave) + Number(boleto.totalPago || boleto.valorTotal || 0)
      );
    });
  }

  return periodos.map(p => {
    const chave = analisesMesRotulo_(p).chave;
    return {
      periodo: analisesMesRotulo_(p).rotulo,
      receita: arredPagUnif_(porMes.get(chave) || 0)
    };
  });
}
