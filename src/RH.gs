const RH_CONFIG = {
  COLAB: 'RH_COLABORADORES', DOCS: 'RH_DOCUMENTOS', FOLHAS: 'RH_FOLHAS_PONTO',
  PASTA: 'SIGA - RH',
  TIPOS: ['RG','CPF','CNH','Carteira de Trabalho','Contrato','Admissão','Demissão','ASO','Comprovante de Residência','Diploma','Certificado','Advertência','eSocial','Férias','Folha de Pagamento','Vale Transporte','Outro'],
  STATUS: ['ATIVO','AFASTADO','DESLIGADO']
};

function configurarModuloRH() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('O projeto precisa estar vinculado à planilha do SIGA.');
  prepararAbaRH_(ss, RH_CONFIG.COLAB, ['ID_COLABORADOR','NOME','CARGO','TELEFONE','EMAIL','DATA_ADMISSAO','STATUS','DATA_CADASTRO','USUARIO']);
  prepararAbaRH_(ss, RH_CONFIG.DOCS, ['ID_DOCUMENTO','ID_COLABORADOR','NOME_COLABORADOR','TIPO_DOCUMENTO','DATA_DOCUMENTO','VALIDADE','OBSERVACAO','DATA_UPLOAD','ID_ARQUIVO_DRIVE','NOME_ARQUIVO','TIPO_ARQUIVO','URL_VISUALIZACAO','URL_DOWNLOAD','USUARIO']);
  prepararAbaRH_(ss, RH_CONFIG.FOLHAS, ['ID_FOLHA','ID_COLABORADOR','NOME_COLABORADOR','COMPETENCIA','OBSERVACAO','DATA_UPLOAD','ID_ARQUIVO_DRIVE','NOME_ARQUIVO','TIPO_ARQUIVO','URL_VISUALIZACAO','URL_DOWNLOAD','USUARIO']);
  obterPastasRH_();
  return {sucesso:true,mensagem:'Módulo RH configurado com sucesso.'};
}

function obterConfiguracoesRH() {
  configurarModuloRH();
  return {tiposDocumento:RH_CONFIG.TIPOS,statusColaborador:RH_CONFIG.STATUS};
}

function salvarColaboradorRH(d) {
  if (!d || !textoRH_(d.nome)) throw new Error('Informe o nome do colaborador.');
  if (!textoRH_(d.cargo)) throw new Error('Informe o cargo.');
  if (!textoRH_(d.status)) throw new Error('Informe o status.');
  const id = gerarIdRH_('SEQ_RH_COLAB','COL-');
  const aba = obterAbaRH_(RH_CONFIG.COLAB);
  aba.appendRow([id,textoRH_(d.nome),textoRH_(d.cargo),textoRH_(d.telefone),textoRH_(d.email),d.dataAdmissao?dataHtmlRH_(d.dataAdmissao):'',textoRH_(d.status),new Date(),usuarioRH_()]);
  const l=aba.getLastRow(); if(d.dataAdmissao) aba.getRange(l,6).setNumberFormat('dd/MM/yyyy'); aba.getRange(l,8).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  return {sucesso:true,mensagem:'Colaborador salvo com sucesso.',idColaborador:id};
}

function listarColaboradoresRH(f={}) {
  const aba=obterAbaRH_(RH_CONFIG.COLAB), n=aba.getLastRow(); if(n<2) return [];
  const termo=normRH_(f.termo), status=normRH_(f.status);
  return aba.getRange(2,1,n-1,9).getValues().map(r=>({idColaborador:String(r[0]||''),nome:String(r[1]||''),cargo:String(r[2]||''),telefone:String(r[3]||''),email:String(r[4]||''),dataAdmissao:dataFmtRH_(r[5]),status:String(r[6]||''),dataCadastro:dataHoraFmtRH_(r[7]),usuario:String(r[8]||'')}))
    .filter(x=>(!status||normRH_(x.status)===status)&&(!termo||normRH_([x.idColaborador,x.nome,x.cargo,x.telefone,x.email].join(' ')).includes(termo)))
    .sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
}

function salvarDocumentoRH(d) {
  validarArquivoRH_(d,'tipoDocumento');
  const c=colaboradorRH_(d.idColaborador), id=gerarIdRH_('SEQ_RH_DOC','DOC-'), arq=salvarArquivoRH_(d.arquivo,'Documentos',id), aba=obterAbaRH_(RH_CONFIG.DOCS);
  aba.appendRow([id,c.idColaborador,c.nome,textoRH_(d.tipoDocumento),d.dataDocumento?dataHtmlRH_(d.dataDocumento):'',d.validade?dataHtmlRH_(d.validade):'',textoRH_(d.observacao),new Date(),arq.id,arq.nome,arq.tipo,arq.urlVisualizacao,arq.urlDownload,usuarioRH_()]);
  const l=aba.getLastRow(); if(d.dataDocumento) aba.getRange(l,5).setNumberFormat('dd/MM/yyyy'); if(d.validade) aba.getRange(l,6).setNumberFormat('dd/MM/yyyy'); aba.getRange(l,8).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  return {sucesso:true,mensagem:'Documento salvo com sucesso.',idDocumento:id};
}

function listarDocumentosRH(f={}) {
  const aba=obterAbaRH_(RH_CONFIG.DOCS), n=aba.getLastRow(); if(n<2) return [];
  return aba.getRange(2,1,n-1,14).getValues().map(r=>({idDocumento:String(r[0]||''),idColaborador:String(r[1]||''),nomeColaborador:String(r[2]||''),tipoDocumento:String(r[3]||''),dataDocumento:dataFmtRH_(r[4]),validade:dataFmtRH_(r[5]),observacao:String(r[6]||''),dataUpload:dataHoraFmtRH_(r[7]),idArquivo:String(r[8]||''),nomeArquivo:String(r[9]||''),tipoArquivo:String(r[10]||''),urlVisualizacao:String(r[11]||''),urlDownload:String(r[12]||''),usuario:String(r[13]||'')}))
    .filter(x=>filtrarArquivoRH_(x,f,'documento'));
}

function excluirDocumentoRH(id) { return excluirArquivoRH_(RH_CONFIG.DOCS,id,9,'Documento'); }

function salvarFolhaPontoRH(d) {
  validarArquivoRH_(d,'competencia');
  const c=colaboradorRH_(d.idColaborador); verificarDuplicadaRH_(c.idColaborador,d.competencia);
  const id=gerarIdRH_('SEQ_RH_FOLHA','FOL-'), arq=salvarArquivoRH_(d.arquivo,'Folhas de Ponto',id), aba=obterAbaRH_(RH_CONFIG.FOLHAS);
  aba.appendRow([id,c.idColaborador,c.nome,textoRH_(d.competencia),textoRH_(d.observacao),new Date(),arq.id,arq.nome,arq.tipo,arq.urlVisualizacao,arq.urlDownload,usuarioRH_()]);
  aba.getRange(aba.getLastRow(),6).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  return {sucesso:true,mensagem:'Folha de ponto salva com sucesso.',idFolha:id};
}

function listarFolhasPontoRH(f={}) {
  const aba=obterAbaRH_(RH_CONFIG.FOLHAS), n=aba.getLastRow(); if(n<2) return [];
  return aba.getRange(2,1,n-1,12).getValues().map(r=>({idFolha:String(r[0]||''),idColaborador:String(r[1]||''),nomeColaborador:String(r[2]||''),competencia:String(r[3]||''),observacao:String(r[4]||''),dataUpload:dataHoraFmtRH_(r[5]),idArquivo:String(r[6]||''),nomeArquivo:String(r[7]||''),tipoArquivo:String(r[8]||''),urlVisualizacao:String(r[9]||''),urlDownload:String(r[10]||''),usuario:String(r[11]||'')}))
    .filter(x=>filtrarArquivoRH_(x,f,'folha'));
}

function excluirFolhaPontoRH(id) { return excluirArquivoRH_(RH_CONFIG.FOLHAS,id,7,'Folha de ponto'); }

/* ==========================================================================
   EDIÇÃO DE DOCUMENTOS
   ========================================================================== */

/** Retorna um único documento pelo ID, para preencher o formulário de edição. */
function obterDocumentoRH(idDocumento) {
  const id = textoRH_(idDocumento);
  if (!id) throw new Error('Documento não informado.');
  const documento = listarDocumentosRH({}).filter(x => String(x.idDocumento) === id)[0];
  if (!documento) throw new Error('Documento não encontrado.');
  return documento;
}

/** Lista enxuta para preencher os campos do formulário de edição. */
function obterOpcoesEdicaoDocumentoRH() {
  return {
    tiposDocumento: RH_CONFIG.TIPOS,
    colaboradores: listarColaboradoresRH({}).map(c => ({idColaborador:c.idColaborador, nome:c.nome}))
  };
}

/**
 * Atualiza um documento já enviado.
 * d = {idDocumento, idColaborador, tipoDocumento, dataDocumento, validade, observacao, arquivo?}
 * "arquivo" é opcional: quando vier preenchido, o novo arquivo substitui o
 * anterior e o antigo vai para a lixeira do Drive.
 */
function atualizarDocumentoRH(d) {
  if (!d || !textoRH_(d.idDocumento)) throw new Error('Documento não informado.');
  if (!textoRH_(d.idColaborador)) throw new Error('Selecione um colaborador.');
  if (!textoRH_(d.tipoDocumento)) throw new Error('Informe o tipo do documento.');

  const idDocumento = textoRH_(d.idDocumento);
  const trocarArquivo = Boolean(d.arquivo && d.arquivo.base64);
  if (trocarArquivo && String(d.arquivo.base64).length * 0.75 > 15 * 1024 * 1024) {
    throw new Error('O arquivo deve possuir no máximo 15 MB.');
  }

  const colaborador = colaboradorRH_(d.idColaborador);

  const trava = LockService.getScriptLock();
  try {
    trava.waitLock(30000);
  } catch (e) {
    throw new Error('O sistema está ocupado neste momento. Tente novamente em alguns segundos.');
  }

  try {
    const aba = obterAbaRH_(RH_CONFIG.DOCS);
    garantirColunasEdicaoDocumentoRH_(aba);

    const total = aba.getLastRow();
    if (total < 2) throw new Error('Documento não encontrado.');

    const ids = aba.getRange(2, 1, total - 1, 1).getDisplayValues();
    let linha = 0;
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === idDocumento) { linha = i + 2; break; }
    }
    if (!linha) throw new Error('Documento não encontrado.');

    aba.getRange(linha, 2, 1, 6).setValues([[
      colaborador.idColaborador,
      colaborador.nome,
      textoRH_(d.tipoDocumento),
      d.dataDocumento ? dataHtmlRH_(d.dataDocumento) : '',
      d.validade ? dataHtmlRH_(d.validade) : '',
      textoRH_(d.observacao)
    ]]);
    aba.getRange(linha, 5).setNumberFormat('dd/MM/yyyy');
    aba.getRange(linha, 6).setNumberFormat('dd/MM/yyyy');

    if (trocarArquivo) {
      const idArquivoAntigo = aba.getRange(linha, 9).getDisplayValue();
      const novo = salvarArquivoRH_(d.arquivo, 'Documentos', idDocumento);
      aba.getRange(linha, 9, 1, 5).setValues([[novo.id, novo.nome, novo.tipo, novo.urlVisualizacao, novo.urlDownload]]);
      if (idArquivoAntigo && idArquivoAntigo !== novo.id) {
        try { DriveApp.getFileById(idArquivoAntigo).setTrashed(true); } catch (e) {}
      }
    }

    aba.getRange(linha, 15, 1, 2).setValues([[new Date(), usuarioRH_()]]);
    aba.getRange(linha, 15).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    SpreadsheetApp.flush();
  } finally {
    try { trava.releaseLock(); } catch (e) {}
  }

  return {
    sucesso: true,
    mensagem: trocarArquivo ? 'Documento atualizado e arquivo substituído com sucesso.' : 'Documento atualizado com sucesso.',
    idDocumento: idDocumento
  };
}

/**
 * Cria os cabeçalhos de auditoria (colunas O e P) se ainda não existirem.
 * São colunas extras: listarDocumentosRH continua lendo apenas 14 colunas,
 * então nada do que já funciona é afetado.
 */
function garantirColunasEdicaoDocumentoRH_(aba) {
  if (aba.getMaxColumns() < 16) aba.insertColumnsAfter(aba.getMaxColumns(), 16 - aba.getMaxColumns());
  const cab = aba.getRange(1, 15, 1, 2).getDisplayValues()[0];
  if (String(cab[0]||'').trim() && String(cab[1]||'').trim()) return;
  aba.getRange(1, 15, 1, 2).setValues([['DATA_EDICAO','USUARIO_EDICAO']])
     .setFontWeight('bold').setBackground('#6B007B').setFontColor('#FFF');
}

/* ========================================================================== */

function prepararAbaRH_(ss,nome,cab){let a=ss.getSheetByName(nome)||ss.insertSheet(nome);a.getRange(1,1,1,cab.length).setValues([cab]).setFontWeight('bold').setBackground('#6B007B').setFontColor('#FFF');a.setFrozenRows(1);}
function obterAbaRH_(nome){const ss=SpreadsheetApp.getActiveSpreadsheet();if(!ss)throw new Error('Projeto não vinculado à planilha.');return ss.getSheetByName(nome)||ss.insertSheet(nome);}
function colaboradorRH_(id){const lista=listarColaboradoresRH({});const c=lista.find(x=>x.idColaborador===String(id||''));if(!c)throw new Error('Colaborador não encontrado.');return c;}
function validarArquivoRH_(d,campo){if(!d)throw new Error('Nenhum dado recebido.');if(!textoRH_(d.idColaborador))throw new Error('Selecione um colaborador.');if(!textoRH_(d[campo]))throw new Error(campo==='competencia'?'Informe a competência.':'Informe o tipo do documento.');if(!d.arquivo||!d.arquivo.base64)throw new Error('Selecione um arquivo.');if(String(d.arquivo.base64).length*.75>15*1024*1024)throw new Error('O arquivo deve possuir no máximo 15 MB.');}
function salvarArquivoRH_(a,sub,id){const p=obterPastasRH_()[sub==='Folhas de Ponto'?'folhas':'documentos'];const blob=Utilities.newBlob(Utilities.base64Decode(a.base64),a.tipo||'application/octet-stream',`${id}_${nomeSeguroRH_(a.nome||'arquivo')}`);const f=p.createFile(blob);return{id:f.getId(),nome:f.getName(),tipo:a.tipo||'',urlVisualizacao:f.getUrl(),urlDownload:`https://drive.google.com/uc?export=download&id=${f.getId()}`};}
function obterPastasRH_(){const props=PropertiesService.getScriptProperties();let raiz;const id=props.getProperty('PASTA_RH_ID');if(id){try{raiz=DriveApp.getFolderById(id);}catch(e){}}if(!raiz){const it=DriveApp.getFoldersByName(RH_CONFIG.PASTA);raiz=it.hasNext()?it.next():DriveApp.createFolder(RH_CONFIG.PASTA);props.setProperty('PASTA_RH_ID',raiz.getId());}return{documentos:subpastaRH_(raiz,'Documentos'),folhas:subpastaRH_(raiz,'Folhas de Ponto')};}
function subpastaRH_(p,n){const it=p.getFoldersByName(n);return it.hasNext()?it.next():p.createFolder(n);}
function filtrarArquivoRH_(x,f,t){if(f.idColaborador&&x.idColaborador!==f.idColaborador)return false;if(t==='folha'&&f.competencia&&x.competencia!==f.competencia)return false;if(t==='documento'&&f.tipoDocumento&&normRH_(x.tipoDocumento)!==normRH_(f.tipoDocumento))return false;const termo=normRH_(f.termo);return !termo||normRH_([x.nomeColaborador,x.tipoDocumento,x.competencia,x.nomeArquivo,x.observacao].join(' ')).includes(termo);}
function verificarDuplicadaRH_(id,comp){if(listarFolhasPontoRH({idColaborador:id,competencia:comp}).length)throw new Error('Já existe uma folha de ponto para este colaborador nesta competência.');}
function excluirArquivoRH_(abaNome,id,colArquivo,rotulo){const a=obterAbaRH_(abaNome),n=a.getLastRow();if(n<2)throw new Error(`${rotulo} não encontrado.`);const ids=a.getRange(2,1,n-1,1).getDisplayValues().flat();const i=ids.findIndex(x=>String(x)===String(id));if(i<0)throw new Error(`${rotulo} não encontrado.`);const linha=i+2,idArq=a.getRange(linha,colArquivo).getDisplayValue();if(idArq){try{DriveApp.getFileById(idArq).setTrashed(true);}catch(e){}}a.deleteRow(linha);return{sucesso:true,mensagem:`${rotulo} excluído com sucesso.`};}
function gerarIdRH_(k,p){const props=PropertiesService.getScriptProperties(),n=Number(props.getProperty(k)||0)+1;props.setProperty(k,String(n));return p+String(n).padStart(6,'0');}
function usuarioRH_(){try{return Session.getActiveUser().getEmail()||Session.getEffectiveUser().getEmail()||'';}catch(e){return'';}}
function textoRH_(v){return String(v||'').trim();}
function normRH_(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();}
function nomeSeguroRH_(v){return String(v||'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'_');}
function dataHtmlRH_(v){const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)throw new Error('Data inválida.');return new Date(+m[1],+m[2]-1,+m[3]);}
function dataFmtRH_(v){if(!v)return'';const d=v instanceof Date?v:new Date(v);return isNaN(d)?'':Utilities.formatDate(d,Session.getScriptTimeZone(),'dd/MM/yyyy');}
function dataHoraFmtRH_(v){if(!v)return'';const d=v instanceof Date?v:new Date(v);return isNaN(d)?'':Utilities.formatDate(d,Session.getScriptTimeZone(),'dd/MM/yyyy HH:mm');}
