/**
 * SIGA — Análises comparativas e estratégicas
 *
 * Reaproveita os leitores e helpers já existentes no projeto
 * (lerMatriculasPagUnif_, mapaGenericoPagUnif_, parseDataPagUnif_,
 * normalizarPagUnif_, arredPagUnif_, numeroPagUnif_, obterAbaTodosBoletosPagamentosSIGA_,
 * montarBoletoPagamentosSIGA_, dataPagamentosSIGA_) definidos em Code.gs/Pagamentos.gs.
 * Não redeclara nada que já exista nesses arquivos.
 */

function obterAnalisesSIGA(filtros) {
  filtros = filtros || {};
  validarPermissaoPagamentosSIGA_(filtros.token);

  const hoje = new Date();
  const mesesJanela = Math.min(36, Math.max(3, Number(filtros.meses) || 12));
  const fimJanela = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const inicioJanela = new Date(fimJanela.getFullYear(), fimJanela.getMonth() - (mesesJanela - 1), 1);

  const periodos = [];
  for (let d = new Date(inicioJanela); d <= fimJanela; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    periodos.push(new Date(d));
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abaMat = ss.getSheetByName('DimMatricula');
  const matriculas = lerMatriculasPagUnif_(abaMat);

  // A frequência por turma NÃO é calculada aqui: obterPainelFrequenciaTurma
  // é cara e, chamada várias vezes em sequência, deixaria a tela inteira
  // esperando. O cliente busca a frequência depois, à parte, via
  // obterFrequenciaComparativoAnalisesSIGA.
  const comparativoTurmas = calcularComparativoTurmasAnalisesSIGA_(matriculas);

  let inadimplenciaAtual = 0;
  try {
    const inad = listarInadimplentesPagamentosSIGA({ token: filtros.token });
    inadimplenciaAtual = Number(inad && inad.resumo && inad.resumo.debitoTotal || 0);
  } catch (erro) {
    // A tela de análises não deve quebrar se o módulo de inadimplência falhar.
    inadimplenciaAtual = 0;
  }

  return {
    sucesso: true,
    periodos: periodos.map(p => analisesMesRotulo_(p).rotulo),
    mesInicial: analisesMesRotulo_(periodos[0]).chave,
    mesFinal: analisesMesRotulo_(periodos[periodos.length - 1]).chave,
    serieMatriculas: calcularSerieMatriculasAnalisesSIGA_(matriculas, periodos),
    serieFinanceira: calcularSerieFinanceiraAnalisesSIGA_(ss, periodos),
    comparativoTurmas,
    resumo: {
      alunosAtivos: matriculas.filter(m => normalizarPagUnif_(m.status) === 'ATIVO').length,
      turmasComparadas: comparativoTurmas.length,
      inadimplenciaAtual: arredPagUnif_(inadimplenciaAtual)
    }
  };
}

/**
 * Busca a frequência média de um conjunto pequeno de turmas (chamado à
 * parte, depois que a tela principal já carregou, para não bloquear a
 * abertura da tela inteira em obterPainelFrequenciaTurma).
 */
function obterFrequenciaComparativoAnalisesSIGA(filtros) {
  filtros = filtros || {};
  validarPermissaoPagamentosSIGA_(filtros.token);

  const frequencias = {};
  const turmas = Array.isArray(filtros.turmas) ? filtros.turmas.slice(0, 10) : [];

  if (typeof obterPainelFrequenciaTurma !== 'function') {
    return { sucesso: true, frequencias };
  }

  turmas.forEach(turma => {
    try {
      const painel = obterPainelFrequenciaTurma({
        turma,
        mesInicial: filtros.mesInicial,
        mesFinal: filtros.mesFinal
      });
      frequencias[turma] = Number(painel && painel.resumo && painel.resumo.mediaFrequencia || 0);
    } catch (erro) {
      frequencias[turma] = null;
    }
  });

  return { sucesso: true, frequencias };
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

function calcularComparativoTurmasAnalisesSIGA_(matriculas) {
  const porTurma = new Map();

  matriculas.forEach(m => {
    const turma = String(m.turma || '').trim();
    if (!turma) {
      return;
    }

    if (!porTurma.has(turma)) {
      porTurma.set(turma, { turma, ativos: 0, cancelados: 0, total: 0, frequenciaMedia: null });
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

  return Array.from(porTurma.values())
    .map(item => Object.assign({}, item, {
      taxaEvasao: item.total > 0 ? arredPagUnif_((item.cancelados / item.total) * 100) : 0
    }))
    .sort((a, b) => b.ativos - a.ativos)
    .slice(0, 20);
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
