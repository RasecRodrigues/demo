/**
 * SIGA — Análises comparativas e estratégicas
 *
 * POR QUE AS CONSTANTES TERMINAM EM _SIGA2
 * Existe outra cópia deste arquivo no projeto (hoje no Alunos.gs). Como
 * todos os .gs dividem o mesmo escopo global, dois `const` de mesmo nome
 * derrubam o projeto INTEIRO antes de qualquer função rodar — nem as
 * telas que nada têm a ver com Análises sobem. Com o sufixo, os dois
 * arquivos convivem e o sistema funciona.
 *
 * As funções continuam com os nomes de sempre. O Apps Script concatena os
 * arquivos na ordem da lista, e "Analises" vem depois de "Alunos": as
 * versões que valem são as DESTE arquivo, que são as corrigidas
 * (confirmado por procurarCopiaDoAnalisesSIGA, no fim do arquivo).
 *
 * Não é preciso desfazer o sufixo depois de limpar o Alunos.gs — nomes de
 * constante são internos, nada fora daqui depende deles.
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

const ANALISES_CACHE_SHEETS_SIGA2 = {
  GERAL: 'AnalisesCache_Geral',
  TURMA: 'AnalisesCache_Turma',
  COMPARATIVO: 'AnalisesCache_ComparativoTurmas',
  PAGAMENTO_ALUNO: 'AnalisesCache_PagamentoAluno'
};
const ANALISES_CACHE_PROP_ATUALIZADO_EM_SIGA2 = 'ANALISES_CACHE_ATUALIZADO_EM';
// Turma em que o cálculo de frequência parou por falta de tempo; a próxima
// execução retoma dela em vez de recomeçar do início da lista.
const ANALISES_CACHE_PROP_FREQ_CURSOR_SIGA2 = 'ANALISES_CACHE_FREQ_CURSOR';
const ANALISES_CACHE_MESES_MAX_SIGA2 = 36;

/**
 * Endpoint principal chamado pela tela. Só LÊ o cache — não faz nenhuma
 * varredura pesada. Na primeiríssima chamada (cache ainda não existe),
 * recalcula uma vez de forma síncrona (lento só dessa vez).
 */
function obterAnalisesSIGA(filtros) {
  filtros = filtros || {};
  validarPermissaoPagamentosSIGA_(filtros.token);

  const mesesJanela = Math.min(ANALISES_CACHE_MESES_MAX_SIGA2, Math.max(3, Number(filtros.meses) || 12));
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

  /*
   * Indicadores "AGORA":
   * - matriculasAtivasAgora = quantidade de linhas da DimMatricula com STATUS = ATIVO/ATIVA;
   * - alunosUnicosAtivosAgora = quantidade de alunos distintos com pelo menos uma matrícula ativa.
   *
   * Esses dois números são lidos diretamente da DimMatricula em cada abertura,
   * portanto não dependem do cache histórico da tela.
   */
  const ssAgora = SpreadsheetApp.getActiveSpreadsheet();
  const abaMatAgora = ssAgora.getSheetByName('DimMatricula');
  const matriculasAgora = abaMatAgora ? lerMatriculasPagUnif_(abaMatAgora) : [];

  const ativasAgora = matriculasAgora.filter(m => {
    const status = normalizarPagUnif_(m && m.status || '');
    return status === 'ATIVO' || status === 'ATIVA';
  });

  const matriculasAtivasAgora = ativasAgora.length;

  const alunosAtivosSet = new Set();
  ativasAgora.forEach(m => {
    const chaveAluno =
      String(m.idAluno || '').trim() ||
      normalizarPagUnif_(m.nome || '');

    if (chaveAluno) {
      alunosAtivosSet.add(chaveAluno);
    }
  });

  const alunosUnicosAtivosAgora = alunosAtivosSet.size;

  /*
   * Mantém alunosAtivos por compatibilidade com o front atual.
   * Agora ele representa ALUNOS ÚNICOS ativos, que é coerente com
   * o rótulo "Alunos ativos agora".
   */
  const alunosAtivos = alunosUnicosAtivosAgora;

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
    atualizadoEm: PropertiesService.getScriptProperties().getProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM_SIGA2) || null,
    resumo: {
      alunosAtivos,
      alunosUnicosAtivosAgora,
      matriculasAtivasAgora,
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
 *
 * A conta é a MESMA de calcularMensalidadesPorTurmaAnalisesSIGA_, que
 * produziu a linha da tabela: mesmo filtro de vigência
 * (analisesMatriculaNoRateio_), mesmo recorte por turmas ativas e mesmo
 * arredondamento por mês. Só assim o rodapé "Total conferido" fecha com a
 * linha de cima por construção — e é isso que rateioVersao: 2 promete à
 * tela. Qualquer divergência que apareça depois é dado, não versão.
 */
function obterAlunosPagamentosPorTurmaAnalisesSIGA(filtros) {
  filtros = filtros || {};
  validarPermissaoPagamentosSIGA_(filtros.token);

  const turmaAlvo = String(filtros.turma || '').trim();
  const periodos = analisesPeriodosEntreChaves_(filtros.mesInicial, filtros.mesFinal);
  if (!turmaAlvo || !periodos.length) {
    return { sucesso: true, rateioVersao: 2, turma: turmaAlvo, alunos: [] };
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

  /*
   * O mesmo conjunto de turmas que o cache usou ao montar a tabela. Sem
   * este recorte, uma matrícula em turma fora da lista entra no rateio e
   * leva uma fatia embora: a soma dos alunos sai MENOR que a linha da
   * tabela, e a tela acusa divergência sem que nada esteja errado nos
   * dados.
   */
  const turmasAtivas = new Set(
    analisesLerCacheComparativoTurmas_().filter(x => x.ativos > 0).map(x => x.turma)
  );

  const matriculasPorAluno = new Map();
  const nomePorAluno = new Map();
  matriculas.forEach(m => {
    const chave = m.chaveAluno || normalizarPagUnif_(m.idAluno || m.nome);
    if (!chave) return;
    if (!matriculasPorAluno.has(chave)) {
      matriculasPorAluno.set(chave, []);
    }
    matriculasPorAluno.get(chave).push(m);
    if (!nomePorAluno.has(chave) && m.nome) nomePorAluno.set(chave, m.nome);
  });

  const hoje = new Date();
  const inicioMesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

  // chaveAluno -> (chaveMes -> parcela em reais, ainda sem arredondar)
  const parcelaPorAlunoMes = new Map();
  // chaveMes -> soma bruta da turma, para arredondar igual à tabela
  const brutoPorMes = new Map();

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
      // Mesma regra da coluna da turma em calcularMensalidadesPorTurmaAnalisesSIGA_:
      // o rateio de um pagamento tem que enxergar TODAS as matrículas vigentes
      // na competência, inclusive as de turma já encerrada. Filtrar por status
      // ATIVO/SUSPENSO aqui escondia a matrícula encerrada do aluno e jogava o
      // pagamento inteiro na turma que sobrou — era por isso que o Caio
      // aparecia com R$ 260,00 na INTERMED1 (R$ 180,00 dela + R$ 80,00 da I22)
      // e a soma dos alunos estourava o total da coluna, que já rateava certo.
      const vigentes = matsAluno.filter(m => analisesMatriculaNoRateio_(m, ref, dataCalculo));
      if (!vigentes.length) return;

      // Valor REALMENTE pago pelo aluno nesse mês (boleto pago +
      // comprovante), atribuído à turma certa quando o próprio pagamento
      // já identifica qual foi (turma na Comprovante de pagamento, ou
      // "Nome - Turma" no boleto); só cai no rateio proporcional (por
      // valor devido) a parte de turma desconhecida.
      const porTurmaPagamento = valorPagoPorAlunoMesTurma.get(chaveAluno + '|' + chaveMes);
      if (!porTurmaPagamento) return;

      const combo = vigentes.length > 1;
      const turmasDoMes = vigentes
        .map(m => ({
          turma: String(m.turma || '').trim(),
          valorDevido: Number(analisesCalcularValorMatricula_(m, combo, ref, dataCalculo) || 0)
        }))
        .filter(d => d.turma && turmasAtivas.has(d.turma));
      if (!turmasDoMes.length) return;

      const parcela = analisesAtribuirPagamentoPorTurma_(porTurmaPagamento, turmasDoMes).get(turmaAlvo) || 0;
      if (!(parcela > 0)) return;

      if (!parcelaPorAlunoMes.has(chaveAluno)) parcelaPorAlunoMes.set(chaveAluno, new Map());
      const mapaMes = parcelaPorAlunoMes.get(chaveAluno);
      mapaMes.set(chaveMes, (mapaMes.get(chaveMes) || 0) + parcela);
      brutoPorMes.set(chaveMes, (brutoPorMes.get(chaveMes) || 0) + parcela);
    });
  });

  const alunos = analisesFecharCentavosPorMesAnalises_(
    parcelaPorAlunoMes, brutoPorMes, nomePorAluno, periodos
  );

  return { sucesso: true, rateioVersao: 2, turma: turmaAlvo, alunos };
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
    atualizadoEm: PropertiesService.getScriptProperties().getProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM_SIGA2)
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
  const inicioExecucao = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(ANALISES_CACHE_SHEETS_SIGA2.GERAL)) {
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('O cache de Análises está sendo calculado por outra requisição. Tente novamente em instantes.');
  }
  let nucleo;
  try {
    if (ss.getSheetByName(ANALISES_CACHE_SHEETS_SIGA2.GERAL)) {
      return; // outra execução já terminou de criar o cache enquanto esperávamos o lock
    }
    nucleo = analisesRecalcularCacheNucleoSemLock_(ss);
  } finally {
    lock.releaseLock();
  }
  if (nucleo) {
    analisesAtualizarMensalidadesCacheSemLock_(ss, nucleo);
    analisesAtualizarFrequenciaCacheComOrcamento_(ss, nucleo.comparativoTurmas, inicioExecucao);
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
  const inicioExecucao = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const nucleo = analisesRecalcularCacheNucleoComLock_(ss);
  analisesAtualizarMensalidadesCacheSemLock_(ss, nucleo);
  analisesAtualizarFrequenciaCacheComOrcamento_(ss, nucleo.comparativoTurmas, inicioExecucao);
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
  const periodos = analisesGerarPeriodos_(ANALISES_CACHE_MESES_MAX_SIGA2);

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

  PropertiesService.getScriptProperties().setProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM_SIGA2, new Date().toISOString());
}




/* ==========================================================================
   EXPORTAÇÃO EM PDF
   ========================================================================== */

const ANALISES_PDF_CONFIG_SIGA2 = {
  NOME_ESCOLA: 'Casa de Artes Gabriel Engel',
  NOME_PASTA: 'SIGA - Relatórios de Análises'
};

/**
 * Gera o PDF da tela de Análises.
 *
 * Mesmo princípio de gerarPdfAlunosTurmaSIGA: a tela já calculou e já
 * ordenou tudo, então ela manda o que está na tela e aqui só desenhamos.
 * Além de ser rápido (nada de varrer planilha de novo, num script que já
 * anda perto do limite de 6 min), garante que o PDF sai idêntico ao que a
 * pessoa está vendo — mesma ordenação, mesmos filtros.
 *
 * dados = {
 *   token, periodo, atualizadoEm,
 *   kpis:   [ { rotulo, valor } ],
 *   blocos: [ { titulo, subtitulo, colunas: [], linhas: [ [] ] } ]
 * }
 *
 * Cada bloco é uma tabela (colunas + linhas) ou um gráfico (imagem PNG em
 * data URL, rasterizada pela própria tela a partir do SVG que está
 * aparecendo). O conversor de HTML para PDF do Apps Script não desenha SVG,
 * por isso a rasterização acontece no navegador e não aqui.
 */
function gerarPdfAnalisesSIGA(dados) {
  dados = dados || {};
  validarPermissaoPagamentosSIGA_(dados.token);

  const blocos = Array.isArray(dados.blocos)
    ? dados.blocos.filter(b => b && (b.imagem || (b.linhas && b.linhas.length)))
    : [];
  if (!blocos.length) {
    throw new Error('Não há dados na tela para exportar. Aguarde o carregamento terminar e tente de novo.');
  }

  const timezone = Session.getScriptTimeZone();
  const agora = new Date();
  const geradoEm = Utilities.formatDate(agora, timezone, "dd/MM/yyyy 'às' HH:mm");

  const kpis = Array.isArray(dados.kpis) ? dados.kpis : [];
  const partes = [];

  partes.push('<div class="capa">');
  partes.push('<div class="escola">' + escapeHtmlAnalisesPdf_(ANALISES_PDF_CONFIG_SIGA2.NOME_ESCOLA) + '</div>');
  partes.push('<h1>Análises</h1>');
  partes.push('<div class="meta">Período: <strong>' + escapeHtmlAnalisesPdf_(dados.periodo || '—') + '</strong>'
    + ' &nbsp;·&nbsp; Gerado em ' + escapeHtmlAnalisesPdf_(geradoEm)
    + (dados.atualizadoEm ? ' &nbsp;·&nbsp; ' + escapeHtmlAnalisesPdf_(dados.atualizadoEm) : '')
    + '</div>');
  partes.push('</div>');

  if (kpis.length) {
    partes.push('<div class="kpis">');
    kpis.forEach(k => {
      partes.push('<div class="kpi"><span>' + escapeHtmlAnalisesPdf_(k.rotulo) + '</span><strong>'
        + escapeHtmlAnalisesPdf_(k.valor) + '</strong></div>');
    });
    partes.push('</div>');
  }

  blocos.forEach(bloco => {
    /*
     * Tabela com muitas colunas (as de turma x mês passam de dez) recebe
     * uma classe própria: sem ela o navegador alarga a tabela além da
     * folha e as últimas colunas saem cortadas do PDF.
     */
    const colunasDoBloco = (bloco.colunas || []).length;
    partes.push(
      '<section class="bloco'
      + (bloco.imagem ? ' grafico-bloco' : '')
      + (!bloco.imagem && colunasDoBloco > 8 ? ' tabela-larga' : '')
      + '">'
    );
    partes.push('<h2>' + escapeHtmlAnalisesPdf_(bloco.titulo || '') + '</h2>');
    if (bloco.subtitulo) {
      partes.push('<p class="sub">' + escapeHtmlAnalisesPdf_(bloco.subtitulo) + '</p>');
    }

    /*
     * Gráfico: a tela rasteriza o SVG em PNG e manda a data URL. Rasterizar
     * no navegador em vez de mandar o SVG é o que torna isso confiável — o
     * conversor de HTML para PDF do Apps Script não desenha SVG.
     */
    if (bloco.imagem) {
      partes.push('<img class="grafico" src="' + escapeHtmlAnalisesPdf_(bloco.imagem) + '">');
      partes.push('</section>');
      return;
    }

    partes.push('<table><thead><tr>');
    (bloco.colunas || []).forEach((coluna, indice) => {
      partes.push('<th' + (indice ? ' class="num"' : '') + '>' + escapeHtmlAnalisesPdf_(coluna) + '</th>');
    });
    partes.push('</tr></thead><tbody>');
    (bloco.linhas || []).forEach(linha => {
      partes.push('<tr>');
      (linha || []).forEach((celula, indice) => {
        const texto = String(celula == null ? '' : celula);
        const negativo = indice > 0 && texto.indexOf('-') === 0;
        partes.push('<td' + (indice ? (negativo ? ' class="num neg"' : ' class="num"') : '') + '>'
          + escapeHtmlAnalisesPdf_(texto) + '</td>');
      });
      partes.push('</tr>');
    });
    partes.push('</tbody></table>');
    partes.push('</section>');
  });

  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    + '@page{size:A4 landscape;margin:12mm 10mm}'
    + 'body{font-family:Helvetica,Arial,sans-serif;color:#111;font-size:9px;margin:0}'
    + '.capa{border-bottom:2px solid #6B007B;padding-bottom:8px;margin-bottom:12px}'
    + '.escola{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#6B007B;font-weight:bold}'
    + 'h1{font-size:20px;margin:4px 0 3px}'
    + '.meta{font-size:9px;color:#555}'
    + '.kpis{display:table;width:100%;table-layout:fixed;margin-bottom:14px;border-spacing:6px 0}'
    + '.kpi{display:table-cell;border:1px solid #ddd;border-radius:5px;padding:7px 9px}'
    + '.kpi span{display:block;font-size:7.5px;letter-spacing:.05em;text-transform:uppercase;color:#666}'
    + '.kpi strong{display:block;font-size:14px;margin-top:2px}'
    + '.bloco{page-break-inside:auto;margin-bottom:16px}'
    + '.bloco.grafico-bloco{page-break-inside:avoid}'
    /*
     * 95mm espremia os gráficos de barras horizontais: object-fit contain
     * escala pela dimensão mais apertada, então uma imagem alta encolhia
     * até a altura caber e sobrava metade da folha em branco dos dois
     * lados. 162mm é o que resta da altura útil (A4 paisagem, 186mm)
     * depois do título do bloco, e faz a LARGURA voltar a ser o limite.
     */
    + 'img.grafico{width:100%;max-height:162mm;object-fit:contain;display:block}'
    + 'td,th{overflow-wrap:anywhere}'
    + '.bloco.tabela-larga table{table-layout:fixed;font-size:7px}'
    + '.bloco.tabela-larga th,.bloco.tabela-larga td{padding:3px 4px}'
    + '.bloco.tabela-larga th:first-child,.bloco.tabela-larga td:first-child{width:13%}'
    + 'h2{font-size:12px;margin:0 0 2px;color:#6B007B}'
    + '.sub{font-size:8px;color:#666;margin:0 0 6px}'
    + 'table{width:100%;border-collapse:collapse}'
    + 'thead{display:table-header-group}'
    + 'tr{page-break-inside:avoid}'
    + 'th{background:#f4f3ef;border-bottom:1px solid #ccc;padding:5px 6px;text-align:left;'
    + 'font-size:7.5px;letter-spacing:.03em;text-transform:uppercase;color:#444}'
    + 'td{border-bottom:1px solid #eee;padding:4px 6px}'
    + 'th.num,td.num{text-align:right}'
    + 'td.neg{color:#b0201d}'
    + '</style></head><body>' + partes.join('') + '</body></html>';

  const nomeArquivo = 'analises_' + Utilities.formatDate(agora, timezone, 'yyyy-MM-dd_HHmm') + '.pdf';
  const pdf = Utilities.newBlob(html, 'text/html', 'analises.html').getAs(MimeType.PDF).setName(nomeArquivo);
  const arquivo = obterPastaRelatoriosAnalisesSIGA_().createFile(pdf);

  /*
   * O app roda como o dono da planilha, então o PDF nasce privado. Sem esta
   * linha o funcionário cai na tela "Você precisa de permissão" do Drive.
   */
  arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    sucesso: true,
    url: arquivo.getUrl(),
    urlDownload: 'https://drive.google.com/uc?export=download&id=' + arquivo.getId(),
    nome: arquivo.getName()
  };
}

function obterPastaRelatoriosAnalisesSIGA_() {
  const propriedades = PropertiesService.getScriptProperties();
  const idSalvo = propriedades.getProperty('PASTA_RELATORIOS_ANALISES_ID');
  if (idSalvo) {
    try {
      return DriveApp.getFolderById(idSalvo);
    } catch (erro) {
      // pasta apagada: cai fora e cria outra
    }
  }
  const iterador = DriveApp.getFoldersByName(ANALISES_PDF_CONFIG_SIGA2.NOME_PASTA);
  const pasta = iterador.hasNext() ? iterador.next() : DriveApp.createFolder(ANALISES_PDF_CONFIG_SIGA2.NOME_PASTA);
  propriedades.setProperty('PASTA_RELATORIOS_ANALISES_ID', pasta.getId());
  return pasta;
}

function escapeHtmlAnalisesPdf_(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Entradas e saídas de alunos por mês, opcionalmente de UMA turma.
 *
 * Chamada sob demanda pelo gráfico "Entradas e saídas de alunos por mês" —
 * de propósito fora do cache de Análises: lê só a DimMatricula (nada de
 * TodosBoletos/Comprovante), então roda em segundos e sempre reflete o
 * cadastro atual, sem esperar o recálculo de 6 horas.
 *
 * Entrada  = matrícula cuja data de início cai no mês.
 * Saída    = matrícula cuja data de encerramento cai no mês.
 *
 * Matrícula encerrada SEM data de encerramento preenchida não entra na
 * contagem de saídas — não há como saber em que mês ela saiu. É a mesma
 * limitação que analisesMatriculaNoRateio_ trata no rateio de pagamentos:
 * o conserto é preencher DATA_CANCELAMENTO/FINALIZACAO no cadastro.
 * O total dessas linhas volta em "saidasSemData" para a tela poder avisar.
 */
function obterMovimentacaoTurmaAnalisesSIGA(filtros) {
  filtros = filtros || {};
  validarPermissaoPagamentosSIGA_(filtros.token);

  const meses = Math.max(1, Math.min(36, Number(filtros.meses || 12)));
  const turmaAlvo = String(filtros.turma || '').trim();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const matriculas = lerMatriculasPagUnif_(ss.getSheetByName('DimMatricula'));

  const periodos = analisesGerarPeriodos_(meses);
  const entradas = new Map();
  const saidas = new Map();

  /*
   * IMPORTANTE:
   * Este gráfico chama-se "ALUNOS ativos por mês".
   * Portanto a contagem precisa ser por ALUNO ÚNICO, e não por linha
   * de matrícula. Um aluno em duas turmas não pode aparecer duas vezes
   * quando o filtro está em "Todas as turmas".
   */
  const alunosAtivosPorMes = new Map();

  /*
   * A tela mostra DUAS séries: alunos únicos e matrículas ativas. Um
   * aluno em duas turmas é 1 aluno e 2 matrículas — por isso o Set para
   * um e um contador simples para o outro. Mandar o mesmo número nas
   * duas seria mentira, e é por isso que a tela recusa a resposta que
   * não traz as duas.
   */
  const matriculasAtivasPorMes = new Map();

  periodos.forEach(p => {
    const chave = analisesMesRotulo_(p).chave;
    entradas.set(chave, 0);
    saidas.set(chave, 0);
    alunosAtivosPorMes.set(chave, new Set());
    matriculasAtivasPorMes.set(chave, 0);
  });

  const turmas = new Set();
  let saidasSemData = 0;

  const hoje = new Date();
  const limites = periodos.map(p => ({
    chave: analisesMesRotulo_(p).chave,
    inicio: p,
    fim: new Date(p.getFullYear(), p.getMonth() + 1, 0, 23, 59, 59, 999),
    ehMesAtual:
      p.getFullYear() === hoje.getFullYear() &&
      p.getMonth() === hoje.getMonth()
  }));

  matriculas.forEach(m => {
    const turma = String(m.turma || '').trim();
    if (turma) turmas.add(turma);
    if (turmaAlvo && turma !== turmaAlvo) return;

    const chaveAluno =
      String(m.idAluno || '').trim() ||
      normalizarPagUnif_(m.nome || '');

    if (!chaveAluno) return;

    if (m.inicio instanceof Date) {
      const chave = analisesMesRotulo_(m.inicio).chave;
      if (entradas.has(chave)) {
        entradas.set(chave, entradas.get(chave) + 1);
      }
    }

    if (m.fim instanceof Date) {
      const chave = analisesMesRotulo_(m.fim).chave;
      if (saidas.has(chave)) {
        saidas.set(chave, saidas.get(chave) + 1);
      }
    } else if (!analisesEmCursoParaMovimentacao_(m)) {
      saidasSemData++;
    }

    limites.forEach(lim => {
      let estaAtivo = false;

      if (lim.ehMesAtual) {
        /*
         * MÊS ATUAL = situação de AGORA.
         * Não projetamos até o último dia do mês.
         */
        const statusAtual = normalizarPagUnif_(m.status || '');
        estaAtivo = statusAtual === 'ATIVO' || statusAtual === 'ATIVA';
      } else {
        /*
         * MESES FECHADOS = vigência histórica.
         */
        estaAtivo = analisesAtivoNoMes_(m, lim.inicio, lim.fim);
      }

      if (estaAtivo) {
        alunosAtivosPorMes.get(lim.chave).add(chaveAluno);
        matriculasAtivasPorMes.set(lim.chave, matriculasAtivasPorMes.get(lim.chave) + 1);
      }
    });
  });

  const serie = periodos.map(p => {
    const { chave, rotulo } = analisesMesRotulo_(p);
    const ent = entradas.get(chave) || 0;
    const sai = saidas.get(chave) || 0;

    const alunos = alunosAtivosPorMes.get(chave) ? alunosAtivosPorMes.get(chave).size : 0;

    return {
      periodo: rotulo,
      alunosAtivos: alunos,
      matriculasAtivas: matriculasAtivasPorMes.get(chave) || 0,
      // Mantido pelo nome antigo para não quebrar nada que ainda leia
      // `ativos`. Continua sendo a contagem de ALUNOS, como antes.
      ativos: alunos,
      entradas: ent,
      saidas: sai,
      saldo: ent - sai
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
 * O aluno estava ativo NAQUELE mês?
 *
 * Conta por VIGÊNCIA da matrícula, não pelo status atual. É a diferença
 * para calcularSerieMatriculasAnalisesSIGA_, que exige
 * analisesStatusAtivo_(m.status) — status é o de HOJE, então quem já saiu
 * deixa de ser contado até nos meses em que ainda estava na turma, e a
 * série histórica de ativos fica menor do que foi de verdade.
 *
 * Sem data de fim não dá para saber quando saiu: aí sim o status atual
 * decide — se a pessoa ainda está em curso, a matrícula segue aberta.
 */
function analisesAtivoNoMes_(m, inicioMes, fimMes) {
  if (!m || !(m.inicio instanceof Date)) return false;
  if (m.inicio > fimMes) return false;
  if (m.fim instanceof Date) return m.fim >= inicioMes;
  return analisesEmCursoParaMovimentacao_(m);
}

/** Matrícula que ainda não é uma saída: aluno em curso ou em espera. */
function analisesEmCursoParaMovimentacao_(m) {
  const status = normalizarPagUnif_(m && m.status || '');
  return status === 'ATIVO' || status === 'ATIVA' || status === 'EM ESPERA' || status === 'SUSPENSO' || status === 'SUSPENSA';
}

/**
 * Uma matrícula entra no rateio de um pagamento daquele mês?
 *
 * vigenteNoMesPagUnif_ sozinho considera vigente qualquer matrícula SEM data
 * de encerramento preenchida — ou seja, para sempre. Uma linha antiga de
 * turma que já acabou, mas cuja DATA_CANCELAMENTO/FINALIZACAO ficou em
 * branco, passava a disputar todo pagamento futuro: além de roubar uma
 * fatia, a presença dela ligava o preço de COMBO, e o aluno aparecia
 * pagando um valor quebrado numa turma em que pagou o valor cheio.
 *
 * Por isso, matrícula com status de saída só conta se o encerramento
 * estiver datado. Note que a lista de status abaixo não é fechada: qualquer
 * status que não seja de aluno em curso (ATIVO/SUSPENSO) cai na mesma
 * exigência — inclusive "TURMA ENCERRADA", que não aparece na lista de
 * encerrados do Pagamentos.
 */
function analisesMatriculaNoRateio_(m, ref, dataCalculo) {
  if (!m) return false;
  if (!vigenteNoMesPagUnif_(m, ref)) return false;
  if (m.inicio && m.inicio > dataCalculo) return false;
  const status = normalizarPagUnif_(m.status || '');
  if (status === 'ATIVO' || status === 'ATIVA' || status === 'SUSPENSO' || status === 'SUSPENSA') {
    return true;
  }
  return Boolean(m.fim);
}

/**
 * O valor devido de uma matrícula é calculado no Pagamentos, cujo nome de
 * função carrega o número da versão (hoje calcularValorMatriculaPagUnifV38_).
 * Análises chamava o nome SEM o sufixo, que não existe: as duas chamadas
 * quebravam com "calcularValorMatriculaPagUnif_ is not defined", derrubando
 * tanto o clique numa turma quanto a gravação do cache de mensalidades — e,
 * como o recálculo morria aí, as etapas seguintes (receita e frequência)
 * nunca rodavam e a tela seguia mostrando números velhos.
 *
 * Resolver o nome em tempo de execução faz a próxima renumeração (V39...)
 * falhar com uma mensagem que diz o que fazer, em vez de um ReferenceError.
 */
function analisesCalcularValorMatricula_(m, combo, ref, dataCalculo) {
  if (typeof calcularValorMatriculaPagUnifV38_ === 'function') {
    return calcularValorMatriculaPagUnifV38_(m, combo, ref, dataCalculo);
  }
  if (typeof calcularValorMatriculaPagUnif_ === 'function') {
    return calcularValorMatriculaPagUnif_(m, combo, ref, dataCalculo);
  }
  throw new Error('Análises não encontrou a função de cálculo do valor da matrícula (esperada calcularValorMatriculaPagUnifV38_ no arquivo Pagamentos). Se ela foi renomeada, atualize analisesCalcularValorMatricula_ no Analises.');
}

/**
 * SUBSTITUI a etapa de frequência.
 *
 * Três mudanças além de preservar o que já existe:
 *
 * 1. Turmas SEM média calculada vão para o começo da fila. Antes o cursor
 *    girava na ordem do comparativo, então uma turma do fim da lista podia
 *    passar rodadas sem nunca ser calculada.
 * 2. Turma sem aula no período mantém o valor anterior em vez de virar 0 —
 *    zero significaria "ninguém apareceu", que é outra coisa.
 * 3. Uma gravação em lote só, na coluna 6, em vez de célula a célula com
 *    flush a cada turma.
 *
 * NÃO lança exceção em nenhum caminho: esta função roda dentro de
 * garantirCacheAnalisesSIGA_, que por sua vez roda dentro de
 * obterAnalisesSIGA. Um throw aqui quebraria a tela inteira por causa de
 * um número acessório.
 */
function analisesAtualizarFrequenciaCacheComOrcamento_(ss, comparativoTurmas, inicioExecucao) {
  const vazio = { processadas: 0, atualizadas: 0, pendentes: 0 };

  // Portal do Professor ausente: a frequência simplesmente não entra.
  // O resto do cache (matrículas, receita, lucro) já foi gravado.
  if (typeof obterPainelFrequenciaTurma !== 'function') {
    console.warn('obterPainelFrequenciaTurma não existe — frequência não atualizada.');
    return vazio;
  }

  const aba = ss.getSheetByName(ANALISES_CACHE_SHEETS_SIGA2.COMPARATIVO);
  if (!aba || aba.getLastRow() < 2 || aba.getLastColumn() < 6) return vazio;

  // O orçamento conta a execução INTEIRA: as etapas anteriores já
  // consumiram parte do limite de 6 min do Apps Script.
  const inicio = inicioExecucao instanceof Date
    ? inicioExecucao.getTime()
    : Number(inicioExecucao) || Date.now();
  const ORCAMENTO_MS = 4.5 * 60 * 1000;

  const periodos = analisesGerarPeriodos_(3);
  if (!periodos.length) return vazio;
  const mesInicial = analisesMesRotulo_(periodos[0]).chave;
  const mesFinal = analisesMesRotulo_(periodos[periodos.length - 1]).chave;

  const dados = aba.getRange(2, 1, aba.getLastRow() - 1, 6).getValues();
  const porTurma = new Map();
  dados.forEach(linha => {
    const turma = String(linha[0] || '').trim();
    if (turma) porTurma.set(turma, linha);
  });

  const origem = Array.isArray(comparativoTurmas) && comparativoTurmas.length
    ? comparativoTurmas
    : dados.map(linha => ({ turma: linha[0], ativos: linha[1] }));

  const nomes = Array.from(new Set(
    origem
      .filter(item => Number(item.ativos) > 0)
      .map(item => String(item.turma || '').trim())
      .filter(turma => turma && porTurma.has(turma))
  ));

  // Quem ainda não tem número vem primeiro.
  const pendentes = [];
  const preenchidas = [];
  nomes.forEach(turma => {
    const media = analisesNumeroFrequenciaCacheV3_(porTurma.get(turma)[5]);
    (media === null ? pendentes : preenchidas).push(turma);
  });
  const fila = pendentes.concat(preenchidas);

  const props = PropertiesService.getScriptProperties();
  if (!fila.length) {
    props.deleteProperty(ANALISES_CACHE_PROP_FREQ_CURSOR_SIGA2);
    return vazio;
  }

  const retomada = props.getProperty(ANALISES_CACHE_PROP_FREQ_CURSOR_SIGA2) || '';
  const encontrado = retomada ? fila.indexOf(retomada) : -1;
  const indiceInicial = encontrado >= 0 ? encontrado : 0;

  const calculadas = new Map();
  let processadas = 0;
  let semAulas = 0;
  let erros = 0;
  let proximaTurma = '';

  for (let passo = 0; passo < fila.length; passo++) {
    const turma = fila[(indiceInicial + passo) % fila.length];

    if (Date.now() - inicio >= ORCAMENTO_MS) {
      proximaTurma = turma; // retoma exatamente daqui na próxima execução
      break;
    }
    processadas++;

    try {
      const painel = obterPainelFrequenciaTurma({ turma, mesInicial, mesFinal });
      const resumo = painel && painel.resumo;
      const aulas = resumo ? Number(resumo.totalAulas) : 0;

      // Sem aula no período não há frequência a afirmar: preserva o que
      // havia em vez de gravar 0.
      if (!Number.isFinite(aulas) || aulas <= 0) {
        semAulas++;
        continue;
      }

      const media = analisesNumeroFrequenciaCacheV3_(resumo.mediaFrequencia);
      if (media === null) {
        erros++;
        console.warn('Média de frequência inválida em ' + turma);
        continue;
      }

      calculadas.set(turma, media);
    } catch (erro) {
      erros++;
      console.warn('Frequência não atualizada em ' + turma + ': ' +
        (erro && erro.message ? erro.message : String(erro)));
    }
  }

  let atualizadas = 0;

  // Relê a aba na hora de gravar: entre o cálculo e a escrita, uma
  // execução concorrente pode ter recriado o cache. Escrever a partir do
  // retrato antigo desfaria o trabalho dela.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    // Sem exceção de propósito: isto roda no gatilho de 6h e dentro da
    // primeira abertura da tela. Falhar aqui derrubaria a execução
    // inteira por causa de contenção momentânea. O cursor NÃO é salvo,
    // então a próxima rodada recalcula exatamente estas turmas.
    console.warn('Cache ocupado — frequência será gravada na próxima execução.');
    return { processadas, atualizadas: 0, pendentes: pendentes.length, semAulas, erros };
  }

  try {
    const atual = ss.getSheetByName(ANALISES_CACHE_SHEETS_SIGA2.COMPARATIVO);
    if (atual && atual.getLastRow() >= 2 && atual.getLastColumn() >= 6) {
      const linhas = atual.getRange(2, 1, atual.getLastRow() - 1, 6).getValues();

      const coluna = linhas.map(linha => {
        const turma = String(linha[0] || '').trim();
        if (!calculadas.has(turma)) return [linha[5]];
        const media = calculadas.get(turma);
        const anterior = analisesNumeroFrequenciaCacheV3_(linha[5]);
        if (typeof linha[5] !== 'number' || anterior !== media) atualizadas++;
        return [media];
      });

      if (atualizadas > 0) {
        atual.getRange(2, 6, coluna.length, 1).setValues(coluna);
        SpreadsheetApp.flush();
      }
    }

    props.setProperty(ANALISES_CACHE_PROP_FREQ_CURSOR_SIGA2, proximaTurma);
  } finally {
    lock.releaseLock();
  }

  const resultado = {
    mesInicial, mesFinal,
    turmasAtivas: fila.length,
    processadas, atualizadas, semAulas, erros,
    pendentes: pendentes.length,
    proximaTurma
  };
  console.log(JSON.stringify({ frequenciaAnalises: resultado }, null, 2));
  return resultado;
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

const ANALISES_MESES_ABREV_PT_SIGA2 = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function analisesChaveParaRotulo_(chave) {
  const partes = String(chave).split('-');
  const mes = Number(partes[1]);
  return ANALISES_MESES_ABREV_PT_SIGA2[mes - 1] + '-' + partes[0].slice(-2);
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
  const aba = analisesObterOuCriarAbaCache_(ss, ANALISES_CACHE_SHEETS_SIGA2.GERAL, ['Mes', 'Ativos', 'Novas', 'Cancelamentos', 'Receita']);
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
  const aba = analisesObterOuCriarAbaCache_(ss, ANALISES_CACHE_SHEETS_SIGA2.TURMA, ['Mes', 'Turma', 'Receita', 'CustoProfessor']);
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
  const aba = analisesObterOuCriarAbaCache_(ss, ANALISES_CACHE_SHEETS_SIGA2.PAGAMENTO_ALUNO, ['ChaveAlunoMes', 'Turma', 'Valor']);
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

/**
 * SUBSTITUI o gravador do comparativo.
 *
 * A leitura acontece antes de analisesObterOuCriarAbaCache_, que faz
 * clearContents() — depois dela não haveria mais o que preservar.
 */
function analisesGravarCacheComparativoTurmas_(ss, comparativoTurmas, frequenciaPorTurma) {
  const frequencias = analisesLerFrequenciasCacheComparativo_(ss);

  if (frequenciaPorTurma instanceof Map) {
    frequenciaPorTurma.forEach((valor, turma) => {
      const media = analisesNumeroFrequenciaCacheV3_(valor);
      if (media !== null) frequencias.set(String(turma || '').trim(), media);
    });
  }

  const aba = analisesObterOuCriarAbaCache_(
    ss,
    ANALISES_CACHE_SHEETS_SIGA2.COMPARATIVO,
    ['Turma', 'Ativos', 'Saidas', 'Total', 'TaxaEvasao', 'FrequenciaMedia']
  );

  const linhas = (comparativoTurmas || []).map(item => {
    const turma = String(item.turma || '').trim();
    const media = frequencias.has(turma) ? frequencias.get(turma) : null;
    return [
      turma,
      Number(item.ativos || 0),
      Number(item.saidas || 0),
      Number(item.total || 0),
      Number(item.taxaEvasao || 0),
      media === null ? '' : media
    ];
  });

  if (linhas.length) {
    aba.getRange(2, 1, linhas.length, 6).setValues(linhas);
  }
}

function analisesLerCacheGeral_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName(ANALISES_CACHE_SHEETS_SIGA2.GERAL);
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
  const aba = ss.getSheetByName(ANALISES_CACHE_SHEETS_SIGA2.TURMA);
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
  const aba = ss.getSheetByName(ANALISES_CACHE_SHEETS_SIGA2.COMPARATIVO);
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
  const aba = ss.getSheetByName(ANALISES_CACHE_SHEETS_SIGA2.PAGAMENTO_ALUNO);
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
 * naquele mês vigentes NAQUELE MÊS (cada uma com seu valorDevido, usado
 * como PROPORÇÃO pra ratear a parte de turma que não bate com nenhuma
 * delas). Retorna Map<turma, valorPago>.
 *
 * Um pagamento cuja turma não bate com nenhuma das turmas vigentes do
 * aluno naquele mês SEMPRE é rateado, nunca descartado — isso inclui
 * tanto turma vazia (não identificada) quanto uma turma preenchida que
 * não é o nome de uma turma de verdade, como "COMBO TC" na aba
 * Comprovante de pagamento (é o nome do PACOTE combo de pagamento, não
 * o TURMA de uma matrícula da DimMatricula — nunca vai bater com
 * nomesTurmasDoMes). Descartar esse caso — como este código já fez no
 * passado — apagava por completo o pagamento de quem paga em pacote
 * combo, mesmo ele tendo uma turma vigente pra ratear.
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
    } else {
      valorDesconhecido += valor;
    }
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
  const periodos = analisesGerarPeriodos_(ANALISES_CACHE_MESES_MAX_SIGA2);

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
    atualizadoEm: PropertiesService.getScriptProperties().getProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM_SIGA2),
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
 * Diagnóstico manual pra UM aluno específico — rode direto pelo editor
 * do Apps Script passando um trecho do nome (ex.: "Franciny Ribeiro") e,
 * opcionalmente, uma chave de mês "yyyy-MM" (ex.: "2026-08"; sem isso,
 * mostra todos os meses). Imprime: 1) todas as linhas da DimMatricula
 * que batem com esse nome (turma, status, início, fim — pra ver se tem
 * linha antiga sem DATA_CANCELAMENTO/FINALIZACAO preenchida, o que a
 * faria contar como "vigente pra sempre" e diluir o pagamento entre
 * turmas); 2) todo pagamento (boleto/comprovante) encontrado pra esse
 * aluno, com a turma exatamente como foi extraída de cada um — pra ver
 * se a grafia bate com o campo TURMA da DimMatricula ou se é um rótulo
 * de pacote (ex.: "COMBO TC") que precisa cair no rateio proporcional
 * (analisesAtribuirPagamentoPorTurma_) em vez de bater direto.
 */
function diagnosticarAlunoAnalisesSIGA(nomeParcial, mesChave) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abaMat = ss.getSheetByName('DimMatricula');
  const matriculas = lerMatriculasPagUnif_(abaMat);
  const identidades = criarIndiceIdentidadePagamentosSIGA_(ss, matriculas);

  const termo = normalizarPagUnif_(nomeParcial || '');
  const matsDoAluno = matriculas.filter(m =>
    normalizarPagUnif_(m.nome || '').includes(termo) ||
    normalizarPagUnif_(m.nomeSocial || '').includes(termo)
  );

  const matriculasInfo = matsDoAluno.map(m => ({
    chaveAluno: m.chaveAluno,
    nome: m.nome,
    turma: m.turma,
    status: m.status,
    inicio: m.inicio ? Utilities.formatDate(m.inicio, Session.getScriptTimeZone(), 'yyyy-MM-dd') : null,
    fim: m.fim ? Utilities.formatDate(m.fim, Session.getScriptTimeZone(), 'yyyy-MM-dd') : '(SEM FIM — vigente pra sempre)'
  }));

  const chavesAluno = new Set(matsDoAluno.map(m => m.chaveAluno).filter(Boolean));

  const periodos = analisesGerarPeriodos_(ANALISES_CACHE_MESES_MAX_SIGA2);
  const { valorPagoPorAlunoMesTurma } = analisesCalcularFinanceiroEValorPagoSIGA_(ss, periodos, identidades);

  const pagamentos = [];
  valorPagoPorAlunoMesTurma.forEach((porTurma, chaveAlunoMes) => {
    const [chaveAluno, mes] = chaveAlunoMes.split('|');
    if (!chavesAluno.has(chaveAluno)) return;
    if (mesChave && mes !== mesChave) return;
    porTurma.forEach((valor, turma) => {
      pagamentos.push({ mes, turma: turma || '(turma desconhecida no pagamento)', valor: arredPagUnif_(valor) });
    });
  });
  pagamentos.sort((a, b) => a.mes.localeCompare(b.mes));

  const diagnostico = { matriculas: matriculasInfo, pagamentosEncontrados: pagamentos };
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
      const ativas = matsAluno.filter(m => analisesMatriculaNoRateio_(m, ref, dataCalculo));
      if (!ativas.length) {
        return;
      }

      const combo = ativas.length > 1;
      const turmasDoMes = ativas
        .map(m => ({
          turma: String(m.turma || '').trim(),
          valorDevido: Number(analisesCalcularValorMatricula_(m, combo, ref, dataCalculo) || 0)
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
  const rotulo = ANALISES_MESES_ABREV_PT_SIGA2[data.getMonth()] + '-' + String(data.getFullYear()).slice(-2);
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
      if (m.inicio && m.inicio >= inicioMes && m.inicio <= fimMes &&
          analisesTipoEntradaMatricula_(m.tipo)) {
        novas++;
      }

      if (m.fim && m.fim >= inicioMes && m.fim <= fimMes &&
          analisesStatusSaidaMatricula_(m.status)) {
        canceladas++;
      }

      if (analisesStatusAtivo_(m.status) && vigenteNoMesPagUnif_(m, periodo)) {
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


/* =========================================================
 * AUXILIARES E DIAGNÓSTICOS
 *
 * Daqui para baixo é tudo função nova. As correções em si já estão
 * acima, dentro das funções que sempre existiram — não há nada para
 * apagar nem arquivo separado para criar.
 *
 * Para rodar pelo botão Executar (nenhuma pede argumento):
 *   listarEntradasDoMesSIGA          por que o mês tem esse número de entradas
 *   analisesReconciliarMatriculasSIGA  DimMatricula x o que o sistema lê x o gráfico
 *   diagnosticarTiposMatriculaAnalisesSIGA  todos os TIPO/STATUS que existem
 *   preencherFrequenciaAgoraSIGA     enche a coluna de frequência do cache
 * ========================================================= */

/** Aceita número, "81,25" e "81,25%". Fora de 0..100 é dado inválido. */
function analisesNumeroFrequenciaCacheV3_(valor) {
  if (valor === '' || valor === null || valor === undefined) return null;
  if (typeof valor === 'boolean') return null;

  const numero = typeof valor === 'number'
    ? valor
    : Number(String(valor).trim().replace('%', '').replace(',', '.'));

  return Number.isFinite(numero) && numero >= 0 && numero <= 100 ? numero : null;
}

/**
 * Médias já gravadas, por turma. Zero verdadeiro é preservado — só o
 * vazio vira null.
 */
function analisesLerFrequenciasCacheComparativo_(ss) {
  const mapa = new Map();
  const aba = ss.getSheetByName(ANALISES_CACHE_SHEETS_SIGA2.COMPARATIVO);

  // Aba recém-criada pode ainda não ter as 6 colunas; ler além do que
  // existe lança exceção e derrubaria o recálculo inteiro.
  if (!aba || aba.getLastRow() < 2 || aba.getLastColumn() < 6) return mapa;

  aba.getRange(2, 1, aba.getLastRow() - 1, 6).getValues().forEach(linha => {
    const turma = String(linha[0] || '').trim();
    const media = analisesNumeroFrequenciaCacheV3_(linha[5]);
    if (turma && media !== null) mapa.set(turma, media);
  });

  return mapa;
}

/** ATIVAÇÃO vira ATIVACAO em normalizarPagUnif_ (o acento é removido). */
function analisesTipoEntradaMatricula_(tipo) {
  const t = normalizarPagUnif_(tipo || '');
  return t === 'ATIVACAO' || t === 'NOVA' || t === 'UPGRADE';
}

/** Aceita as duas formas de gênero: a planilha traz as duas. */
function analisesStatusSaidaMatricula_(status) {
  const s = normalizarPagUnif_(status || '');
  return s === 'CANCELADO' || s === 'CANCELADA'
    || s === 'FINALIZADO' || s === 'FINALIZADA'
    || s === 'ABANDONO'
    || s === 'SUSPENSO' || s === 'SUSPENSA';
}

/**
 * Diagnóstico — rode pelo editor do Apps Script antes de estranhar os
 * números novos. Imprime todos os valores distintos de
 * TIPO_MATRICULA/ALTERACAO e de STATUS que existem na DimMatricula, com a
 * contagem de cada um, marcando quais entram na conta.
 *
 * Se aparecer um TIPO com muitas linhas e "conta: NAO", é um valor que
 * você provavelmente quer incluir em analisesTipoEntradaMatricula_.
 */
function diagnosticarTiposMatriculaAnalisesSIGA() {
  const matriculas = lerMatriculasPagUnif_(
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName('DimMatricula')
  );

  const contar = (lista, chave, pertence) => {
    const mapa = new Map();
    lista.forEach(m => {
      const valor = String(m[chave] || '(vazio)').trim() || '(vazio)';
      if (!mapa.has(valor)) {
        mapa.set(valor, { valor, linhas: 0, conta: pertence(valor) ? 'SIM' : 'NAO' });
      }
      mapa.get(valor).linhas++;
    });
    return Array.from(mapa.values()).sort((a, b) => b.linhas - a.linhas);
  };

  const diagnostico = {
    matriculasLidas: matriculas.length,
    tiposDeEntrada: contar(matriculas, 'tipo', analisesTipoEntradaMatricula_),
    statusDeSaida: contar(matriculas, 'status', analisesStatusSaidaMatricula_),
    comDataInicio: matriculas.filter(m => m.inicio).length,
    comDataFim: matriculas.filter(m => m.fim).length,
    // Saída sem data não entra em mês nenhum — é o furo que já aparece no
    // aviso amarelo do cartão de movimentação.
    saidaSemData: matriculas.filter(
      m => !m.fim && analisesStatusSaidaMatricula_(m.status)
    ).length
  };

  console.log(JSON.stringify(diagnostico, null, 2));
  return diagnostico;
}

/**
 * Preenche a frequência AGORA, sem esperar o gatilho.
 *
 * Cada execução tem o orçamento de 4,5 min do Apps Script e retoma de
 * onde a anterior parou. Se "pendentes" voltar maior que zero, rode de
 * novo — repita até chegar a zero. Numa escola com muitas turmas isso
 * pode levar três, quatro execuções na primeira vez, porque o bug antigo
 * deixou a coluna inteira em branco.
 *
 * Não recalcula matrículas, receita nem lucro: só a coluna de frequência.
 */
function preencherFrequenciaAgoraSIGA() {
  const resultado = analisesAtualizarFrequenciaCacheComOrcamento_(
    SpreadsheetApp.getActiveSpreadsheet(),
    null,          // sem lista: lê as turmas da própria aba de cache
    Date.now()     // orçamento novo para esta execução
  );

  console.log(JSON.stringify(resultado, null, 2));

  if (resultado && Number(resultado.pendentes) > 0) {
    console.log('AINDA FALTAM ' + resultado.pendentes +
      ' turma(s) sem frequência. Rode preencherFrequenciaAgoraSIGA de novo.');
  }

  return resultado;
}

/**
 * Diagnóstico do gráfico "Matrículas vs. cancelamentos".
 *
 * Responde se os números do gráfico podem ser lidos como estão. Duas
 * coisas distorcem a série mesmo com o TIPO e o STATUS certos:
 *
 * 1. MÊS CORRENTE INCOMPLETO. A última coluna cobre só os dias já
 *    decorridos. As entradas de um começo de semestre acontecem quase
 *    todas nos primeiros dias, e as saídas se espalham pelo mês inteiro —
 *    então a última coluna nasce com muita entrada e quase nenhuma saída.
 *    Comparar essa barra com um mês fechado é comparar coisas diferentes.
 *
 * 2. ENTRADA PELA DATA DE EDIÇÃO. lerMatriculasPagUnif_ usa
 *    DATA_EFETIVO_TURMA e, quando ela está vazia, cai em
 *    DATA_ALTERACAO/MATRICULA — que é quando a LINHA foi mexida, não
 *    quando o aluno entrou. Uma edição em massa joga um monte de entrada
 *    para o mês da edição. A coluna "entradasPorDataDeEdicao" abaixo mede
 *    exatamente isso: se for alta em algum mês, aquela barra está inflada.
 *
 * 3. Saída sem DATA_CANCELAMENTO/FINALIZACAO não entra em mês nenhum —
 *    fica fora do gráfico inteiro (campo saidasSemDataForaDoGrafico).
 */
function diagnosticarSerieMatriculasAnalisesSIGA(meses) {
  const janela = Math.max(1, Math.min(36, Number(meses) || 12));
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('DimMatricula');
  if (!aba || aba.getLastRow() < 2) {
    throw new Error('DimMatricula não encontrada ou vazia.');
  }

  const dados = aba.getDataRange().getValues();
  const mapa = mapaGenericoPagUnif_(dados[0]);

  const periodos = analisesGerarPeriodos_(janela);
  const porMes = new Map();
  periodos.forEach(p => {
    porMes.set(analisesMesRotulo_(p).chave, {
      mes: analisesMesRotulo_(p).rotulo,
      entradas: 0,
      entradasPorDataDeEdicao: 0,
      saidas: 0
    });
  });

  const hoje = new Date();
  const chaveMesCorrente = analisesMesRotulo_(hoje).chave;
  let saidasSemData = 0;

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];

    const tipo = campoPagUnif_(linha, mapa, [
      'TIPO_MATRICULA/ALTERACAO', 'TIPO_MATRICULA', 'TIPO DE MATRÍCULA'
    ]);
    const status = campoPagUnif_(linha, mapa, ['STATUS']);

    const dataEfetivo = parseDataPagUnif_(
      campoPagUnif_(linha, mapa, ['DATA_EFETIVO_TURMA', 'DATA EFETIVO TURMA'])
    );
    const dataAlteracao = parseDataPagUnif_(
      campoPagUnif_(linha, mapa, ['DATA_ALTERACAO/MATRICULA', 'DATA ALTERACAO/MATRICULA'])
    );
    // Mesma precedência de lerMatriculasPagUnif_.
    const inicio = dataEfetivo || dataAlteracao;

    const fim = parseDataPagUnif_(campoPagUnif_(linha, mapa, [
      'DATA_CANCELAMENTO/FINALIZACAO', 'DATA CANCELAMENTO/FINALIZACAO'
    ]));

    if (inicio && analisesTipoEntradaMatricula_(tipo)) {
      const registro = porMes.get(analisesMesRotulo_(inicio).chave);
      if (registro) {
        registro.entradas++;
        // Entrou pela data de edição, não pela data real de início.
        if (!dataEfetivo) registro.entradasPorDataDeEdicao++;
      }
    }

    if (analisesStatusSaidaMatricula_(status)) {
      if (!fim) {
        saidasSemData++;
      } else {
        const registro = porMes.get(analisesMesRotulo_(fim).chave);
        if (registro) registro.saidas++;
      }
    }
  }

  const linhas = Array.from(porMes.entries()).map(([chave, registro]) => {
    const parcial = chave === chaveMesCorrente;
    return {
      mes: registro.mes,
      entradas: registro.entradas,
      saidas: registro.saidas,
      saldo: registro.entradas - registro.saidas,
      entradasPorDataDeEdicao: registro.entradasPorDataDeEdicao,
      // Um mês em curso não é comparável com os fechados.
      observacao: parcial
        ? 'MÊS INCOMPLETO — faltam ' +
          (new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate() - hoje.getDate()) +
          ' dia(s); as saídas ainda vão acontecer'
        : (registro.entradasPorDataDeEdicao > registro.entradas / 2
            ? 'ATENÇÃO — mais da metade das entradas veio da data de edição'
            : '')
    };
  });

  const diagnostico = {
    janelaMeses: janela,
    saidasSemDataForaDoGrafico: saidasSemData,
    totalEntradasPorDataDeEdicao: linhas.reduce((s, l) => s + l.entradasPorDataDeEdicao, 0),
    meses: linhas
  };

  console.log(JSON.stringify(diagnostico, null, 2));
  return diagnostico;
}

/**
 * Fecha os centavos: a tabela arredonda a SOMA do mês, o detalhamento
 * arredonda aluno por aluno. Arredondar dez parcelas e somar pode dar um
 * ou dois centavos a mais que arredondar a soma — e é isso que faria a
 * tela acusar divergência num mês em que ninguém errou nada.
 *
 * A sobra vai para o aluno de maior valor no mês. É alocação de exibição,
 * nunca invenção: o total do mês continua sendo exatamente o da tabela.
 */
function analisesFecharCentavosPorMesAnalises_(parcelaPorAlunoMes, brutoPorMes, nomePorAluno, periodos) {
  const chavesMes = periodos.map(p => analisesMesRotulo_(p).chave);
  const centavosPorAlunoMes = new Map();

  chavesMes.forEach(chaveMes => {
    const doMes = [];
    parcelaPorAlunoMes.forEach((mapaMes, chaveAluno) => {
      const valor = mapaMes.get(chaveMes);
      if (valor > 0) doMes.push({ chaveAluno, valor });
    });
    if (!doMes.length) return;

    const alvoCentavos = Math.round(arredPagUnif_(brutoPorMes.get(chaveMes) || 0) * 100);
    let somaCentavos = 0;
    doMes.forEach(item => {
      item.centavos = Math.round(item.valor * 100);
      somaCentavos += item.centavos;
    });

    const sobra = alvoCentavos - somaCentavos;
    if (sobra !== 0) {
      doMes.reduce((maior, item) => (item.centavos > maior.centavos ? item : maior), doMes[0]).centavos += sobra;
    }

    doMes.forEach(item => {
      if (!(item.centavos > 0)) return;
      if (!centavosPorAlunoMes.has(item.chaveAluno)) centavosPorAlunoMes.set(item.chaveAluno, new Map());
      centavosPorAlunoMes.get(item.chaveAluno).set(chaveMes, item.centavos);
    });
  });

  const lista = [];
  centavosPorAlunoMes.forEach((mapaMes, chaveAluno) => {
    let total = 0;
    const porMes = [];
    chavesMes.forEach(chaveMes => {
      const centavos = mapaMes.get(chaveMes) || 0;
      if (!centavos) return;
      total += centavos;
      porMes.push({ periodo: analisesChaveParaRotulo_(chaveMes), valor: centavos / 100 });
    });
    lista.push({
      aluno: nomePorAluno.get(chaveAluno) || '(sem nome)',
      total: total / 100,
      porMes
    });
  });

  return lista.sort((a, b) => b.total - a.total);
}

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
      PropertiesService.getScriptProperties().getProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM_SIGA2) || '(nunca)',
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
 * Uso: escolha listarEntradasDoMesSIGA no menu de funções e clique em
 * Executar. Sem argumento nenhum ela usa o MÊS ATUAL — o botão Executar
 * do Apps Script não sabe passar parâmetro. Para outro mês, digite a
 * chamada no editor: listarEntradasDoMesSIGA('2026-03').
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
  const alvo = String(chaveMes || '').trim() || analisesMesRotulo_(new Date()).chave;
  if (!/^\d{4}-\d{2}$/.test(alvo)) {
    throw new Error('Mês inválido: use o formato aaaa-mm. Ex.: listarEntradasDoMesSIGA("2026-03")');
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
      PropertiesService.getScriptProperties().getProperty(ANALISES_CACHE_PROP_ATUALIZADO_EM_SIGA2) || '(nunca)',
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


/**
 * Ainda existe uma cópia deste arquivo no projeto?
 *
 * Este arquivo não declara nenhum dos seis nomes antigos (todos ganharam
 * o sufixo _SIGA2). Então, se `typeof ANALISES_CACHE_SHEETS` ainda
 * responder, só pode ter vindo de outro .gs. typeof não estoura com nome
 * inexistente, então o teste é seguro nos dois casos.
 *
 * Rode depois de limpar o Alunos.gs para confirmar que ficou só um.
 */
function procurarCopiaDoAnalisesSIGA() {
  const nomesAntigos = [
    'ANALISES_CACHE_SHEETS',
    'ANALISES_CACHE_PROP_ATUALIZADO_EM',
    'ANALISES_CACHE_PROP_FREQ_CURSOR',
    'ANALISES_CACHE_MESES_MAX',
    'ANALISES_PDF_CONFIG_',
    'ANALISES_MESES_ABREV_PT_'
  ];

  const aindaExistem = nomesAntigos.filter(nome => {
    try {
      // eslint-disable-next-line no-eval
      return eval('typeof ' + nome) !== 'undefined';
    } catch (erro) {
      return true; // nome em TDZ também prova que alguém o declarou
    }
  });

  // Qual versão de cada função o projeto está usando de verdade: lê o
  // código em memória e procura uma marca que só a corrigida tem.
  const marcas = [
    ['analisesGravarCacheComparativoTurmas_', 'analisesLerFrequenciasCacheComparativo_(ss)'],
    ['analisesAtualizarFrequenciaCacheComOrcamento_', 'pendentes.concat(preenchidas)'],
    ['calcularSerieMatriculasAnalisesSIGA_', 'analisesTipoEntradaMatricula_(m.tipo)'],
    ['obterMovimentacaoTurmaAnalisesSIGA', 'matriculasAtivasPorMes'],
    ['obterAlunosPagamentosPorTurmaAnalisesSIGA', 'analisesFecharCentavosPorMesAnalises_']
  ];

  const versoes = marcas.map(([nome, marca]) => {
    let situacao;
    try {
      situacao = eval(nome).toString().indexOf(marca) >= 0
        ? 'ESTA (corrigida)'
        : 'A DA CÓPIA (antiga)';
    } catch (erro) {
      situacao = 'NÃO EXISTE — ' + (erro && erro.message ? erro.message : String(erro));
    }
    return { funcao: nome, valendoAgora: situacao };
  });

  const velhasVencendo = versoes.filter(v => v.valendoAgora === 'A DA CÓPIA (antiga)');

  const resultado = {
    copiaDetectada: aindaExistem.length > 0,
    constantesQueVieramDeOutroArquivo: aindaExistem,
    versaoEmUso: versoes,
    veredito: !aindaExistem.length
      ? 'LIMPO. Este é o único arquivo do Análises no projeto.'
      : (velhasVencendo.length
          ? 'CÓPIA VENCENDO em ' + velhasVencendo.length + ' função(ões) — a tela ainda mostra número errado.'
          : 'A cópia existe mas PERDE em todas as funções: o sistema está usando o código corrigido.')
  };

  console.log(JSON.stringify(resultado, null, 2));
  return resultado;
}
