/**
 * SIGA — Correções do Analises.gs
 *
 * 1. Frequência que some de parte das turmas.
 * 2. Matrículas vs. cancelamentos contando por TIPO e STATUS.
 *
 * COMO INSTALAR — dois passos, sem emendar nada no meio do arquivo:
 *
 * 1) No Analises.gs, APAGUE estas três funções inteiras (da linha
 *    "function" até a chave que a fecha). Só apagar, não colar nada:
 *
 *       analisesGravarCacheComparativoTurmas_
 *       analisesAtualizarFrequenciaCacheComOrcamento_
 *       calcularSerieMatriculasAnalisesSIGA_
 *
 * 2) Crie um arquivo novo (+ → Script) chamado AnalisesCorrecoes e cole
 *    ESTE arquivo inteiro. As versões corrigidas das três, mais quatro
 *    auxiliares novos e um diagnóstico, já vêm aqui.
 *
 * No Apps Script todos os .gs dividem o mesmo escopo global, então as
 * funções deste arquivo passam a valer para o projeto todo. É por isso
 * que o passo 1 é obrigatório: duas funções com o mesmo nome fazem a
 * ordem de carregamento decidir qual vale, e isso não é confiável.
 *
 * NÃO mexa em analisesRecalcularCacheNucleoSemLock_ nem em nada de
 * Chamadas, pagamentos ou professores.
 */


/* =========================================================
 * ERRO 1 — A FREQUÊNCIA SÓ APARECE EM ALGUMAS TURMAS
 *
 * CAUSA: o núcleo chama o gravador com um Map vazio:
 *
 *     analisesGravarCacheComparativoTurmas_(ss, comparativoTurmas, new Map());
 *
 * e o gravador escreve '' quando o Map não tem a turma. Ou seja, TODO
 * recálculo apaga a coluna FrequenciaMedia inteira. Depois, a etapa de
 * frequência só consegue repreencher as turmas que couberem no orçamento
 * de 4,5 min — as demais ficam em branco até a próxima rodada, que apaga
 * tudo de novo. Numa escola com muitas turmas, algumas nunca aparecem.
 *
 * CORREÇÃO: ler as médias ANTES de recriar a aba e preservá-las.
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
  const aba = ss.getSheetByName(ANALISES_CACHE_SHEETS.COMPARATIVO);

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
    ANALISES_CACHE_SHEETS.COMPARATIVO,
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

  const aba = ss.getSheetByName(ANALISES_CACHE_SHEETS.COMPARATIVO);
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
    props.deleteProperty(ANALISES_CACHE_PROP_FREQ_CURSOR);
    return vazio;
  }

  const retomada = props.getProperty(ANALISES_CACHE_PROP_FREQ_CURSOR) || '';
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
    const atual = ss.getSheetByName(ANALISES_CACHE_SHEETS.COMPARATIVO);
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

    props.setProperty(ANALISES_CACHE_PROP_FREQ_CURSOR, proximaTurma);
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


/* =========================================================
 * ERRO 2 — MATRÍCULAS VS. CANCELAMENTOS
 *
 * O subtítulo da tela já dizia a regra certa, mas o cálculo não a
 * aplicava: contava QUALQUER matrícula com data de início no mês como
 * entrada, e QUALQUER uma com data de encerramento como saída,
 * independentemente do TIPO e do STATUS.
 *
 * Agora:
 *   entrada = TIPO_MATRICULA/ALTERACAO em ATIVAÇÃO, NOVA ou UPGRADE
 *   saída   = STATUS em CANCELADO, FINALIZADO, ABANDONO ou SUSPENSO
 *
 * ATENÇÃO: os números de entradas vão CAIR. Tudo que tiver TIPO fora da
 * lista (transferência, rematrícula, campo em branco) deixa de contar.
 * Rode diagnosticarTiposMatriculaAnalisesSIGA para ver quais valores
 * existem na sua DimMatricula antes de estranhar a queda.
 * ========================================================= */

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
