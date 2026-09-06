/**
 * SIGA — Diagnóstico do "em atraso" da lista de risco
 *
 * Rode pelo editor do Apps Script (selecione a função ao lado do botão
 * Executar) passando um trecho do nome do aluno. Não grava nada.
 *
 * POR QUE EXISTE:
 * o "em atraso" da lista de risco compara DEVIDO com PAGO, e as duas
 * pontas vêm de lugares diferentes do sistema:
 *
 *   devido = analisesCalcularValorMatricula_ (Pagamentos.gs)
 *   pago   = cache AnalisesCache_PagamentoAluno
 *
 * O cache é montado de forma assimétrica em
 * analisesCalcularFinanceiroEValorPagoSIGA_: da aba "Comprovante de
 * pagamento" entra SÓ "VALOR PAGO MENSALIDADE" (mais o resíduo), mas de
 * TodosBoletos entra o boleto INTEIRO. Se a taxa de matrícula for
 * cobrada dentro de um boleto, ela entra na conta como se fosse
 * mensalidade; se for lançada por comprovante, não entra.
 *
 * Isso produz erro nos dois sentidos:
 *   - pago inflado por taxa de matrícula esconde um mês realmente em
 *     aberto (o aluno em atraso não aparece na lista);
 *   - devido calculado sem considerar bolsa ou isenção marca como
 *     devedor quem não deve nada — e, como o atraso soma pontos, joga
 *     todo bolsista para o topo da lista de risco.
 *
 * Este diagnóstico imprime as duas pontas lado a lado, mês a mês, junto
 * das marcações BOLSISTA e ISENTO_MATRICULA da DimMatricula, para a
 * pergunta ser respondida com dado e não com suposição. Rode em três
 * alunos: um pagante comum, um bolsista e um isento.
 */
function diagnosticarFinanceiroRiscoSIGA(nomeParcial) {
  const termo = normalizarPagUnif_(nomeParcial || '');
  if (!termo) {
    throw new Error('Passe um trecho do nome do aluno, ex.: diagnosticarFinanceiroRiscoSIGA("Maria Souza")');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const matriculas = lerMatriculasPagUnif_(ss.getSheetByName('DimMatricula'));
  criarIndiceIdentidadePagamentosSIGA_(ss, matriculas);

  const doAluno = matriculas.filter(m =>
    normalizarPagUnif_(m.nome || '').includes(termo) ||
    normalizarPagUnif_(m.nomeSocial || '').includes(termo)
  );

  if (!doAluno.length) {
    throw new Error('Nenhuma matrícula encontrada para "' + nomeParcial + '".');
  }

  garantirCacheAnalisesSIGA_();
  const valorPagoPorAlunoMes = analisesLerCachePagamentoAluno_();

  const hoje = new Date();
  const inicioMesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const periodos = analisesGerarPeriodos_(ANALISES_RISCO_CONFIG.MESES_RECORRENCIA + 1);

  const chaves = Array.from(new Set(doAluno.map(m =>
    m.chaveAluno || normalizarPagUnif_(m.idAluno || m.nome)
  ).filter(Boolean)));

  const relatorio = {
    aluno: doAluno[0].nome,
    // As marcações que o cálculo de "devido" PRECISA respeitar. Se
    // estiverem em SIM e mesmo assim aparecer saldo devedor abaixo, o
    // problema está no cálculo do devido, não no pagamento.
    marcacoes: analisesRiscoLerMarcacoesDimMatricula_(ss, termo),
    meses: []
  };

  periodos.forEach(ref => {
    const ehMesCorrente = ref >= inicioMesAtual;
    const dataCalculo = ehMesCorrente
      ? hoje
      : new Date(ref.getFullYear(), ref.getMonth() + 1, 0);

    const vigentes = doAluno.filter(m => analisesMatriculaNoRateio_(m, ref, dataCalculo));
    if (!vigentes.length) {
      return;
    }

    const combo = vigentes.length > 1;
    const chaveMes = analisesMesRotulo_(ref).chave;

    const detalheDevido = vigentes.map(m => ({
      turma: String(m.turma || '').trim(),
      status: m.status,
      valor: arredPagUnif_(Number(analisesCalcularValorMatricula_(m, combo, ref, dataCalculo) || 0))
    }));

    const devido = detalheDevido.reduce((s, d) => s + d.valor, 0);

    const detalhePago = [];
    let pago = 0;
    chaves.forEach(chave => {
      const porTurma = valorPagoPorAlunoMes.get(chave + '|' + chaveMes);
      if (!porTurma) return;
      porTurma.forEach((valor, turma) => {
        detalhePago.push({ turma: turma || '(turma não identificada no pagamento)', valor: arredPagUnif_(valor) });
        pago += Number(valor || 0);
      });
    });

    const saldo = devido - pago;

    relatorio.meses.push({
      mes: chaveMes,
      mesCorrente: ehMesCorrente,
      combo: combo,
      devido: arredPagUnif_(devido),
      detalheDevido: detalheDevido,
      pago: arredPagUnif_(pago),
      detalhePago: detalhePago,
      saldo: arredPagUnif_(saldo),
      // Espelha exatamente a regra de analisesRiscoFinanceiroPorAluno_.
      contaComoAtraso: !ehMesCorrente && saldo > ANALISES_RISCO_CONFIG.TOLERANCIA_REAIS,
      // Pago acima do devido é o sintoma de taxa de matrícula (ou outra
      // cobrança) entrando na conta pela via do boleto inteiro.
      pagoAcimaDoDevido: pago - devido > ANALISES_RISCO_CONFIG.TOLERANCIA_REAIS
    });
  });

  const fechados = relatorio.meses.filter(m => !m.mesCorrente);
  relatorio.conclusao = {
    mesesFechados: fechados.length,
    mesesContadosComoAtraso: fechados.filter(m => m.contaComoAtraso).length,
    mesesComPagoAcimaDoDevido: fechados.filter(m => m.pagoAcimaDoDevido).length
  };

  console.log(JSON.stringify(relatorio, null, 2));
  return relatorio;
}

/**
 * BOLSISTA e ISENTO_MATRICULA direto da DimMatricula.
 *
 * Lidos aqui, e não de lerMatriculasPagUnif_, porque não se sabe se
 * aquele leitor expõe esses campos — e a pergunta que este diagnóstico
 * responde é justamente se o cálculo do devido os respeita.
 */
function analisesRiscoLerMarcacoesDimMatricula_(ss, termo) {
  const aba = ss.getSheetByName('DimMatricula');
  if (!aba || aba.getLastRow() < 2) {
    return [];
  }

  const dados = aba.getDataRange().getValues();
  const mapa = mapaGenericoPagUnif_(dados[0]);
  const marcacoes = [];

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const nome = String(campoPagUnif_(linha, mapa, ['NOME_ALUNO', 'NOME DO ALUNO']) || '');
    if (!normalizarPagUnif_(nome).includes(termo)) continue;

    marcacoes.push({
      turma: String(campoPagUnif_(linha, mapa, ['TURMA']) || '').trim(),
      status: String(campoPagUnif_(linha, mapa, ['STATUS']) || '').trim(),
      bolsista: String(campoPagUnif_(linha, mapa, ['BOLSISTA']) || '').trim(),
      isentoMatricula: String(campoPagUnif_(linha, mapa, ['ISENTO_MATRICULA', 'ISENTO MATRICULA']) || '').trim()
    });
  }

  return marcacoes;
}
