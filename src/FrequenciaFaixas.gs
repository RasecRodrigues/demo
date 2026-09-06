/**
 * SIGA — Faixas de frequência (fonte única)
 *
 * A régua oficial do projeto, na forma em que o relatório de frequência
 * já a descrevia ao leitor:
 *
 *   abaixo de 50% ....... Risco crítico
 *   de 50% a 69,9% ...... Risco de evasão
 *   de 70% a 89,9% ...... Frequência adequada
 *   90% ou mais ......... Frequência excelente
 *
 * POR QUE ESTE ARQUIVO EXISTE:
 * a mesma pergunta — "esse aluno está mal de frequência?" — era
 * respondida em cinco lugares, com quatro respostas diferentes. O caso
 * mais visível ficava dentro de um único PDF: um aluno com 72% entrava
 * na conta do cartão "Alunos em risco" (LIMITE_RISCO era 75) e, três
 * centímetros abaixo, aparecia na tabela como "Frequência adequada"
 * (o diagnóstico corta em 70). O mesmo documento se contradizia.
 *
 * "Em risco" deixa de ser um número solto e passa a ser derivado: são as
 * duas piores faixas, crítico e evasão — ou seja, abaixo de 70%. Não há
 * mais um corte que possa divergir da régua, porque ele não existe mais.
 */

const SIGA_FREQUENCIA_FAIXAS = [
  {
    chave: 'critico',
    minimo: 0,
    rotulo: 'Risco crítico',
    emRisco: true,
    cor: '#dc2626',
    classeTexto: 'freq-critica',
    classeEtiqueta: 'diagnostico-critico'
  },
  {
    chave: 'evasao',
    minimo: 50,
    rotulo: 'Risco de evasão',
    emRisco: true,
    cor: '#ea580c',
    classeTexto: 'freq-evasao',
    classeEtiqueta: 'diagnostico-evasao'
  },
  {
    chave: 'adequado',
    minimo: 70,
    rotulo: 'Frequência adequada',
    emRisco: false,
    cor: '#ca8a04',
    classeTexto: 'freq-adequada',
    classeEtiqueta: 'diagnostico-adequado'
  },
  {
    chave: 'excelente',
    minimo: 90,
    rotulo: 'Frequência excelente',
    emRisco: false,
    cor: '#16a34a',
    classeTexto: 'freq-excelente',
    classeEtiqueta: 'diagnostico-excelente'
  }
];

/**
 * A faixa de um percentual.
 *
 * Devolve null quando não há percentual — aluno sem aula válida no
 * período. Null não é a mesma coisa que 0%: quem não teve aula não tem
 * frequência ruim, tem frequência desconhecida, e tratar os dois como
 * iguais colocaria aluno novo no topo de toda lista de risco.
 */
function obterFaixaFrequenciaSIGA_(percentual) {
  if (percentual === null || percentual === undefined || percentual === '') {
    return null;
  }

  const valor = Number(percentual);
  if (isNaN(valor)) {
    return null;
  }

  // Da melhor para a pior: a primeira cujo mínimo o valor alcança.
  for (let i = SIGA_FREQUENCIA_FAIXAS.length - 1; i >= 0; i--) {
    if (valor >= SIGA_FREQUENCIA_FAIXAS[i].minimo) {
      return SIGA_FREQUENCIA_FAIXAS[i];
    }
  }

  return SIGA_FREQUENCIA_FAIXAS[0];
}

/**
 * "Em risco" = as duas piores faixas (abaixo de 70%).
 *
 * Sem percentual devolve false: sem aula no período não há como afirmar
 * risco, e contar como risco encheria o relatório de falso positivo todo
 * início de turma.
 */
function frequenciaEmRiscoSIGA_(percentual) {
  const faixa = obterFaixaFrequenciaSIGA_(percentual);
  return Boolean(faixa && faixa.emRisco);
}

/** O texto que o leitor vê. */
function rotuloFrequenciaSIGA_(percentual) {
  const faixa = obterFaixaFrequenciaSIGA_(percentual);
  return faixa ? faixa.rotulo : 'Sem aulas válidas no período';
}

/**
 * A descrição da régua, para não escrever os números na mão em cada
 * relatório — e não haver texto explicativo desatualizado se a régua
 * mudar.
 */
function descreverFaixasFrequenciaSIGA_() {
  return 'Critério: abaixo de 50% = risco crítico; de 50% a 69,9% = risco '
    + 'de evasão; de 70% a 89,9% = frequência adequada; 90% ou mais = '
    + 'frequência excelente. Em risco = abaixo de 70%.';
}
