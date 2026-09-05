/**
 * SIGA — uma linha por turma na tela de Pagamentos
 *
 * Antes, aluno com duas matrículas virava UMA linha só:
 *   Turma: "FORMAÇÃO I22, FORMAÇÃO INTERMED1"
 *   Devido: R$ 260   Pago: R$ 260
 *
 * Ao filtrar por INTERMED1 aparecia o valor cheio, porque a
 * linha era do aluno, não da turma.
 *
 * Agora cada turma vira uma linha, com o devido dela e o pago
 * rateado na mesma proporção:
 *   FORMAÇÃO INTERMED1   Devido R$ 180   Pago R$ 180
 *   FORMAÇÃO I22         Devido R$  80   Pago R$  80
 *
 * O rateio é proporcional ao valor devido de cada turma, que é
 * a única divisão que o sistema tem como saber: o pagamento
 * chega como um valor único (um Pix, um boleto), sem indicação
 * de quanto era de cada turma.
 *
 * A soma é preservada ao centavo — a sobra do arredondamento
 * vai para a última turma. Aluno com uma matrícula só continua
 * com uma linha, exatamente como antes.
 */


function listarMensalidadesPagasSIGA(filtros) {
  const resultado =
    listarMensalidadesPagasAgrupadoSIGA_(filtros || {});

  return separarMensalidadesPorTurmaSIGA_(resultado);
}


function separarMensalidadesPorTurmaSIGA_(resultado) {
  if (!resultado || !Array.isArray(resultado.pagamentos)) {
    return resultado;
  }

  const linhas = [];

  resultado.pagamentos.forEach(item => {
    const detalhes = Array.isArray(item.detalhesTurmas)
      ? item.detalhesTurmas.filter(d => d && d.turma)
      : [];

    /* Uma turma só: nada muda. */
    if (detalhes.length < 2) {
      linhas.push(item);
      return;
    }

    const totalDevido = detalhes.reduce(
      (soma, d) => soma + Number(d.valorDevido || 0),
      0
    );

    const valorPagoTotal = Number(item.valorPago || 0);
    const diferencaTotal = Number(item.diferenca || 0);

    let pagoDistribuido = 0;
    let diferencaDistribuida = 0;

    detalhes.forEach((detalhe, indice) => {
      const ultima = indice === detalhes.length - 1;

      const devidoTurma = arredPagUnif_(
        Number(detalhe.valorDevido || 0)
      );

      /*
       * Sem valor devido em nenhuma turma (isento, por exemplo),
       * divide em partes iguais para não perder centavos.
       */
      const proporcao = totalDevido > 0
        ? Number(detalhe.valorDevido || 0) / totalDevido
        : 1 / detalhes.length;

      /* A última turma recebe a sobra, para a soma fechar. */
      const pagoTurma = ultima
        ? arredPagUnif_(valorPagoTotal - pagoDistribuido)
        : arredPagUnif_(valorPagoTotal * proporcao);

      const diferencaTurma = ultima
        ? arredPagUnif_(diferencaTotal - diferencaDistribuida)
        : arredPagUnif_(diferencaTotal * proporcao);

      pagoDistribuido = arredPagUnif_(pagoDistribuido + pagoTurma);
      diferencaDistribuida = arredPagUnif_(
        diferencaDistribuida + diferencaTurma
      );

      linhas.push({
        ...item,
        turma: detalhe.turma,
        valorDevido: devidoTurma,
        valorPago: pagoTurma,
        diferenca: diferencaTurma,
        detalhesTurmas: [
          {
            turma: detalhe.turma,
            valorDevido: devidoTurma
          }
        ],

        /*
         * Marca para a tela e para conferência: esta linha é a
         * fatia de um pagamento único do aluno.
         */
        rateadoPorTurma: true,
        turmasDoAluno: detalhes.map(d => d.turma).join(', '),
        valorPagoTotalAluno: arredPagUnif_(valorPagoTotal),
        valorDevidoTotalAluno: arredPagUnif_(totalDevido)
      });
    });
  });

  resultado.pagamentos = linhas;

  if (resultado.resumo) {
    resultado.resumo.quantidade = linhas.length;
  }

  return resultado;
}
