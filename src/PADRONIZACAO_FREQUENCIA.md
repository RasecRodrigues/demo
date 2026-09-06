# Padronização das faixas de frequência

Régua única, em `FrequenciaFaixas.gs`:

| Frequência | Rótulo | Em risco? |
| --- | --- | --- |
| abaixo de 50% | Risco crítico | sim |
| 50% a 69,9% | Risco de evasão | sim |
| 70% a 89,9% | Frequência adequada | não |
| 90% ou mais | Frequência excelente | não |

`LIMITE_RISCO` deixa de existir como número solto: "em risco" passa a ser
derivado das duas piores faixas (`frequenciaEmRiscoSIGA_`), então não há mais
um corte que possa divergir da régua.

Os valores de `classeTexto` e `classeEtiqueta` das faixas são exatamente os
nomes de classe que o `RelatorioFrequenciaTemplate.html` já usa
(`freq-critica`, `diagnostico-critico`, ...). **Nenhum CSS muda.**

---

## Já aplicado

**`AnalisesRisco.gs`** — as faixas saíram do módulo; ficou só quanto cada uma
pesa (`FREQUENCIA_PONTOS`). "Adequada" e "excelente" valem zero: um relatório
que chama 78% de adequada e ao mesmo tempo soma risco por causa dela se
contradiz.

---

## A aplicar (arquivos fora do repositório)

### 1. `RelatoriosFrequencia.gs`

Apague `LIMITE_RISCO` de `CONFIG_RELATORIO_FREQUENCIA` e troque o cálculo de
`emRisco`, em `prepararTurmaRelatorioFrequencia_`:

```js
// antes
const emRisco =
  ativo &&
  Number(aluno.totalAulas || 0) > 0 &&
  percentual < CONFIG_RELATORIO_FREQUENCIA.LIMITE_RISCO;

// depois
const emRisco =
  ativo &&
  Number(aluno.totalAulas || 0) > 0 &&
  frequenciaEmRiscoSIGA_(percentual);
```

No mesmo `map`, publique a faixa para o template não ter que recalculá-la:

```js
// antes
classificacao: classificarFrequenciaRelatorio_(percentual, aluno.totalAulas, ativo),
classe: classeFrequenciaRelatorio_(percentual),

// depois
classificacao: classificarFrequenciaRelatorio_(percentual, aluno.totalAulas, ativo),
classe: classeFrequenciaRelatorio_(percentual),
classeTexto: (obterFaixaFrequenciaSIGA_(percentual) || {}).classeTexto || '',
classeEtiqueta: (obterFaixaFrequenciaSIGA_(percentual) || {}).classeEtiqueta || '',
```

E as duas funções de classificação passam a delegar:

```js
function classificarFrequenciaRelatorio_(percentual, totalAulas, ativo) {
  if (!ativo) return 'Fora da análise de risco';
  if (Number(totalAulas || 0) <= 0) return 'Sem aulas válidas no período';
  return rotuloFrequenciaSIGA_(percentual);
}

function classeFrequenciaRelatorio_(percentual) {
  const faixa = obterFaixaFrequenciaSIGA_(percentual);
  if (!faixa) return 'baixa';
  if (faixa.chave === 'excelente') return 'alta';
  if (faixa.chave === 'adequado') return 'media';
  return 'baixa';
}
```

> `classeFrequenciaRelatorio_` já batia com a régua (alta ≥90, media ≥70).
> Delegar é para ela não sair do lugar se a régua mudar.

### 2. `RelatorioFrequenciaTemplate.html`

**Apague a função `dadosDiagnostico`.** Ela reimplementa, dentro do template,
a mesma escada que o `.gs` já calculou e mandou em `aluno.classificacao` —
duas cópias da mesma regra no caminho de um único PDF.

Nos dois lugares que a chamam (primeira página e continuação), troque:

```html
<!-- antes -->
<? alunosPrimeiraPagina.forEach(function(aluno) {
  var diag = dadosDiagnostico(aluno);
?>
  ...
  <td class="numero freq <?= diag.classeFrequencia ?>">
    <span class="icone-frequencia">●</span>
    <?= aluno.percentualTexto ?>
  </td>
  <td>
    <span class="diagnostico <?= diag.classeDiagnostico ?>">
      <?= diag.textoDiagnostico ?>
    </span>
  </td>

<!-- depois -->
<? alunosPrimeiraPagina.forEach(function(aluno) { ?>
  ...
  <td class="numero freq <?= aluno.classeTexto ?>">
    <span class="icone-frequencia">●</span>
    <?= aluno.percentualTexto ?>
  </td>
  <td>
    <span class="diagnostico <?= aluno.classeEtiqueta ?>">
      <?= aluno.classificacao ?>
    </span>
  </td>
```

E o parágrafo que descreve o critério passa a vir da régua, para não virar
texto desatualizado se ela mudar:

```html
<p class="observacao">
  <?= descreverFaixasFrequenciaSIGA_() ?>
  Alunos sem aulas válidas no período aparecem como
  “Sem aulas válidas no período”.
</p>
```

### 3. `RelatoriosAlunosTurma.gs`

Apague `LIMITE_RISCO` de `CONFIG_RELATORIO_ALUNOS_TURMA_SIGA` e troque o
vermelho da coluna de frequência:

```js
// antes
const baixa = percentual < CONFIG_RELATORIO_ALUNOS_TURMA_SIGA.LIMITE_RISCO;

// depois
const baixa = frequenciaEmRiscoSIGA_(percentual);
```

O rodapé do PDF cita o número na mão — troque também:

```js
// antes
'<div class="rodape">Frequência abaixo de ' +
CONFIG_RELATORIO_ALUNOS_TURMA_SIGA.LIMITE_RISCO +
'% aparece em vermelho. Relatório gerado pelo SIGA em ' +

// depois
'<div class="rodape">Frequência abaixo de 70% (risco de evasão ou crítico) ' +
'aparece em vermelho. Relatório gerado pelo SIGA em ' +
```

### 4. `Analises_.html` — `vizStatusFrequencia_`

Hoje usa uma régua própria de três faixas (≥85 boa, 75–85 atenção, <75
crítica), que é a que mais destoa: pinta de "atenção" um aluno de 76%, que
pela régua é adequado, e de "crítica" um de 72%, que é risco de evasão.

```js
// antes
function vizStatusFrequencia_(pct) {
  if (pct === null || pct === undefined) return { chave: null, cor: VIZ_COR.inkMudo, rotulo: 'Sem dado' };
  if (pct >= 85) return { chave: 'bom', cor: VIZ_COR.status.bom, rotulo: 'Boa' };
  if (pct >= 75) return { chave: 'atencao', cor: VIZ_COR.status.atencao, rotulo: 'Atenção' };
  return { chave: 'critico', cor: VIZ_COR.status.critico, rotulo: 'Crítica' };
}

// depois — as quatro faixas da régua, nas quatro cores de status que a
// tela já tem
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

A legenda do cartão de frequência (em `desenharGraficoFrequenciaAnalisesSIGA`)
lista as faixas na mão e precisa acompanhar:

```js
// antes
[['bom', 'Boa (≥85%)'], ['atencao', 'Atenção (75–85%)'], ['critico', 'Crítica (<75%)']]

// depois
[['bom', 'Excelente (≥90%)'], ['atencao', 'Adequada (70–89%)'],
 ['grave', 'Risco de evasão (50–69%)'], ['critico', 'Risco crítico (<50%)']]
```

E o subtítulo do cartão, no HTML:

```html
<!-- antes -->
<span class="subtitulo">Turmas coloridas pela situação: boa (≥85%), atenção (75–85%) ou crítica (&lt;75%).</span>

<!-- depois -->
<span class="subtitulo">Turmas coloridas pela situação: excelente (≥90%), adequada (70–89%), risco de evasão (50–69%) ou risco crítico (&lt;50%).</span>
```

---

## O que muda nos números

Com `LIMITE_RISCO` indo de 75 para 70, a faixa **70% a 74,9% deixa de contar
como "em risco"**. Os cartões "Alunos em risco" dos relatórios de frequência
passam a mostrar números menores — não porque algum aluno melhorou, mas porque
o relatório parou de contradizer o próprio rótulo, que já chamava essa faixa
de "Frequência adequada".

Na lista de risco de evasão, a mesma faixa deixa de somar pontos de
frequência. Um aluno com 71% e duas faltas seguidas sai de 30 (médio) para 15
(baixo). Se a intenção for continuar pegando esse caso, o ajuste é em
`ANALISES_RISCO_CONFIG` — subir os pontos de `FALTAS` ou baixar `SCORE_MEDIO`
—, não voltar a mexer na régua de frequência.
