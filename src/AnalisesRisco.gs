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

  // Comparar frequência recente com a anterior custa uma segunda consulta
  // ao painel de frequência por turma — a chamada mais cara do módulo.
  // Desligue se "todas as turmas" ficar lento demais: o resto do score
  // continua saindo normalmente, só sem o sinal de queda.
  AVALIAR_QUEDA: true,

  // Orçamento de tempo. obterPainelFrequenciaTurma é a parte cara (é a
  // mesma chamada que já obriga o cache de Análises a trabalhar por
  // orçamento). Sem isto, "todas as turmas" numa escola grande estoura o
  // limite de 6 min do Apps Script e a tela não recebe nada — melhor
  // devolver as turmas que couberam e dizer quantas ficaram de fora.
  ORCAMENTO_MS: 55 * 1000
};

/**
 * Lista de alunos em risco, do maior score para o menor.
 *
 * Só entram matrículas ATIVAS hoje: quem já saiu não corre risco de sair,
 * e quem está EM ESPERA ainda não começou a frequentar (frequência dele
 * não significa nada).
 */
function obterAlunosEmRiscoAnalisesSIGA(filtros) {
  filtros = filtros || {};
  validarPermissaoPagamentosSIGA_(filtros.token);

  const inicioExecucao = Date.now();
  const turmaAlvo = String(filtros.turma || '').trim();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const matriculas = lerMatriculasPagUnif_(ss.getSheetByName('DimMatricula'));
  criarIndiceIdentidadePagamentosSIGA_(ss, matriculas);

  garantirCacheAnalisesSIGA_();
  const valorPagoPorAlunoMes = analisesLerCachePagamentoAluno_();

  const turmas = new Set();
  const ativas = [];

  matriculas.forEach(m => {
    const turma = String(m.turma || '').trim();
    if (!turma) return;
    turmas.add(turma);
    if (normalizarPagUnif_(m.status) !== 'ATIVO') return;
    if (turmaAlvo && turma !== turmaAlvo) return;
    ativas.push(m);
  });

  const financeiroPorAluno = analisesRiscoFinanceiroPorAluno_(matriculas, valorPagoPorAlunoMes);

  // Uma consulta de frequência por turma, não por aluno — é a chamada
  // cara, e o painel já devolve a turma inteira de uma vez.
  const turmasDaLista = Array.from(new Set(ativas.map(m => String(m.turma || '').trim())));
  const frequenciaPorTurma = new Map();
  let turmasPendentes = 0;

  turmasDaLista.forEach(turma => {
    if (Date.now() - inicioExecucao > ANALISES_RISCO_CONFIG.ORCAMENTO_MS) {
      turmasPendentes++;
      return;
    }
    frequenciaPorTurma.set(turma, analisesRiscoFrequenciaDaTurma_(turma));
  });

  const hoje = new Date();
  const alunos = [];

  ativas.forEach(m => {
    const turma = String(m.turma || '').trim();
    const porAluno = frequenciaPorTurma.get(turma);
    if (!porAluno) return; // turma que não coube no orçamento

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

  alunos.sort((a, b) => b.score - a.score || a.aluno.localeCompare(b.aluno, 'pt-BR'));

  return {
    sucesso: true,
    turma: turmaAlvo,
    turmas: Array.from(turmas).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    alunos: alunos,
    resumo: analisesRiscoResumo_(alunos),
    turmasAnalisadas: frequenciaPorTurma.size,
    turmasPendentes: turmasPendentes,
    frequenciaIndisponivel: alunos.length > 0 && alunos.every(a => a.frequencia === null)
  };
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
 * ADAPTADOR — frequência por aluno de uma turma.
 *
 * O restante deste arquivo usa só funções que já foram lidas. Esta é a
 * exceção: de obterPainelFrequenciaTurma só se conhece o
 * `.resumo.mediaFrequencia` que o Analises.gs consome, e aqui o que
 * importa é o detalhe POR ALUNO. Em vez de chutar um formato só, procura
 * a lista nos nomes mais prováveis e, se não achar nenhum, devolve
 * frequência nula — o score continua saindo pelos outros sinais e a tela
 * avisa que a frequência não entrou (ver frequenciaIndisponivel).
 *
 * Quando o formato real for conhecido, troque este corpo por um acesso
 * direto: é o único ponto do módulo que precisa mudar.
 *
 * Devolve Map<nome normalizado,
 *             { frequencia, frequenciaAnterior, faltas, consecutivas }>.
 */
function analisesRiscoFrequenciaDaTurma_(turma) {
  const cfg = ANALISES_RISCO_CONFIG;
  const recente = analisesRiscoLerPainelFrequencia_(turma, 0, 0);

  if (!cfg.AVALIAR_QUEDA || !recente.size) {
    return recente;
  }

  // Segunda consulta, só para a linha de base da queda: os três meses
  // ANTERIORES ao corrente. É o que dobra o custo desta etapa — daí o
  // interruptor AVALIAR_QUEDA na configuração.
  const anterior = analisesRiscoLerPainelFrequencia_(turma, 3, 1);
  recente.forEach((dados, chaveNome) => {
    const base = anterior.get(chaveNome);
    dados.frequenciaAnterior = base ? base.frequencia : null;
  });

  return recente;
}

/**
 * Uma consulta ao painel de frequência da turma numa janela de meses.
 * `mesesAtras` recua o fim da janela (0 = mês corrente) e `extra` alarga
 * o início — assim a mesma função serve para o retrato de agora e para a
 * linha de base anterior.
 */
function analisesRiscoLerPainelFrequencia_(turma, extra, mesesAtras) {
  const vazio = new Map();
  if (typeof obterPainelFrequenciaTurma !== 'function') {
    return vazio;
  }

  const periodos = analisesGerarPeriodos_(1 + extra + mesesAtras);
  const usados = mesesAtras > 0 ? periodos.slice(0, periodos.length - mesesAtras) : periodos;
  if (!usados.length) {
    return vazio;
  }

  const mesInicial = analisesMesRotulo_(usados[0]).chave;
  const mesFinal = analisesMesRotulo_(usados[usados.length - 1]).chave;

  let painel;
  try {
    painel = obterPainelFrequenciaTurma({ turma: turma, mesInicial: mesInicial, mesFinal: mesFinal });
  } catch (erro) {
    return vazio; // uma turma sem frequência não derruba a lista inteira
  }
  if (!painel) {
    return vazio;
  }

  const lista = painel.alunos || painel.linhas || painel.detalhes || painel.itens;
  if (!Array.isArray(lista)) {
    return vazio;
  }

  const mapa = new Map();
  lista.forEach(item => {
    if (!item) return;
    const nome = item.aluno || item.nome || item.nomeAluno;
    if (!nome) return;

    mapa.set(normalizarPagUnif_(nome), {
      frequencia: analisesRiscoPrimeiroNumero_([
        item.frequencia, item.percentual, item.percentualPresenca, item.mediaFrequencia
      ]),
      frequenciaAnterior: null,
      faltas: analisesRiscoPrimeiroNumero_([item.faltas, item.ausencias, item.totalFaltas]) || 0,
      consecutivas: analisesRiscoPrimeiroNumero_([
        item.faltasConsecutivas, item.consecutivas, item.faltasSeguidas
      ]) || 0
    });
  });

  return mapa;
}

function analisesRiscoPrimeiroNumero_(candidatos) {
  for (let i = 0; i < candidatos.length; i++) {
    const valor = candidatos[i];
    if (valor === null || valor === undefined || valor === '') continue;
    const numero = Number(valor);
    if (!isNaN(numero)) return numero;
  }
  return null;
}
