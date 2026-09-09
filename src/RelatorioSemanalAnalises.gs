/**
 * SIGA — envio semanal do relatório de Análises por e-mail.
 *
 * ARQUIVO NOVO. Não substitui nada: nenhum nome aqui existe em outro .gs
 * do projeto. Crie um arquivo (+ → Script) chamado
 * RelatorioSemanalAnalises e cole isto dentro.
 *
 * PARA USAR
 *   1. Escreva o e-mail de destino em RELATORIO_SEMANAL_EMAIL_ logo abaixo.
 *   2. Rode enviarRelatorioAnalisesSemanalSIGA uma vez pelo botão Executar
 *      (o Google vai pedir autorização para enviar e-mail). Confira a caixa
 *      de entrada.
 *   3. Rode configurarEnvioSemanalRelatorioAnalisesSIGA uma vez para agendar.
 *      Toda segunda de manhã o relatório sai sozinho.
 *
 * POR QUE OS GRÁFICOS AQUI SÃO DIFERENTES DOS DA TELA
 * O PDF do botão "Exportar" recebe os gráficos como imagem: a tela desenha
 * o SVG, rasteriza num canvas e manda o PNG pronto. Um gatilho de tempo
 * roda sem navegador — não há canvas, não há SVG, não há como rasterizar.
 * Por isso as barras daqui são <div> com largura em porcentagem, que o
 * conversor de HTML para PDF do Apps Script imprime sem ajuda nenhuma.
 * São mais simples que as da tela, e são as mesmas contas.
 *
 * NÃO RECALCULA O CACHE de propósito. O recálculo pesado já roda de 6 em
 * 6 horas no gatilho próprio dele; encaixar outro aqui arriscaria estourar
 * o limite de 6 minutos justamente na execução que também gera PDF e envia
 * e-mail. Em vez de esconder isso, o cabeçalho do relatório diz de quando
 * são os dados.
 */

/** Destino do relatório. Vazio = manda para o dono da planilha. */
const RELATORIO_SEMANAL_EMAIL_ = '';

/** Quantos meses o relatório cobre. */
const RELATORIO_SEMANAL_MESES_ = 12;

const RELATORIO_SEMANAL_ESCOLA_ = 'Casa de Artes Gabriel Engel';


/**
 * Gera e envia o relatório. Sem argumentos: serve para o gatilho e para o
 * botão Executar.
 */
function enviarRelatorioAnalisesSemanalSIGA() {
  const destino = relSemDestinatario_();
  if (!destino) {
    throw new Error(
      'Nenhum e-mail de destino. Preencha RELATORIO_SEMANAL_EMAIL_ no topo deste arquivo.'
    );
  }

  const dados = relSemMontarDados_();

  if (!dados.temAlgumDado) {
    /*
     * Cache vazio significa que o recálculo nunca rodou. Mandar um PDF de
     * zeros pareceria queda real de matrículas — melhor avisar.
     */
    MailApp.sendEmail({
      to: destino,
      subject: 'SIGA — relatório de Análises indisponível',
      htmlBody:
        '<p>O relatório semanal não foi gerado: o cache de Análises está vazio.</p>' +
        '<p>Abra a tela de Análises ou rode <b>recalcularCacheAnalisesSIGA</b> no editor ' +
        'do Apps Script, e depois <b>configurarGatilhoCacheAnalisesSIGA</b> para o ' +
        'recálculo passar a rodar sozinho.</p>'
    });
    return { sucesso: true, enviado: false, motivo: 'cache vazio' };
  }

  const fuso = Session.getScriptTimeZone();
  const agora = new Date();
  const nomeArquivo =
    'analises_' + Utilities.formatDate(agora, fuso, 'yyyy-MM-dd') + '.pdf';

  const pdf = Utilities.newBlob(relSemMontarHtml_(dados), 'text/html', 'analises.html')
    .getAs(MimeType.PDF)
    .setName(nomeArquivo);

  MailApp.sendEmail({
    to: destino,
    subject: 'SIGA — Análises · ' + dados.periodoRotulo,
    htmlBody: relSemCorpoDoEmail_(dados),
    attachments: [pdf]
  });

  return {
    sucesso: true,
    enviado: true,
    para: destino,
    arquivo: nomeArquivo,
    dadosDe: dados.atualizadoEmRotulo
  };
}


/**
 * Agenda o envio para toda segunda-feira de manhã. Rode UMA vez.
 *
 * Apaga o gatilho anterior antes de criar o novo — rodar duas vezes não
 * faz o relatório chegar em dobro.
 */
function configurarEnvioSemanalRelatorioAnalisesSIGA() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'enviarRelatorioAnalisesSemanalSIGA')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('enviarRelatorioAnalisesSemanalSIGA')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();

  return { sucesso: true, quando: 'toda segunda-feira, entre 8h e 9h' };
}


/** Cancela o envio automático. O relatório manual continua funcionando. */
function cancelarEnvioSemanalRelatorioAnalisesSIGA() {
  const removidos = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'enviarRelatorioAnalisesSemanalSIGA');

  removidos.forEach(t => ScriptApp.deleteTrigger(t));
  return { sucesso: true, gatilhosRemovidos: removidos.length };
}


function relSemDestinatario_() {
  const escrito = String(RELATORIO_SEMANAL_EMAIL_ || '').trim();
  if (escrito) return escrito;

  // Sem endereço escrito, vai para quem é dono do script — é o mesmo
  // e-mail que autoriza o gatilho, então nunca fica sem destino.
  try {
    return String(Session.getEffectiveUser().getEmail() || '').trim();
  } catch (erro) {
    return '';
  }
}


/**
 * Lê as três abas de cache e devolve tudo já no formato de tabela.
 *
 * Usa os mesmos leitores da tela (analisesLerCache*), então os números do
 * e-mail são exatamente os que a tela mostraria no mesmo instante.
 */
function relSemMontarDados_() {
  const periodos = analisesGerarPeriodos_(RELATORIO_SEMANAL_MESES_);
  const chaves = periodos.map(p => analisesMesRotulo_(p).chave);
  const chavesSet = new Set(chaves);

  const geral = analisesLerCacheGeral_();
  const porTurmaMes = analisesLerCacheTurma_();
  const comparativo = analisesLerCacheComparativoTurmas_().filter(x => x.ativos > 0);

  const movimentacao = chaves.map(chave => {
    const linha = geral.get(chave);
    const novas = linha ? Number(linha.novas || 0) : 0;
    const canceladas = linha ? Number(linha.canceladas || 0) : 0;
    return {
      periodo: analisesChaveParaRotulo_(chave),
      novas,
      canceladas,
      saldo: novas - canceladas,
      receita: linha ? Number(linha.receita || 0) : 0
    };
  });

  // Receita e lucro por turma, só nos meses da janela.
  const acumulado = new Map();
  porTurmaMes.forEach(item => {
    if (!chavesSet.has(item.mes)) return;
    if (!acumulado.has(item.turma)) acumulado.set(item.turma, { receita: 0, custo: 0 });
    const acc = acumulado.get(item.turma);
    acc.receita += Number(item.receita || 0);
    acc.custo += Number(item.custoProfessor || 0);
  });

  const turmas = comparativo
    .map(item => {
      const acc = acumulado.get(item.turma) || { receita: 0, custo: 0 };
      return {
        turma: item.turma,
        ativos: Number(item.ativos || 0),
        saidas: Number(item.saidas || 0),
        total: Number(item.total || 0),
        taxaEvasao: Number(item.taxaEvasao || 0),
        frequenciaMedia: item.frequenciaMedia,
        receita: arredPagUnif_(acc.receita),
        lucro: arredPagUnif_(acc.receita - acc.custo)
      };
    })
    .sort((a, b) => b.ativos - a.ativos);

  const receitaTotal = movimentacao.reduce((s, m) => s + m.receita, 0);
  const atualizadoEm = PropertiesService.getScriptProperties()
    .getProperty('ANALISES_CACHE_ATUALIZADO_EM');

  return {
    movimentacao,
    turmas,
    periodoRotulo:
      (movimentacao.length ? movimentacao[0].periodo : '') +
      ' a ' +
      (movimentacao.length ? movimentacao[movimentacao.length - 1].periodo : ''),
    atualizadoEmRotulo: relSemDataLegivel_(atualizadoEm),
    receitaTotal: arredPagUnif_(receitaTotal),
    alunosAtivos: turmas.reduce((s, t) => s + t.ativos, 0),
    temAlgumDado: turmas.length > 0 || movimentacao.some(m => m.novas || m.canceladas || m.receita)
  };
}


function relSemDataLegivel_(iso) {
  if (!iso) return 'nunca recalculado';
  const data = new Date(iso);
  if (isNaN(data.getTime())) return String(iso);
  return Utilities.formatDate(data, Session.getScriptTimeZone(), "dd/MM/yyyy 'às' HH:mm");
}


function relSemMoeda_(valor) {
  return 'R$ ' + Number(valor || 0)
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}


function relSemEscaparHtml_(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


/**
 * Barra horizontal feita com <div>, não com SVG.
 *
 * É o que permite o gráfico existir sem navegador. `porcentagem` já vem
 * calculada em relação à maior barra do grupo — assim a mais alta ocupa a
 * largura toda e as outras ficam proporcionais a ela.
 */
function relSemBarra_(porcentagem, cor) {
  const largura = Math.max(0, Math.min(100, Number(porcentagem) || 0));
  return '<div style="background:#eef0f4;border-radius:3px;height:11px;width:100%">' +
    '<div style="background:' + cor + ';border-radius:3px;height:11px;width:' +
    largura.toFixed(1) + '%"></div></div>';
}


function relSemMontarHtml_(dados) {
  const fuso = Session.getScriptTimeZone();
  const geradoEm = Utilities.formatDate(new Date(), fuso, "dd/MM/yyyy 'às' HH:mm");
  const p = [];

  p.push('<div class="capa">');
  p.push('<div class="escola">' + relSemEscaparHtml_(RELATORIO_SEMANAL_ESCOLA_) + '</div>');
  p.push('<h1>Análises</h1>');
  p.push('<div class="meta">Período: <strong>' + relSemEscaparHtml_(dados.periodoRotulo) + '</strong>'
    + ' &nbsp;·&nbsp; Gerado em ' + relSemEscaparHtml_(geradoEm)
    + ' &nbsp;·&nbsp; Dados de ' + relSemEscaparHtml_(dados.atualizadoEmRotulo) + '</div>');
  p.push('</div>');

  p.push('<div class="kpis">');
  [
    ['Alunos ativos', String(dados.alunosAtivos)],
    ['Turmas ativas', String(dados.turmas.length)],
    ['Receita no período', relSemMoeda_(dados.receitaTotal)]
  ].forEach(([rotulo, valor]) => {
    p.push('<div class="kpi"><span>' + relSemEscaparHtml_(rotulo) + '</span><strong>'
      + relSemEscaparHtml_(valor) + '</strong></div>');
  });
  p.push('</div>');

  // --- Matrículas vs. cancelamentos, com barra de saldo ---
  const maiorMov = Math.max(1, ...dados.movimentacao.map(m => Math.max(m.novas, m.canceladas)));
  p.push('<section class="bloco"><h2>Matrículas vs. cancelamentos</h2>');
  p.push('<p class="sub">Entradas: ATIVAÇÃO, NOVA, UPGRADE e RENOVAÇÃO. '
    + 'Saídas: toda matrícula com data de cancelamento/finalização no mês.</p>');
  p.push('<table><thead><tr><th>Mês</th><th class="num">Entradas</th><th class="barra">&nbsp;</th>'
    + '<th class="num">Saídas</th><th class="barra">&nbsp;</th><th class="num">Saldo</th></tr></thead><tbody>');
  dados.movimentacao.forEach(m => {
    p.push('<tr><td>' + relSemEscaparHtml_(m.periodo) + '</td>'
      + '<td class="num">' + m.novas + '</td>'
      + '<td class="barra">' + relSemBarra_(m.novas / maiorMov * 100, '#2a78d6') + '</td>'
      + '<td class="num">' + m.canceladas + '</td>'
      + '<td class="barra">' + relSemBarra_(m.canceladas / maiorMov * 100, '#eb6834') + '</td>'
      + '<td class="num' + (m.saldo < 0 ? ' neg' : '') + '">'
      + (m.saldo > 0 ? '+' : '') + m.saldo + '</td></tr>');
  });
  p.push('</tbody></table></section>');

  // --- Receita por mês ---
  const maiorReceita = Math.max(1, ...dados.movimentacao.map(m => m.receita));
  p.push('<section class="bloco"><h2>Receita recebida por mês</h2>');
  p.push('<table><thead><tr><th>Mês</th><th class="num">Receita</th>'
    + '<th class="barra">&nbsp;</th></tr></thead><tbody>');
  dados.movimentacao.forEach(m => {
    p.push('<tr><td>' + relSemEscaparHtml_(m.periodo) + '</td>'
      + '<td class="num">' + relSemMoeda_(m.receita) + '</td>'
      + '<td class="barra">' + relSemBarra_(m.receita / maiorReceita * 100, '#1baf7a') + '</td></tr>');
  });
  p.push('</tbody></table></section>');

  // --- Comparação entre turmas ---
  const maiorAtivos = Math.max(1, ...dados.turmas.map(t => t.ativos));
  p.push('<section class="bloco"><h2>Comparação entre turmas</h2>');
  p.push('<table><thead><tr><th>Turma</th><th class="num">Ativos</th><th class="barra">&nbsp;</th>'
    + '<th class="num">Saídas</th><th class="num">Evasão</th><th class="num">Frequência</th>'
    + '<th class="num">Receita</th><th class="num">Lucro</th></tr></thead><tbody>');
  dados.turmas.forEach(t => {
    const freq = (t.frequenciaMedia === null || t.frequenciaMedia === undefined)
      ? '—'
      : Number(t.frequenciaMedia).toFixed(1).replace('.', ',') + '%';
    p.push('<tr><td>' + relSemEscaparHtml_(t.turma) + '</td>'
      + '<td class="num">' + t.ativos + '</td>'
      + '<td class="barra">' + relSemBarra_(t.ativos / maiorAtivos * 100, '#2a78d6') + '</td>'
      + '<td class="num">' + t.saidas + '</td>'
      + '<td class="num">' + Number(t.taxaEvasao || 0).toFixed(1).replace('.', ',') + '%</td>'
      + '<td class="num">' + freq + '</td>'
      + '<td class="num">' + relSemMoeda_(t.receita) + '</td>'
      + '<td class="num' + (t.lucro < 0 ? ' neg' : '') + '">' + relSemMoeda_(t.lucro) + '</td></tr>');
  });
  p.push('</tbody></table></section>');

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
    + '@page{size:A4 landscape;margin:12mm 10mm}'
    + 'body{font-family:Helvetica,Arial,sans-serif;color:#111;font-size:9px;margin:0}'
    + '.capa{border-bottom:2px solid #6B007B;padding-bottom:8px;margin-bottom:12px}'
    + '.escola{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#6B007B;font-weight:bold}'
    + 'h1{font-size:20px;margin:4px 0 3px}'
    + '.meta{font-size:9px;color:#555}'
    + '.kpis{display:table;width:100%;table-layout:fixed;margin-bottom:14px;border-spacing:6px 0}'
    + '.kpi{display:table-cell;border:1px solid #ddd;border-radius:5px;padding:7px 9px}'
    + '.kpi span{display:block;font-size:7.5px;letter-spacing:.05em;text-transform:uppercase;color:#666}'
    + '.kpi strong{display:block;font-size:14px;margin-top:2px}'
    + '.bloco{margin-bottom:16px}'
    + 'h2{font-size:12px;margin:0 0 2px;color:#6B007B}'
    + '.sub{font-size:8px;color:#666;margin:0 0 6px}'
    + 'table{width:100%;border-collapse:collapse;table-layout:fixed}'
    + 'thead{display:table-header-group}'
    + 'tr{page-break-inside:avoid}'
    + 'th{background:#f4f3ef;border-bottom:1px solid #ccc;padding:5px 6px;text-align:left;'
    + 'font-size:7.5px;letter-spacing:.03em;text-transform:uppercase;color:#444}'
    + 'td{border-bottom:1px solid #eee;padding:4px 6px;overflow-wrap:anywhere}'
    + 'th.num,td.num{text-align:right}'
    + 'th.barra,td.barra{width:22%}'
    + 'td.neg{color:#b0201d}'
    + '</style></head><body>' + p.join('') + '</body></html>';
}


function relSemCorpoDoEmail_(dados) {
  const primeiras = dados.turmas.slice(0, 5)
    .map(t => '<li>' + relSemEscaparHtml_(t.turma) + ' — <b>' + t.ativos + '</b> ativos, '
      + 'evasão ' + Number(t.taxaEvasao || 0).toFixed(1).replace('.', ',') + '%</li>')
    .join('');

  const ultimoMes = dados.movimentacao[dados.movimentacao.length - 1];

  return ''
    + '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">'
    + '<p>Relatório de Análises do SIGA em anexo, cobrindo <b>'
    + relSemEscaparHtml_(dados.periodoRotulo) + '</b>.</p>'
    + '<ul>'
    + '<li><b>' + dados.alunosAtivos + '</b> alunos ativos em <b>' + dados.turmas.length + '</b> turmas</li>'
    + '<li>Receita no período: <b>' + relSemMoeda_(dados.receitaTotal) + '</b></li>'
    + (ultimoMes
        ? '<li>' + relSemEscaparHtml_(ultimoMes.periodo) + ': ' + ultimoMes.novas
          + ' entradas e ' + ultimoMes.canceladas + ' saídas</li>'
        : '')
    + '</ul>'
    + (primeiras ? '<p>Maiores turmas:</p><ul>' + primeiras + '</ul>' : '')
    + '<p style="color:#666;font-size:12px">Dados de ' + relSemEscaparHtml_(dados.atualizadoEmRotulo)
    + '. O mês em curso ainda está incompleto — as saídas se espalham pelo mês inteiro, '
    + 'então o saldo dele tende a melhorar até o fechamento.</p>'
    + '</div>';
}
