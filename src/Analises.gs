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
 * Calcular os dados de Análises do zero exige varrer DimMatricula e
 * TodosBoletos (a maior aba do sistema) por inteiro. Fazer isso a cada
 * abertura da tela levava dezenas de segundos.
 * Em vez disso, o cálculo pesado roda em segundo plano (gatilho de tempo,
 * ver configurarGatilhoCacheAnalisesSIGA) e grava o resultado em 3 abas
 * pequenas (AnalisesCache_*). A tela só LÊ essas abas — leitura de
 * algumas dezenas/centenas de linhas é quase instantânea.
 */

const ANALISES_CACHE_SHEETS = {
  GERAL: 'AnalisesCache_Geral',
  TURMA: 'AnalisesCache_Turma',
  COMPARATIVO: 'AnalisesCache_ComparativoTurmas',
  PAGAMENTO_ALUNO: 'AnalisesCache_PagamentoAluno'
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

  // Agrega mensalidades por turma somando só os meses dentro da janela
  // selecionada.
  const acumuladoPorTurma = new Map();
  turma.forEach(item => {
    if (!chavesSet.has(item.mes)) {
      return;
    }
    if (!acumuladoPorTurma.has(item.turma)) {
      acumuladoPorTurma.set(item.turma, { receita: 0, custoProfessor: 0, pontos: new Map() });
    }
    const acc = acumuladoPorTurma.get(item.turma);
    acc.receita += item.receita;
    acc.custoProfessor += Number(item.custoProfessor || 0);
    acc.pontos.set(item.mes, {
      periodo: analisesChaveParaRotulo_(item.mes),
      receita: item.receita,
      lucro: arredPagUnif_(item.receita - Number(item.custoProfessor || 0))
    });
  });

  const resumoPorTurma = Array.from(acumuladoPorTurma.entries())
    .map(([nomeTurma, acc]) => ({ turma: nomeTurma, receita: arredPagUnif_(acc.receita) }))
    .sort((a, b) => b.receita - a.receita);

  // Manda mais turmas do que o gráfico vai destacar: a tela mostra as 3
  // primeiras em cor e o restante como linhas de contexto (cinza, sem
  // legenda) — assim dá pra ver a forma geral sem competir com 8+ cores.
  const serieMensalidadesPorTurma = resumoPorTurma.slice(0, 20).map(item => {
    const acc = acumuladoPorTurma.get(item.turma);
    return {
      turma: item.turma,
      pontos: chaves.map(chave => acc.pontos.get(chave) || { periodo: analisesChaveParaRotulo_(chave), receita: 0 })
    };
  });

  // Linha por turma x mês (não só o top 20 do gráfico) — usado pela tabela
  // "Mensalidades por turma no período", que mostra o detalhamento mensal
  // completo.
  const detalheMensalPorTurma = [];
  // Mesma coisa, mas com o LUCRO (receita paga − custo do professor) —
  // usado só pela tabela "Mensalidades por turma no tempo", que na
  // verdade é lucro por turma, não mensalidade.
  const lucroPorTurma = [];
  resumoPorTurma.forEach(item => {
    const acc = acumuladoPorTurma.get(item.turma);
    chaves.forEach(chave => {
      const ponto = acc.pontos.get(chave);
      detalheMensalPorTurma.push({
        turma: item.turma,
        periodo: analisesChaveParaRotulo_(chave),
        receita: ponto ? ponto.receita : 0
      });
      lucroPorTurma.push({
        turma: item.turma,
        periodo: analisesChaveParaRotulo_(chave),
        receita: ponto ? ponto.lucro : 0
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
    serieMensalidadesPorTurma,
    detalheMensalPorTurma,
    lucroPorTurma,
    atualizadoEm: PropertiesService.getScriptProperties().getProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM) || null,
    resumo: {
      alunosAtivos,
      turmasComparadas: comparativoTurmas.length,
      mensalidadesTotalPeriodo: arredPagUnif_(resumoPorTurma.reduce((s, x) => s + Number(x.receita || 0), 0))
    }
  };
}

/**
 * Alunos de uma turma e o quanto cada um REALMENTE pagou (não o valor
 * devido) no período selecionado — chamado sob demanda quando o usuário
 * clica numa turma na tabela de mensalidades. Não faz parte do cache: é
 * um recorte de UMA turma só, então é rápido o bastante para rodar na hora.
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
  // Lê do cache (AnalisesCache_PagamentoAluno) em vez de varrer
  // TodosBoletos + Comprovante de pagamento na hora — isso fazia cada
  // clique numa turma demorar muito (a mesma razão pela qual as outras
  // tabelas de Análises já usam cache). garantirCacheAnalisesSIGA_
  // recalcula na hora só se o cache ainda não existir de jeito nenhum.
  garantirCacheAnalisesSIGA_();
  const abaMat = ss.getSheetByName('DimMatricula');
  const matriculas = lerMatriculasPagUnif_(abaMat);
  criarIndiceIdentidadePagamentosSIGA_(ss, matriculas);
  const valorPagoPorAlunoMesTurma = analisesLerCachePagamentoAluno_();

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
    const chaveMes = analisesMesRotulo_(ref).chave;

    matriculasPorAluno.forEach((matsAluno, chaveAluno) => {
      // Aqui o filtro é intencionalmente mais restrito que analisesStatusAtivo_:
      // a lista de alunos de uma turma (clique na tabela de mensalidades) deve
      // mostrar só quem está ATIVO ou SUSPENSO, sem incluir EM ESPERA (que
      // ainda não começou de fato na turma).
      const ativas = matsAluno.filter(m => {
        const status = normalizarPagUnif_(m.status);
        return (status === 'ATIVO' || status === 'SUSPENSO') && vigenteNoMesPagUnif_(m, ref);
      });
      if (!ativas.length) return;

      const matriculaDaTurma = ativas.find(m => String(m.turma || '').trim() === turmaAlvo);
      if (!matriculaDaTurma) return;

      // Valor REALMENTE pago pelo aluno nesse mês (boleto pago +
      // comprovante), atribuído à turma certa quando o próprio pagamento
      // já identifica qual foi (turma na Comprovante de pagamento, ou
      // "Nome - Turma" no boleto); só cai no rateio proporcional (por
      // valor devido) a parte de turma desconhecida. Isso evita que o
      // pagamento de uma turma que o aluno já deixou apareça como se
      // fosse desta. Não usa obterTurmasEValorDevidoDimPagUnif_ porque
      // ela só considera status ATIVO — aqui "ativas" já inclui
      // SUSPENSO, por regra própria desta função.
      const porTurmaPagamento = valorPagoPorAlunoMesTurma.get(chaveAluno + '|' + chaveMes);
      if (!porTurmaPagamento) return;

      const combo = ativas.length > 1;
      const turmasDoMes = ativas
        .map(m => ({
          turma: String(m.turma || '').trim(),
          valorDevido: Number(calcularValorMatriculaPagUnif_(m, combo, ref, dataCalculo) || 0)
        }))
        .filter(d => d.turma);
      if (!turmasDoMes.length) return;

      const atribuicao = analisesAtribuirPagamentoPorTurma_(porTurmaPagamento, turmasDoMes);
      const valor = atribuicao.get(turmaAlvo) || 0;
      if (!(valor > 0)) return;

      const nome = matriculaDaTurma.nome || matriculaDaTurma.idAluno || '(sem nome)';

      if (!totalPorAluno.has(chaveAluno)) {
        totalPorAluno.set(chaveAluno, { aluno: nome, total: 0, porMes: new Map() });
      }
      const registro = totalPorAluno.get(chaveAluno);
      registro.total += valor;
      const rotuloMes = analisesChaveParaRotulo_(chaveMes);
      registro.porMes.set(rotuloMes, (registro.porMes.get(rotuloMes) || 0) + valor);
    });
  });

  const alunos = Array.from(totalPorAluno.values())
    .map(x => ({
      aluno: x.aluno,
      total: arredPagUnif_(x.total),
      porMes: Array.from(x.porMes.entries()).map(([periodo, valor]) => ({ periodo, valor: arredPagUnif_(valor) }))
    }))
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

/**
 * Só dispara o recálculo se o cache ainda não existir. Usa um lock com
 * dupla checagem: se duas requisições chegarem ao mesmo tempo (ex.: o
 * gatilho de tempo disparando junto com alguém abrindo a tela), a segunda
 * espera a primeira terminar em vez de tentar criar as mesmas abas de novo
 * — sem o lock, as duas viam "cache não existe" ao mesmo tempo e a segunda
 * quebrava com "Já existe uma página chamada ...".
 */
function garantirCacheAnalisesSIGA_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(ANALISES_CACHE_SHEETS.GERAL)) {
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('O cache de Análises está sendo calculado por outra requisição. Tente novamente em instantes.');
  }
  let nucleo;
  try {
    if (ss.getSheetByName(ANALISES_CACHE_SHEETS.GERAL)) {
      return; // outra execução já terminou de criar o cache enquanto esperávamos o lock
    }
    nucleo = analisesRecalcularCacheNucleoSemLock_(ss);
  } finally {
    lock.releaseLock();
  }
  if (nucleo) {
    analisesAtualizarMensalidadesCacheSemLock_(ss, nucleo);
    analisesAtualizarFrequenciaCacheComOrcamento_(ss, nucleo.comparativoTurmas);
  }
}

/**
 * Entrada pública do recálculo — chamada pelo gatilho de tempo e pelo botão
 * "Recalcular dados". O lock só protege a parte RÁPIDA (criar/gravar as
 * abas de Geral/Comparativo — segundos). Mensalidades por turma/aluno
 * (que precisa varrer TodosBoletos + Comprovante de pagamento pra achar
 * o valor REALMENTE pago) e frequência (que pode levar minutos) rodam
 * DEPOIS de soltar o lock — se qualquer uma ficasse presa dentro do
 * lock, qualquer execução concorrente (o gatilho de 6h caindo junto de
 * um clique manual, por exemplo) esperaria só 30s e falharia com "Lock
 * timeout: another process was holding the lock for too long", mesmo a
 * primeira execução sendo legítima e ainda rodando (foi exatamente isso
 * que voltou a acontecer quando o cálculo de valor pago/custo de
 * professor foi colocado dentro do núcleo com lock). Regravar essas
 * abas duas vezes ao mesmo tempo não quebra nada (só refaz um
 * trabalho), então nenhuma delas precisa de lock.
 */
function recalcularCacheAnalisesSIGA() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nucleo = analisesRecalcularCacheNucleoComLock_(ss);
  analisesAtualizarMensalidadesCacheSemLock_(ss, nucleo);
  analisesAtualizarFrequenciaCacheComOrcamento_(ss, nucleo.comparativoTurmas);
}

function analisesRecalcularCacheNucleoComLock_(ss) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return analisesRecalcularCacheNucleoSemLock_(ss);
  } finally {
    lock.releaseLock();
  }
}

/**
 * A parte rápida do recálculo (só DimMatricula, sem tocar em nenhuma
 * aba de pagamento): calcula e grava só o comparativo entre turmas.
 * Nem a receita geral nem mensalidades por turma/aluno são calculadas
 * aqui — as duas dependem de varrer TodosBoletos/Comprovante de
 * pagamento (a maior aba do sistema) e rodam depois, sem lock, em
 * analisesAtualizarMensalidadesCacheSemLock_. Sempre chamada com o lock
 * de script já adquirido — nunca chame direto. Retorna tudo que a etapa
 * seguinte precisa, já que ela roda fora do lock e não pode recalcular
 * do zero.
 */
function analisesRecalcularCacheNucleoSemLock_(ss) {
  const periodos = analisesGerarPeriodos_(ANALISES_CACHE_MESES_MAX);

  const abaMat = ss.getSheetByName('DimMatricula');
  const matriculas = lerMatriculasPagUnif_(abaMat);

  // Preenche m.chaveAluno em cada matrícula usando a mesma resolução de
  // identidade do módulo financeiro — garante que "combo" (aluno com mais
  // de uma turma ativa) seja calculado com a MESMA regra usada no restante
  // do sistema.
  const identidades = criarIndiceIdentidadePagamentosSIGA_(ss, matriculas);

  const serieMatriculas = calcularSerieMatriculasAnalisesSIGA_(matriculas, periodos);
  const comparativoTurmas = calcularComparativoTurmasAnalisesSIGA_(matriculas, true);

  // Só turmas com aluno ativo agora — mesmo filtro já usado no
  // Detalhamento e na Comparação entre turmas. Turma sem ninguém ativo
  // não aparece mais no gráfico/tabela de mensalidades.
  const turmasAtivas = new Set(comparativoTurmas.filter(x => x.ativos > 0).map(x => x.turma));

  analisesGravarCacheComparativoTurmas_(ss, comparativoTurmas, new Map());

  return { comparativoTurmas, matriculas, identidades, periodos, turmasAtivas, serieMatriculas };
}

/**
 * Receita geral + mensalidades por turma/aluno + custo de professor — a
 * parte LENTA do recálculo. Antes disso virar duas funções separadas
 * (uma pra receita geral, outra pro valor pago por turma), cada uma
 * varria TodosBoletos + Comprovante de pagamento do zero — ler a maior
 * aba do sistema duas vezes deixava o recálculo lento a ponto de,
 * somado com a etapa de frequência logo em seguida, correr risco de
 * estourar o limite de execução do Apps Script (~6 min) e ser
 * interrompido no meio, deixando abas de cache atualizadas e outras
 * não (números discrepantes entre as tabelas). Agora
 * analisesCalcularFinanceiroEValorPagoSIGA_ faz as duas coisas numa
 * única passada pelas abas. Roda SEM lock, depois que
 * analisesRecalcularCacheNucleoComLock_ já soltou o dele — ver o
 * comentário de recalcularCacheAnalisesSIGA.
 */
function analisesAtualizarMensalidadesCacheSemLock_(ss, nucleo) {
  const { matriculas, identidades, periodos, turmasAtivas, serieMatriculas } = nucleo;
  const { serieFinanceira, valorPagoPorAlunoMesTurma } =
    analisesCalcularFinanceiroEValorPagoSIGA_(ss, periodos, identidades);
  const mensalidadesPorTurma = calcularMensalidadesPorTurmaAnalisesSIGA_(matriculas, periodos, turmasAtivas, valorPagoPorAlunoMesTurma);
  const custoProfessorPorTurmaMes = analisesCalcularCustoProfessorPorTurmaMes_(ss);

  analisesGravarCacheGeral_(ss, periodos, serieMatriculas, serieFinanceira);
  analisesGravarCacheTurma_(ss, periodos, mensalidadesPorTurma.detalhesPorTurma, custoProfessorPorTurmaMes);
  analisesGravarCachePagamentoAluno_(ss, valorPagoPorAlunoMesTurma);

  PropertiesService.getScriptProperties().setProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM, new Date().toISOString());
}

function analisesAtualizarFrequenciaCacheComOrcamento_(ss, comparativoTurmas) {
  if (typeof obterPainelFrequenciaTurma !== 'function') {
    return;
  }
  const aba = ss.getSheetByName(ANALISES_CACHE_SHEETS.COMPARATIVO);
  if (!aba || aba.getLastRow() < 2) {
    return;
  }

  const inicio = Date.now();
  const ORCAMENTO_MS = 4 * 60 * 1000; // deixa ~2min de folga do limite de 6min do Apps Script

  const periodosFreq = analisesGerarPeriodos_(3);
  const mesInicial = analisesMesRotulo_(periodosFreq[0]).chave;
  const mesFinal = analisesMesRotulo_(periodosFreq[periodosFreq.length - 1]).chave;

  const linhaPorTurma = new Map();
  aba.getRange(2, 1, aba.getLastRow() - 1, 1).getValues().forEach((linha, indice) => {
    const nome = String(linha[0] || '').trim();
    if (nome) {
      linhaPorTurma.set(nome, indice + 2);
    }
  });

  const ativas = comparativoTurmas.filter(item => item.ativos > 0);
  for (let i = 0; i < ativas.length; i++) {
    if (Date.now() - inicio > ORCAMENTO_MS) {
      break; // fica pra próxima execução — os números principais já foram salvos
    }
    const turma = ativas[i].turma;
    const linha = linhaPorTurma.get(turma);
    if (!linha) {
      continue;
    }
    try {
      const painel = obterPainelFrequenciaTurma({ turma, mesInicial, mesFinal });
      const media = Number(painel && painel.resumo && painel.resumo.mediaFrequencia || 0);
      aba.getRange(linha, 6).setValue(media);
    } catch (erro) {
      // deixa em branco — não trava as próximas turmas nem o resto do cache
    }
    SpreadsheetApp.flush();
  }
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

const ANALISES_MESES_ABREV_PT_ = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function analisesChaveParaRotulo_(chave) {
  const partes = String(chave).split('-');
  const mes = Number(partes[1]);
  return ANALISES_MESES_ABREV_PT_[mes - 1] + '-' + partes[0].slice(-2);
}

function analisesObterOuCriarAbaCache_(ss, nome, cabecalhos) {
  let aba = ss.getSheetByName(nome);
  if (!aba) {
    aba = ss.insertSheet(nome);
  } else {
    aba.clearContents();
  }
  // Força a primeira coluna (Mes ou Turma) a ficar em texto puro — sem
  // isso, o Sheets pode auto-converter um texto como "2025-10" para uma
  // data de verdade, e a comparação de texto usada na leitura nunca bate
  // (foi exatamente isso que deixou o cache de turma "vazio" mesmo com
  // linhas gravadas).
  aba.getRange('A:A').setNumberFormat('@');
  aba.getRange(1, 1, 1, cabecalhos.length).setValues([cabecalhos]);
  return aba;
}

/**
 * Alguma linha antiga pode já ter sido convertida para data pelo Sheets
 * antes da correção acima — trata os dois formatos na leitura.
 */
function analisesNormalizarChaveMes_(valor) {
  if (valor instanceof Date) {
    return analisesMesRotulo_(valor).chave;
  }
  return String(valor || '').trim();
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

function analisesGravarCacheTurma_(ss, periodos, detalhesPorTurma, custoProfessorPorTurmaMes) {
  const aba = analisesObterOuCriarAbaCache_(ss, ANALISES_CACHE_SHEETS.TURMA, ['Mes', 'Turma', 'Receita', 'CustoProfessor']);
  const linhas = [];
  detalhesPorTurma.forEach((pontos, turma) => {
    periodos.forEach((p, i) => {
      const chave = analisesMesRotulo_(p).chave;
      const ponto = pontos[i] || {};
      const custo = custoProfessorPorTurmaMes ? Number(custoProfessorPorTurmaMes.get(turma + '|' + chave) || 0) : 0;
      linhas.push([chave, turma, Number(ponto.receita || 0), custo]);
    });
  });
  if (linhas.length) {
    aba.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  }
}

/**
 * Cache do valor pago por aluno/mês/turma — usado só pelo detalhamento
 * de alunos (clique numa turma). Sem isso, cada clique tinha que varrer
 * TodosBoletos (a maior aba do sistema) + Comprovante de pagamento na
 * hora, o que ficava lento demais pra uma ação de UI. Uma linha por
 * combinação chaveAluno+mês+turma; Turma pode vir vazia (pagamento cuja
 * turma não pôde ser identificada — ver analisesAtribuirPagamentoPorTurma_).
 */
function analisesGravarCachePagamentoAluno_(ss, valorPagoPorAlunoMesTurma) {
  const aba = analisesObterOuCriarAbaCache_(ss, ANALISES_CACHE_SHEETS.PAGAMENTO_ALUNO, ['ChaveAlunoMes', 'Turma', 'Valor']);
  const linhas = [];
  valorPagoPorAlunoMesTurma.forEach((porTurma, chaveAlunoMes) => {
    porTurma.forEach((valor, turma) => {
      if (!(valor > 0)) return;
      linhas.push([chaveAlunoMes, turma, arredPagUnif_(valor)]);
    });
  });
  if (linhas.length) {
    aba.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  }
}

function analisesGravarCacheComparativoTurmas_(ss, comparativoTurmas, frequenciaPorTurma) {
  const aba = analisesObterOuCriarAbaCache_(ss, ANALISES_CACHE_SHEETS.COMPARATIVO, ['Turma', 'Ativos', 'Saidas', 'Total', 'TaxaEvasao', 'FrequenciaMedia']);
  const linhas = comparativoTurmas.map(x => {
    const freq = frequenciaPorTurma.get(x.turma);
    return [
      x.turma,
      Number(x.ativos || 0),
      Number(x.saidas || 0),
      Number(x.total || 0),
      Number(x.taxaEvasao || 0),
      (freq === null || freq === undefined) ? '' : Number(freq)
    ];
  });
  if (linhas.length) {
    aba.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  }
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
    const chave = analisesNormalizarChaveMes_(linha[0]);
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
  const dados = aba.getRange(2, 1, aba.getLastRow() - 1, 4).getValues();
  dados.forEach(linha => {
    const mes = analisesNormalizarChaveMes_(linha[0]);
    const turma = String(linha[1] || '').trim();
    if (!mes || !turma) {
      return;
    }
    lista.push({ mes, turma, receita: Number(linha[2] || 0), custoProfessor: Number(linha[3] || 0) });
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
      saidas: Number(linha[2] || 0),
      total: Number(linha[3] || 0),
      taxaEvasao: Number(linha[4] || 0),
      frequenciaMedia: (freqBruta === '' || freqBruta === null || freqBruta === undefined) ? null : Number(freqBruta)
    });
  });
  return lista;
}

/**
 * Lê o cache gravado por analisesGravarCachePagamentoAluno_. Retorna o
 * mesmo formato de analisesCalcularValorPagoPorAlunoMesTurma_:
 * Map<chaveAluno + '|' + 'yyyy-MM', Map<turma-ou-'', valor>>.
 */
function analisesLerCachePagamentoAluno_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName(ANALISES_CACHE_SHEETS.PAGAMENTO_ALUNO);
  const mapa = new Map();
  if (!aba || aba.getLastRow() < 2) {
    return mapa;
  }
  const dados = aba.getRange(2, 1, aba.getLastRow() - 1, 3).getValues();
  dados.forEach(linha => {
    const chaveAlunoMes = String(linha[0] || '').trim();
    if (!chaveAlunoMes) {
      return;
    }
    const turma = String(linha[1] || '').trim();
    if (!mapa.has(chaveAlunoMes)) {
      mapa.set(chaveAlunoMes, new Map());
    }
    mapa.get(chaveAlunoMes).set(turma, Number(linha[2] || 0));
  });
  return mapa;
}

/**
 * Faz numa ÚNICA passada por TodosBoletos + Comprovante de pagamento o
 * que antes eram DUAS varreduras separadas (calcularSerieFinanceiraAnalisesSIGA_
 * e analisesCalcularValorPagoPorAlunoMesTurma_): a série financeira
 * mensal — por DATA DE PAGAMENTO, pro gráfico "Receita financeira" — e
 * o valor pago por aluno/mês/turma — por COMPETÊNCIA (vencimento do
 * boleto / período de referência do comprovante), pras tabelas de
 * mensalidades por turma. Ler a maior aba do sistema duas vezes deixava
 * o recálculo lento o bastante pra, somado com a etapa de frequência
 * logo depois, arriscar estourar o limite de execução do Apps Script.
 * Usada só pelo recálculo do cache — o diagnóstico manual
 * (diagnosticarValorPagoAnalisesSIGA) continua usando a função mais
 * simples abaixo, que não precisa da série financeira.
 */
function analisesCalcularFinanceiroEValorPagoSIGA_(ss, periodos, identidades) {
  const porMesFinanceiro = new Map();
  periodos.forEach(p => porMesFinanceiro.set(analisesMesRotulo_(p).chave, 0));

  const porAlunoMes = new Map();
  const somarValorPago = (chaveAluno, mesISO, turma, valor) => {
    if (!chaveAluno || !mesISO || !(valor > 0)) return;
    const chave = chaveAluno + '|' + mesISO;
    if (!porAlunoMes.has(chave)) {
      porAlunoMes.set(chave, new Map());
    }
    const porTurma = porAlunoMes.get(chave);
    porTurma.set(turma, (porTurma.get(turma) || 0) + valor);
  };

  const abaComp = ss.getSheetByName('Comprovante de pagamento');
  if (abaComp && abaComp.getLastRow() >= 2) {
    const dados = abaComp.getDataRange().getValues();
    const mapa = mapaGenericoPagUnif_(dados[0]);

    dados.slice(1).forEach(linha => {
      const valorMensalidade =
        numeroPagUnif_(campoPagUnif_(linha, mapa, ['VALOR PAGO MENSALIDADE'])) +
        numeroPagUnif_(campoPagUnif_(linha, mapa, [
          'VALOR PAGO RESIDUO DE MENSALIDADE',
          'VALOR PAGO RESÍDUO DE MENSALIDADE'
        ]));

      const dataPagamento = parseDataPagUnif_(
        campoPagUnif_(linha, mapa, ['Data do Pagamento', 'DATA DO PAGAMENTO'])
      );
      if (dataPagamento) {
        const chaveFin = analisesMesRotulo_(dataPagamento).chave;
        if (porMesFinanceiro.has(chaveFin)) {
          const valorFinanceiro =
            numeroPagUnif_(campoPagUnif_(linha, mapa, ['Valor total pago'])) || valorMensalidade;
          porMesFinanceiro.set(chaveFin, porMesFinanceiro.get(chaveFin) + valorFinanceiro);
        }
      }

      if (valorMensalidade > 0) {
        const ref = inicioMesPagUnif_(campoPagUnif_(linha, mapa, [
          'PAGAMENTO REFERENTE A QUAL PERIODO?',
          'PAGAMENTO REFERENTE A QUAL PERÍODO?',
          'PERIODO DE REFERENCIA',
          'PERÍODO DE REFERÊNCIA'
        ]));
        if (ref) {
          const identidade = resolverComprovantePagamentoSIGA_(identidades, linha, mapa);
          if (identidade) {
            const turma = String(campoPagUnif_(linha, mapa, ['TURMA']) || '').trim();
            somarValorPago(identidade.chaveAluno, analisesMesRotulo_(ref).chave, turma, valorMensalidade);
          }
        }
      }
    });
  }

  const abaBol = obterAbaTodosBoletosPagamentosSIGA_();
  if (abaBol && abaBol.getLastRow() >= 2) {
    const dados = abaBol.getDataRange().getValues();
    const mapa = mapaCabecalhosPagamentosSIGA_(dados[0]);

    dados.slice(1).forEach(linha => {
      const boleto = montarBoletoPagamentosSIGA_(linha, mapa, true);
      if (boleto.statusNormalizado !== 'PAGO') return;
      const valor = Number(boleto.totalPago || boleto.valorTotal || 0);

      const dataPagamento = dataPagamentosSIGA_(boleto.dataPagamento);
      if (dataPagamento) {
        const chaveFin = analisesMesRotulo_(dataPagamento).chave;
        if (porMesFinanceiro.has(chaveFin)) {
          porMesFinanceiro.set(chaveFin, porMesFinanceiro.get(chaveFin) + valor);
        }
      }

      const vencimento = dataPagamentosSIGA_(boleto.vencimentoOriginal || boleto.vencimento);
      if (vencimento) {
        const identidade = resolverIdentidadePagamentoSIGA_(identidades, {
          nome: boleto.nomePagante, documento: boleto.documento
        }, false);
        if (identidade) {
          const turma = separarAlunoTurmaPagUnif_(boleto.nomePagante || '').turma;
          somarValorPago(identidade.chaveAluno, analisesMesRotulo_(vencimento).chave, turma, valor);
        }
      }
    });
  }

  const serieFinanceira = periodos.map(p => {
    const chave = analisesMesRotulo_(p).chave;
    return { periodo: analisesMesRotulo_(p).rotulo, receita: arredPagUnif_(porMesFinanceiro.get(chave) || 0) };
  });

  return { serieFinanceira, valorPagoPorAlunoMesTurma: porAlunoMes };
}

/**
 * Quanto cada aluno REALMENTE pagou (não o que devia) em cada mês —
 * soma TodosBoletos (só status PAGO) + Comprovante de pagamento, do
 * mesmo jeito que a tela de Pagamentos (montarBaseMensalidadesPagasSIGA_
 * em Pagamentos.gs). Quando dá pra saber a turma do PRÓPRIO pagamento —
 * "Comprovante de pagamento" tem coluna Turma; em TodosBoletos o Nome
 * do Pagante costuma vir como "Nome - Turma" (mesmo padrão já usado em
 * separarAlunoTurmaPagUnif_/listarInadimplentesPagamentosSIGA em
 * Pagamentos.gs) — o valor fica registrado sob essa turma. Quando não
 * dá pra saber, fica sob a chave '' (turma desconhecida).
 *
 * Sem isso, um aluno com mais de uma matrícula no mesmo mês (ex.: saiu
 * de uma turma X e entrou noutra) teria o pagamento de UMA turma
 * repartido proporcionalmente entre as duas — gerando uma entrada falsa
 * na turma que ele não pagou naquele mês.
 *
 * Retorna Map<chaveAluno + '|' + 'yyyy-MM', Map<turma-ou-'', valor>>.
 */
function analisesCalcularValorPagoPorAlunoMesTurma_(ss, identidades) {
  const porAlunoMes = new Map();
  const somar = (chaveAluno, mesISO, turma, valor) => {
    if (!chaveAluno || !mesISO || !(valor > 0)) return;
    const chave = chaveAluno + '|' + mesISO;
    if (!porAlunoMes.has(chave)) {
      porAlunoMes.set(chave, new Map());
    }
    const porTurma = porAlunoMes.get(chave);
    porTurma.set(turma, (porTurma.get(turma) || 0) + valor);
  };

  const abaBol = obterAbaTodosBoletosPagamentosSIGA_();
  if (abaBol && abaBol.getLastRow() >= 2) {
    const dados = abaBol.getDataRange().getValues();
    const mapa = mapaCabecalhosPagamentosSIGA_(dados[0]);
    for (let i = 1; i < dados.length; i++) {
      const boleto = montarBoletoPagamentosSIGA_(dados[i], mapa, true);
      if (boleto.statusNormalizado !== 'PAGO') continue;
      const vencimento = dataPagamentosSIGA_(boleto.vencimentoOriginal || boleto.vencimento);
      if (!vencimento) continue;
      const identidade = resolverIdentidadePagamentoSIGA_(identidades, {
        nome: boleto.nomePagante, documento: boleto.documento
      }, false);
      if (!identidade) continue;
      const turma = separarAlunoTurmaPagUnif_(boleto.nomePagante || '').turma;
      somar(
        identidade.chaveAluno,
        analisesMesRotulo_(vencimento).chave,
        turma,
        Number(boleto.totalPago || boleto.valorTotal || 0)
      );
    }
  }

  const abaComp = ss.getSheetByName('Comprovante de pagamento');
  if (abaComp && abaComp.getLastRow() >= 2) {
    const dados = abaComp.getDataRange().getValues();
    const mapa = mapaGenericoPagUnif_(dados[0]);
    for (let i = 1; i < dados.length; i++) {
      const linha = dados[i];
      const valor =
        numeroPagUnif_(campoPagUnif_(linha, mapa, ['VALOR PAGO MENSALIDADE'])) +
        numeroPagUnif_(campoPagUnif_(linha, mapa, [
          'VALOR PAGO RESIDUO DE MENSALIDADE',
          'VALOR PAGO RESÍDUO DE MENSALIDADE'
        ]));
      if (valor <= 0) continue;
      const ref = inicioMesPagUnif_(campoPagUnif_(linha, mapa, [
        'PAGAMENTO REFERENTE A QUAL PERIODO?',
        'PAGAMENTO REFERENTE A QUAL PERÍODO?',
        'PERIODO DE REFERENCIA',
        'PERÍODO DE REFERÊNCIA'
      ]));
      if (!ref) continue;
      const identidade = resolverComprovantePagamentoSIGA_(identidades, linha, mapa);
      if (!identidade) continue;
      const turma = String(campoPagUnif_(linha, mapa, ['TURMA']) || '').trim();
      somar(identidade.chaveAluno, analisesMesRotulo_(ref).chave, turma, valor);
    }
  }

  return porAlunoMes;
}

/**
 * Junta o mapa turma->valor de um aluno num mês (de
 * analisesCalcularValorPagoPorAlunoMesTurma_) com a lista de turmas dele
 * naquele mês (cada uma com seu valorDevido, só usado como PROPORÇÃO
 * pra ratear a parte de turma desconhecida). Um pagamento cuja turma é
 * conhecida mas não é nenhuma das turmas atuais do aluno (ex.: turma
 * antiga que ele já deixou) é descartado aqui — nunca vaza pra outra
 * turma. Retorna Map<turma, valorPago>.
 */
function analisesAtribuirPagamentoPorTurma_(porTurmaPagamento, turmasDoMes) {
  const resultado = new Map();
  if (!porTurmaPagamento || !porTurmaPagamento.size || !turmasDoMes.length) {
    return resultado;
  }
  const nomesTurmasDoMes = new Set(turmasDoMes.map(d => d.turma));

  let valorDesconhecido = 0;
  porTurmaPagamento.forEach((valor, turma) => {
    if (turma && nomesTurmasDoMes.has(turma)) {
      resultado.set(turma, (resultado.get(turma) || 0) + valor);
    } else if (!turma) {
      valorDesconhecido += valor;
    }
    // turma conhecida mas que não é nenhuma das turmas atuais do aluno:
    // descarta de propósito, não atribui a nenhuma turma atual.
  });

  if (valorDesconhecido > 0) {
    const totalDevido = turmasDoMes.reduce((s, d) => s + Number(d.valorDevido || 0), 0);
    turmasDoMes.forEach(d => {
      const proporcao = totalDevido > 0
        ? Number(d.valorDevido || 0) / totalDevido
        : 1 / turmasDoMes.length;
      resultado.set(d.turma, (resultado.get(d.turma) || 0) + valorDesconhecido * proporcao);
    });
  }

  return resultado;
}

/**
 * Quanto a escola pagou de professor, por turma e por mês — soma
 * "Valor a Pagar" da aba "Pagamentos Professores", agrupando pela
 * própria coluna Turma e pelo mês de "Data da Aula" (não precisa de
 * resolução de identidade: a aba já vem com a turma escrita em cada
 * linha). Usado só pra calcular o lucro da tabela "Mensalidades por
 * turma no tempo" (receita paga − custo do professor).
 */
function analisesCalcularCustoProfessorPorTurmaMes_(ss) {
  const custoPorTurmaMes = new Map();
  const aba = ss.getSheetByName('Pagamentos Professores');
  if (!aba || aba.getLastRow() < 2) {
    return custoPorTurmaMes;
  }
  const dados = aba.getDataRange().getValues();
  const mapa = mapaGenericoPagUnif_(dados[0]);
  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const turma = String(campoPagUnif_(linha, mapa, ['TURMA']) || '').trim();
    const dataAula = parseDataPagUnif_(campoPagUnif_(linha, mapa, ['DATA DA AULA', 'DATA_AULA']));
    if (!turma || !dataAula) continue;
    const valor = numeroPagUnif_(campoPagUnif_(linha, mapa, ['VALOR A PAGAR']));
    if (valor <= 0) continue;
    const chave = turma + '|' + analisesMesRotulo_(dataAula).chave;
    custoPorTurmaMes.set(chave, (custoPorTurmaMes.get(chave) || 0) + valor);
  }
  return custoPorTurmaMes;
}

/**
 * Diagnóstico manual — selecione esta função no seletor ao lado do botão
 * "Executar" no editor do Apps Script e rode direto (sem precisar abrir
 * a tela). Não grava nada, só lê TodosBoletos/Comprovante de pagamento e
 * imprime no "Log de execução" quantas linhas foram identificadas (ligadas
 * a um aluno da DimMatricula) e quantas não foram — se a maioria não for
 * identificada, analisesCalcularValorPagoPorAlunoMesTurma_ fica quase
 * vazia e o valor pago acaba não aparecendo (ou aparecendo bem menor
 * que deveria).
 */
function diagnosticarValorPagoAnalisesSIGA() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abaMat = ss.getSheetByName('DimMatricula');
  const matriculas = lerMatriculasPagUnif_(abaMat);
  const identidades = criarIndiceIdentidadePagamentosSIGA_(ss, matriculas);

  const diagnostico = {
    boletosLidos: 0,
    boletosPagos: 0,
    boletosPagosIdentificados: 0,
    boletosPagosNaoIdentificados: 0,
    comprovantesLidos: 0,
    comprovantesComValor: 0,
    comprovantesIdentificados: 0,
    comprovantesNaoIdentificados: 0,
    amostraNaoIdentificados: []
  };

  const abaBol = obterAbaTodosBoletosPagamentosSIGA_();
  if (abaBol && abaBol.getLastRow() >= 2) {
    const dados = abaBol.getDataRange().getValues();
    diagnostico.boletosLidos = dados.length - 1;
    const mapa = mapaCabecalhosPagamentosSIGA_(dados[0]);
    for (let i = 1; i < dados.length; i++) {
      const boleto = montarBoletoPagamentosSIGA_(dados[i], mapa, true);
      if (boleto.statusNormalizado !== 'PAGO') continue;
      diagnostico.boletosPagos++;
      const identidade = resolverIdentidadePagamentoSIGA_(identidades, {
        nome: boleto.nomePagante, documento: boleto.documento
      }, false);
      if (identidade) {
        diagnostico.boletosPagosIdentificados++;
      } else {
        diagnostico.boletosPagosNaoIdentificados++;
        if (diagnostico.amostraNaoIdentificados.length < 15) {
          diagnostico.amostraNaoIdentificados.push({ origem: 'BOLETO', nome: boleto.nomePagante, documento: boleto.documento });
        }
      }
    }
  }

  const abaComp = ss.getSheetByName('Comprovante de pagamento');
  if (abaComp && abaComp.getLastRow() >= 2) {
    const dados = abaComp.getDataRange().getValues();
    diagnostico.comprovantesLidos = dados.length - 1;
    const mapa = mapaGenericoPagUnif_(dados[0]);
    for (let i = 1; i < dados.length; i++) {
      const linha = dados[i];
      const valor =
        numeroPagUnif_(campoPagUnif_(linha, mapa, ['VALOR PAGO MENSALIDADE'])) +
        numeroPagUnif_(campoPagUnif_(linha, mapa, [
          'VALOR PAGO RESIDUO DE MENSALIDADE',
          'VALOR PAGO RESÍDUO DE MENSALIDADE'
        ]));
      if (valor <= 0) continue;
      diagnostico.comprovantesComValor++;
      const identidade = resolverComprovantePagamentoSIGA_(identidades, linha, mapa);
      if (identidade) {
        diagnostico.comprovantesIdentificados++;
      } else {
        diagnostico.comprovantesNaoIdentificados++;
        if (diagnostico.amostraNaoIdentificados.length < 15) {
          diagnostico.amostraNaoIdentificados.push({
            origem: 'COMPROVANTE',
            nome: campoPagUnif_(linha, mapa, ['NOME DO ALUNO', 'NOME_ALUNO'])
          });
        }
      }
    }
  }

  const valorPagoPorAlunoMesTurma = analisesCalcularValorPagoPorAlunoMesTurma_(ss, identidades);
  let totalValorPagoCalculado = 0;
  valorPagoPorAlunoMesTurma.forEach(porTurma => {
    porTurma.forEach(v => { totalValorPagoCalculado += v; });
  });
  diagnostico.chavesAlunoMes = valorPagoPorAlunoMesTurma.size;
  diagnostico.totalValorPagoCalculado = arredPagUnif_(totalValorPagoCalculado);
  diagnostico.amostraValorPago = Array.from(valorPagoPorAlunoMesTurma.entries()).slice(0, 15)
    .map(([chave, porTurma]) => ({
      chave,
      porTurma: Array.from(porTurma.entries()).map(([turma, valor]) => ({
        turma: turma || '(desconhecida)',
        valor: arredPagUnif_(valor)
      }))
    }));

  console.log(JSON.stringify(diagnostico, null, 2));
  return diagnostico;
}

/**
 * Diagnóstico manual — rode direto pelo editor do Apps Script. Diferente
 * de diagnosticarValorPagoAnalisesSIGA (que calcula ao vivo, sem tocar
 * no cache), esta função compara TRÊS números pro mesmo total:
 *   1) o cálculo AO VIVO (igual ao diagnóstico de identificação);
 *   2) o que está GRAVADO nas abas AnalisesCache_Turma/PagamentoAluno
 *      agora (resultado da última vez que "Recalcular dados" rodou);
 *   3) o que calcularMensalidadesPorTurmaAnalisesSIGA_ realmente mantém
 *      depois de aplicar o filtro extra (só matrícula com status ATIVO
 *      de fato, só turma com aluno ativo agora).
 * Se (1) for bem maior que (2)/(3), o problema é esse filtro cortando
 * pagamento de aluno que já saiu da turma — não a identificação.
 */
function diagnosticarCacheMensalidadesAnalisesSIGA() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abaMat = ss.getSheetByName('DimMatricula');
  const matriculas = lerMatriculasPagUnif_(abaMat);
  const identidades = criarIndiceIdentidadePagamentosSIGA_(ss, matriculas);
  const periodos = analisesGerarPeriodos_(ANALISES_CACHE_MESES_MAX);

  const { valorPagoPorAlunoMesTurma } = analisesCalcularFinanceiroEValorPagoSIGA_(ss, periodos, identidades);
  let totalAoVivo = 0;
  valorPagoPorAlunoMesTurma.forEach(porTurma => porTurma.forEach(v => { totalAoVivo += v; }));

  const comparativoTurmas = calcularComparativoTurmasAnalisesSIGA_(matriculas, true);
  const turmasAtivas = new Set(comparativoTurmas.filter(x => x.ativos > 0).map(x => x.turma));
  const mensalidadesPorTurma = calcularMensalidadesPorTurmaAnalisesSIGA_(matriculas, periodos, turmasAtivas, valorPagoPorAlunoMesTurma);
  let totalAposFiltroTurma = 0;
  mensalidadesPorTurma.resumoPorTurma.forEach(x => { totalAposFiltroTurma += Number(x.receita || 0); });

  const cacheTurma = analisesLerCacheTurma_();
  let totalGravadoCacheTurma = 0;
  cacheTurma.forEach(item => { totalGravadoCacheTurma += Number(item.receita || 0); });

  const cachePagamentoAluno = analisesLerCachePagamentoAluno_();
  let totalGravadoCachePagamentoAluno = 0;
  cachePagamentoAluno.forEach(porTurma => porTurma.forEach(v => { totalGravadoCachePagamentoAluno += v; }));

  const diagnostico = {
    atualizadoEm: PropertiesService.getScriptProperties().getProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM),
    totalAoVivo_semNenhumFiltro: arredPagUnif_(totalAoVivo),
    totalAposFiltroTurmaAtiva_calculadoAgora: arredPagUnif_(totalAposFiltroTurma),
    totalGravadoNoCache_AnalisesCache_Turma: arredPagUnif_(totalGravadoCacheTurma),
    totalGravadoNoCache_AnalisesCache_PagamentoAluno: arredPagUnif_(totalGravadoCachePagamentoAluno),
    linhasCacheTurma: cacheTurma.length,
    chavesCachePagamentoAluno: cachePagamentoAluno.size
  };

  console.log(JSON.stringify(diagnostico, null, 2));
  return diagnostico;
}

/**
 * Mensalidades por turma (valor REALMENTE pago pelos alunos, não o
 * valor devido), agrupado por turma e por mês. Usado só por
 * recalcularCacheAnalisesSIGA — retorna TODAS as turmas (o corte para
 * as top N usado na tela acontece na leitura do cache).
 */
function calcularMensalidadesPorTurmaAnalisesSIGA_(matriculas, periodos, turmasAtivas, valorPagoPorAlunoMesTurma) {
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

  // Toda turma ativa aparece na tabela, mesmo com R$ 0,00 no mês — sem
  // isso, uma turma cujos pagamentos não foram identificados (ou que
  // simplesmente não teve nenhum pagamento ainda) some da lista em vez
  // de aparecer zerada, o que parece a turma ter "desaparecido".
  if (turmasAtivas) {
    turmasAtivas.forEach(t => receitaPorTurmaMes.set(t, new Map()));
  }

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

    matriculasPorAluno.forEach((matsAluno, chaveAluno) => {
      const porTurmaPagamento = valorPagoPorAlunoMesTurma.get(chaveAluno + '|' + chaveMes);
      if (!porTurmaPagamento) {
        return;
      }

      // Dinheiro de verdade é atribuído por VIGÊNCIA da matrícula
      // naquele mês — nunca pelo status ATUAL do aluno. Um aluno que já
      // se formou/saiu (status hoje é CANCELADO/FORMADO/etc.) continua
      // tendo pago de verdade nos meses em que esteve lá; exigir
      // status === 'ATIVO' aqui fazia TODO o histórico de quem não está
      // mais ativo HOJE sumir da tabela (era ~95% do valor pago real).
      // m.inicio <= dataCalculo cobre o caso de uma matrícula que só
      // começa no meio do mês atual — vigenteNoMesPagUnif_ sozinho, por
      // trabalhar em granularidade de mês inteiro, consideraria o mês
      // inteiro vigente mesmo antes do início real (foi isso que fez uma
      // turma que ainda vai começar aparecer com pagamento antes).
      const ativas = matsAluno.filter(m =>
        vigenteNoMesPagUnif_(m, ref) && (!m.inicio || m.inicio <= dataCalculo)
      );
      if (!ativas.length) {
        return;
      }

      const combo = ativas.length > 1;
      const turmasDoMes = ativas
        .map(m => ({
          turma: String(m.turma || '').trim(),
          valorDevido: Number(calcularValorMatriculaPagUnif_(m, combo, ref, dataCalculo) || 0)
        }))
        .filter(d => d.turma && (!turmasAtivas || turmasAtivas.has(d.turma)));
      if (!turmasDoMes.length) {
        return;
      }

      const atribuicao = analisesAtribuirPagamentoPorTurma_(porTurmaPagamento, turmasDoMes);
      atribuicao.forEach((parcela, turma) => {
        if (!(parcela > 0)) return;
        if (!receitaPorTurmaMes.has(turma)) {
          receitaPorTurmaMes.set(turma, new Map());
        }
        const mapaMes = receitaPorTurmaMes.get(turma);
        mapaMes.set(chaveMes, (mapaMes.get(chaveMes) || 0) + parcela);
      });
    });
  });

  const resumoPorTurma = [];
  const detalhesPorTurma = new Map();

  receitaPorTurmaMes.forEach((mapaReceita, turma) => {
    let totalReceita = 0;

    const pontos = periodos.map(p => {
      const chaveMes = analisesMesRotulo_(p).chave;
      const receita = arredPagUnif_(mapaReceita.get(chaveMes) || 0);
      totalReceita += receita;
      return { periodo: analisesMesRotulo_(p).rotulo, receita };
    });

    detalhesPorTurma.set(turma, pontos);
    resumoPorTurma.push({ turma, receita: arredPagUnif_(totalReceita) });
  });

  resumoPorTurma.sort((a, b) => b.receita - a.receita);

  return { resumoPorTurma, detalhesPorTurma };
}

function analisesMesRotulo_(data) {
  const chave = Utilities.formatDate(data, Session.getScriptTimeZone(), 'yyyy-MM');
  const rotulo = ANALISES_MESES_ABREV_PT_[data.getMonth()] + '-' + String(data.getFullYear()).slice(-2);
  return { chave, rotulo };
}

/**
 * "Em curso" para fins de contagem de alunos: ATIVO ou EM ESPERA somam
 * juntos. Qualquer outro status (CANCELADO, ABANDONO, FINALIZADO,
 * SUSPENSO, INATIVO, TURMA ENCERRADA etc.) conta como saída.
 */
function analisesStatusAtivo_(status) {
  const s = normalizarPagUnif_(status);
  return s === 'ATIVO' || s === 'EM ESPERA';
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
        analisesStatusAtivo_(m.status) &&
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
      porTurma.set(turma, { turma, ativos: 0, saidas: 0, total: 0 });
    }

    const item = porTurma.get(turma);
    item.total++;

    // Todo status que não seja "em curso" (ATIVO ou EM ESPERA) conta como
    // saída — CANCELADO, ABANDONO, FINALIZADO, SUSPENSO, INATIVO, TURMA
    // ENCERRADA etc. Assim ativos + saídas sempre bate com o total, sem
    // nenhum status ficando de fora da contagem.
    if (analisesStatusAtivo_(m.status)) {
      item.ativos++;
    } else {
      item.saidas++;
    }
  });

  const lista = Array.from(porTurma.values())
    .map(item => Object.assign({}, item, {
      taxaEvasao: item.total > 0 ? arredPagUnif_((item.saidas / item.total) * 100) : 0
    }))
    .sort((a, b) => b.ativos - a.ativos);

  return incluirTodas ? lista : lista.slice(0, 20);
}

