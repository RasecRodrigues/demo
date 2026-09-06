# Conectar o Power BI ao SIGA

O SIGA publica os próprios dados em JSON pelo Web App que já existe
(`Code.gs` → `doGet`, rota `pagina=powerbi`, implementada em `PowerBI.gs`).
O Power BI lê esse endereço pelo conector **Web** — não precisa
compartilhar a planilha com ninguém nem exportar arquivo na mão.

## 1. Publicar o Web App

No editor do Apps Script: **Implantar → Nova implantação → App da Web**.

| Campo | Valor |
| --- | --- |
| Executar como | **Eu** (o dono da planilha) |
| Quem pode acessar | **Qualquer pessoa** |

"Qualquer pessoa" é obrigatório: o Power BI não faz login no Google ao
atualizar. Quem controla o acesso é o token da URL — é o mesmo desenho
já usado nos portais do professor e do aluno.

Copie a URL `/exec` gerada. **Toda vez que republicar, use "Gerenciar
implantações → editar a implantação existente"**; criar uma implantação
nova gera outra URL e o relatório para de atualizar.

## 2. Conferir no navegador

```
https://script.google.com/macros/s/SEU_ID/exec?pagina=powerbi&token=POWERBI-GE-2026
```

Deve voltar o catálogo com a lista de datasets. Se voltar
`{"erro":"Token inválido."}`, o token não bate com `TOKEN_POWERBI`
(`PowerBI.gs`).

> Troque `POWERBI-GE-2026` por um token próprio antes de usar pra valer:
> quem tem a URL tem os dados. O token fica em `TOKEN_POWERBI`, no topo
> de `PowerBI.gs`.

## 3. Trazer uma tabela pro Power BI

**Página Inicial → Obter dados → Web**, e cole a URL do dataset:

```
https://script.google.com/macros/s/SEU_ID/exec?pagina=powerbi&token=SEU_TOKEN&dataset=fatoTurmaMes
```

No Power Query:

1. o conteúdo chega como um registro — clique no campo **linhas** (`List`);
2. **Converter em tabela**;
3. no cabeçalho da coluna, **expanda** os campos.

Repita pra cada dataset. Autenticação: **Anônimo**.

### Parametrizar a URL (recomendado)

Crie dois parâmetros no Power Query (`UrlBase` e `Token`) e uma função
que monta a chamada — assim, trocar de implantação ou de token não exige
mexer em cada consulta:

```m
(dataset as text) as record =>
    Json.Document(
        Web.Contents(
            UrlBase,
            [Query = [pagina = "powerbi", token = Token, dataset = dataset]]
        )
    )
```

Usar `Query` em vez de concatenar a URL na mão é o que mantém a
atualização programada funcionando no Power BI Service (ele exige que a
URL base seja fixa).

## 4. Datasets disponíveis

Vêm direto das abas de cadastro:

| Dataset | Aba | Conteúdo |
| --- | --- | --- |
| `dimAluno` | `DimAluno` | Cadastro de alunos |
| `dimTurma` | `DimTurma` | Cadastro de turmas |
| `dimMatricula` | `DimMatricula` | Matrículas, status, datas e valores |
| `fatoComprovantePagamento` | `Comprovante de pagamento` | Comprovantes lançados pela secretaria |
| `fatoPagamentoProfessor` | `Pagamentos Professores` | Custo de professor por aula |
| `fatoBoleto` | `TodosBoletos` | Boletos emitidos — aba grande, ver paginação |

Vêm do cache de Análises (`AnalisesCache_*`), já com os números
consolidados **exatamente como a tela de Análises mostra** — é o caminho
mais curto pra um relatório financeiro:

| Dataset | Grão | Colunas úteis |
| --- | --- | --- |
| `fatoResumoMensal` | mês | `Ativos`, `Novas`, `Cancelamentos`, `Receita`, `Saldo` |
| `fatoTurmaMes` | turma × mês | `Receita`, `CustoProfessor`, `Lucro` |
| `dimTurmaIndicadores` | turma | `Ativos`, `Saidas`, `TaxaEvasao`, `FrequenciaMedia` |
| `fatoPagamentoAluno` | aluno × mês × turma | `Valor`, `ChaveAluno`, `Mes` |

Esses quatro trazem também `atualizadoEm` (quando o cache rodou pela
última vez) e uma coluna `PrimeiroDiaMes` (`2026-08-01`) pronta pra
relacionar com uma tabela de calendário.

O cache é recalculado por gatilho de tempo
(`configurarGatilhoCacheAnalisesSIGA`, em `Analises.gs`) — agende a
atualização do Power BI **depois** dele, senão o relatório mostra os
números da rodada anterior.

## 5. Paginação

Abas grandes podem estourar o tempo de execução do Apps Script (~6 min).
Use `limite` e `offset`:

```
...&dataset=fatoBoleto&limite=5000&offset=0
...&dataset=fatoBoleto&limite=5000&offset=5000
```

A resposta traz `total` (linhas do dataset inteiro) e `temMais` (`true`
enquanto houver página seguinte) — dá pra montar um `List.Generate` no
Power Query que para sozinho quando `temMais` fica `false`.

## 6. Modelagem sugerida

- `dimAluno[ID_ALUNO]` 1→N `dimMatricula[ID_ALUNO]`
- `dimTurma[TURMA]` 1→N `dimMatricula[TURMA]` e 1→N `fatoTurmaMes[Turma]`
- tabela de calendário 1→N `fatoTurmaMes[PrimeiroDiaMes]` e
  `fatoResumoMensal[PrimeiroDiaMes]`

Datas saem sempre como texto ISO (`yyyy-MM-dd`) e valores como número —
sem isso o Power BI interpretaria `01/02/2026` conforme a localidade do
arquivo `.pbix` e trocaria dia por mês sem avisar. No Power Query, marque
as colunas ISO como **Data**.

## 7. Publicar uma coluna nova

Datasets vindos de cadastro publicam todas as colunas da aba. Os do
cache de Análises publicam só o que está declarado em
`POWERBI_DATASETS` (`PowerBI.gs`) — é o filtro que evita um dado novo
vazar sem ninguém decidir. Pra incluir uma coluna nova, acrescente-a na
lista `colunas` do dataset e republique a implantação.
