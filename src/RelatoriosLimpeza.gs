/**
 * SIGA — Limpeza dos relatórios em PDF
 *
 * O projeto gera PDF em três pastas do Drive, cada uma de um módulo:
 *
 *   SIGA - Relatórios de Análises    (Analises.gs)
 *   SIGA - Relatórios de Turmas      (limparRelatoriosTurmasAntigosSIGA)
 *   SIGA - Relatórios de Frequência  (limparRelatoriosFrequenciaAntigos)
 *
 * Duas delas já têm função de limpeza, mas nenhuma é chamada por
 * ninguém — os próprios comentários dizem "ligue num acionador de tempo
 * se quiser limpeza automática". Este arquivo é esse acionador. A pasta
 * de Análises não tinha limpeza nenhuma e ganha uma aqui.
 *
 * POR QUE ISSO IMPORTA MAIS DO QUE ESPAÇO EM DISCO:
 * todo PDF nasce com DriveApp.Access.ANYONE_WITH_LINK, necessário para
 * o funcionário abrir sem pedir permissão. Isso significa que cada
 * arquivo fica legível por qualquer pessoa com o link, para sempre — e
 * esses arquivos trazem nome de aluno, frequência e situação de dívida.
 * Apagar depois de alguns dias transforma "exposto para sempre" em
 * "exposto por uma semana".
 *
 * INSTALAÇÃO: rode configurarGatilhoLimpezaRelatoriosSIGA UMA VEZ pelo
 * editor do Apps Script.
 */

const LIMPEZA_RELATORIOS_SIGA = {
  // Só para a pasta de Análises. Turmas e Frequência mantêm o prazo
  // declarado em cada módulo (DIAS_PARA_LIMPEZA), para que o número
  // continue morando junto do código que cria o arquivo.
  DIAS_ANALISES: 7,
  HORA_EXECUCAO: 3
};

/**
 * Execute UMA VEZ pelo editor do Apps Script. Agenda a limpeza diária
 * de madrugada, quando ninguém está gerando relatório.
 */
function configurarGatilhoLimpezaRelatoriosSIGA() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'limparRelatoriosAntigosSIGA')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('limparRelatoriosAntigosSIGA')
    .timeBased()
    .everyDays(1)
    .atHour(LIMPEZA_RELATORIOS_SIGA.HORA_EXECUCAO)
    .create();

  return 'Limpeza diária agendada para as '
    + LIMPEZA_RELATORIOS_SIGA.HORA_EXECUCAO + 'h.';
}

/**
 * Alvo do gatilho. Limpa as três pastas.
 *
 * Cada pasta é tentada de forma isolada: uma pasta apagada na mão, ou um
 * módulo que ainda não foi colado no projeto, não pode impedir a limpeza
 * das outras duas — seria a diferença entre uma pasta acumulando e três.
 */
function limparRelatoriosAntigosSIGA() {
  const resultado = { analises: 0, turmas: 0, frequencia: 0, falhas: [] };

  const tentar = (rotulo, acao) => {
    try {
      resultado[rotulo] = Number(acao() || 0);
    } catch (erro) {
      resultado.falhas.push(rotulo + ': ' + (erro && erro.message ? erro.message : erro));
    }
  };

  // A pasta de Análises não tem função própria — é a única limpa aqui.
  tentar('analises', () => {
    if (typeof obterPastaRelatoriosAnalisesSIGA_ !== 'function') {
      throw new Error('Analises.gs não está no projeto.');
    }
    return limparPastaRelatoriosSIGA_(
      obterPastaRelatoriosAnalisesSIGA_(),
      LIMPEZA_RELATORIOS_SIGA.DIAS_ANALISES
    );
  });

  // As outras duas já sabem se limpar; reaproveitar mantém o prazo de
  // cada módulo no módulo, em vez de espalhar o número por aqui.
  tentar('turmas', () => {
    if (typeof limparRelatoriosTurmasAntigosSIGA !== 'function') {
      throw new Error('O módulo de relatório de turmas não está no projeto.');
    }
    return limparRelatoriosTurmasAntigosSIGA();
  });

  tentar('frequencia', () => {
    if (typeof limparRelatoriosFrequenciaAntigos !== 'function') {
      throw new Error('O módulo de relatório de frequência não está no projeto.');
    }
    return limparRelatoriosFrequenciaAntigos();
  });

  console.log(JSON.stringify(resultado));
  return resultado;
}

/**
 * Manda para a lixeira os arquivos criados há mais de `dias`.
 *
 * setTrashed (e não remove) é de propósito, igual às limpezas que já
 * existem: um relatório apagado por engano volta da lixeira. Vale saber
 * que, enquanto estiver lá, ele ainda ocupa espaço e o link continua
 * valendo — a lixeira do Drive esvazia sozinha em 30 dias.
 */
function limparPastaRelatoriosSIGA_(pasta, dias) {
  const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
  const arquivos = pasta.getFiles();
  let removidos = 0;

  while (arquivos.hasNext()) {
    const arquivo = arquivos.next();
    if (arquivo.getDateCreated().getTime() < limite) {
      arquivo.setTrashed(true);
      removidos++;
    }
  }

  return removidos;
}
