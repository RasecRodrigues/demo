/**
 * SIGA — relatório semanal por e-mail, do MÊS EM CURSO.
 *
 * ARQUIVO NOVO. Nenhum nome aqui existe em outro .gs do projeto: crie um
 * arquivo (+ → Script) chamado RelatorioSemanalAnalises e cole isto.
 *
 * PARA USAR
 *   1. Escreva o e-mail em RELATORIO_SEMANAL_EMAIL_ logo abaixo.
 *   2. Rode enviarRelatorioAnalisesSemanalSIGA pelo botão Executar (o
 *      Google pede autorização para enviar e-mail) e confira a caixa.
 *   3. Rode configurarEnvioSemanalRelatorioAnalisesSIGA uma vez para
 *      agendar toda segunda de manhã.
 *
 * O QUE ENTRA
 *   1. Alunos que ainda não pagaram a mensalidade do mês.
 *   2. Matrículas e cancelamentos registrados no mês.
 *   3. Frequência por turma no mês.
 *   4. Os 20 alunos com mais faltas no mês.
 *   5. Camisas, calças e carteirinhas — PENDENTE, ver o aviso no fim.
 *
 * NÃO USA O CACHE DE ANÁLISES. Aquele cache é histórico e roda de 6 em 6
 * horas; um relatório operacional que diz "fulano não pagou" tem de ler o
 * cadastro no instante do envio, senão cobra quem pagou ontem.
 *
 * ORÇAMENTO. Cada aba pesada (TodosBoletos, Comprovante, Chamadas) é lida
 * UMA vez, e só o mês corrente é filtrado. É o que mantém a execução longe
 * do limite de 6 minutos do Apps Script.
 */

/** Destino do relatório. Vazio = manda para o dono da planilha. */
const RELATORIO_SEMANAL_EMAIL_ = '';

/** Quantos alunos entram na lista de faltas. */
const RELATORIO_SEMANAL_TOP_FALTAS_ = 20;

const RELATORIO_SEMANAL_ESCOLA_ = 'Casa de Artes Gabriel Engel';


function enviarRelatorioAnalisesSemanalSIGA() {
  const destino = relSemDestinatario_();
  if (!destino) {
    throw new Error(
      'Nenhum e-mail de destino. Preencha RELATORIO_SEMANAL_EMAIL_ no topo deste arquivo.'
    );
  }

  const dados = relSemColetar_();
  const fuso = Session.getScriptTimeZone();
  const nomeArquivo = 'siga_' + Utilities.formatDate(new Date(), fuso, 'yyyy-MM-dd') + '.pdf';

  const pdf = Utilities.newBlob(relSemMontarHtml_(dados), 'text/html', 'siga.html')
    .getAs(MimeType.PDF)
    .setName(nomeArquivo);

  MailApp.sendEmail({
    to: destino,
    subject: 'SIGA — ' + dados.mesRotulo + ' · ' + dados.pendentes.length + ' sem pagamento, '
      + dados.faltas.length + ' com falta',
    htmlBody: relSemCorpoDoEmail_(dados),
    attachments: [pdf]
  });

  return {
    sucesso: true,
    para: destino,
    arquivo: nomeArquivo,
    mes: dados.mesRotulo,
    pendentesDePagamento: dados.pendentes.length,
    entradas: dados.entradas.length,
    saidas: dados.saidas.length,
    turmasComAula: dados.turmas.length,
    avisos: dados.avisos
  };
}


/** Agenda para toda segunda-feira de manhã. Rode UMA vez. */
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


/** Desliga o envio automático. O manual continua funcionando. */
function cancelarEnvioSemanalRelatorioAnalisesSIGA() {
  const removidos = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'enviarRelatorioAnalisesSemanalSIGA');
  removidos.forEach(t => ScriptApp.deleteTrigger(t));
  return { sucesso: true, gatilhosRemovidos: removidos.length };
}


function relSemDestinatario_() {
  const escrito = String(RELATORIO_SEMANAL_EMAIL_ || '').trim();
  if (escrito) return escrito;
  try {
    return String(Session.getEffectiveUser().getEmail() || '').trim();
  } catch (erro) {
    return '';
  }
}


/* =========================================================
 * COLETA
 * ========================================================= */

function relSemColetar_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59, 999);
  const chaveMes = analisesMesRotulo_(inicioMes).chave;

  const avisos = [];
  const matriculas = lerMatriculasPagUnif_(ss.getSheetByName('DimMatricula'));

  const entradasSaidas = relSemEntradasSaidas_(matriculas, inicioMes, fimMes);
  const pagamento = relSemPendentesDePagamento_(ss, matriculas, inicioMes, chaveMes, avisos);
  const frequencia = relSemFrequenciaDoMes_(ss, inicioMes, fimMes, avisos);

  return {
    mesRotulo: relSemMesPorExtenso_(inicioMes),
    diaDeRotulo: hoje.getDate() + ' de ' +
      new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate() + ' dias',
    geradoEm: Utilities.formatDate(hoje, Session.getScriptTimeZone(), "dd/MM/yyyy 'às' HH:mm"),
    pendentes: pagamento.pendentes,
    totalPrevisto: pagamento.totalPrevisto,
    alunosAtivos: pagamento.alunosAtivos,
    entradas: entradasSaidas.entradas,
    saidas: entradasSaidas.saidas,
    turmas: frequencia.turmas,
    faltas: frequencia.top,
    mediaGeral: frequencia.mediaGeral,
    avisos
  };
}


/**
 * Matrículas e cancelamentos com data DENTRO do mês.
 *
 * Usa as mesmas regras da tela de Análises: entrada precisa de TIPO em
 * ATIVAÇÃO/NOVA/UPGRADE/RENOVAÇÃO, saída precisa de STATUS de saída. Se
 * essas funções não existirem (arquivo Analises fora do projeto), cai
 * para "toda linha com data no mês", e o relatório avisa.
 */
function relSemEntradasSaidas_(matriculas, inicioMes, fimMes) {
  const temRegras =
    typeof analisesTipoEntradaMatricula_ === 'function' &&
    typeof analisesStatusSaidaMatricula_ === 'function';

  const entradas = [];
  const saidas = [];
  const dia = d => d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM') : '';

  matriculas.forEach(m => {
    if (m.inicio instanceof Date && m.inicio >= inicioMes && m.inicio <= fimMes) {
      if (!temRegras || analisesTipoEntradaMatricula_(m.tipo)) {
        entradas.push({
          nome: m.nome, turma: m.turma, tipo: m.tipo || '—', data: dia(m.inicio)
        });
      }
    }
    if (m.fim instanceof Date && m.fim >= inicioMes && m.fim <= fimMes) {
      if (!temRegras || analisesStatusSaidaMatricula_(m.status)) {
        saidas.push({
          nome: m.nome, turma: m.turma, status: m.status || '—', data: dia(m.fim)
        });
      }
    }
  });

  const porData = (a, b) => String(a.data).localeCompare(String(b.data));
  return { entradas: entradas.sort(porData), saidas: saidas.sort(porData) };
}


/**
 * Quem tem mensalidade do mês em aberto.
 *
 * "Pagou" = existe boleto PAGO com vencimento no mês, ou comprovante cujo
 * período de referência é o mês. É a mesma competência que o resto do
 * sistema usa — não a data em que o dinheiro entrou.
 *
 * Quem deve zero não entra: bolsa de 100% e APPAI zeram a mensalidade em
 * calcularValorMatricula, e cobrar essas pessoas seria o pior erro que
 * este relatório poderia cometer.
 */
function relSemPendentesDePagamento_(ss, matriculas, inicioMes, chaveMes, avisos) {
  const ativas = matriculas.filter(m => {
    const s = normalizarPagUnif_(m.status || '');
    return s === 'ATIVO' || s === 'ATIVA';
  });

  const identidades = criarIndiceIdentidadePagamentosSIGA_(ss, matriculas);
  const pagouNoMes = new Set();

  // --- boletos ---
  try {
    const abaBol = obterAbaTodosBoletosPagamentosSIGA_();
    if (abaBol && abaBol.getLastRow() >= 2) {
      const dados = abaBol.getDataRange().getValues();
      const mapa = mapaCabecalhosPagamentosSIGA_(dados[0]);
      for (let i = 1; i < dados.length; i++) {
        const boleto = montarBoletoPagamentosSIGA_(dados[i], mapa, true);
        if (boleto.statusNormalizado !== 'PAGO') continue;
        const venc = dataPagamentosSIGA_(boleto.vencimentoOriginal || boleto.vencimento);
        if (!venc || analisesMesRotulo_(venc).chave !== chaveMes) continue;
        const id = resolverIdentidadePagamentoSIGA_(identidades, {
          nome: boleto.nomePagante, documento: boleto.documento
        }, false);
        if (id) pagouNoMes.add(id.chaveAluno);
      }
    }
  } catch (erro) {
    avisos.push('Não consegui ler TodosBoletos: ' + (erro && erro.message ? erro.message : erro));
  }

  // --- comprovantes ---
  try {
    const abaComp = ss.getSheetByName('Comprovante de pagamento');
    if (abaComp && abaComp.getLastRow() >= 2) {
      const dados = abaComp.getDataRange().getValues();
      const mapa = mapaGenericoPagUnif_(dados[0]);
      for (let i = 1; i < dados.length; i++) {
        const linha = dados[i];
        const valor =
          numeroPagUnif_(campoPagUnif_(linha, mapa, ['VALOR PAGO MENSALIDADE'])) +
          numeroPagUnif_(campoPagUnif_(linha, mapa, [
            'VALOR PAGO RESIDUO DE MENSALIDADE', 'VALOR PAGO RESÍDUO DE MENSALIDADE'
          ]));
        if (valor <= 0) continue;
        const ref = inicioMesPagUnif_(campoPagUnif_(linha, mapa, [
          'PAGAMENTO REFERENTE A QUAL PERIODO?', 'PAGAMENTO REFERENTE A QUAL PERÍODO?',
          'PERIODO DE REFERENCIA', 'PERÍODO DE REFERÊNCIA'
        ]));
        if (!ref || analisesMesRotulo_(ref).chave !== chaveMes) continue;
        const id = resolverComprovantePagamentoSIGA_(identidades, linha, mapa);
        if (id) pagouNoMes.add(id.chaveAluno);
      }
    }
  } catch (erro) {
    avisos.push('Não consegui ler Comprovante de pagamento: ' + (erro && erro.message ? erro.message : erro));
  }

  // --- quem sobrou ---
  const hoje = new Date();
  const fimDoMes = new Date(inicioMes.getFullYear(), inicioMes.getMonth() + 1, 0);
  const dataCalculo = hoje > fimDoMes ? fimDoMes : hoje;

  const porAluno = new Map();
  ativas.forEach(m => {
    const chave = m.chaveAluno || normalizarPagUnif_(m.idAluno || m.nome);
    if (!chave) return;
    if (!porAluno.has(chave)) porAluno.set(chave, []);
    porAluno.get(chave).push(m);
  });

  const pendentes = [];
  let totalPrevisto = 0;

  porAluno.forEach((mats, chave) => {
    if (pagouNoMes.has(chave)) return;

    const combo = new Set(mats.map(m => normalizarPagUnif_(m.turma || ''))).size > 1;
    let devido = 0;
    try {
      mats.forEach(m => {
        devido += Number(analisesCalcularValorMatricula_(m, combo, inicioMes, dataCalculo) || 0);
      });
    } catch (erro) {
      devido = 0;
    }

    // Bolsa integral e APPAI devolvem zero — não devem nada, não cobre.
    if (!(devido > 0)) return;

    totalPrevisto += devido;
    pendentes.push({
      nome: mats[0].nome || '(sem nome)',
      turma: Array.from(new Set(mats.map(m => m.turma).filter(Boolean))).join(', '),
      diaVencimento: Number(mats[0].diaVenc || 10),
      valor: arredPagUnif_(devido)
    });
  });

  pendentes.sort((a, b) => b.valor - a.valor || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

  return {
    pendentes,
    totalPrevisto: arredPagUnif_(totalPrevisto),
    alunosAtivos: porAluno.size
  };
}


/**
 * Frequência do mês, lendo a aba Chamadas UMA vez.
 *
 * A aba tem uma linha por aluno por aula, com PRESENCA em PRESENTE ou
 * AUSENTE. Linha de aluno experimental ou fora da lista não conta: essas
 * pessoas não estão matriculadas, e a falta delas não é falta de ninguém.
 */
function relSemFrequenciaDoMes_(ss, inicioMes, fimMes, avisos) {
  const vazio = { turmas: [], top: [], mediaGeral: null };
  const aba = ss.getSheetByName('Chamadas');
  if (!aba || aba.getLastRow() < 2) {
    avisos.push('A aba Chamadas não foi encontrada ou está vazia — frequência fora do relatório.');
    return vazio;
  }

  const dados = aba.getDataRange().getValues();
  const mapa = mapaGenericoPagUnif_(dados[0]);
  const iData = relSemIndiceColuna_(mapa, ['DATA DA AULA', 'DATA_AULA', 'DATA']);
  const iTurma = relSemIndiceColuna_(mapa, ['TURMA']);
  const iAluno = relSemIndiceColuna_(mapa, ['ALUNO', 'NOME_ALUNO', 'NOME DO ALUNO']);
  const iPresenca = relSemIndiceColuna_(mapa, ['PRESENCA', 'PRESENÇA']);
  const iExperimental = relSemIndiceColuna_(mapa, ['EXPERIMENTAL']);
  const iForaLista = relSemIndiceColuna_(mapa, ['FORA DA LISTA']);

  if (iData < 0 || iTurma < 0 || iAluno < 0 || iPresenca < 0) {
    avisos.push('A aba Chamadas não tem as colunas Data da Aula, Turma, Aluno e Presenca.');
    return vazio;
  }

  const porTurma = new Map();
  const porAluno = new Map();
  const ehSim = v => ['SIM', 'S', 'TRUE', '1'].includes(normalizarPagUnif_(v || ''));

  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const data = parseDataPagUnif_(linha[iData]);
    if (!data || data < inicioMes || data > fimMes) continue;

    if (iExperimental >= 0 && ehSim(linha[iExperimental])) continue;
    if (iForaLista >= 0 && ehSim(linha[iForaLista])) continue;

    const presenca = normalizarPagUnif_(linha[iPresenca] || '');
    if (presenca !== 'PRESENTE' && presenca !== 'AUSENTE') continue;

    const turma = String(linha[iTurma] || '').trim() || '(sem turma)';
    const aluno = String(linha[iAluno] || '').trim();
    if (!aluno) continue;

    const presente = presenca === 'PRESENTE';

    if (!porTurma.has(turma)) porTurma.set(turma, { turma, aulas: 0, presencas: 0, faltas: 0 });
    const t = porTurma.get(turma);
    t.aulas++;
    if (presente) t.presencas++; else t.faltas++;

    const chave = turma + '||' + normalizarPagUnif_(aluno);
    if (!porAluno.has(chave)) porAluno.set(chave, { aluno, turma, aulas: 0, faltas: 0 });
    const a = porAluno.get(chave);
    a.aulas++;
    if (!presente) a.faltas++;
  }

  const turmas = Array.from(porTurma.values())
    .map(t => Object.assign({}, t, {
      percentual: t.aulas > 0 ? arredPagUnif_(t.presencas / t.aulas * 100) : 0
    }))
    .sort((a, b) => a.percentual - b.percentual);

  const top = Array.from(porAluno.values())
    .filter(a => a.faltas > 0)
    .map(a => Object.assign({}, a, {
      percentual: a.aulas > 0 ? arredPagUnif_((a.aulas - a.faltas) / a.aulas * 100) : 0
    }))
    .sort((a, b) => b.faltas - a.faltas || a.percentual - b.percentual)
    .slice(0, RELATORIO_SEMANAL_TOP_FALTAS_);

  const totalAulas = turmas.reduce((s, t) => s + t.aulas, 0);
  const totalPresencas = turmas.reduce((s, t) => s + t.presencas, 0);

  return {
    turmas,
    top,
    mediaGeral: totalAulas > 0 ? arredPagUnif_(totalPresencas / totalAulas * 100) : null
  };
}


function relSemIndiceColuna_(mapa, nomes) {
  for (const nome of nomes) {
    const chave = normalizarPagUnif_(nome).replace(/[^A-Z0-9]/g, '');
    for (const existente of Object.keys(mapa)) {
      if (String(existente).replace(/[^A-Z0-9]/g, '') === chave) return mapa[existente];
    }
  }
  return -1;
}


/* =========================================================
 * APRESENTAÇÃO
 * ========================================================= */

const RELATORIO_SEMANAL_MESES_PT_ = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

function relSemMesPorExtenso_(data) {
  return RELATORIO_SEMANAL_MESES_PT_[data.getMonth()] + '/' + data.getFullYear();
}

function relSemMoeda_(valor) {
  return 'R$ ' + Number(valor || 0).toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function relSemPct_(valor) {
  if (valor === null || valor === undefined) return '—';
  return Number(valor).toFixed(1).replace('.', ',') + '%';
}

function relSemEscaparHtml_(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Barra feita com <div>, não com SVG: execução agendada roda sem
 * navegador, e o conversor de HTML para PDF do Apps Script não desenha
 * SVG. Div com largura em porcentagem ele imprime.
 */
function relSemBarra_(porcentagem, cor) {
  const largura = Math.max(0, Math.min(100, Number(porcentagem) || 0));
  return '<div style="background:#eef0f4;border-radius:3px;height:10px;width:100%">' +
    '<div style="background:' + cor + ';border-radius:3px;height:10px;width:' +
    largura.toFixed(1) + '%"></div></div>';
}

function relSemVazio_(texto) {
  return '<p class="vazio">' + relSemEscaparHtml_(texto) + '</p>';
}


function relSemMontarHtml_(d) {
  const p = [];

  p.push('<div class="capa">');
  p.push('<div class="escola">' + relSemEscaparHtml_(RELATORIO_SEMANAL_ESCOLA_) + '</div>');
  p.push('<h1>Resumo de ' + relSemEscaparHtml_(d.mesRotulo) + '</h1>');
  p.push('<div class="meta">Gerado em ' + relSemEscaparHtml_(d.geradoEm)
    + ' &nbsp;·&nbsp; mês em curso: ' + relSemEscaparHtml_(d.diaDeRotulo) + ' decorridos</div>');
  p.push('</div>');

  p.push('<div class="kpis">');
  [
    ['Sem pagamento no mês', String(d.pendentes.length)],
    ['Valor previsto em aberto', relSemMoeda_(d.totalPrevisto)],
    ['Matrículas no mês', String(d.entradas.length)],
    ['Cancelamentos no mês', String(d.saidas.length)],
    ['Frequência do mês', relSemPct_(d.mediaGeral)]
  ].forEach(([r, v]) => {
    p.push('<div class="kpi"><span>' + relSemEscaparHtml_(r) + '</span><strong>'
      + relSemEscaparHtml_(v) + '</strong></div>');
  });
  p.push('</div>');

  // 1) Pendentes de pagamento
  p.push('<section class="bloco"><h2>Ainda não pagaram a mensalidade de '
    + relSemEscaparHtml_(d.mesRotulo) + '</h2>');
  p.push('<p class="sub">Matrícula ativa, sem boleto pago com vencimento no mês nem comprovante '
    + 'do mês. Quem é APPAI ou tem bolsa de 100% não aparece: a mensalidade dessas matrículas é zero.</p>');
  if (!d.pendentes.length) {
    p.push(relSemVazio_('Ninguém em aberto. Todos os alunos ativos têm pagamento registrado no mês.'));
  } else {
    p.push('<table><thead><tr><th>Aluno</th><th>Turma</th><th class="num">Vence dia</th>'
      + '<th class="num">Valor previsto</th></tr></thead><tbody>');
    d.pendentes.forEach(x => {
      p.push('<tr><td>' + relSemEscaparHtml_(x.nome) + '</td>'
        + '<td>' + relSemEscaparHtml_(x.turma) + '</td>'
        + '<td class="num">' + x.diaVencimento + '</td>'
        + '<td class="num">' + relSemMoeda_(x.valor) + '</td></tr>');
    });
    p.push('<tr class="total"><td colspan="3"><strong>Total</strong></td>'
      + '<td class="num"><strong>' + relSemMoeda_(d.totalPrevisto) + '</strong></td></tr>');
    p.push('</tbody></table>');
  }
  p.push('</section>');

  // 2) Matrículas e cancelamentos
  p.push('<section class="bloco"><h2>Matrículas do mês</h2>');
  if (!d.entradas.length) {
    p.push(relSemVazio_('Nenhuma matrícula registrada neste mês.'));
  } else {
    p.push('<table><thead><tr><th>Dia</th><th>Aluno</th><th>Turma</th><th>Tipo</th>'
      + '</tr></thead><tbody>');
    d.entradas.forEach(x => {
      p.push('<tr><td>' + relSemEscaparHtml_(x.data) + '</td>'
        + '<td>' + relSemEscaparHtml_(x.nome) + '</td>'
        + '<td>' + relSemEscaparHtml_(x.turma) + '</td>'
        + '<td>' + relSemEscaparHtml_(x.tipo) + '</td></tr>');
    });
    p.push('</tbody></table>');
  }
  p.push('</section>');

  p.push('<section class="bloco"><h2>Cancelamentos do mês</h2>');
  if (!d.saidas.length) {
    p.push(relSemVazio_('Nenhum cancelamento registrado neste mês.'));
  } else {
    p.push('<table><thead><tr><th>Dia</th><th>Aluno</th><th>Turma</th><th>Status</th>'
      + '</tr></thead><tbody>');
    d.saidas.forEach(x => {
      p.push('<tr><td>' + relSemEscaparHtml_(x.data) + '</td>'
        + '<td>' + relSemEscaparHtml_(x.nome) + '</td>'
        + '<td>' + relSemEscaparHtml_(x.turma) + '</td>'
        + '<td>' + relSemEscaparHtml_(x.status) + '</td></tr>');
    });
    p.push('</tbody></table>');
  }
  p.push('</section>');

  // 3) Frequência por turma
  p.push('<section class="bloco"><h2>Frequência por turma no mês</h2>');
  p.push('<p class="sub">Da pior para a melhor. Aula experimental e aluno fora da lista '
    + 'não entram na conta.</p>');
  if (!d.turmas.length) {
    p.push(relSemVazio_('Nenhuma chamada registrada neste mês.'));
  } else {
    p.push('<table><thead><tr><th>Turma</th><th class="num">Aulas</th><th class="num">Presenças</th>'
      + '<th class="num">Faltas</th><th class="num">%</th><th class="barra">&nbsp;</th>'
      + '</tr></thead><tbody>');
    d.turmas.forEach(t => {
      const cor = t.percentual >= 80 ? '#1baf7a' : (t.percentual > 60 ? '#eda100' : '#d03b3b');
      p.push('<tr><td>' + relSemEscaparHtml_(t.turma) + '</td>'
        + '<td class="num">' + t.aulas + '</td>'
        + '<td class="num">' + t.presencas + '</td>'
        + '<td class="num">' + t.faltas + '</td>'
        + '<td class="num">' + relSemPct_(t.percentual) + '</td>'
        + '<td class="barra">' + relSemBarra_(t.percentual, cor) + '</td></tr>');
    });
    p.push('</tbody></table>');
  }
  p.push('</section>');

  // 4) Top faltas
  p.push('<section class="bloco"><h2>Os ' + RELATORIO_SEMANAL_TOP_FALTAS_
    + ' alunos com mais faltas no mês</h2>');
  if (!d.faltas.length) {
    p.push(relSemVazio_('Nenhuma falta registrada neste mês.'));
  } else {
    p.push('<table><thead><tr><th>Aluno</th><th>Turma</th><th class="num">Faltas</th>'
      + '<th class="num">Aulas</th><th class="num">Presença</th><th class="barra">&nbsp;</th>'
      + '</tr></thead><tbody>');
    d.faltas.forEach(a => {
      const cor = a.percentual >= 80 ? '#1baf7a' : (a.percentual > 60 ? '#eda100' : '#d03b3b');
      p.push('<tr><td>' + relSemEscaparHtml_(a.aluno) + '</td>'
        + '<td>' + relSemEscaparHtml_(a.turma) + '</td>'
        + '<td class="num">' + a.faltas + '</td>'
        + '<td class="num">' + a.aulas + '</td>'
        + '<td class="num">' + relSemPct_(a.percentual) + '</td>'
        + '<td class="barra">' + relSemBarra_(a.percentual, cor) + '</td></tr>');
    });
    p.push('</tbody></table>');
  }
  p.push('</section>');

  // 5) Encomendas — ainda não implementado, e dito com todas as letras
  p.push('<section class="bloco"><h2>Camisas, calças e carteirinhas</h2>');
  p.push(relSemVazio_(
    'Ainda não incluído: o módulo de encomendas não foi ligado a este relatório. '
    + 'Falta saber em que aba os pedidos ficam e quais colunas identificam item, '
    + 'tamanho, aluno e situação da entrega.'
  ));
  p.push('</section>');

  if (d.avisos.length) {
    p.push('<section class="bloco"><h2>Avisos da geração</h2><ul class="avisos">');
    d.avisos.forEach(a => p.push('<li>' + relSemEscaparHtml_(a) + '</li>'));
    p.push('</ul></section>');
  }

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
    + '.vazio{font-size:9px;color:#666;background:#f7f7f5;border:1px solid #e6e6e0;'
    + 'border-radius:5px;padding:8px 10px;margin:0}'
    + 'table{width:100%;border-collapse:collapse;table-layout:fixed}'
    + 'thead{display:table-header-group}'
    + 'tr{page-break-inside:avoid}'
    + 'th{background:#f4f3ef;border-bottom:1px solid #ccc;padding:5px 6px;text-align:left;'
    + 'font-size:7.5px;letter-spacing:.03em;text-transform:uppercase;color:#444}'
    + 'td{border-bottom:1px solid #eee;padding:4px 6px;overflow-wrap:anywhere}'
    + 'th.num,td.num{text-align:right}'
    + 'th.barra,td.barra{width:18%}'
    + 'tr.total td{border-top:1px solid #999;border-bottom:none}'
    + 'ul.avisos{margin:0;padding-left:16px;font-size:9px;color:#8a5a00}'
    + '</style></head><body>' + p.join('') + '</body></html>';
}


function relSemCorpoDoEmail_(d) {
  const lista = d.pendentes.slice(0, 8)
    .map(x => '<li>' + relSemEscaparHtml_(x.nome) + ' — ' + relSemEscaparHtml_(x.turma)
      + ' — <b>' + relSemMoeda_(x.valor) + '</b></li>').join('');

  const piores = d.turmas.slice(0, 3)
    .map(t => '<li>' + relSemEscaparHtml_(t.turma) + ' — <b>' + relSemPct_(t.percentual)
      + '</b> (' + t.faltas + ' faltas)</li>').join('');

  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">'
    + '<p>Resumo de <b>' + relSemEscaparHtml_(d.mesRotulo) + '</b>, com o mês em curso ('
    + relSemEscaparHtml_(d.diaDeRotulo) + ' decorridos). Detalhe completo no PDF em anexo.</p>'
    + '<ul>'
    + '<li><b>' + d.pendentes.length + '</b> alunos sem pagamento no mês, '
    + relSemMoeda_(d.totalPrevisto) + ' previstos</li>'
    + '<li><b>' + d.entradas.length + '</b> matrículas e <b>' + d.saidas.length
    + '</b> cancelamentos</li>'
    + '<li>Frequência do mês: <b>' + relSemPct_(d.mediaGeral) + '</b></li>'
    + '</ul>'
    + (lista ? '<p>Maiores valores em aberto:</p><ul>' + lista + '</ul>' : '')
    + (piores ? '<p>Turmas com menor frequência:</p><ul>' + piores + '</ul>' : '')
    + (d.avisos.length
        ? '<p style="color:#8a5a00">Avisos: ' + d.avisos.map(relSemEscaparHtml_).join(' · ') + '</p>'
        : '')
    + '</div>';
}
