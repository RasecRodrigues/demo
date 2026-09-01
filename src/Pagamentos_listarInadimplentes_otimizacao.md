# Otimização: listarInadimplentesPagamentosSIGA

Arquivo: o `.gs` que contém `listarInadimplentesPagamentosSIGA` (aparece junto com
`montarBaseMensalidadesPagasSIGA_`, `criarIndiceIdentidadePagamentosSIGA_` etc. —
provavelmente `Pagamentos.gs`).

Medido nos logs de execução do Apps Script: 18-25s por chamada.

## Problema

Dentro do loop que varre a aba `TodosBoletos` (a maior aba do sistema), o código
monta o objeto completo do boleto (~20 campos, com parsing de datas e números)
**antes** de checar se o vencimento já passou:

```js
valores.slice(1).forEach(linha => {
  const boleto = montarBoletoPagamentosSIGA_(linha, mapa);
  const vencimento = dataPagamentosSIGA_(boleto.vencimentoOriginal || boleto.vencimento);
  if (!vencimento) {
    return;
  }
  if (vencimento >= hojeInadimplencia) {
    return;
  }
  const alunoDim = localizarAlunoDimInadimplente_(boleto.nomePagante || '', boleto.documento);
  // ... resto do processamento
```

Isso desperdiça o parsing completo (datas, valores, status, formatação) para
todo boleto ainda em aberto ou com vencimento futuro — que não interessam a
esta função (só cuidamos de boletos JÁ vencidos).

## Correção

Extrair só a data de vencimento primeiro (1 campo) e só montar o boleto
completo se ele já estiver vencido:

```js
valores.slice(1).forEach(linha => {
  const vencimento = dataPagamentosSIGA_(
    valorMapaPagamentosSIGA_(linha, mapa, ['Data do Vencimento'])
  );
  if (!vencimento || vencimento >= hojeInadimplencia) {
    return;
  }
  const boleto = montarBoletoPagamentosSIGA_(linha, mapa);
  const alunoDim = localizarAlunoDimInadimplente_(boleto.nomePagante || '', boleto.documento);
  // ... resto do processamento continua igual
```

O restante da função (tudo que vem depois de `localizarAlunoDimInadimplente_`)
não muda — só a ordem das duas primeiras linhas do `forEach` é alterada, e a
variável `vencimento` deixa de ser recalculada a partir de `boleto` (já foi
calculada antes).
