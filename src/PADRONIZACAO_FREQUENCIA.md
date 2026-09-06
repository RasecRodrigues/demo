# Padronização das faixas de frequência — código pronto

Régua única (`FrequenciaFaixas.gs`):

| Frequência | Rótulo | Em risco? |
| --- | --- | --- |
| abaixo de 50% | Risco crítico | sim |
| 50% a 69,9% | Risco de evasão | sim |
| 70% a 89,9% | Frequência adequada | não |
| 90% ou mais | Frequência excelente | não |

`LIMITE_RISCO` deixa de existir: "em risco" é derivado das duas piores faixas
(`frequenciaEmRiscoSIGA_`), então não há mais um corte que possa divergir.

Os valores de `classeTexto`/`classeEtiqueta` são exatamente os nomes de classe
que o `RelatorioFrequenciaTemplate.html` já usa. **Nenhum CSS muda.**

## Ordem de instalação

1. Crie o arquivo **`FrequenciaFaixas.gs`** com o conteúdo de `FrequenciaFaixas.gs`.
2. Aplique os blocos abaixo. Cada um é uma unidade completa — troque o bloco
   inteiro, não linhas soltas.
3. Salve e publique **Nova versão** da implantação.

Os arquivos `AnalisesRisco.gs`, `AnalisesMotivos.gs` e `RelatoriosLimpeza.gs`
já saem prontos, sem edição.

---

# 1. `RelatoriosFrequencia.gs`

## 1.1 Troque o objeto de configuração inteiro

```js
const CONFIG_RELATORIO_FREQUENCIA = {
  NOME_ESCOLA: 'Casa de Artes Gabriel Engel',
  NOME_PASTA: 'SIGA - Relatórios de Frequência',
  // LIMITE_RISCO saiu: "em risco" agora vem de frequenciaEmRiscoSIGA_
  // (FrequenciaFaixas.gs), para não existir um corte que possa divergir
  // do diagnóstico mostrado na mesma página do relatório.
  DIAS_PARA_LIMPEZA: 7
};
```

## 1.2 Dentro de `prepararTurmaRelatorioFrequencia_`, troque o bloco `alunosPreparados` inteiro

```js
  const alunosPreparados =
    alunos.map(aluno => {
      const percentual =
        Number(aluno.percentual || 0);

      const status =
        String(aluno.status || 'SEM STATUS')
          .trim()
          .toUpperCase();

      const ativo =
        ['ATIVO', 'ATIVA'].includes(status);

      const temAula =
        Number(aluno.totalAulas || 0) > 0;

      const faixa =
        temAula
          ? obterFaixaFrequenciaSIGA_(percentual)
          : null;

      return {
        nomeAluno:
          String(aluno.nomeAluno || ''),
        status,
        totalAulas:
          Number(aluno.totalAulas || 0),
        presencas:
          Number(aluno.presencas || 0),
        faltas:
          Number(aluno.faltas || 0),
        percentual,
        percentualTexto:
          formatarPercentualRelatorio_(percentual),
        classificacao:
          classificarFrequenciaRelatorio_(
            percentual,
            aluno.totalAulas,
            ativo
          ),
        classe:
          classeFrequenciaRelatorio_(percentual),

        /*
         * A faixa vai pronta para o template. Sem isto ele recalculava a
         * mesma escada por conta própria — duas cópias da regra no
         * caminho de um único PDF, que era como as duas versavam
         * divergir.
         */
        classeTexto: faixa ? faixa.classeTexto : '',
        classeEtiqueta: faixa ? faixa.classeEtiqueta : '',

        ativo,
        emRisco:
          ativo &&
          temAula &&
          frequenciaEmRiscoSIGA_(percentual)
      };
    });
```

## 1.3 Troque as duas funções de classificação inteiras

```js
function classificarFrequenciaRelatorio_(
  percentual,
  totalAulas,
  ativo
) {
  if (!ativo) {
    return 'Fora da análise de risco';
  }

  if (Number(totalAulas || 0) <= 0) {
    return 'Sem aulas válidas no período';
  }

  return rotuloFrequenciaSIGA_(percentual);
}


/*
 * As três classes do gráfico de barras (alta/media/baixa) derivam da
 * régua em vez de repetir os números: já batiam com ela, e delegar é o
 * que impede de saírem do lugar se a régua mudar.
 */
function classeFrequenciaRelatorio_(
  percentual
) {
  const faixa =
    obterFaixaFrequenciaSIGA_(percentual);

  if (!faixa) {
    return 'baixa';
  }

  if (faixa.chave === 'excelente') {
    return 'alta';
  }

  if (faixa.chave === 'adequado') {
    return 'media';
  }

  return 'baixa';
}
```

---

# 2. `RelatorioFrequenciaTemplate.html`

## 2.1 APAGUE a função `dadosDiagnostico` inteira

Ela reimplementa, dentro do template, a escada que o `.gs` já calculou e
mandou em `aluno.classificacao`. Apague desde `function dadosDiagnostico(aluno) {`
até o `}` que a fecha.

## 2.2 Troque o parágrafo do critério

```html
      <p class="observacao">
        <?= descreverFaixasFrequenciaSIGA_() ?>
        Alunos sem aulas válidas no período aparecem como
        “Sem aulas válidas no período”.
      </p>
```

## 2.3 Troque o `<tbody>` da PRIMEIRA página inteiro

```html
          <tbody>
            <? alunosPrimeiraPagina.forEach(function(aluno) { ?>
              <tr class="risco-linha">
                <td><strong><?= aluno.nomeAluno ?></strong></td>
                <td class="numero"><?= aluno.totalAulas ?></td>
                <td class="numero"><?= aluno.presencas ?></td>
                <td class="numero"><?= aluno.faltas ?></td>
                <td class="numero freq <?= aluno.classeTexto ?>">
                  <span class="icone-frequencia">●</span>
                  <?= aluno.percentualTexto ?>
                </td>
                <td>
                  <span class="diagnostico <?= aluno.classeEtiqueta ?>">
                    <?= aluno.classificacao ?>
                  </span>
                </td>
              </tr>
            <? }); ?>
          </tbody>
```

## 2.4 Troque o `<tbody>` das páginas de CONTINUAÇÃO inteiro

```html
          <tbody>
            <? grupo.forEach(function(aluno) { ?>
              <tr class="risco-linha">
                <td><strong><?= aluno.nomeAluno ?></strong></td>
                <td class="numero"><?= aluno.totalAulas ?></td>
                <td class="numero"><?= aluno.presencas ?></td>
                <td class="numero"><?= aluno.faltas ?></td>
                <td class="numero freq <?= aluno.classeTexto ?>">
                  <span class="icone-frequencia">●</span>
                  <?= aluno.percentualTexto ?>
                </td>
                <td>
                  <span class="diagnostico <?= aluno.classeEtiqueta ?>">
                    <?= aluno.classificacao ?>
                  </span>
                </td>
              </tr>
            <? }); ?>
          </tbody>
```

---

# 3. `RelatoriosAlunosTurma.gs`

## 3.1 Troque o objeto de configuração inteiro

```js
const CONFIG_RELATORIO_ALUNOS_TURMA_SIGA = {
  NOME_ESCOLA: 'Casa de Artes Gabriel Engel',
  NOME_PASTA: 'SIGA - Relatórios de Turmas',
  // LIMITE_RISCO saiu: o vermelho da coluna de frequência agora segue a
  // régua única (FrequenciaFaixas.gs).
  DIAS_PARA_LIMPEZA: 7
};
```

## 3.2 Dentro do `map` de `gerarPdfAlunosTurmaSIGA`, troque a linha do `baixa`

```js
        const baixa =
          frequenciaEmRiscoSIGA_(percentual);
```

## 3.3 Troque o trecho do rodapé

```js
    '<div class="rodape">Frequência abaixo de 70% ' +
    '(risco de evasão ou risco crítico) aparece em vermelho. ' +
    'Relatório gerado pelo SIGA em ' +
```

---

# 4. `Analises_.html`

## 4.1 Troque a função `vizStatusFrequencia_` inteira

```js
/*
 * As quatro faixas da régua única (FrequenciaFaixas.gs) nas quatro cores
 * de status que a tela já tem. A régua anterior era a que mais destoava:
 * pintava de "atenção" um aluno de 76%, que é adequado, e de "crítica"
 * um de 72%, que é risco de evasão.
 */
function vizStatusFrequencia_(pct) {
  if (pct === null || pct === undefined) {
    return { chave: null, cor: VIZ_COR.inkMudo, rotulo: 'Sem dado' };
  }
  if (pct >= 90) return { chave: 'bom', cor: VIZ_COR.status.bom, rotulo: 'Excelente' };
  if (pct >= 70) return { chave: 'atencao', cor: VIZ_COR.status.atencao, rotulo: 'Adequada' };
  if (pct >= 50) return { chave: 'grave', cor: VIZ_COR.status.grave, rotulo: 'Risco de evasão' };
  return { chave: 'critico', cor: VIZ_COR.status.critico, rotulo: 'Risco crítico' };
}
```

## 4.2 Em `desenharGraficoFrequenciaAnalisesSIGA`, troque a lista da legenda

```js
      [['bom', 'Excelente (≥90%)'], ['atencao', 'Adequada (70–89%)'],
       ['grave', 'Risco de evasão (50–69%)'], ['critico', 'Risco crítico (<50%)']]
```

## 4.3 Troque o subtítulo do cartão de frequência (na marcação)

```html
          <span class="subtitulo">Turmas coloridas pela régua do SIGA: excelente (≥90%), adequada (70–89%), risco de evasão (50–69%) ou risco crítico (&lt;50%).</span>
```

---

# O que muda nos números

**Nos relatórios de frequência:** a faixa de **70% a 74,9% deixa de contar como
"em risco"**. Os cartões "Alunos em risco" mostram números menores — não porque
alguém melhorou, mas porque o relatório parou de contradizer o próprio rótulo,
que já chamava essa faixa de "Frequência adequada".

**Na lista de risco de evasão**, com `SCORE_MEDIO` em 15:

| Aluno | Score | Risco |
| --- | --- | --- |
| 48%, 3 faltas seguidas, em atraso | 80 | Alto |
| 62%, sem faltas seguidas, em dia | 25 | Médio |
| 71%, 2 faltas seguidas, em dia | 15 | Médio |
| 88%, matrícula de 30 dias | 5 | Baixo |
| 92%, em dia | 0 | Baixo |

O corte foi de 30 para 15 porque a padronização criou um caso novo: um aluno de
62% somava 25 e caía em "baixo" enquanto a régua o chamava de "Risco de evasão"
— a mesma contradição entre número e rótulo, agora dentro do módulo de risco.
Com 15, um único sinal real já coloca o aluno na lista de observação.
