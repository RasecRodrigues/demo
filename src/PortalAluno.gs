/**
 * Portal do Aluno — módulo independente da interface administrativa do SIGA.
 * Usa as abas DimAluno, DimMatricula, Chamadas e NotasAlunos.
 */
const CONFIG_PORTAL_ALUNO = {
  ABA_ALUNOS: 'DimAluno',
  ABA_MATRICULAS: 'DimMatricula',
  ABA_CHAMADAS: 'Chamadas',
  ABA_NOTAS: 'NotasAlunos',
  DURACAO_SESSAO: 21600,
  PASTA_FOTOS: 'SIGA - Fotos Portal dos Alunos'
};

let CACHE_LEITURAS_PORTAL_ALUNO_ = {};
function iniciarLeiturasPortalAluno_(){CACHE_LEITURAS_PORTAL_ALUNO_={};}
function lerDadosAbaPortalAluno_(ss,nome){if(CACHE_LEITURAS_PORTAL_ALUNO_[nome])return CACHE_LEITURAS_PORTAL_ALUNO_[nome];const aba=ss.getSheetByName(nome);const dados=aba&&aba.getLastRow()>0?aba.getDataRange().getValues():[];return CACHE_LEITURAS_PORTAL_ALUNO_[nome]={aba,dados};}
/* =========================================================
   AUTOCOMPLETE — NOMES DOS ALUNOS
   ========================================================= */

function listarNomesPortalAlunoSIGA() {
  const cache = CacheService.getScriptCache();
  const chave = 'PORTAL_ALUNO_NOMES_V2_SOCIAL_ADULTO';

  try {
    const salvo = cache.get(chave);

    if (salvo) {
      return JSON.parse(salvo);
    }
  } catch (e) {}


  const ss =
    SpreadsheetApp.getActiveSpreadsheet();

  const leitura =
    lerDadosAbaPortalAluno_(
      ss,
      CONFIG_PORTAL_ALUNO.ABA_ALUNOS
    );

  const aba = leitura.aba;
  const dados = leitura.dados;


  if (
    !aba ||
    dados.length < 2
  ) {
    return [];
  }


  const mapa =
    mapaPortalAluno_(dados[0]);


  const indiceNome =
    indicePortalAluno_(
      mapa,
      ['NOME_ALUNO']
    );


  const indiceId =
    indicePortalAluno_(
      mapa,
      ['ID_ALUNO']
    );

  const indiceSocial = indicePortalAluno_(mapa, ['NOME_SOCIAL']);
  const indiceNascimento = indicePortalAluno_(mapa, ['DATA_NASCIMENTO']);


  if (indiceNome < 0) {
    throw new Error(
      'A coluna NOME_ALUNO não foi encontrada na DimAluno.'
    );
  }


  const alunos = new Map();


  dados
    .slice(1)
    .forEach(linha => {

      const nomeCompleto =
        String(
          linha[indiceNome] || ''
        ).trim();

      if (!nomeCompleto) {
        return;
      }

      const nomeSocial = indiceSocial >= 0
        ? String(linha[indiceSocial] || '').trim()
        : '';
      const idade = indiceNascimento >= 0
        ? calcularIdadePortalAluno_(linha[indiceNascimento])
        : 0;
      const nome = idade >= 18 && nomeSocial
        ? nomeSocial
        : nomeCompleto;


      const idAluno =
        indiceId >= 0
          ? String(
              linha[indiceId] || ''
            ).trim()
          : '';


      const chaveNome =
        normalizarPortalAluno_(
          nome
        );


      /*
       * Evita nome duplicado.
       */
      if (!alunos.has(chaveNome)) {

        alunos.set(
          chaveNome,
          {
            idAluno,
            nomeAluno: nome
          }
        );

      }

    });


  const lista =
    Array.from(
      alunos.values()
    )
      .sort(
        (a, b) =>
          a.nomeAluno.localeCompare(
            b.nomeAluno,
            'pt-BR'
          )
      );


  /*
   * 30 minutos de cache.
   * Para cerca de 300 alunos fica muito rápido.
   */
  try {

    cache.put(
      chave,
      JSON.stringify(lista),
      1800
    );

  } catch (e) {}


  return lista;
}
function autenticarPortalAluno(dados) {
  iniciarLeiturasPortalAluno_();
  dados = dados || {};
  const login = normalizarPortalAluno_(dados.login);
  const cpfInformado = somenteNumerosPortalAluno_(dados.senha);
  if (!login || !cpfInformado) throw new Error('Informe o nome completo e o CPF.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const leituraAluno=lerDadosAbaPortalAluno_(ss,CONFIG_PORTAL_ALUNO.ABA_ALUNOS),aba=leituraAluno.aba;
  if (!aba || aba.getLastRow() < 2) throw new Error('A aba DimAluno não possui alunos cadastrados.');
  const d = leituraAluno.dados;
  const m = mapaPortalAluno_(d[0]);
  const i = indicesAlunoPortal_(m);
  const encontrados = d.slice(1).filter(l => {
    const regraNome = obterRegraNomePortalAluno_(l, i);
    return login === normalizarPortalAluno_(regraNome.nomeAcesso);
  });
  if (!encontrados.length) {
    throw new Error(
      'Aluno não encontrado. Maiores de 18 anos com nome social cadastrado devem entrar pelo nome social completo.'
    );
  }

  const aluno = encontrados.find(l => {
    const menor = calcularIdadePortalAluno_(l[i.nascimento]) < 18;
    const cpfEsperado = menor && i.cpfResponsavel >= 0 && somenteNumerosPortalAluno_(l[i.cpfResponsavel])
      ? somenteNumerosPortalAluno_(l[i.cpfResponsavel])
      : somenteNumerosPortalAluno_(l[i.cpf]);
    return cpfEsperado && cpfEsperado === cpfInformado;
  });
  if (!aluno) throw new Error('CPF inválido para o aluno informado.');

  const idAluno = String(aluno[i.id] || '').trim();
  if (!idAluno) throw new Error('O aluno está sem ID_ALUNO na DimAluno.');
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('PORTAL_ALUNO_' + token, idAluno, CONFIG_PORTAL_ALUNO.DURACAO_SESSAO);
  const perfil=montarPerfilPortalAluno_(ss,idAluno);
  return { sucesso: true, token, perfil };
}

function validarSessaoPortalAluno(token) {
  iniciarLeiturasPortalAluno_();
  const id = obterIdSessaoPortalAluno_(token);
  const perfil=montarPerfilPortalAluno_(SpreadsheetApp.getActiveSpreadsheet(),id);
  return { sucesso: true, perfil };
}

function sairPortalAluno(token) {
  if (token) CacheService.getScriptCache().remove('PORTAL_ALUNO_' + String(token));
  return { sucesso: true };
}

function obterDadosPortalAluno(token) {
  iniciarLeiturasPortalAluno_();
  const id = obterIdSessaoPortalAluno_(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resumo = lerResumoPreparadoPortalAluno_(ss, id);
  if (resumo) return resumo;
  const cache=lerCacheDadosPortalAluno_(id);if(cache)return cache;
  const dados=montarDadosCompletosPortalAluno_(ss,id);gravarCacheDadosPortalAluno_(id,dados);return dados;
}

function obterDadosBasicosPortalAluno(token) {
  iniciarLeiturasPortalAluno_();
  const id = obterIdSessaoPortalAluno_(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resumo = lerResumoPreparadoPortalAluno_(ss, id);
  if (resumo) return {
    perfil: resumo.perfil, matriculas: resumo.matriculas,
    notas: resumo.notas, atualizadoEm: resumo.atualizadoEm
  };
  return {perfil: montarPerfilPortalAluno_(ss,id), matriculas: obterMatriculasPortalAluno_(ss,id), notas: obterNotasPortalAluno_(ss,id)};
}

function obterFrequenciaPortalAlunoAssincrona(token) {
  iniciarLeiturasPortalAluno_();
  const id = obterIdSessaoPortalAluno_(token);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resumo = lerResumoPreparadoPortalAluno_(ss, id);
  if (resumo) return resumo.frequencia;
  const cache=CacheService.getScriptCache(),chave='PORTAL_ALUNO_FREQUENCIA_V4_SOCIAL_ADULTO_'+String(id);
  try {const t=cache.get(chave);if(t)return JSON.parse(t);} catch(e) {}
  const perfil=montarPerfilPortalAluno_(ss,id),frequencia=obterFrequenciaPortalAluno_(ss,id,perfil);
  try {cache.put(chave,JSON.stringify(frequencia),900);} catch(e) {}
  return frequencia;
}

function montarDadosCompletosPortalAluno_(ss,id){const perfil=montarPerfilPortalAluno_(ss,id);return{perfil,matriculas:obterMatriculasPortalAluno_(ss,id),frequencia:obterFrequenciaPortalAluno_(ss,id,perfil),notas:obterNotasPortalAluno_(ss,id)};}
function chaveCacheDadosPortalAluno_(id){return'PORTAL_ALUNO_DADOS_V3_SOCIAL_ADULTO_'+String(id);}
function lerCacheDadosPortalAluno_(id){try{const t=CacheService.getScriptCache().get(chaveCacheDadosPortalAluno_(id));return t?JSON.parse(t):null;}catch(e){return null;}}
function gravarCacheDadosPortalAluno_(id,dados){try{const t=JSON.stringify(dados);if(t.length<90000)CacheService.getScriptCache().put(chaveCacheDadosPortalAluno_(id),t,300);}catch(e){}}

function salvarFotoPerfilPortalAluno(token, arquivo) {
  const id = obterIdSessaoPortalAluno_(token);
  arquivo = arquivo || {};
  const mime = String(arquivo.mimeType || '');
  const base64 = String(arquivo.base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!/^image\/(jpeg|png|webp)$/i.test(mime)) throw new Error('Envie uma imagem JPG, PNG ou WEBP.');
  if (!base64) throw new Error('A imagem está vazia.');
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > 3 * 1024 * 1024) throw new Error('A foto deve ter no máximo 3 MB.');
  const pastas = DriveApp.getFoldersByName(CONFIG_PORTAL_ALUNO.PASTA_FOTOS);
  const pasta = pastas.hasNext() ? pastas.next() : DriveApp.createFolder(CONFIG_PORTAL_ALUNO.PASTA_FOTOS);
  const blob = Utilities.newBlob(bytes, mime, 'aluno_' + id + '.' + (mime.split('/')[1] || 'jpg'));
  const arquivoDrive = pasta.createFile(blob);
  arquivoDrive.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const url = 'https://drive.google.com/thumbnail?id=' + arquivoDrive.getId() + '&sz=w500';
  gravarFotoDimAluno_(SpreadsheetApp.getActiveSpreadsheet(), id, url);
  iniciarLeiturasPortalAluno_();
  CacheService.getScriptCache().remove(chaveCacheDadosPortalAluno_(id));
  return { sucesso: true, url };
}

function montarPerfilPortalAluno_(ss, idAluno) {
  const leitura=lerDadosAbaPortalAluno_(ss,CONFIG_PORTAL_ALUNO.ABA_ALUNOS),aba=leitura.aba;
  if (!aba) throw new Error('A aba DimAluno não foi encontrada.');
  const d = leitura.dados, m = mapaPortalAluno_(d[0]), i = indicesAlunoPortal_(m);
  const l = d.slice(1).find(x => String(x[i.id] || '').trim() === String(idAluno));
  if (!l) throw new Error('Cadastro do aluno não encontrado.');
  const iFoto = indicePortalAluno_(m, ['FOTO_PERFIL']);
  const regraNome = obterRegraNomePortalAluno_(l, i);
  return {
    idAluno: String(idAluno),
    nome: regraNome.nomeAcesso,
    nomeCompleto: regraNome.nomeCompleto,
    nomeSocial: regraNome.nomeSocial,
    usarNomeSocial: regraNome.usarNomeSocial,
    idade: regraNome.idade,
    foto: iFoto >= 0 ? String(l[iFoto] || '') : ''
  };
}

function obterMatriculasPortalAluno_(ss, idAluno) {
  const aba = ss.getSheetByName(CONFIG_PORTAL_ALUNO.ABA_MATRICULAS);
  if (!aba || aba.getLastRow() < 2) return [];
  const d=lerDadosAbaPortalAluno_(ss,CONFIG_PORTAL_ALUNO.ABA_MATRICULAS).dados,m=mapaPortalAluno_(d[0]);
  const ii=indicePortalAluno_(m,['ID_ALUNO']),it=indicePortalAluno_(m,['TURMA']),is=indicePortalAluno_(m,['STATUS','STATUS_MATRICULA']);
  if(ii<0||it<0)return [];
  return [...new Set(d.slice(1).filter(l=>String(l[ii]).trim()===String(idAluno)&&
    (is<0||['ATIVO','ATIVA'].includes(normalizarPortalAluno_(l[is])))).map(l=>String(l[it]).trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'pt-BR'));
}

function obterFrequenciaPortalAluno_(ss, idAluno, perfilInformado) {
  const perfil = perfilInformado||montarPerfilPortalAluno_(ss,idAluno);
  const abaChamadas=ss.getSheetByName(CONFIG_PORTAL_ALUNO.ABA_CHAMADAS);
  const abaMatriculas=ss.getSheetByName(CONFIG_PORTAL_ALUNO.ABA_MATRICULAS);
  const vazio={total:0,presentes:0,faltas:0,percentual:0,porTurma:[]};
  if(!abaChamadas||abaChamadas.getLastRow()<2||!abaMatriculas||abaMatriculas.getLastRow()<2)return vazio;

  // Mesma regra do painel de frequência: todas as datas únicas da turma
  // formam o total de aulas; a presença é consultada separadamente por aluno.
  const dc=lerDadosAbaPortalAluno_(ss,CONFIG_PORTAL_ALUNO.ABA_CHAMADAS).dados,mc=mapaPortalAluno_(dc[0]);
  const cData=indicePortalAluno_(mc,['DATA DA AULA','DATA_AULA']);
  const cTurma=indicePortalAluno_(mc,['TURMA']);
  const cAluno=indicePortalAluno_(mc,['ALUNO']);
  const cPresenca=indicePortalAluno_(mc,['PRESENCA','PRESENÇA']);
  const cExperimental=indicePortalAluno_(mc,['EXPERIMENTAL']);
  if([cData,cTurma,cAluno,cPresenca].some(x=>x<0))throw new Error('A aba Chamadas precisa ter Data da Aula, Turma, Aluno e Presença.');

  const datasPorTurma=new Map(),presencas=new Map();
  dc.slice(1).forEach(l=>{
    if(!l[cData]||!l[cTurma])return;
    const data=converterDataPortalAluno_(l[cData]);if(!data)return;
    const turma=String(l[cTurma]||'').trim(),chaveTurma=normalizarPortalAluno_(turma);
    const dataChave=Utilities.formatDate(data,Session.getScriptTimeZone(),'yyyy-MM-dd');
    if(!datasPorTurma.has(chaveTurma))datasPorTurma.set(chaveTurma,{turma,datas:new Map()});
    datasPorTurma.get(chaveTurma).datas.set(dataChave,data);
    const experimental=cExperimental>=0?normalizarPortalAluno_(l[cExperimental]):'NAO';
    if(['SIM','S','TRUE','1'].includes(experimental))return;
    if(!nomeChamadaCorrespondePortalAluno_(l[cAluno],perfil))return;
    const p=normalizarPortalAluno_(l[cPresenca]);
    if(['PRESENTE','AUSENTE'].includes(p))presencas.set(chaveTurma+'|'+dataChave,p);
  });

  const dm=lerDadosAbaPortalAluno_(ss,CONFIG_PORTAL_ALUNO.ABA_MATRICULAS).dados,mm=mapaPortalAluno_(dm[0]);
  const mId=indicePortalAluno_(mm,['ID_ALUNO']),mTurma=indicePortalAluno_(mm,['TURMA']);
  const mMatricula=indicePortalAluno_(mm,['DATA_ALTERACAO/MATRICULA']);
  const mEfetivo=indicePortalAluno_(mm,['DATA_EFETIVO_TURMA']);
  const mFim=indicePortalAluno_(mm,['DATA_CANCELAMENTO/FINALIZACAO']);
  if(mId<0||mTurma<0)throw new Error('A DimMatricula precisa ter ID_ALUNO e TURMA.');

  const aulasContadas=new Set(),grupos={};
  dm.slice(1).forEach(l=>{
    if(String(l[mId]||'').trim()!==String(idAluno))return;
    const turma=String(l[mTurma]||'').trim(),chaveTurma=normalizarPortalAluno_(turma),base=datasPorTurma.get(chaveTurma);
    if(!turma||!base)return;
    const inicio=converterDataPortalAluno_(mEfetivo>=0&&l[mEfetivo]?l[mEfetivo]:(mMatricula>=0?l[mMatricula]:''));
    const fim=converterDataPortalAluno_(mFim>=0?l[mFim]:'');
    if(!grupos[chaveTurma])grupos[chaveTurma]={turma,total:0,presentes:0,faltas:0,percentual:0};
    base.datas.forEach((data,dataChave)=>{
      if(inicio&&data<inicio)return;if(fim&&data>fim)return;
      const chaveAula=chaveTurma+'|'+dataChave;if(aulasContadas.has(chaveAula))return;aulasContadas.add(chaveAula);
      grupos[chaveTurma].total++;
      if(presencas.get(chaveAula)==='PRESENTE')grupos[chaveTurma].presentes++;
    });
  });
  const porTurma=Object.values(grupos).filter(g=>g.total>0).map(g=>({...g,faltas:Math.max(0,g.total-g.presentes),percentual:g.total?Math.round(g.presentes/g.total*100):0})).sort((a,b)=>a.turma.localeCompare(b.turma,'pt-BR'));
  const total=porTurma.reduce((s,g)=>s+g.total,0),presentes=porTurma.reduce((s,g)=>s+g.presentes,0);
  return {total,presentes,faltas:total-presentes,percentual:total?Math.round(presentes/total*100):0,porTurma};
}

function obterNotasPortalAluno_(ss,idAluno){
  const aba=ss.getSheetByName(CONFIG_PORTAL_ALUNO.ABA_NOTAS);if(!aba||aba.getLastRow()<2)return[];
  const d=lerDadosAbaPortalAluno_(ss,CONFIG_PORTAL_ALUNO.ABA_NOTAS).dados,m=mapaPortalAluno_(d[0]);
  const ii=indicePortalAluno_(m,['ID_ALUNO']),it=indicePortalAluno_(m,['TURMA']),id=indicePortalAluno_(m,['DISCIPLINA']),inn=indicePortalAluno_(m,['NOTA']),ip=indicePortalAluno_(m,['PROFESSOR']);
  if(ii<0)return[];
  return d.slice(1).filter(l=>String(l[ii]).trim()===String(idAluno)).map(l=>({turma:it>=0?l[it]:'',disciplina:id>=0?l[id]:'',nota:inn>=0?l[inn]:'',professor:ip>=0?l[ip]:''}));
}

function gravarFotoDimAluno_(ss,idAluno,url){
  const aba=ss.getSheetByName(CONFIG_PORTAL_ALUNO.ABA_ALUNOS);let cab=aba.getRange(1,1,1,aba.getLastColumn()).getValues()[0];let m=mapaPortalAluno_(cab);
  let iFoto=indicePortalAluno_(m,['FOTO_PERFIL']);if(iFoto<0){iFoto=aba.getLastColumn();aba.getRange(1,iFoto+1).setValue('FOTO_PERFIL');}
  m=mapaPortalAluno_(aba.getRange(1,1,1,aba.getLastColumn()).getValues()[0]);const iId=indicePortalAluno_(m,['ID_ALUNO']);
  const ids=aba.getRange(2,iId+1,Math.max(aba.getLastRow()-1,1),1).getDisplayValues();const pos=ids.findIndex(l=>String(l[0]).trim()===String(idAluno));if(pos<0)throw new Error('Aluno não encontrado.');aba.getRange(pos+2,iFoto+1).setValue(url);
}
function obterIdSessaoPortalAluno_(token){const t=String(token||'');const id=t&&CacheService.getScriptCache().get('PORTAL_ALUNO_'+t);if(!id)throw new Error('Sua sessão expirou. Entre novamente.');CacheService.getScriptCache().put('PORTAL_ALUNO_'+t,id,CONFIG_PORTAL_ALUNO.DURACAO_SESSAO);return id;}
function indicesAlunoPortal_(m){const x={id:indicePortalAluno_(m,['ID_ALUNO']),nome:indicePortalAluno_(m,['NOME_ALUNO']),social:indicePortalAluno_(m,['NOME_SOCIAL']),nascimento:indicePortalAluno_(m,['DATA_NASCIMENTO']),cpf:indicePortalAluno_(m,['CPF']),cpfResponsavel:indicePortalAluno_(m,['CPF_RESPONSAVEL'])};if(x.id<0||x.nome<0||x.nascimento<0||x.cpf<0)throw new Error('Confira ID_ALUNO, NOME_ALUNO, DATA_NASCIMENTO e CPF na DimAluno.');return x;}
function obterRegraNomePortalAluno_(linha,indices){
  const idade=calcularIdadePortalAluno_(linha[indices.nascimento]);
  const nomeCompleto=String(linha[indices.nome]||'').trim();
  const nomeSocial=indices.social>=0?String(linha[indices.social]||'').trim():'';
  const usarNomeSocial=idade>=18&&!!nomeSocial;
  return{idade,nomeCompleto,nomeSocial,usarNomeSocial,nomeAcesso:usarNomeSocial?nomeSocial:nomeCompleto};
}
function chavesNomeChamadaPortalAluno_(valor){
  const texto=String(valor||'').trim();
  const chaves=new Set();
  const adicionar=v=>{const chave=normalizarPortalAluno_(v);if(chave)chaves.add(chave);};
  adicionar(texto);
  (texto.match(/\(([^)]+)\)/g)||[]).forEach(p=>adicionar(p.slice(1,-1)));
  adicionar(texto.split(/\s+-\s+/)[0]);
  return Array.from(chaves);
}
function nomesPermitidosPerfilPortalAluno_(perfil){
  if(perfil&&perfil.usarNomeSocial&&perfil.nomeSocial)return[perfil.nomeSocial];
  return[perfil&&perfil.nomeCompleto,perfil&&perfil.nomeSocial,perfil&&perfil.nome]
    .filter(Boolean);
}
function nomeChamadaCorrespondePortalAluno_(valorChamada,perfil){
  const permitidos=new Set(nomesPermitidosPerfilPortalAluno_(perfil).map(normalizarPortalAluno_));
  return chavesNomeChamadaPortalAluno_(valorChamada).some(chave=>permitidos.has(chave));
}
function calcularIdadePortalAluno_(v){const d=v instanceof Date?v:new Date(v);if(isNaN(d))return 0;const h=new Date();let a=h.getFullYear()-d.getFullYear();if(h.getMonth()<d.getMonth()||(h.getMonth()===d.getMonth()&&h.getDate()<d.getDate()))a--;return a;}
function converterDataPortalAluno_(v){if(!v)return null;if(v instanceof Date&&!isNaN(v))return new Date(v.getFullYear(),v.getMonth(),v.getDate());const s=String(v).trim();let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(m)return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]));m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));const d=new Date(s);return isNaN(d)?null:new Date(d.getFullYear(),d.getMonth(),d.getDate());}
function mapaPortalAluno_(cab){const m={};cab.forEach((v,i)=>m[normalizarPortalAluno_(v)]=i);return m;}
function indicePortalAluno_(m,nomes){for(const n of nomes)if(m[normalizarPortalAluno_(n)]!==undefined)return m[normalizarPortalAluno_(n)];return-1;}
function somenteNumerosPortalAluno_(v){return String(v||'').replace(/\D/g,'');}
function normalizarPortalAluno_(v){return String(v||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');}

/* ======================================================================
 * RESUMO PREPARADO — versão 3 (com integração financeira opcional)
 *
 * INSTALAÇÃO: substitua o conteúdo do .gs original por este arquivo completo.
 * Não adicione uma segunda cópia: os nomes das funções públicas são mantidos.
 * Execute prepararResumoPortalAluno uma vez pelo editor, como proprietário
 * da planilha. Isso cria PortalAlunoResumo, sem modificar as abas de origem.
 * Opcional: execute instalarAtualizacaoResumoPortalAluno para atualizar a
 * cada 15 minutos. Não é executado automaticamente apenas por colar o código.
 * Depois atualize a versão da implantação web já existente.
 *
 * Com PortalAlunoFinanceiro.gs instalado: financeiro do mês atual no JSON
 * do aluno. Valores financeiros visíveis apenas na primeira linha do aluno,
 * evitando duplicar totais quando ele participa de várias turmas.
 * Não contém CPF, credenciais ou tokens na tabela de resumo.
 * A regra original de frequência foi preservada, inclusive ausência de
 * registro contando como falta nas datas de aula da turma durante a vigência.
 * ====================================================================== */
const RESUMO_PORTAL_ALUNO_V1_ = {
  aba: 'PortalAlunoResumo',
  cabecalho: ['ID_ALUNO','ALUNO','TURMA','IDS_MATRICULAS_JSON',
    'STATUS_MATRICULAS_JSON','AULAS','PRESENCAS','FALTAS','FREQUENCIA_PERCENTUAL',
    'NOTAS_JSON','ATUALIZADO_EM','DADOS_PORTAL_JSON','INTEGRACAO_FINANCEIRA',
    'COMPETENCIA_FINANCEIRA','STATUS_MENSALIDADE','VALOR_PREVISTO',
    'TOTAL_PAGO','VALOR_FALTANTE','VENCIMENTO','BOLETOS_JSON']
};

// Esta validação protege as funções públicas administrativas contra chamadas
// feitas pelo navegador de um aluno. Projetos em Drive compartilhado precisam
// de uma autorização administrativa própria antes de usar estes comandos.
function exigirProprietarioResumoPortalAluno_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Execute no projeto vinculado à planilha do SIGA.');
  const ativo = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const efetivo = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const dono = DriveApp.getFileById(ss.getId()).getOwner();
  const emailDono = dono ? String(dono.getEmail()).toLowerCase() : '';
  if (!ativo || ativo !== efetivo || ativo !== emailDono) {
    throw new Error('Execute este comando no editor com a conta proprietária da planilha.');
  }
  return ss;
}

function prepararResumoPortalAluno() {
  const ss = exigirProprietarioResumoPortalAluno_();
  const resultado = reconstruirResumoPortalAluno_(ss);
  console.log(JSON.stringify(resultado));
  return resultado;
}

function instalarAtualizacaoResumoPortalAluno() {
  const ss = exigirProprietarioResumoPortalAluno_();
  const aba = ss.getSheetByName(RESUMO_PORTAL_ALUNO_V1_.aba);
  if (!aba || aba.getLastRow() < 2) throw new Error('Execute prepararResumoPortalAluno primeiro.');
  const p = PropertiesService.getScriptProperties();
  p.setProperty('RESUMO_PORTAL_PLANILHA_V1', ss.getId());
  const existentes = ScriptApp.getProjectTriggers().filter(t =>
    t.getHandlerFunction() === 'atualizarResumoPortalAlunoAgendado_');
  if (!existentes.length) ScriptApp.newTrigger('atualizarResumoPortalAlunoAgendado_')
    .timeBased().everyMinutes(15).create();
  return {sucesso:true, mensagem:'Atualização a cada 15 minutos configurada para esta conta.'};
}

// Execute uma única vez após instalar os arquivos. Função protegida para uso
// pela conta proprietária no editor, nunca por alunos no navegador.
function ativarAtualizacaoAutomaticaPortalAluno() {
  const ss=exigirProprietarioResumoPortalAluno_();
  if(typeof montarFinanceiroPortalV3_!=='function')throw new Error('Adicione PortalAlunoFinanceiro.gs primeiro.');
  const primeira=reconstruirResumoPortalAluno_(ss);
  const agendamento=instalarAtualizacaoResumoPortalAluno();
  const retorno={...primeira,agendamento:agendamento.mensagem};
  console.log(JSON.stringify(retorno));
  return retorno;
}

function removerAtualizacaoResumoPortalAluno() {
  exigirProprietarioResumoPortalAluno_();
  ScriptApp.getProjectTriggers().filter(t =>
    t.getHandlerFunction() === 'atualizarResumoPortalAlunoAgendado_')
    .forEach(t => ScriptApp.deleteTrigger(t));
  return {sucesso:true};
}

// Sufixo _ impede execução direta por google.script.run.
function atualizarResumoPortalAlunoAgendado_() {
  const id = PropertiesService.getScriptProperties().getProperty('RESUMO_PORTAL_PLANILHA_V1');
  if (!id) throw new Error('Planilha de atualização não configurada.');
  const resultado = reconstruirResumoPortalAluno_(SpreadsheetApp.openById(id));
  console.log(JSON.stringify(resultado));
}

function chaveVersaoResumoPortalAluno_(ss) {
  return 'RESUMO_PORTAL_VERSAO_V1_' + ss.getId();
}

function cabecalhoCompativelResumoPortalV3_(cab) {
  const atual=RESUMO_PORTAL_ALUNO_V1_.cabecalho;
  // Migra a versão anterior sem apagar as linhas existentes primeiro.
  const completo=JSON.stringify(cab)===JSON.stringify(atual);
  const antigo=JSON.stringify(cab.slice(0,13))===JSON.stringify(atual.slice(0,13))&&cab.slice(13).every(v=>!v);
  return completo||antigo;
}

// V2: índices construídos UMA vez. Nenhum acesso ao Sheets por aluno.
function indexarResumoPortalAlunoV2_(chamadas, notas, donosNome, fuso) {
  const datasPorTurma = new Map(), presencasPorAluno = new Map(), notasPorAluno = new Map();
  const datasConvertidas = new Map();
  if (chamadas.length > 1) {
    const m = mapaPortalAluno_(chamadas[0]);
    const cd=indicePortalAluno_(m,['DATA DA AULA','DATA_AULA']);
    const ct=indicePortalAluno_(m,['TURMA']), ca=indicePortalAluno_(m,['ALUNO']);
    const cp=indicePortalAluno_(m,['PRESENCA']), ce=indicePortalAluno_(m,['EXPERIMENTAL']);
    if ([cd,ct,ca,cp].some(n=>n<0)) throw new Error('Confira Data da Aula, Turma, Aluno e Presença em Chamadas.');
    for (let n=1;n<chamadas.length;n++) {
      const l=chamadas[n];if(!l[cd]||!l[ct])continue;
      const valorData=l[cd];
      const chaveData=valorData instanceof Date?'D'+valorData.getTime():'S'+String(valorData);
      if(!datasConvertidas.has(chaveData)) {
        const data=converterDataPortalAluno_(valorData);
        datasConvertidas.set(chaveData,data?{data,chave:Utilities.formatDate(data,fuso,'yyyy-MM-dd')}:null);
      }
      const dia=datasConvertidas.get(chaveData);if(!dia)continue;
      const turma=normalizarPortalAluno_(l[ct]);
      if(!datasPorTurma.has(turma))datasPorTurma.set(turma,new Map());
      datasPorTurma.get(turma).set(dia.chave,dia.data);
      // Preserva a regra original: aula conta mesmo com registro experimental;
      // a presença individual experimental não conta.
      if(ce>=0 && ['SIM','S','TRUE','1'].includes(normalizarPortalAluno_(l[ce])))continue;
      const donos=new Set();
      chavesNomeChamadaPortalAluno_(l[ca]).forEach(chave=>{
        const candidatos=donosNome.get(chave);
        if(candidatos)candidatos.forEach(id=>donos.add(id));
      });
      if(donos.size!==1)continue;
      const p=normalizarPortalAluno_(l[cp]);if(!['PRESENTE','AUSENTE'].includes(p))continue;
      const id=donos.values().next().value;
      if(!presencasPorAluno.has(id))presencasPorAluno.set(id,new Map());
      // Em duplicatas, o último registro válido prevalece como na rotina original.
      presencasPorAluno.get(id).set(turma+'|'+dia.chave,p);
    }
  }
  if(notas.length>1) {
    const m=mapaPortalAluno_(notas[0]);
    const ii=indicePortalAluno_(m,['ID_ALUNO']),it=indicePortalAluno_(m,['TURMA']);
    const id=indicePortalAluno_(m,['DISCIPLINA']),inn=indicePortalAluno_(m,['NOTA']),ip=indicePortalAluno_(m,['PROFESSOR']);
    if(ii<0)throw new Error('NotasAlunos não possui ID_ALUNO.');
    for(let n=1;n<notas.length;n++) {
      const l=notas[n],aluno=String(l[ii]||'').trim();if(!aluno)continue;
      if(!notasPorAluno.has(aluno))notasPorAluno.set(aluno,[]);
      notasPorAluno.get(aluno).push({turma:it>=0?l[it]:'',disciplina:id>=0?l[id]:'',nota:inn>=0?l[inn]:'',professor:ip>=0?l[ip]:''});
    }
  }
  return {datasPorTurma,presencasPorAluno,notasPorAluno};
}

function montarResumoIndexadoPortalAlunoV2_(idAluno,mats,mm,indice) {
  const mt=indicePortalAluno_(mm,['TURMA']),ms=indicePortalAluno_(mm,['STATUS','STATUS_MATRICULA']);
  const mi=indicePortalAluno_(mm,['DATA_ALTERACAO/MATRICULA']);
  const me=indicePortalAluno_(mm,['DATA_EFETIVO_TURMA']),mf=indicePortalAluno_(mm,['DATA_CANCELAMENTO/FINALIZACAO']);
  const grupos=new Map(),contadas=new Set(),presencas=indice.presencasPorAluno.get(idAluno)||new Map();
  mats.forEach(l=>{
    const turma=String(l[mt]||'').trim(),chave=normalizarPortalAluno_(turma),datas=indice.datasPorTurma.get(chave);
    if(!turma||!datas)return;
    const inicio=converterDataPortalAluno_(me>=0&&l[me]?l[me]:(mi>=0?l[mi]:''));
    const fim=converterDataPortalAluno_(mf>=0?l[mf]:'');
    if(!grupos.has(chave))grupos.set(chave,{turma,total:0,presentes:0,faltas:0,percentual:0});
    const g=grupos.get(chave);
    datas.forEach((data,dia)=>{
      if((inicio&&data<inicio)||(fim&&data>fim))return;
      const aula=chave+'|'+dia;if(contadas.has(aula))return;
      contadas.add(aula);g.total++;
      if(presencas.get(aula)==='PRESENTE')g.presentes++;
    });
  });
  const porTurma=Array.from(grupos.values()).filter(g=>g.total>0).map(g=>({
    ...g,faltas:g.total-g.presentes,percentual:Math.round(g.presentes/g.total*100)
  })).sort((a,b)=>a.turma.localeCompare(b.turma,'pt-BR'));
  const total=porTurma.reduce((s,g)=>s+g.total,0),presentes=porTurma.reduce((s,g)=>s+g.presentes,0);
  const matriculas=Array.from(new Set(mats.filter(l=>ms<0||['ATIVO','ATIVA'].includes(normalizarPortalAluno_(l[ms])))
    .map(l=>String(l[mt]||'').trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'pt-BR'));
  return {matriculas,frequencia:{total,presentes,faltas:total-presentes,percentual:total?Math.round(presentes/total*100):0,porTurma},
    notas:indice.notasPorAluno.get(idAluno)||[]};
}

function lerResumoPreparadoPortalAluno_(ss, idAluno) {
  const propriedades = PropertiesService.getScriptProperties();
  const versao = propriedades.getProperty(chaveVersaoResumoPortalAluno_(ss));
  if (!versao) return null; // Antes da instalação usa o caminho original.
  const chave = 'RESUMO_PORTAL_V1_' + ss.getId() + '_' + versao + '_' + idAluno;
  const cache = CacheService.getScriptCache();
  let dados = null;
  try {const salvo=cache.get(chave);if(salvo)dados=JSON.parse(salvo);} catch(e) {}
  if (!dados) {
    const aba = ss.getSheetByName(RESUMO_PORTAL_ALUNO_V1_.aba);
    if (!aba || aba.getLastRow() < 2) return null;
    const cab = aba.getRange(1,1,1,RESUMO_PORTAL_ALUNO_V1_.cabecalho.length).getValues()[0];
    if (!cabecalhoCompativelResumoPortalV3_(cab))
      throw new Error('Estrutura de PortalAlunoResumo alterada. Contate a secretaria.');
    // A coluna 12 tem payload somente na primeira linha de cada aluno.
    const achados = aba.getRange(2,1,aba.getLastRow()-1,1).createTextFinder(String(idAluno))
      .matchEntireCell(true).matchCase(true).useRegularExpression(false).findAll();
    if (!achados.length) return null; // Aluno cadastrado após a última atualização.
    const primeiraLinha = Math.min.apply(null, achados.map(c => c.getRow()));
    const texto = aba.getRange(primeiraLinha,12).getValue();
    if (!texto) throw new Error('Resumo incompleto. Contate a secretaria para atualizar.');
    dados = JSON.parse(texto);
    if (String(dados.idAluno) !== String(idAluno)) throw new Error('Resumo inconsistente.');
    // Revalida versão após leitura: uma reconstrução concorrente pode ter mudado linhas.
    if (propriedades.getProperty(chaveVersaoResumoPortalAluno_(ss)) !== versao) return null;
    try {if(Utilities.newBlob(texto).getBytes().length<90000)cache.put(chave,texto,300);} catch(e) {}
  }
  // Resumos anteriores não aplicavam a regra de nome social para maiores.
  // Até a reconstrução, usa o cálculo direto atualizado.
  if (Number(dados.regraNomeSocialVersao || 0) < 1) return null;
  // Perfil continua vindo do cadastro: foto, idade e nome não ficam congelados.
  dados.perfil = montarPerfilPortalAluno_(ss,idAluno);
  dados.resumoDesatualizado = Date.now() - new Date(dados.atualizadoEm).getTime() > 30*60000;
  return dados;
}

function reconstruirResumoPortalAluno_(ss) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Já existe uma atualização em andamento.');
  const inicio = Date.now();
  try {
    iniciarLeiturasPortalAluno_();
    const fonte = lerDadosAbaPortalAluno_(ss,CONFIG_PORTAL_ALUNO.ABA_ALUNOS).dados;
    if (fonte.length < 2) throw new Error('DimAluno vazia. O resumo anterior foi preservado.');
    const mapa = mapaPortalAluno_(fonte[0]);
    const i = indicesAlunoPortal_(mapa);
    const alunos = fonte.slice(1).filter(l => String(l[i.id]||'').trim());
    const ids = alunos.map(l => String(l[i.id]).trim());
    if (new Set(ids).size !== ids.length) throw new Error('ID_ALUNO duplicado na DimAluno. Corrija antes de atualizar.');
    const dm = lerDadosAbaPortalAluno_(ss,CONFIG_PORTAL_ALUNO.ABA_MATRICULAS).dados;
    if (!dm.length) throw new Error('DimMatricula não encontrada.');
    const mm = mapaPortalAluno_(dm[0]);
    const mi=indicePortalAluno_(mm,['ID_ALUNO']), mt=indicePortalAluno_(mm,['TURMA']);
    const mid=indicePortalAluno_(mm,['ID_MATRICULA']), ms=indicePortalAluno_(mm,['STATUS']);
    if ([mi,mt,mid,ms].some(n=>n<0)) throw new Error('Confira ID_ALUNO, ID_MATRICULA, TURMA e STATUS na DimMatricula.');
    const chamadas=lerDadosAbaPortalAluno_(ss,CONFIG_PORTAL_ALUNO.ABA_CHAMADAS);
    if(!chamadas.aba) throw new Error('A aba Chamadas não foi encontrada.');
    const notas=lerDadosAbaPortalAluno_(ss,CONFIG_PORTAL_ALUNO.ABA_NOTAS);
    if(notas.dados.length>1 && indicePortalAluno_(mapaPortalAluno_(notas.dados[0]),['ID_ALUNO'])<0)
      throw new Error('NotasAlunos não possui ID_ALUNO. Envie seus cabeçalhos para adaptar a associação com segurança.');
    // Nomes em Chamadas não possuem ID: homônimos não podem compartilhar presença.
    const donosNome = new Map();
    alunos.forEach(l => {
      const regraNome=obterRegraNomePortalAluno_(l,i);
      const nomes=regraNome.usarNomeSocial
        ? [regraNome.nomeSocial]
        : [regraNome.nomeCompleto,regraNome.nomeSocial];
      nomes.forEach(n => {
        const chave=normalizarPortalAluno_(n);if(!chave)return;
        if(!donosNome.has(chave))donosNome.set(chave,new Set());
        donosNome.get(chave).add(String(l[i.id]).trim());
      });
    });
    if(Array.from(donosNome.values()).some(s=>s.size>1))
      throw new Error('Há nomes iguais associados a IDs diferentes. A aba Chamadas precisa de ID_ALUNO para esses casos.');
    const porAluno = new Map();
    dm.slice(1).forEach(l=>{const id=String(l[mi]||'').trim();if(!porAluno.has(id))porAluno.set(id,[]);porAluno.get(id).push(l);});
    const cadastroPorId = new Map(alunos.map(l=>[String(l[i.id]).trim(),l]));
    console.log('Resumo V2: abas lidas. Alunos='+ids.length+', chamadas='+Math.max(0,chamadas.dados.length-1));
    const indice = indexarResumoPortalAlunoV2_(chamadas.dados,notas.dados,donosNome,ss.getSpreadsheetTimeZone());
    const financeiro = typeof montarFinanceiroPortalV3_==='function'?montarFinanceiroPortalV3_(ss,fonte,dm):null;
    const atualizadoEm = new Date().toISOString();
    const linhas = [];
    ids.forEach((idAluno,numeroAluno) => {
      if(Date.now()-inicio>240000)throw new Error('Resumo V2: processamento excedeu 4 minutos antes da gravação. Resumo anterior preservado.');
      const mats=porAluno.get(idAluno)||[];
      const dados=montarResumoIndexadoPortalAlunoV2_(idAluno,mats,mm,indice);
      if(financeiro)dados.financeiro=financeiro.porAluno.get(idAluno)||null;
      dados.idAluno=idAluno;
      dados.regraNomeSocialVersao=1;
      dados.atualizadoEm=atualizadoEm;
      const json=JSON.stringify(dados);
      if(json.length>45000)throw new Error('Histórico muito grande para uma célula. Necessário dividir o resumo do aluno '+idAluno+'.');
      const turmas=new Map();
      mats.forEach(l=>{const t=String(l[mt]||'').trim();if(t)turmas.set(normalizarPortalAluno_(t),t);});
      dados.frequencia.porTurma.forEach(g=>turmas.set(normalizarPortalAluno_(g.turma),g.turma));
      dados.notas.forEach(n=>{if(n.turma)turmas.set(normalizarPortalAluno_(n.turma),String(n.turma));});
      if(!turmas.size)turmas.set('','');
      let primeira=true;
      const cadastro=cadastroPorId.get(idAluno);
      turmas.forEach((turma,chave)=>{
        const f=dados.frequencia.porTurma.find(g=>normalizarPortalAluno_(g.turma)===chave)||{total:0,presentes:0,faltas:0,percentual:0};
        const m=mats.filter(l=>normalizarPortalAluno_(l[mt])===chave);
        linhas.push([idAluno,String(cadastro[i.nome]||''),turma,
          JSON.stringify(m.map(l=>String(l[mid]||''))),JSON.stringify(m.map(l=>String(l[ms]||''))),
          f.total,f.presentes,f.faltas,f.percentual,
          JSON.stringify(dados.notas.filter(n=>normalizarPortalAluno_(n.turma)===chave)),
          atualizadoEm,primeira?json:'',financeiro?'INTEGRADO_MES_ATUAL':'NAO_INTEGRADO',
          primeira&&dados.financeiro?dados.financeiro.competencia:'',
          primeira&&dados.financeiro?dados.financeiro.status:'',
          primeira&&dados.financeiro&&dados.financeiro.valorPrevisto!=null?dados.financeiro.valorPrevisto:'',
          primeira&&dados.financeiro&&dados.financeiro.totalPago!=null?dados.financeiro.totalPago:'',
          primeira&&dados.financeiro&&dados.financeiro.valorFaltante!=null?dados.financeiro.valorFaltante:'',
          primeira&&dados.financeiro?dados.financeiro.vencimento:'',
          primeira&&dados.financeiro?JSON.stringify(dados.financeiro.boletos):'']);
        primeira=false;
      });
      if((numeroAluno+1)%100===0)console.log('Resumo V2: '+(numeroAluno+1)+'/'+ids.length+' alunos preparados.');
    });
    if(!linhas.length)throw new Error('Nenhum aluno válido. Resumo anterior preservado.');
    let aba=ss.getSheetByName(RESUMO_PORTAL_ALUNO_V1_.aba);
    const cab=RESUMO_PORTAL_ALUNO_V1_.cabecalho;
    if(aba && aba.getLastRow()>0 && !cabecalhoCompativelResumoPortalV3_(aba.getRange(1,1,1,cab.length).getValues()[0]))
      throw new Error('Já existe uma PortalAlunoResumo com estrutura diferente. Nada foi sobrescrito.');
    if(!aba)aba=ss.insertSheet(RESUMO_PORTAL_ALUNO_V1_.aba);
    const antigas=aba.getLastRow();
    if(aba.getMaxRows()<linhas.length+1)aba.insertRowsAfter(aba.getMaxRows(),linhas.length+1-aba.getMaxRows());
    if(aba.getMaxColumns()<cab.length)aba.insertColumnsAfter(aba.getMaxColumns(),cab.length-aba.getMaxColumns());
    // Invalida leitores antes de trocar linhas; eles usam o cálculo original
    // temporariamente. A nova versão é publicada somente após flush.
    const p=PropertiesService.getScriptProperties();
    p.deleteProperty(chaveVersaoResumoPortalAluno_(ss));
    const seguro=v=>typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:v;
    aba.getRange(1,1,linhas.length+1,cab.length).setValues([cab].concat(linhas).map(l=>l.map(seguro)));
    if(antigas>linhas.length+1)aba.getRange(linhas.length+2,1,antigas-linhas.length-1,cab.length).clearContent();
    aba.setFrozenRows(1);
    SpreadsheetApp.flush();
    p.setProperty(chaveVersaoResumoPortalAluno_(ss),String(Date.now()));
    return {sucesso:true,alunos:ids.length,linhas:linhas.length,atualizadoEm,
      duracaoMs:Date.now()-inicio,financeiro:financeiro?'INTEGRADO_MES_ATUAL':'NAO_INTEGRADO',
      financeiroEmConferencia:financeiro?financeiro.erros.size:0,
      avisoNotas:notas.aba?'':'NotasAlunos não encontrada: notas vazias.'};
  } finally {lock.releaseLock();}
}
