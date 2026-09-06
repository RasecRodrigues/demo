/**
 * SIGA — Alunos em risco de evasão
 *
 * A tela de Análises só olha para trás: a taxa de evasão conta quem JÁ
 * saiu. Este módulo olha para frente — cruza frequência com situação
 * financeira e devolve a lista de quem provavelmente sai se ninguém
 * ligar. É a única análise do módulo que vira ação no mesmo dia.
 *
 * Nada de modelo estatístico: o score é uma soma ponderada de três
 * sinais, com os pesos e cortes todos em ANALISES_RISCO_CONFIG. Com o
 * volume de uma escola, uma regra que a secretaria consegue conferir na
 * mão acerta mais — e, principalmente, dá para explicar ao aluno por que
 * ele apareceu na lista.
 *
 * Usa de Analises.gs/Pagamentos.gs: validarPermissaoPagamentosSIGA_,
 * lerMatriculasPagUnif_, criarIndiceIdentidadePagamentosSIGA_,
 * normalizarPagUnif_, arredPagUnif_, garantirCacheAnalisesSIGA_,
 * analisesLerCachePagamentoAluno_, analisesGerarPeriodos_,
 * analisesMesRotulo_, analisesMatriculaNoRateio_,
 * analisesCalcularValorMatricula_, analisesStatusAtivo_ e
 * obterPainelFrequenciaTurma (este último via adaptador — ver
 * analisesRiscoFrequenciaDaTurma_).
 */

/**
 * Pontos do score. Somam-se — o score é a soma das razões que se aplicam
 * ao aluno, não uma média. Foi decisão deliberada: um score que se
 * decompõe ("48% de frequência +35, 3 faltas seguidas +25, em atraso
 * +20") justifica o telefonema; uma média ponderada cospe um número que
 * ninguém consegue explicar ao aluno do outro lado da linha.
 *
 * Calibrar a lista é mexer AQUI, não no cartão da tela.
 */
const ANALISES_RISCO_CONFIG = {
  // Faixas de frequência, da pior para a melhor. A primeira cujo `ate`
  // alcança a frequência do aluno é a que vale — escada, não soma.
  // A faixa 70–79 fecha um buraco: sem ela, 71% pontuava zero e um aluno
  // com 71% e duas faltas seguidas caía em risco baixo.
  FREQUENCIA: [
    { ate: 50, pontos: 35 },
    { ate: 70, pontos: 25 },
    { ate: 80, pontos: 15 }
  ],

  // Faltas SEGUIDAS na janela recente. Também escada: 3 seguidas não
  // soma com 2 seguidas.
  FALTAS: [
    { minimo: 3, pontos: 25 },
    { minimo: 2, pontos: 15 }
  ],

  ATRASO_PONTOS: 20,            // algum mês fechado em aberto (janela curta)
  ATRASO_RECORRENTE_PONTOS: 10, // soma ao anterior: é dívida que se repete
  QUEDA_PONTOS: 15,
  MATRICULA_RECENTE_PONTOS: 5,

  // Corte dos rótulos: 0–29 baixo, 30–59 médio, 60–100 alto.
  SCORE_ALTO: 60,
  SCORE_MEDIO: 30,

  // Teto. Sem ele o máximo somável é 110 (35+25+20+10+15+5) e a tela
  // mostraria score fora da escala que os cortes acima descrevem.
  SCORE_MAXIMO: 100,

  // "Queda forte": a frequência do mês corrente caiu este tanto de pontos
  // percentuais em relação aos meses anteriores. 20 é meio dia de aula por
  // semana a menos — abaixo disso é oscilação normal de agenda.
  QUEDA_MINIMA_PONTOS: 20,

  // "Matrícula muito recente": aluno novo desiste mais, e nos primeiros
  // meses a frequência dele ainda nem formou padrão.
  MATRICULA_RECENTE_DIAS: 90,

  // Meses FECHADOS olhados para trás. O mês corrente nunca entra: no dia
  // 3, quem ainda não pagou não está atrasado.
  MESES_ATRASO: 3,     // janela do "em atraso"
  MESES_RECORRENCIA: 6, // janela do "atraso recorrente"
  MIN_MESES_RECORRENCIA: 2,

  // Diferença abaixo da qual devido/pago é considerado quitado — evita
  // marcar como devedor quem tem centavos de arredondamento em aberto.
  TOLERANCIA_REAIS: 1,

  // Janela de frequência. Uma leitura só serve para tudo: o percentual do
  // aluno, a linha de base da queda (os meses anteriores ao corrente) e a
  // lista de datas de aula da turma.
  MESES_FREQUENCIA: 4,

  // Orçamento do recálculo em segundo plano. O painel de frequência com
  // detalhe ignora o próprio cache e relê Chamadas + DimMatricula +
  // AbonosFrequencia a CADA turma, então numa escola grande o cálculo não
  // cabe numa execução só. O que não couber é retomado na execução
  // seguinte pelo cursor, e as turmas já calculadas ficam preservadas.
  ORCAMENTO_MS: 4.5 * 60 * 1000
};

const ANALISES_RISCO_CACHE = {
  ABA: 'AnalisesCache_Risco',
  PROP_ATUALIZADO_EM: 'ANALISES_RISCO_ATUALIZADO_EM',
  // Turma em que o cálculo parou por falta de tempo; a próxima execução
  // retoma dela em vez de recomeçar do início da lista — mesma solução
  // que analisesAtualizarFrequenciaCacheComOrcamento_ usa no Analises.
  PROP_CURSOR: 'ANALISES_RISCO_CURSOR',
  CABECALHOS: [
    'Turma', 'Aluno', 'Frequencia', 'FrequenciaAnterior', 'Faltas',
    'FaltasConsecutivas', 'EmAtraso', 'MesesEmAtraso', 'ValorEmAberto',
    'Mensalidade', 'DiasDeCasa', 'Score', 'Risco', 'Motivos'
  ]
};

/**
 * Endpoint da tela. Só LÊ a aba de cache — nenhuma varredura pesada.
 *
 * O cálculo real é caro: o painel de frequência com detalhe ignora o
 * próprio cache e relê Chamadas + DimMatricula + AbonosFrequencia a cada
 * turma. Fazer isso a cada abertura da tela deixaria a lista inutilizável
 * — a mesma razão pela qual o resto de Análises já vive de cache.
 *
 * Na primeiríssima chamada (aba ainda não existe) calcula uma vez de
 * forma síncrona: lento só dessa vez, e ainda assim limitado pelo
 * orçamento, então pode voltar parcial.
 */
function obterAlunosEmRiscoAnalisesSIGA(filtros) {
  filtros = filtros || {};
  validarPermissaoPagamentosSIGA_(filtros.token);

  const turmaAlvo = String(filtros.turma || '').trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss.getSheetByName(ANALISES_RISCO_CACHE.ABA)) {
    recalcularCacheRiscoSIGA();
  }

  const todos = analisesRiscoLerCache_(ss);
  const alunos = turmaAlvo ? todos.filter(a => a.turma === turmaAlvo) : todos;

  return {
    sucesso: true,
    turma: turmaAlvo,
    turmas: Array.from(new Set(todos.map(a => a.turma)))
      .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    alunos: alunos,
    resumo: analisesRiscoResumo_(alunos),
    atualizadoEm: PropertiesService.getScriptProperties()
      .getProperty(ANALISES_RISCO_CACHE.PROP_ATUALIZADO_EM) || null,
    frequenciaIndisponivel: alunos.length > 0 && alunos.every(a => a.frequencia === null)
  };
}

/**
 * Força o recálculo (botão "Recalcular dados" da tela).
 */
function recalcularCacheRiscoManualSIGA(filtros) {
  filtros = filtros || {};
  validarPermissaoPagamentosSIGA_(filtros.token);
  const resultado = recalcularCacheRiscoSIGA();
  return Object.assign({ sucesso: true }, resultado);
}

/**
 * Execute UMA VEZ pelo editor do Apps Script para agendar a atualização
 * automática da lista de risco. Sem isto, a tabela só é calculada na
 * primeira abertura da tela ou por "Recalcular dados".
 *
 * Roda a cada 4 horas — mais frequente que o cache de Análises (6h)
 * porque falta e atraso mudam dia a dia, e uma lista de risco velha faz
 * a secretaria ligar para quem já voltou.
 */
function configurarGatilhoCacheRiscoSIGA() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'recalcularCacheRiscoSIGA')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('recalcularCacheRiscoSIGA')
    .timeBased()
    .everyHours(4)
    .create();
}

/**
 * Calcula e grava a tabela. Chamada pelo gatilho de tempo.
 *
 * MESCLA em vez de sobrescrever: as turmas que couberam no orçamento têm
 * suas linhas substituídas, as que não couberam mantêm as da rodada
 * anterior. Sem isso, toda execução apagaria as turmas do fim da fila e a
 * tabela nunca ficaria completa — só que agora com dado velho em vez de
 * dado nenhum, e por isso a tela mostra desde quando cada rodada é.
 */
function recalcularCacheRiscoSIGA() {
  const inicioExecucao = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();

  const anteriores = new Map();
  analisesRiscoLerCache_(ss).forEach(linha => {
    if (!anteriores.has(linha.turma)) {
      anteriores.set(linha.turma, []);
    }
    anteriores.get(linha.turma).push(linha);
  });

  const calculo = analisesRiscoCalcular_(ss, inicioExecucao, props.getProperty(ANALISES_RISCO_CACHE.PROP_CURSOR) || '');

  calculo.turmasCalculadas.forEach(turma => anteriores.delete(turma));
  const linhas = calculo.alunos.concat(
    Array.from(anteriores.values()).reduce((tudo, lista) => tudo.concat(lista), [])
  );

  analisesRiscoGravarCache_(ss, linhas);
  props.setProperty(ANALISES_RISCO_CACHE.PROP_ATUALIZADO_EM, new Date().toISOString());
  props.setProperty(ANALISES_RISCO_CACHE.PROP_CURSOR, calculo.proximaTurma);

  return {
    turmasCalculadas: calculo.turmasCalculadas.length,
    turmasPendentes: calculo.turmasPendentes,
    alunos: linhas.length
  };
}

/**
 * O cálculo pesado. Percorre as turmas a partir do cursor, dando a volta
 * na lista, até o orçamento acabar.
 */
function analisesRiscoCalcular_(ss, inicioExecucao, turmaRetomada) {
  const cfg = ANALISES_RISCO_CONFIG;

  const matriculas = lerMatriculasPagUnif_(ss.getSheetByName('DimMatricula'));
  criarIndiceIdentidadePagamentosSIGA_(ss, matriculas);

  garantirCacheAnalisesSIGA_();
  const financeiroPorAluno = analisesRiscoFinanceiroPorAluno_(
    matriculas, analisesLerCachePagamentoAluno_()
  );

  const ativas = matriculas.filter(m =>
    String(m.turma || '').trim() && normalizarPagUnif_(m.status) === 'ATIVO'
  );
  const turmas = Array.from(new Set(ativas.map(m => String(m.turma).trim())))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));

  // Janela única para tudo: o percentual de frequência, a linha de base da
  // queda e as datas de aula saem da mesma leitura.
  const periodos = analisesGerarPeriodos_(cfg.MESES_FREQUENCIA);
  const mesInicial = analisesMesRotulo_(periodos[0]).chave;
  const mesFinal = analisesMesRotulo_(periodos[periodos.length - 1]).chave;
  const mesCorrente = mesFinal;

  const datasPorTurma = analisesRiscoDatasDeAulaPorTurma_(
    ss,
    periodos[0],
    new Date(periodos[periodos.length - 1].getFullYear(), periodos[periodos.length - 1].getMonth() + 1, 0)
  );

  const hoje = new Date();
  const alunos = [];
  const turmasCalculadas = [];
  let turmasPendentes = 0;
  let proximaTurma = '';

  const indiceInicial = Math.max(0, turmas.indexOf(turmaRetomada));

  for (let passo = 0; passo < turmas.length; passo++) {
    const turma = turmas[(indiceInicial + passo) % turmas.length];

    if (Date.now() - inicioExecucao > cfg.ORCAMENTO_MS) {
      proximaTurma = turma; // retoma exatamente daqui na próxima execução
      turmasPendentes = turmas.length - passo;
      break;
    }

    const porAluno = analisesRiscoFrequenciaDaTurma_(
      turma,
      datasPorTurma.get(normalizarTextoPainelFrequencia_(turma)) || [],
      mesInicial, mesFinal, mesCorrente
    );
    turmasCalculadas.push(turma);

    ativas
      .filter(m => String(m.turma).trim() === turma)
      .forEach(m => {
        const nome = m.nome || m.idAluno || '(sem nome)';
        const freq = porAluno.get(normalizarPagUnif_(nome))
          || { frequencia: null, frequenciaAnterior: null, faltas: 0, consecutivas: 0 };

        const chaveAluno = m.chaveAluno || normalizarPagUnif_(m.idAluno || m.nome);
        const financeiro = financeiroPorAluno.get(chaveAluno)
          || { emAtraso: false, recorrente: false, mesesEmAtraso: 0, valorEmAberto: 0, mensalidade: 0 };

        const diasDeCasa = m.inicio instanceof Date
          ? Math.floor((hoje - m.inicio) / 86400000)
          : null;

        const avaliacao = analisesRiscoAvaliar_(freq, financeiro, diasDeCasa);

        alunos.push({
          aluno: nome,
          turma: turma,
          frequencia: freq.frequencia,
          frequenciaAnterior: freq.frequenciaAnterior,
          faltas: Number(freq.faltas || 0),
          faltasConsecutivas: Number(freq.consecutivas || 0),
          emAtraso: financeiro.emAtraso,
          mesesEmAtraso: financeiro.mesesEmAtraso,
          valorEmAberto: arredPagUnif_(financeiro.valorEmAberto),
          mensalidade: arredPagUnif_(financeiro.mensalidade),
          diasDeCasa: diasDeCasa,
          score: avaliacao.score,
          motivos: avaliacao.motivos,
          risco: analisesRiscoRotulo_(avaliacao.score)
        });
      });
  }

  return { alunos, turmasCalculadas, turmasPendentes, proximaTurma };
}

/**
 * Grava a tabela, ordenada do maior score para o menor — quem abrir a aba
 * na mão vê a mesma ordem da tela.
 *
 * Reaproveita analisesObterOuCriarAbaCache_ do Analises, que já força a
 * primeira coluna como texto (sem isso o Sheets converte nome de turma
 * parecido com data e a leitura nunca mais bate).
 */
function analisesRiscoGravarCache_(ss, alunos) {
  const aba = analisesObterOuCriarAbaCache_(
    ss, ANALISES_RISCO_CACHE.ABA, ANALISES_RISCO_CACHE.CABECALHOS
  );

  const ordenados = alunos.slice().sort(
    (a, b) => b.score - a.score || a.aluno.localeCompare(b.aluno, 'pt-BR')
  );

  const linhas = ordenados.map(a => [
    a.turma,
    a.aluno,
    a.frequencia === null || a.frequencia === undefined ? '' : a.frequencia,
    a.frequenciaAnterior === null || a.frequenciaAnterior === undefined ? '' : a.frequenciaAnterior,
    Number(a.faltas || 0),
    Number(a.faltasConsecutivas || 0),
    a.emAtraso ? 'SIM' : 'NAO',
    Number(a.mesesEmAtraso || 0),
    Number(a.valorEmAberto || 0),
    Number(a.mensalidade || 0),
    a.diasDeCasa === null || a.diasDeCasa === undefined ? '' : a.diasDeCasa,
    Number(a.score || 0),
    a.risco,
    analisesRiscoMotivosParaTexto_(a.motivos)
  ]);

  if (linhas.length) {
    aba.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  }
}

function analisesRiscoLerCache_(ss) {
  const aba = ss.getSheetByName(ANALISES_RISCO_CACHE.ABA);
  if (!aba || aba.getLastRow() < 2) {
    return [];
  }

  const largura = ANALISES_RISCO_CACHE.CABECALHOS.length;
  const dados = aba.getRange(2, 1, aba.getLastRow() - 1, largura).getValues();
  const numeroOuNulo = v => (v === '' || v === null || v === undefined) ? null : Number(v);

  return dados
    .filter(linha => String(linha[0] || '').trim() && String(linha[1] || '').trim())
    .map(linha => ({
      turma: String(linha[0]).trim(),
      aluno: String(linha[1]).trim(),
      frequencia: numeroOuNulo(linha[2]),
      frequenciaAnterior: numeroOuNulo(linha[3]),
      faltas: Number(linha[4] || 0),
      faltasConsecutivas: Number(linha[5] || 0),
      emAtraso: String(linha[6] || '').trim().toUpperCase() === 'SIM',
      mesesEmAtraso: Number(linha[7] || 0),
      valorEmAberto: Number(linha[8] || 0),
      mensalidade: Number(linha[9] || 0),
      diasDeCasa: numeroOuNulo(linha[10]),
      score: Number(linha[11] || 0),
      risco: String(linha[12] || 'baixo').trim(),
      motivos: analisesRiscoTextoParaMotivos_(linha[13])
    }))
    .sort((a, b) => b.score - a.score || a.aluno.localeCompare(b.aluno, 'pt-BR'));
}

/**
 * Os motivos viram uma coluna legível — "Frequência de 48% (+35) · 3
 * faltas consecutivas (+25)" — em vez de JSON. Quem abrir a aba na mão
 * consegue conferir a conta, que é o ponto inteiro de um score somável.
 */
function analisesRiscoMotivosParaTexto_(motivos) {
  return (motivos || [])
    .map(m => m.texto + (m.pontos ? ' (+' + m.pontos + ')' : ''))
    .join(' · ');
}

function analisesRiscoTextoParaMotivos_(texto) {
  return String(texto || '')
    .split(' · ')
    .map(parte => parte.trim())
    .filter(Boolean)
    .map(parte => {
      const casa = parte.match(/^(.*) \(\+(\d+)\)$/);
      return casa
        ? { texto: casa[1], pontos: Number(casa[2]) }
        : { texto: parte, pontos: 0 };
    });
}

/**
 * Os KPIs do topo da tela.
 *
 * "Valor exposto" soma a MENSALIDADE dos alunos em risco alto e médio —
 * é a receita mensal que a escola perde se ninguém agir. Somar o valor em
 * aberto seria outra coisa (dívida passada); o que decide se vale a pena
 * ligar é a receita futura.
 */
function analisesRiscoResumo_(alunos) {
  const emRisco = alunos.filter(a => a.risco !== 'baixo');
  const comFrequencia = emRisco.filter(a => a.frequencia !== null);

  return {
    analisados: alunos.length,
    alto: alunos.filter(a => a.risco === 'alto').length,
    medio: alunos.filter(a => a.risco === 'medio').length,
    baixo: alunos.filter(a => a.risco === 'baixo').length,
    frequenciaMediaEmRisco: comFrequencia.length
      ? arredPagUnif_(comFrequencia.reduce((s, a) => s + a.frequencia, 0) / comFrequencia.length)
      : null,
    valorExposto: arredPagUnif_(emRisco.reduce((s, a) => s + Number(a.mensalidade || 0), 0))
  };
}

/**
 * Soma os pontos e devolve JUNTO a lista de razões que os geraram.
 *
 * Os motivos não são enfeite: são a diferença entre "o sistema diz 80" e
 * "ele faltou três aulas seguidas e está devendo agosto". A tela mostra
 * essa lista, e é ela que a secretaria leva para a ligação.
 *
 * Frequência ausente não vira zero — zero significaria frequência
 * perfeita e esconderia o aluno no fim da lista. Ela simplesmente não
 * pontua, e o motivo registra que o dado faltou.
 */
function analisesRiscoAvaliar_(freq, financeiro, diasDeCasa) {
  const cfg = ANALISES_RISCO_CONFIG;
  const motivos = [];
  let score = 0;

  const somar = (pontos, texto) => {
    if (!pontos) return;
    score += pontos;
    motivos.push({ pontos: pontos, texto: texto });
  };

  if (freq.frequencia === null || freq.frequencia === undefined) {
    motivos.push({ pontos: 0, texto: 'Frequência sem dado' });
  } else {
    const faixa = cfg.FREQUENCIA.find(f => Number(freq.frequencia) < f.ate);
    if (faixa) {
      somar(faixa.pontos, 'Frequência de '
        + Number(freq.frequencia).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '%');
    }
  }

  const consecutivas = Number(freq.consecutivas || 0);
  const faixaFaltas = cfg.FALTAS.find(f => consecutivas >= f.minimo);
  if (faixaFaltas) {
    somar(faixaFaltas.pontos, consecutivas + ' faltas consecutivas');
  }

  if (financeiro.emAtraso) {
    somar(cfg.ATRASO_PONTOS, 'Mensalidade em atraso');
  }
  if (financeiro.recorrente) {
    somar(cfg.ATRASO_RECORRENTE_PONTOS, 'Atraso recorrente ('
      + financeiro.mesesEmAtraso + ' meses em aberto)');
  }

  if (analisesRiscoTeveQueda_(freq)) {
    somar(cfg.QUEDA_PONTOS, 'Queda forte de frequência');
  }

  if (diasDeCasa !== null && diasDeCasa >= 0 && diasDeCasa < cfg.MATRICULA_RECENTE_DIAS) {
    somar(cfg.MATRICULA_RECENTE_PONTOS, 'Matrícula recente (' + diasDeCasa + ' dias)');
  }

  return { score: Math.min(cfg.SCORE_MAXIMO, score), motivos: motivos };
}

function analisesRiscoTeveQueda_(freq) {
  if (freq.frequencia === null || freq.frequencia === undefined) return false;
  if (freq.frequenciaAnterior === null || freq.frequenciaAnterior === undefined) return false;
  return (Number(freq.frequenciaAnterior) - Number(freq.frequencia))
    >= ANALISES_RISCO_CONFIG.QUEDA_MINIMA_PONTOS;
}

function analisesRiscoRotulo_(score) {
  if (score >= ANALISES_RISCO_CONFIG.SCORE_ALTO) return 'alto';
  if (score >= ANALISES_RISCO_CONFIG.SCORE_MEDIO) return 'medio';
  return 'baixo';
}

/**
 * Devido x pago por aluno nos últimos meses FECHADOS.
 *
 * Reaproveita exatamente a mesma engrenagem do detalhamento por turma
 * (analisesMatriculaNoRateio_ + analisesCalcularValorMatricula_ + o cache
 * de pagamento por aluno), então "em atraso" aqui significa o mesmo que
 * na tela de mensalidades — nenhuma segunda definição de dívida.
 *
 * O mês corrente fica de fora de propósito: no dia 3, quem ainda não
 * pagou não está atrasado, e incluí-lo marcaria a escola inteira como
 * devedora todo início de mês.
 *
 * Duas janelas, porque são dois sinais diferentes:
 *   emAtraso   — algum mês em aberto nos últimos MESES_ATRASO. É o aperto
 *                de agora.
 *   recorrente — MIN_MESES_RECORRENCIA ou mais meses em aberto nos
 *                últimos MESES_RECORRENCIA. É o padrão, que pesa mais do
 *                que um mês solto e por isso soma pontos ao primeiro.
 *
 * `mensalidade` é o valor devido do mês CORRENTE — a receita que se perde
 * se o aluno sair. Por isso é calculado mesmo ficando fora do atraso.
 */
function analisesRiscoFinanceiroPorAluno_(matriculas, valorPagoPorAlunoMes) {
  const cfg = ANALISES_RISCO_CONFIG;
  const resultado = new Map();

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

  // analisesGerarPeriodos_ termina sempre no mês corrente; ele entra só
  // para a mensalidade, e os anteriores para as duas janelas de atraso.
  const periodos = analisesGerarPeriodos_(cfg.MESES_RECORRENCIA + 1);

  matriculasPorAluno.forEach((matsAluno, chaveAluno) => {
    const mesesComSaldo = [];
    let valorEmAberto = 0;
    let mensalidade = 0;

    periodos.forEach((ref, indice) => {
      const ehMesCorrente = ref >= inicioMesAtual;
      const dataCalculo = ehMesCorrente
        ? hoje
        : new Date(ref.getFullYear(), ref.getMonth() + 1, 0);

      const vigentes = matsAluno.filter(m => analisesMatriculaNoRateio_(m, ref, dataCalculo));
      if (!vigentes.length) return;

      const combo = vigentes.length > 1;
      const devido = vigentes.reduce(
        (soma, m) => soma + Number(analisesCalcularValorMatricula_(m, combo, ref, dataCalculo) || 0),
        0
      );

      if (ehMesCorrente) {
        mensalidade = devido;
        return;
      }

      const porTurma = valorPagoPorAlunoMes.get(chaveAluno + '|' + analisesMesRotulo_(ref).chave);
      let pago = 0;
      if (porTurma) {
        porTurma.forEach(valor => { pago += Number(valor || 0); });
      }

      const saldo = devido - pago;
      if (saldo > cfg.TOLERANCIA_REAIS) {
        // Distância em meses até o mês corrente, para separar as janelas.
        mesesComSaldo.push(periodos.length - 1 - indice);
        valorEmAberto += saldo;
      }
    });

    resultado.set(chaveAluno, {
      emAtraso: mesesComSaldo.some(distancia => distancia <= cfg.MESES_ATRASO),
      recorrente: mesesComSaldo.length >= cfg.MIN_MESES_RECORRENCIA,
      mesesEmAtraso: mesesComSaldo.length,
      valorEmAberto: valorEmAberto,
      mensalidade: mensalidade
    });
  });

  return resultado;
}

/**
 * Datas de aula por turma, lidas UMA vez da aba Chamadas.
 *
 * Por que é preciso: o painel de frequência devolve, por aluno, só as
 * datas em que ele FALTOU (`dias`). Sem a lista completa de aulas da
 * turma não dá para saber se duas faltas foram seguidas ou se houve uma
 * presença entre elas — e "faltou 3 seguidas" é justamente o sinal que
 * mais separa quem está de saída de quem só faltou espalhado.
 *
 * Reconstruir isso pela união das faltas de todos os alunos não serve:
 * uma aula em que ninguém faltou não apareceria na união, e duas faltas
 * separadas por ela pareceriam consecutivas.
 *
 * Comparação de turma por igualdade exata do texto normalizado — é
 * exatamente como calcularPainelFrequenciaComAbonosSIGA_ monta as datas
 * de aula, e as duas listas precisam bater.
 */
function analisesRiscoDatasDeAulaPorTurma_(ss, dataInicial, dataFinal) {
  const porTurma = new Map();
  const aba = ss.getSheetByName('Chamadas');
  if (!aba || aba.getLastRow() < 2) {
    return porTurma;
  }

  const dados = aba.getDataRange().getValues();
  const mapa = criarMapaCabecalhosPortal_(dados[0]);
  const iData = localizarIndicePortal_(mapa, ['DATA DA AULA']);
  const iTurma = localizarIndicePortal_(mapa, ['TURMA']);
  if (iData < 0 || iTurma < 0) {
    return porTurma;
  }

  const agora = new Date();
  const vistas = new Map();

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    if (!linha[iData] || !linha[iTurma]) continue;

    let dataAula;
    try {
      dataAula = converterDataPortal_(linha[iData]);
    } catch (erro) {
      continue; // linha com data corrompida não derruba a turma inteira
    }
    if (dataAula < dataInicial || dataAula > dataFinal || dataAula > agora) continue;

    const chaveTurma = normalizarTextoPainelFrequencia_(linha[iTurma]);
    if (!vistas.has(chaveTurma)) {
      vistas.set(chaveTurma, new Set());
    }
    vistas.get(chaveTurma).add(
      Utilities.formatDate(dataAula, Session.getScriptTimeZone(), 'yyyy-MM-dd')
    );
  }

  vistas.forEach((datas, chaveTurma) => {
    porTurma.set(chaveTurma, Array.from(datas).sort());
  });

  return porTurma;
}

/**
 * Frequência por aluno de uma turma, no formato que o score consome.
 *
 * Chama calcularPainelFrequenciaComAbonosSIGA_ com detalhar=true — a
 * mesma função que o Portal do Professor usa — em vez de reimplementar a
 * conta. Ela já resolve o que é difícil: abono de falta, janela de
 * matrícula de cada aluno, exclusão de experimental e chamada duplicada.
 *
 * A autorização já foi feita na entrada de obterAlunosEmRiscoAnalisesSIGA;
 * por isso chama o cálculo direto e não obterAcompanhamentoFrequenciaSIGA,
 * que exige o token de outro módulo.
 *
 * CUSTO: com detalhar=true o painel ignora o próprio cache e relê
 * Chamadas + DimMatricula + AbonosFrequencia a CADA turma. É a razão de
 * existir o orçamento de tempo em ANALISES_RISCO_CONFIG.
 *
 * Devolve Map<nome normalizado,
 *             { frequencia, frequenciaAnterior, faltas, consecutivas }>.
 */
function analisesRiscoFrequenciaDaTurma_(turma, datasDaTurma, mesInicial, mesFinal, mesCorrente) {
  const vazio = new Map();
  if (typeof calcularPainelFrequenciaComAbonosSIGA_ !== 'function') {
    return vazio;
  }

  let painel;
  try {
    painel = calcularPainelFrequenciaComAbonosSIGA_(
      { turma: turma, mesInicial: mesInicial, mesFinal: mesFinal },
      true
    );
  } catch (erro) {
    return vazio; // uma turma sem chamada não derruba a lista inteira
  }
  if (!painel || !Array.isArray(painel.alunos)) {
    return vazio;
  }

  const datas = datasDaTurma || [];
  const mapa = new Map();

  painel.alunos.forEach(aluno => {
    if (!aluno || !aluno.nomeAluno) return;

    // `dias` só traz as aulas em que o aluno não esteve presente. Falta
    // abonada fica de fora da sequência: o aluno avisou por que faltou —
    // é justamente o oposto do sumiço que a lista procura.
    const faltou = new Set();
    const abonadas = new Set();
    (aluno.dias || []).forEach(dia => {
      if (!dia || !dia.dataISO) return;
      if (dia.status === 'Falta abonada') {
        abonadas.add(dia.dataISO);
      } else {
        faltou.add(dia.dataISO);
      }
    });

    // Só as aulas dentro da vigência da matrícula do aluno — a mesma
    // janela que o painel usou para contar as faltas dele.
    const inicio = analisesRiscoDataBrParaISO_(aluno.dataInicio);
    const fim = analisesRiscoDataBrParaISO_(aluno.dataFim);
    const validas = datas.filter(d =>
      (!inicio || d >= inicio) && (!fim || d <= fim)
    );

    let consecutivas = 0;
    for (let i = validas.length - 1; i >= 0; i--) {
      if (!faltou.has(validas[i])) break;
      consecutivas++;
    }

    mapa.set(normalizarPagUnif_(aluno.nomeAluno), {
      // O percentual vem do painel, não recalculado aqui: é o número que
      // a tela de frequência mostra, e os dois não podem divergir.
      frequencia: (aluno.percentual === null || aluno.percentual === undefined)
        ? null
        : Number(aluno.percentual),
      frequenciaAnterior: analisesRiscoPercentual_(
        validas.filter(d => d.slice(0, 7) < mesCorrente), faltou, abonadas
      ),
      frequenciaRecente: analisesRiscoPercentual_(
        validas.filter(d => d.slice(0, 7) === mesCorrente), faltou, abonadas
      ),
      faltas: Number(aluno.faltas || 0),
      consecutivas: consecutivas
    });
  });

  return mapa;
}

/**
 * Percentual de presença num recorte de datas, com a mesma regra do
 * painel: falta abonada sai do denominador em vez de contar como
 * presença.
 */
function analisesRiscoPercentual_(datas, faltou, abonadas) {
  const consideradas = datas.filter(d => !abonadas.has(d));
  if (!consideradas.length) {
    return null;
  }
  const presencas = consideradas.filter(d => !faltou.has(d)).length;
  return (presencas / consideradas.length) * 100;
}

/** "31/08/2026" -> "2026-08-31". Vazio devolve null (sem limite). */
function analisesRiscoDataBrParaISO_(texto) {
  const partes = String(texto || '').trim().split('/');
  if (partes.length !== 3) return null;
  return partes[2] + '-' + partes[1] + '-' + partes[0];
}

