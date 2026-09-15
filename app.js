/* ===================================================================
   LFT — Lutando Fora do Tatame — lógica do aplicativo
   Tudo roda no aparelho: os dados ficam salvos no localStorage.
   =================================================================== */

(function(){
"use strict";

/* ---------------------------------------------------------------
   Constantes de treino (regras descritas no PDF do projeto)
   --------------------------------------------------------------- */
const DEFAULT_SERIES = 3;
const DEFAULT_REPS   = 12;
const DEFAULT_REST   = 60;   // segundos
const SEC_PER_REP    = 2;    // segundos por repetição
const STORAGE_KEY     = "lft_state_v1";

const RED_SCALE = ["#402336","#5a2438","#7a2438","#9c2438","#c02a34","#d84430","#e8672f","#f2862f"].reverse();
// escala clara -> escura (pouco treinado -> muito treinado)
const SCALE_LIGHT_TO_DARK = ["#fbe4e4","#f3c6c6","#eba7a7","#e3898a","#da6a6d","#c94a4f","#a02f34","#6e1c20"];

const DOW_LABELS = ["seg.","ter.","qua.","qui.","sex.","sáb.","dom."];
const MONTH_LABELS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

/* ---------------------------------------------------------------
   Utilidades
   --------------------------------------------------------------- */
function $(sel, root){ return (root||document).querySelector(sel); }
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
function shuffle(arr){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function pad2(n){ return String(n).padStart(2,"0"); }

function todayISO(){ return toISO(new Date()); }
function toISO(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function fromISO(iso){ const [y,m,d] = iso.split("-").map(Number); return new Date(y, m-1, d); }
function addDays(d, n){ const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function addMonths(d, n){ const r = new Date(d); r.setMonth(r.getMonth()+n); return r; }
function startOfWeek(d){ const dow = (d.getDay()+6)%7; return addDays(d, -dow); } // segunda-feira
function fmtDateBR(iso){ const [y,m,dd] = iso.split("-"); return `${dd}/${m}/${y}`; }
function fmtWeekdayBR(iso){
  const dias = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
  return dias[fromISO(iso).getDay()];
}
function calcAge(birthISO){
  if(!birthISO) return 30;
  const b = fromISO(birthISO), t = new Date();
  let age = t.getFullYear()-b.getFullYear();
  const m = t.getMonth()-b.getMonth();
  if(m<0 || (m===0 && t.getDate()<b.getDate())) age--;
  return age;
}
function mmss(totalSec){
  totalSec = Math.max(0, Math.round(totalSec));
  const m = Math.floor(totalSec/60), s = totalSec%60;
  return `${m}:${pad2(s)}`;
}

/* ---------------------------------------------------------------
   Estado / armazenamento
   --------------------------------------------------------------- */
function defaultState(){
  return {
    profile: null, // {apelido, nascimento, peso, mesesJiuJitsu, faixa, graus}
    customExercises: { musculacao: [], calistenia: [] },
    restOverrides: {},  // { "nome do exercicio (lowercase)": segundos }
    logs: []             // ver logExercise() para o formato de cada item
  };
}
let state = loadState();
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed);
  }catch(e){ return defaultState(); }
}
function saveState(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){ /* armazenamento indisponível */ }
}

/* ---------------------------------------------------------------
   Dados de exercícios / faixas (vêm de data.js)
   --------------------------------------------------------------- */
function getBeltTrack(age){ return age < 16 ? LFT_DATA.belts.kids : LFT_DATA.belts.adults; }

function beltIndex(track, cor){ return track.findIndex(b => b.cor.toLowerCase() === String(cor||"").toLowerCase()); }

function nextBeltTargetLabel(track, cor){
  const idx = beltIndex(track, cor);
  if(idx === -1 || idx+1 >= track.length) return null;
  return track[idx+1].cor;
}

function nextSegment(track, cor, grau){
  const idx = beltIndex(track, cor);
  if(idx === -1) return { cor: track[0].cor, graus: 0, hex: track[0].hex };
  const belt = track[idx];
  if(grau < belt.graus) return { cor: belt.cor, graus: grau+1, hex: belt.hex };
  if(idx+1 < track.length) return { cor: track[idx+1].cor, graus: 0, hex: track[idx+1].hex };
  return { cor: belt.cor, graus: belt.graus, hex: belt.hex }; // já no nível máximo
}

function flatExercises(classe){
  const base = LFT_DATA.flatLists[classe] || [];
  const custom = (state.customExercises[classe] || []).map(e => ({...e, habilidades:[], custom:true}));
  return base.concat(custom);
}
function findExerciseMeta(classe, nome){
  const key = String(nome||"").trim().toLowerCase();
  return flatExercises(classe).find(e => e.nome.toLowerCase() === key) || null;
}
function poolForSkill(skillId, classe){
  const bucket = LFT_DATA.exByskill[skillId];
  return bucket ? (bucket[classe] || []).slice() : [];
}
function getRestFor(nome){
  const key = String(nome||"").trim().toLowerCase();
  return state.restOverrides[key] || DEFAULT_REST;
}
function estimateExerciseTime(reps, series, rest){ return series * (reps*SEC_PER_REP + rest); }

function muscleZoneFill(token){
  const zone = LFT_DATA.muscleZoneMap[token];
  return zone || null;
}

/* ---------------------------------------------------------------
   Motor de sugestão de treino
   --------------------------------------------------------------- */
function computeTiedLeastTrainedSkills(classe){
  const cutoff = toISO(addDays(new Date(), -15));
  const skillDates = {}; // skillId -> Set(date)
  const muscleDates = {}; // muscleToken -> Set(date)
  LFT_DATA.skillsInfo.forEach(s => skillDates[s.id] = new Set());

  state.logs.forEach(log => {
    if(log.date < cutoff) return;
    let skills = [];
    if(log.habilidade) skills = [log.habilidade];
    else {
      const meta = findExerciseMeta(log.classe, log.exerciseName);
      skills = (meta && meta.habilidades) ? meta.habilidades : [];
    }
    skills.forEach(sid => { (skillDates[sid] = skillDates[sid]||new Set()).add(log.date); });
    (log.musculos||"").split(/[;,]/).forEach(tok => {
      tok = tok.trim(); if(!tok) return;
      (muscleDates[tok] = muscleDates[tok]||new Set()).add(log.date);
    });
  });

  let minDays = Infinity;
  LFT_DATA.skillsInfo.forEach(s => { const c=(skillDates[s.id]||new Set()).size; if(c<minDays) minDays=c; });
  let candidates = LFT_DATA.skillsInfo.filter(s => (skillDates[s.id]||new Set()).size === minDays).map(s => s.id);
  if(candidates.length <= 1) return candidates.length ? candidates : [LFT_DATA.skillsInfo[0].id];

  function muscleScore(skillId){
    const exs = poolForSkill(skillId, classe);
    let total=0, n=0;
    exs.forEach(ex => (ex.musculos||"").split(/[;,]/).forEach(tok => {
      tok = tok.trim(); if(!tok) return;
      total += (muscleDates[tok]||new Set()).size; n++;
    }));
    return n ? total/n : 0;
  }
  let minScore = Infinity;
  candidates.forEach(sid => { const sc=muscleScore(sid); if(sc<minScore) minScore=sc; });
  return candidates.filter(sid => muscleScore(sid) === minScore);
}

function generateWorkout(classe, tempoMin, skillId){
  let pool = [];
  let tiedSkills = null;
  if(skillId){
    pool = poolForSkill(skillId, classe).map(ex => ({...ex, habilidade: skillId}));
  } else {
    tiedSkills = computeTiedLeastTrainedSkills(classe);
    tiedSkills.forEach(sid => poolForSkill(sid, classe).forEach(ex => pool.push({...ex, habilidade: sid})));
  }
  pool = shuffle(pool);

  const budget = tempoMin*60;
  let remaining = budget, chosen = [], i = 0;
  while(i < pool.length){
    const ex = pool[i];
    const already = chosen.some(c => c.nome.toLowerCase() === ex.nome.toLowerCase());
    if(already){ i++; continue; }
    const rest = getRestFor(ex.nome);
    const t = estimateExerciseTime(DEFAULT_REPS, DEFAULT_SERIES, rest);
    if(chosen.length < 2 || t <= remaining){
      chosen.push({
        nome: ex.nome, comoExecutar: ex.comoExecutar, musculos: ex.musculos, habilidade: ex.habilidade,
        series: DEFAULT_SERIES, reps: DEFAULT_REPS, rest,
        carga: classe === "calistenia" ? (state.profile && state.profile.peso ? state.profile.peso : "") : ""
      });
      remaining -= t; i++;
    } else break;
  }
  if(remaining >= 30 && chosen.length >= 2){
    const fillerPool = poolForSkill("condicionamento", classe);
    if(fillerPool.length){
      const f = fillerPool[Math.floor(Math.random()*fillerPool.length)];
      chosen.push({
        nome:f.nome, comoExecutar:f.comoExecutar, musculos:f.musculos, habilidade:"condicionamento",
        isTimeBased:true, durationSec: Math.max(30, Math.round(remaining/5)*5)
      });
    }
  }
  return chosen;
}

function logExercise(entry){
  state.logs.push(Object.assign({ id: uid() }, entry));
  saveState();
}

/* ---------------------------------------------------------------
   Navegação
   --------------------------------------------------------------- */
const BACK_MAP = {
  addWorkout:"menu", addExerciseDb:"addWorkout",
  newClasse:"menu", newTempo:"newClasse", newHabilidade:"newTempo", newLista:"newHabilidade", exec:"newLista",
  progressMenu:"menu", progressWeek:"progressMenu", progressMonth:"progressMenu",
  onboardingEdit:"menu", exit:"menu"
};

let screen = "onboarding";
let flow = {};          // estado temporário do fluxo "Novo treino" / "Adicionar treino" / cadastro de exercício
let progressWeekOffset = 0;
let progressMonthOffset = 0;
let execState = null;   // { list, idx, phase, serieAtual, timer, secondsLeft }
let infoModal = null;

function go(next, resetFlow){
  if(execState && execState.timer){ clearInterval(execState.timer); }
  if(resetFlow) flow = {};
  screen = next;
  render();
}

/* ---------------------------------------------------------------
   Cabeçalho de faixa (aparece em todas as telas exceto o cadastro)
   --------------------------------------------------------------- */
function beltHeaderHtml(){
  if(!state.profile) return "";
  const age = calcAge(state.profile.nascimento);
  const track = getBeltTrack(age);
  const cor = state.profile.faixa || track[0].cor;
  const graus = clamp(state.profile.graus||0, 0, (track[beltIndex(track,cor)]||track[0]).graus);
  const belt = track[beltIndex(track,cor)] || track[0];
  const seg2 = nextSegment(track, cor, graus);
  const targetLabel = nextBeltTargetLabel(track, cor);

  function segHtml(hex, ticks, maxTicks){
    let tipInner = "";
    for(let i=0;i<ticks;i++) tipInner += "<i></i>";
    return `<div class="belt-seg" style="background:${hex}"><div class="tip">${tipInner}</div></div>`;
  }
  const caption = targetLabel ? `RUMO À FAIXA ${targetLabel.toUpperCase()}` : "NÍVEL MÁXIMO ALCANÇADO 🏆";

  return `
  <div class="belt-header">
    <div class="belt-bar">
      ${segHtml(belt.hex, graus, belt.graus)}
      <span class="belt-arrow">➜</span>
      ${segHtml(seg2.hex, seg2.graus, belt.graus)}
    </div>
    <div class="belt-caption-wrap"><span class="belt-caption">${caption}</span></div>
  </div>`;
}

function brandHtml(sub){
  return `<div class="brand"><h1>LFT</h1><p>Lutando Fora do Tatame</p></div>`;
}

/* ---------------------------------------------------------------
   Tela 00 — cadastro / alterar dados
   --------------------------------------------------------------- */
function beltOptionsHtml(age, selected){
  const track = getBeltTrack(age);
  return track.map(b => `<option value="${esc(b.cor)}" ${b.cor===selected?"selected":""}>${esc(b.cor)}</option>`).join("");
}

function renderOnboarding(isEdit){
  const p = state.profile || {};
  const age = calcAge(p.nascimento);
  const track = getBeltTrack(age);
  const faixaSel = p.faixa || track[0].cor;
  const beltDef = track[beltIndex(track,faixaSel)] || track[0];

  return `
  ${brandHtml()}
  <div class="screen-title">${isEdit? "Alterar dados" : "Bem-vindo!"}${isEdit? "" : "<small>Vamos te conhecer antes do primeiro treino</small>"}</div>

  <div class="field">
    <label>Nome (Apelido):</label>
    <input type="text" id="f-apelido" value="${esc(p.apelido||"")}" placeholder="Como podemos te chamar" />
  </div>
  <div class="field">
    <label>Data de Nascimento:</label>
    <input type="date" id="f-nascimento" data-action="birthdate-change" value="${esc(p.nascimento||"")}" />
  </div>
  <div class="field-row">
    <div class="field">
      <label>Peso (Kg):</label>
      <input type="number" step="0.1" min="0" id="f-peso" value="${esc(p.peso||"")}" placeholder="0" />
    </div>
    <div class="field">
      <label>Meses de Jiu-jitsu:</label>
      <input type="number" min="0" id="f-meses" value="${esc(p.mesesJiuJitsu||"")}" placeholder="0" />
    </div>
  </div>
  <div class="field-row">
    <div class="field">
      <label>Qual faixa:</label>
      <select id="f-faixa" data-action="belt-change">${beltOptionsHtml(age, faixaSel)}</select>
    </div>
    <div class="field">
      <label>Quantos graus:</label>
      <input type="number" id="f-graus" min="0" max="${beltDef.graus}" value="${esc(p.graus||0)}" />
    </div>
  </div>
  <p class="hint">A faixa disponível é calculada a partir da data de nascimento (até 16 anos usa a escala infantil).</p>

  <div class="btn-group">
    <button class="btn btn-green" data-action="save-profile">${isEdit? "Salvar alterações" : "Confirmar cadastro"}</button>
    ${isEdit? `<button class="btn btn-outline" data-action="go" data-target="menu">Voltar</button>` : ""}
  </div>`;
}

/* ---------------------------------------------------------------
   Menu principal
   --------------------------------------------------------------- */
function renderMenu(){
  return `
  ${beltHeaderHtml()}
  ${brandHtml()}
  <div class="screen-title">O QUE DESEJA:</div>
  <div class="menu-list">
    <button class="btn btn-light" data-action="go" data-target="addWorkout">Adicionar treino</button>
    <button class="btn btn-light" data-action="go" data-target="newClasse">Novo treino</button>
    <button class="btn btn-light" data-action="go" data-target="progressMenu">Conferir progresso</button>
    <button class="btn btn-light" data-action="go" data-target="onboardingEdit">Alterar dados</button>
    <button class="btn btn-light" data-action="go" data-target="exit">Sair</button>
  </div>`;
}

function renderExit(){
  return `
  ${brandHtml()}
  <div class="screen-title">Até o próximo treino! 🥋</div>
  <p class="hint center">Pode fechar a aba com tranquilidade — seus dados continuam salvos neste aparelho.</p>
  <div class="btn-group"><button class="btn btn-light" data-action="go" data-target="menu">Voltar ao menu</button></div>`;
}

/* ---------------------------------------------------------------
   Tela 01 — Adicionar treino (log manual) + 01.1 cadastrar exercício
   --------------------------------------------------------------- */
function renderAddWorkout(){
  flow.addData = flow.addData || todayISO();
  flow.addSaved = flow.addSaved || [];
  const savedHtml = flow.addSaved.length ? flow.addSaved.map((s,idx)=>`
    <div class="list-item"><span>${esc(s.exerciseName)} — ${s.series}×${s.reps} ${s.cargaKg?('· '+s.cargaKg+'kg'):''}</span>
    <button class="info-dot" data-action="remove-saved" data-idx="${idx}">✕</button></div>`).join("") :
    `<p class="hint">Nenhum exercício adicionado ainda nesta sessão.</p>`;

  return `
  ${beltHeaderHtml()}
  ${brandHtml()}
  <div class="screen-title">ADICIONAR TREINO</div>

  <div class="field">
    <label>Data:</label>
    <input type="date" id="f-add-data" value="${esc(flow.addData)}" />
  </div>
  <div class="field autocomplete">
    <label>Exercício:</label>
    <input type="text" id="f-add-exercicio" autocomplete="off" placeholder="Digite para buscar..." value="${esc(flow.addExNome||'')}" data-action="search-exercise" />
    <div id="add-suggest" class="suggest-list hidden"></div>
  </div>
  <div class="field-row">
    <div class="field"><label>Carga (Kg):</label><input type="number" step="0.5" id="f-add-carga" value="${esc(flow.addCarga||'')}" placeholder="0" /></div>
    <div class="field"><label>Séries:</label><input type="number" min="1" id="f-add-series" value="${esc(flow.addSeries||3)}" /></div>
    <div class="field"><label>Repetições:</label><input type="number" min="1" id="f-add-reps" value="${esc(flow.addReps||12)}" /></div>
  </div>
  <p class="hint">Não achou o exercício? <span class="link" style="cursor:pointer" data-action="go" data-target="addExerciseDb">Cadastrar novo exercício</span>.</p>

  <button class="btn btn-green" data-action="save-add-exercise">Salvar exercício</button>

  <div style="margin:14px 0;">${savedHtml}</div>

  <div class="btn-group"><button class="btn btn-light" data-action="go" data-target="menu">Voltar</button></div>`;
}

function renderAddExerciseDb(){
  flow.newEx = flow.newEx || { classe:"musculacao", nome:"", musculos:[] };
  const chips = flow.newEx.musculos.map((m,i)=>`<span class="chip">${esc(m)}<button data-action="remove-muscle" data-idx="${i}">✕</button></span>`).join("");
  return `
  ${beltHeaderHtml()}
  ${brandHtml()}
  <div class="screen-title">ADICIONAR TREINO<small>Cadastrar novo exercício</small></div>

  <div class="field">
    <label>Classe do exercício:</label>
    <select id="f-nex-classe">
      <option value="musculacao" ${flow.newEx.classe==='musculacao'?'selected':''}>Musculação</option>
      <option value="calistenia" ${flow.newEx.classe==='calistenia'?'selected':''}>Calistenia</option>
    </select>
  </div>
  <div class="field">
    <label>Nome do exercício:</label>
    <input type="text" id="f-nex-nome" value="${esc(flow.newEx.nome)}" placeholder="Ex: Flexão diamante" />
  </div>
  <div class="field autocomplete">
    <label>Músculos trabalhados:</label>
    <input type="text" id="f-nex-musculo" autocomplete="off" placeholder="Digite e adicione..." data-action="search-muscle" />
    <div id="muscle-suggest" class="suggest-list hidden"></div>
  </div>
  <div class="chips">${chips}</div>

  <div class="btn-group">
    <button class="btn btn-green" data-action="confirm-add-exercise">Adicionar Exercício</button>
    <button class="btn btn-light" data-action="go" data-target="addWorkout">Cancelar</button>
  </div>`;
}

/* ---------------------------------------------------------------
   Tela 02 — Novo treino (classe → tempo → habilidade → lista → execução)
   --------------------------------------------------------------- */
function renderNewClasse(){
  return `
  ${beltHeaderHtml()}
  ${brandHtml()}
  <div class="screen-title">Novo Treino<small>Qual tipo de treino?</small></div>
  <button class="btn btn-light" data-action="pick-classe" data-value="musculacao">Musculação</button>
  <button class="btn btn-light" data-action="pick-classe" data-value="calistenia">Calistenia</button>
  <div class="btn-group"><button class="btn btn-outline" data-action="go" data-target="menu">Voltar</button></div>`;
}

function renderNewTempo(){
  const opts = [["15","15 minutos"],["30","30 minutos"],["45","45 minutos"],["60","1 hora"],["90","+ 1 hora"]];
  return `
  ${beltHeaderHtml()}
  ${brandHtml()}
  <div class="screen-title">Novo Treino<small>Quanto tempo de treino</small></div>
  ${opts.map(([v,l])=>`<button class="btn btn-light" data-action="pick-tempo" data-value="${v}">${l}</button>`).join("")}
  <div class="btn-group"><button class="btn btn-outline" data-action="go" data-target="newClasse">Voltar</button></div>`;
}

function renderNewHabilidade(){
  const rows = LFT_DATA.skillsInfo.map(s => `
    <div class="skill-row">
      <button class="btn btn-light skill-btn" data-action="pick-skill" data-value="${s.id}">${esc(s.nome)}</button>
      <button class="info-dot" data-action="info-skill" data-value="${s.id}" title="Importância no Jiu-Jitsu">i</button>
    </div>`).join("");
  return `
  ${beltHeaderHtml()}
  ${brandHtml()}
  <div class="screen-title">Novo Treino (${flow.classe==='calistenia'?'Calistenia':'Musculação'})<small>O que deseja melhorar?</small></div>
  <button class="btn btn-red" data-action="pick-skill" data-value="">Propor treino para hoje</button>
  ${rows}
  <div class="btn-group"><button class="btn btn-outline" data-action="go" data-target="newTempo">Voltar</button></div>
  ${infoModalHtml()}`;
}

function infoModalHtml(){
  if(!infoModal) return "";
  return `
  <div class="modal-overlay" data-action="close-modal">
    <div class="modal-box" data-stop="1">
      <h3>${esc(infoModal.title)}</h3>
      <p>${esc(infoModal.text)}</p>
      <button class="btn btn-red" data-action="close-modal">Entendi</button>
    </div>
  </div>`;
}

function skillLabel(id){ const s = LFT_DATA.skillsInfo.find(x=>x.id===id); return s? s.nome : "Treino livre"; }

function renderNewLista(){
  flow.lista = flow.lista || generateWorkout(flow.classe, Number(flow.tempo), flow.skill || null);
  const items = flow.lista.map((ex,idx)=>{
    const done = flow.doneIdx && flow.doneIdx.includes(idx);
    return `
    <div class="list-item ${done?'done':''}" data-action="open-exercise" data-idx="${idx}">
      <span>${esc(ex.nome)}${ex.isTimeBased? ' ⏱':''}</span>
      <button class="info-dot" data-action="info-exercise" data-idx="${idx}">i</button>
    </div>`;
  }).join("");

  return `
  ${beltHeaderHtml()}
  ${brandHtml()}
  <div class="screen-title">Novo Treino (${flow.classe==='calistenia'?'Calistenia':'Musculação'})<small>${flow.skill? esc(skillLabel(flow.skill)) : 'Treino do dia — foco automático'}</small></div>
  ${items}
  <div class="btn-group">
    <button class="btn btn-red-dark" data-action="finish-session">Encerrar Treino</button>
    <button class="btn btn-outline" data-action="go" data-target="newHabilidade">Voltar</button>
  </div>
  ${infoModalHtml()}`;
}

/* ---------------------------------------------------------------
   Tela 02.4 — execução do exercício
   --------------------------------------------------------------- */
function ensureExecState(){
  if(!execState || execState.list !== flow.lista){
    execState = { list: flow.lista, idx: 0, phase:"idle", serieAtual:0, timer:null, secondsLeft:0 };
  }
}
function currentExec(){ return execState.list[execState.idx]; }

function renderExec(){
  ensureExecState();
  const ex = currentExec();
  if(!ex){ go("progressWeek"); return renderProgressWeek(); }

  let dialLabel, dialClass="", numDisplay="";
  if(ex.isTimeBased){
    if(execState.phase==="idle"){ dialLabel="Iniciar"; }
    else if(execState.phase==="running"){ dialClass="resting"; numDisplay = mmss(execState.secondsLeft); dialLabel = "restando"; }
  } else {
    if(execState.phase==="idle"){ dialLabel="Iniciar"; }
    else if(execState.phase==="active"){ dialLabel = `${execState.serieAtual}<br><small>Série</small>`; }
    else if(execState.phase==="resting"){ dialClass="resting"; numDisplay = String(execState.secondsLeft); }
  }

  const statsHtml = ex.isTimeBased ? `
    <div class="stat-row">
      <div class="stat-box">${mmss(ex.durationSec)}<span>DURAÇÃO</span></div>
    </div>` : `
    <div class="stat-row">
      <div class="stat-box"><input type="number" min="1" id="ex-series" value="${ex.series}" ${execState.phase!=='idle'?'disabled':''}/><span>SÉRIES</span></div>
      <div class="stat-box"><input type="number" min="1" id="ex-reps" value="${ex.reps}" ${execState.phase!=='idle'?'disabled':''}/><span>REPETIÇÕES</span></div>
      <div class="stat-box"><input type="number" min="5" id="ex-rest" value="${ex.rest}" ${execState.phase!=='idle'?'disabled':''}/><span>DESCANSO(s)</span></div>
    </div>
    <div class="carga-row">
      <div class="carga-label">Carga${flow.classe==='calistenia'?' (peso corporal)':' (Kg)'}</div>
      <div class="carga-input"><input type="number" step="0.5" id="ex-carga" value="${esc(ex.carga)}" /></div>
    </div>`;

  return `
  ${beltHeaderHtml()}
  ${brandHtml()}
  <div class="exec-skill-badge">${ex.habilidade? esc(skillLabel(ex.habilidade)).toUpperCase() : 'TREINO DO DIA'}</div>
  <div class="exec-exercise-badge">${esc(ex.nome)} <button class="info-dot" data-action="info-current">i</button></div>

  ${statsHtml}

  <div class="big-dial-wrap">
    <button class="big-dial ${dialClass}" data-action="dial-tap">
      ${numDisplay? `<span class="num">${numDisplay}</span>` : `<span>${dialLabel}</span>`}
    </button>
  </div>

  <div class="btn-group">
    <div class="btn-duo">
      <button class="btn btn-red-dark" data-action="finish-session">Encerrar</button>
      <button class="btn btn-outline" data-action="go" data-target="newLista">Voltar</button>
    </div>
  </div>
  ${infoModalHtml()}`;
}

function dialTap(){
  ensureExecState();
  const ex = currentExec();
  if(!ex) return;

  if(ex.isTimeBased){
    if(execState.phase === "idle"){
      execState.phase = "running";
      execState.secondsLeft = ex.durationSec;
      execState.timer = setInterval(()=>{
        execState.secondsLeft--;
        if(execState.secondsLeft <= 0){
          clearInterval(execState.timer); execState.timer=null;
          completeCurrentExercise();
          return;
        }
        render();
      },1000);
      render();
    } else if(execState.phase === "running"){
      // usuário tocou no cronômetro durante a contagem: encerra agora e considera concluído
      if(execState.timer){ clearInterval(execState.timer); execState.timer=null; }
      completeCurrentExercise();
    }
    return;
  }

  // exercícios com séries/repetições
  const seriesTotal = Number($("#ex-series")? $("#ex-series").value : ex.series) || ex.series;
  ex.series = seriesTotal;
  ex.reps = Number($("#ex-reps")? $("#ex-reps").value : ex.reps) || ex.reps;
  ex.rest  = Number($("#ex-rest")?  $("#ex-rest").value  : ex.rest)  || ex.rest;
  ex.carga = $("#ex-carga") ? $("#ex-carga").value : ex.carga;
  if(ex.rest !== getRestFor(ex.nome)){
    state.restOverrides[ex.nome.trim().toLowerCase()] = ex.rest;
    saveState();
  }

  if(execState.phase === "idle"){
    execState.serieAtual = 1;
    execState.phase = "active";
    render();
  } else if(execState.phase === "active"){
    execState.phase = "resting";
    execState.secondsLeft = ex.rest;
    execState.timer = setInterval(()=>{
      execState.secondsLeft--;
      if(execState.secondsLeft <= 0){
        clearInterval(execState.timer); execState.timer=null;
        advanceAfterRest();
        return;
      }
      render();
    },1000);
    render();
  } else if(execState.phase === "resting"){
    // usuário tocou no cronômetro durante o descanso: encerra a contagem agora e
    // considera a série executada, avançando imediatamente
    if(execState.timer){ clearInterval(execState.timer); execState.timer=null; }
    advanceAfterRest();
  }
}

function advanceAfterRest(){
  const ex = currentExec();
  if(execState.serieAtual >= ex.series){
    completeCurrentExercise();
  } else {
    execState.serieAtual++;
    execState.phase = "active";
    render();
  }
}

function completeCurrentExercise(){
  const ex = currentExec();
  flow.doneIdx = flow.doneIdx || [];
  if(!flow.doneIdx.includes(execState.idx)) flow.doneIdx.push(execState.idx);

  logExercise({
    date: todayISO(),
    classe: flow.classe,
    exerciseName: ex.nome,
    musculos: ex.musculos,
    habilidade: ex.habilidade || null,
    series: ex.isTimeBased? null : ex.series,
    reps: ex.isTimeBased? null : ex.reps,
    cargaKg: ex.isTimeBased? null : (ex.carga || null),
    restSec: ex.isTimeBased? null : ex.rest,
    isTimeBased: !!ex.isTimeBased,
    durationSec: ex.isTimeBased? ex.durationSec : null
  });

  if(execState.idx+1 < execState.list.length){
    execState.idx++; execState.phase="idle"; execState.serieAtual=0;
    render();
  } else {
    finishSession();
  }
}

function finishSession(){
  if(execState && execState.timer){ clearInterval(execState.timer); execState.timer = null; }
  execState = null;
  progressWeekOffset = 0;
  flow = {};
  go("progressWeek");
}

/* ---------------------------------------------------------------
   Tela 03 — progresso (semanal / mensal)
   --------------------------------------------------------------- */
function renderProgressMenu(){
  return `
  ${beltHeaderHtml()}
  ${brandHtml()}
  <div class="screen-title">Conferir Progresso</div>
  <button class="btn btn-light" data-action="go-week" data-value="0">Semanal</button>
  <button class="btn btn-light" data-action="go-month" data-value="0">Mensal</button>
  <div class="btn-group"><button class="btn btn-outline" data-action="go" data-target="menu">Voltar</button></div>`;
}

function computeZoneScores(logs){
  const zoneSet = {};
  logs.forEach(l=>{
    (l.musculos||"").split(/[;,]/).forEach(tok=>{
      tok = tok.trim(); if(!tok) return;
      const zone = muscleZoneFill(tok); if(!zone) return;
      (zoneSet[zone] = zoneSet[zone]||new Set()).add(l.id);
    });
  });
  let max=0; const counts={};
  Object.keys(zoneSet).forEach(z=>{ counts[z]=zoneSet[z].size; if(counts[z]>max) max=counts[z]; });
  return { counts, max };
}
function scaleColor(t){ const idx = clamp(Math.floor(t*SCALE_LIGHT_TO_DARK.length), 0, SCALE_LIGHT_TO_DARK.length-1); return SCALE_LIGHT_TO_DARK[idx]; }

function zoneColorMap(logs){
  const { counts, max } = computeZoneScores(logs);
  const map = {};
  ["cabeca","ombros","peitoral","biceps","triceps","antebracos","abdomen","obliquos","dorsais","trapezio","lombar","gluteos","quadriceps","adutores","posteriores_coxa","panturrilhas","maos"].forEach(z=>{
    const c = counts[z]||0;
    map[z] = c>0 && max>0 ? scaleColor(c/max) : "#2b3765";
  });
  return map;
}

function bodySvg(colors){
  const F = (z)=>colors[z]||"#2b3765";
  return `
  <svg viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg">
    <!-- FRENTE -->
    <g>
      <circle cx="42" cy="18" r="13" fill="${F('cabeca')}"/>
      <circle cx="21" cy="44" r="10" fill="${F('ombros')}"/>
      <circle cx="63" cy="44" r="10" fill="${F('ombros')}"/>
      <rect x="24" y="38" width="36" height="26" rx="9" fill="${F('peitoral')}"/>
      <rect x="8" y="46" width="12" height="40" rx="6" fill="${F('biceps')}"/>
      <rect x="64" y="46" width="12" height="40" rx="6" fill="${F('biceps')}"/>
      <rect x="4" y="87" width="11" height="34" rx="5" fill="${F('antebracos')}"/>
      <rect x="69" y="87" width="11" height="34" rx="5" fill="${F('antebracos')}"/>
      <ellipse cx="9" cy="126" rx="6" ry="8" fill="${F('maos')}"/>
      <ellipse cx="75" cy="126" rx="6" ry="8" fill="${F('maos')}"/>
      <rect x="24" y="64" width="15" height="42" rx="6" fill="${F('obliquos')}"/>
      <rect x="45" y="64" width="15" height="42" rx="6" fill="${F('obliquos')}"/>
      <rect x="33" y="66" width="18" height="40" rx="6" fill="${F('abdomen')}"/>
      <rect x="20" y="106" width="18" height="52" rx="7" fill="${F('quadriceps')}"/>
      <rect x="46" y="106" width="18" height="52" rx="7" fill="${F('quadriceps')}"/>
      <rect x="37" y="106" width="10" height="52" rx="4" fill="${F('adutores')}"/>
      <rect x="21" y="158" width="16" height="46" rx="6" fill="${F('panturrilhas')}"/>
      <rect x="47" y="158" width="16" height="46" rx="6" fill="${F('panturrilhas')}"/>
      <text x="42" y="238" text-anchor="middle" font-size="9" fill="#8b96c2">frente</text>
    </g>
    <!-- VERSO -->
    <g transform="translate(115,0)">
      <circle cx="42" cy="18" r="13" fill="${F('cabeca')}"/>
      <circle cx="21" cy="44" r="10" fill="${F('ombros')}"/>
      <circle cx="63" cy="44" r="10" fill="${F('ombros')}"/>
      <rect x="26" y="36" width="32" height="18" rx="7" fill="${F('trapezio')}"/>
      <rect x="24" y="52" width="36" height="30" rx="8" fill="${F('dorsais')}"/>
      <rect x="27" y="82" width="30" height="24" rx="7" fill="${F('lombar')}"/>
      <rect x="8" y="46" width="12" height="40" rx="6" fill="${F('triceps')}"/>
      <rect x="64" y="46" width="12" height="40" rx="6" fill="${F('triceps')}"/>
      <rect x="4" y="87" width="11" height="34" rx="5" fill="${F('antebracos')}"/>
      <rect x="69" y="87" width="11" height="34" rx="5" fill="${F('antebracos')}"/>
      <rect x="22" y="106" width="40" height="24" rx="9" fill="${F('gluteos')}"/>
      <rect x="20" y="130" width="18" height="40" rx="6" fill="${F('posteriores_coxa')}"/>
      <rect x="46" y="130" width="18" height="40" rx="6" fill="${F('posteriores_coxa')}"/>
      <rect x="21" y="170" width="16" height="42" rx="6" fill="${F('panturrilhas')}"/>
      <rect x="47" y="170" width="16" height="42" rx="6" fill="${F('panturrilhas')}"/>
      <text x="42" y="238" text-anchor="middle" font-size="9" fill="#8b96c2">verso</text>
    </g>
  </svg>`;
}

function calendarWeekHtml(weekStartDate, logs){
  const days = [];
  for(let i=0;i<7;i++) days.push(addDays(weekStartDate,i));
  const byDate = {};
  logs.forEach(l=>{ (byDate[l.date]=byDate[l.date]||[]).push(l); });
  let maxVol=0;
  const vol = {};
  days.forEach(d=>{
    const iso = toISO(d);
    const v = (byDate[iso]||[]).reduce((s,l)=> s + (l.isTimeBased? (l.durationSec||0)/10 : (l.series||0)*(l.reps||0)), 0);
    vol[iso]=v; if(v>maxVol) maxVol=v;
  });
  const todayIso = todayISO();
  const cells = days.map(d=>{
    const iso = toISO(d);
    const trained = (byDate[iso]||[]).length>0;
    const color = trained && maxVol>0 ? scaleColor(vol[iso]/maxVol) : null;
    const cls = ["cal-day","in-range", iso===todayIso?"today":"", trained?"trained":""].join(" ");
    const style = color? `style="background:${color}"` : "";
    return `<div class="${cls}" ${style}>${d.getDate()}</div>`;
  }).join("");
  return { cells, days, byDate };
}

function renderProgressWeek(){
  const base = addDays(startOfWeek(new Date()), progressWeekOffset*7);
  const { cells, days, byDate } = calendarWeekHtml(base, state.logs);
  const monthLabel = `${MONTH_LABELS[base.getMonth()].toUpperCase()} ${base.getFullYear()}`;
  const weekLogs = days.flatMap(d => byDate[toISO(d)] || []);
  const colors = zoneColorMap(weekLogs);

  const daysDesc = days.slice().reverse().filter(d => (byDate[toISO(d)]||[]).length);
  const daysHtml = daysDesc.length ? daysDesc.map(d=>{
    const iso = toISO(d);
    const items = byDate[iso].map(l => l.isTimeBased
      ? `<li><b>${esc(l.exerciseName)}</b> — ${mmss(l.durationSec)}</li>`
      : `<li><b>${esc(l.exerciseName)}</b> — ${l.series}×${l.reps}${l.cargaKg?(' · '+l.cargaKg+'kg'):''}</li>`).join("");
    return `<div class="log-day"><h4>${fmtDateBR(iso)} ${fmtWeekdayBR(iso)}</h4><ul>${items}</ul></div>`;
  }).join("") : `<p class="empty-note">Nenhum treino registrado nesta semana.</p>`;

  return `
  ${beltHeaderHtml()}
  ${brandHtml()}
  <div class="screen-title">Progresso Semanal</div>
  <div class="calendar-card">
    <div class="calendar-nav">
      <button data-action="week-nav" data-value="-1">‹</button>
      <div><div class="calendar-title">SEMANA</div><div class="calendar-month">${monthLabel}</div></div>
      <button data-action="week-nav" data-value="1">›</button>
    </div>
    <div class="cal-grid">${DOW_LABELS.map(l=>`<div class="cal-dow">${l}</div>`).join("")}${cells}</div>
  </div>
  <div class="body-map-wrap">${bodySvg(colors)}</div>
  <div class="scale-legend">${SCALE_LIGHT_TO_DARK.map(c=>`<div style="background:${c}"></div>`).join("")}</div>
  ${daysHtml}
  <div class="btn-group"><button class="btn btn-outline" data-action="go" data-target="progressMenu">Voltar</button></div>`;
}

function renderProgressMonth(){
  const base = addMonths(new Date(), progressMonthOffset);
  const y = base.getFullYear(), m = base.getMonth();
  const first = new Date(y,m,1);
  const startOffset = (first.getDay()+6)%7; // segunda=0
  const gridStart = addDays(first, -startOffset);
  const daysInMonthCount = new Date(y,m+1,0).getDate();
  const totalCells = Math.ceil((startOffset+daysInMonthCount)/7)*7;

  const byDate = {};
  state.logs.forEach(l=>{ (byDate[l.date]=byDate[l.date]||[]).push(l); });

  let maxVol=0; const vol={};
  const cellDates = [];
  for(let i=0;i<totalCells;i++){
    const d = addDays(gridStart,i);
    cellDates.push(d);
    const iso = toISO(d);
    const v = (byDate[iso]||[]).reduce((s,l)=> s + (l.isTimeBased? (l.durationSec||0)/10 : (l.series||0)*(l.reps||0)), 0);
    vol[iso]=v; if(v>maxVol) maxVol=v;
  }
  const todayIso = todayISO();
  const cellsHtml = cellDates.map(d=>{
    const iso = toISO(d);
    const inMonth = d.getMonth()===m;
    const trained = (byDate[iso]||[]).length>0;
    const color = trained && maxVol>0 ? scaleColor(vol[iso]/maxVol) : null;
    const cls = ["cal-day", inMonth?"in-range":"", iso===todayIso?"today":"", trained?"trained":""].join(" ");
    const style = color? `style="background:${color}"` : "";
    return `<div class="${cls}" ${style}>${d.getDate()}</div>`;
  }).join("");

  // dias treinados por habilidade no mês
  const skillDays = {};
  cellDates.forEach(d=>{
    if(d.getMonth()!==m) return;
    const iso = toISO(d);
    const logsToday = byDate[iso]||[];
    const skillsToday = new Set();
    logsToday.forEach(l=>{
      let sids = l.habilidade ? [l.habilidade] : [];
      if(!sids.length){ const meta = findExerciseMeta(l.classe, l.exerciseName); sids = meta? meta.habilidades: []; }
      sids.forEach(s=>skillsToday.add(s));
    });
    skillsToday.forEach(sid => { skillDays[sid] = (skillDays[sid]||0)+1; });
  });
  const pillsSorted = Object.keys(skillDays).sort((a,b)=>skillDays[b]-skillDays[a]);
  const pillsHtml = pillsSorted.length ? pillsSorted.map(sid=>`
    <div class="skill-pill"><div class="count">${skillDays[sid]}<small>DIAS</small></div><div class="name">${esc(skillLabel(sid))}</div></div>
  `).join("") : `<p class="empty-note">Nenhum treino registrado neste mês.</p>`;

  return `
  ${beltHeaderHtml()}
  ${brandHtml()}
  <div class="screen-title">Progresso Mensal</div>
  <div class="calendar-card">
    <div class="calendar-nav">
      <button data-action="month-nav" data-value="-1">‹</button>
      <div><div class="calendar-title">DIÁRIO DE TREINOS</div><div class="calendar-month">${MONTH_LABELS[m].toUpperCase()} ${y}</div></div>
      <button data-action="month-nav" data-value="1">›</button>
    </div>
    <div class="cal-grid">${DOW_LABELS.map(l=>`<div class="cal-dow">${l}</div>`).join("")}${cellsHtml}</div>
  </div>
  ${pillsHtml}
  <div class="btn-group"><button class="btn btn-outline" data-action="go" data-target="progressMenu">Voltar</button></div>`;
}

/* ---------------------------------------------------------------
   Roteador / render principal
   --------------------------------------------------------------- */
function render(){
  const app = $("#app");
  let html = "";
  switch(screen){
    case "onboarding": html = renderOnboarding(false); break;
    case "onboardingEdit": html = renderOnboarding(true); break;
    case "menu": html = renderMenu(); break;
    case "exit": html = renderExit(); break;
    case "addWorkout": html = renderAddWorkout(); break;
    case "addExerciseDb": html = renderAddExerciseDb(); break;
    case "newClasse": html = renderNewClasse(); break;
    case "newTempo": html = renderNewTempo(); break;
    case "newHabilidade": html = renderNewHabilidade(); break;
    case "newLista": html = renderNewLista(); break;
    case "exec": html = renderExec(); break;
    case "progressMenu": html = renderProgressMenu(); break;
    case "progressWeek": html = renderProgressWeek(); break;
    case "progressMonth": html = renderProgressMonth(); break;
    default: html = renderMenu();
  }
  app.innerHTML = html;
}

/* ---------------------------------------------------------------
   Ações (delegação de eventos)
   --------------------------------------------------------------- */
function saveProfileFromForm(){
  const apelido = $("#f-apelido").value.trim();
  const nascimento = $("#f-nascimento").value;
  const peso = Number($("#f-peso").value)||0;
  const mesesJiuJitsu = Number($("#f-meses").value)||0;
  const faixa = $("#f-faixa").value;
  const graus = Number($("#f-graus").value)||0;
  state.profile = { apelido, nascimento, peso, mesesJiuJitsu, faixa, graus };
  saveState();
  go("menu");
}

function refreshBeltFieldsOnBirthdateChange(){
  const nascimento = $("#f-nascimento").value;
  const age = calcAge(nascimento);
  const track = getBeltTrack(age);
  const sel = $("#f-faixa");
  const current = sel.value;
  sel.innerHTML = beltOptionsHtml(age, track.some(b=>b.cor===current)? current : track[0].cor);
  updateGrausMax();
}
function updateGrausMax(){
  const nascimento = $("#f-nascimento").value;
  const age = calcAge(nascimento);
  const track = getBeltTrack(age);
  const cor = $("#f-faixa").value;
  const belt = track[beltIndex(track,cor)] || track[0];
  const grausInput = $("#f-graus");
  grausInput.max = belt.graus;
  if(Number(grausInput.value) > belt.graus) grausInput.value = belt.graus;
}

function exerciseSuggestions(term){
  term = term.trim().toLowerCase();
  if(!term) return [];
  const all = flatExercises("musculacao").map(e=>({...e,classe:"musculacao"}))
    .concat(flatExercises("calistenia").map(e=>({...e,classe:"calistenia"})));
  return all.filter(e => e.nome.toLowerCase().includes(term)).slice(0,8);
}

function renderExerciseSuggestions(){
  const input = $("#f-add-exercicio");
  const box = $("#add-suggest");
  const list = exerciseSuggestions(input.value);
  if(!list.length){ box.classList.add("hidden"); box.innerHTML=""; return; }
  box.classList.remove("hidden");
  box.innerHTML = list.map(e => `<div class="suggest-item" data-action="pick-add-exercise" data-nome="${esc(e.nome)}" data-classe="${e.classe}">${esc(e.nome)} <small style="opacity:.6">(${e.classe==='musculacao'?'musculação':'calistenia'})</small></div>`).join("");
}

function muscleSuggestions(term){
  term = term.trim().toLowerCase();
  if(!term) return [];
  return LFT_DATA.muscleTokens.filter(t => t.toLowerCase().includes(term)).slice(0,8);
}
function renderMuscleSuggestions(){
  const input = $("#f-nex-musculo");
  const box = $("#muscle-suggest");
  const list = muscleSuggestions(input.value);
  if(!list.length){ box.classList.add("hidden"); box.innerHTML=""; return; }
  box.classList.remove("hidden");
  box.innerHTML = list.map(t => `<div class="suggest-item" data-action="pick-muscle" data-value="${esc(t)}">${esc(t)}</div>`).join("");
}

document.addEventListener("DOMContentLoaded", () => {
  const app = $("#app");

  app.addEventListener("click", (e) => {
    const overlay = e.target.closest(".modal-overlay");
    const stopper = e.target.closest("[data-stop]");
    if(overlay && !stopper){ infoModal = null; render(); return; }

    const btn = e.target.closest("[data-action]");
    if(!btn) return;
    const action = btn.dataset.action;

    if(action === "go"){ go(btn.dataset.target); return; }
    if(action === "close-modal"){ infoModal = null; render(); return; }

    if(action === "save-profile"){ saveProfileFromForm(); return; }

    if(action === "pick-classe"){ flow = { classe: btn.dataset.value }; go("newTempo"); return; }
    if(action === "pick-tempo"){ flow.tempo = btn.dataset.value; go("newHabilidade"); return; }
    if(action === "pick-skill"){
      flow.skill = btn.dataset.value || null;
      flow.lista = null; flow.doneIdx = [];
      go("newLista");
      return;
    }
    if(action === "info-skill"){
      const s = LFT_DATA.skillsInfo.find(x=>x.id===btn.dataset.value);
      infoModal = { title: s.nome, text: s.importancia };
      render(); return;
    }
    if(action === "info-exercise"){
      const ex = flow.lista[Number(btn.dataset.idx)];
      infoModal = { title: ex.nome, text: ex.comoExecutar };
      render(); return;
    }
    if(action === "info-current"){
      ensureExecState();
      const ex = currentExec();
      infoModal = { title: ex.nome, text: ex.comoExecutar };
      render(); return;
    }
    if(action === "open-exercise"){
      execState = { list: flow.lista, idx: Number(btn.dataset.idx), phase:"idle", serieAtual:0, timer:null, secondsLeft:0 };
      go("exec"); return;
    }
    if(action === "dial-tap"){ dialTap(); return; }
    if(action === "finish-session"){ finishSession(); return; }

    if(action === "save-add-exercise"){
      const nome = $("#f-add-exercicio").value.trim();
      if(!nome){ return; }
      const carga = $("#f-add-carga").value;
      const series = Number($("#f-add-series").value)||0;
      const reps = Number($("#f-add-reps").value)||0;
      const data = $("#f-add-data").value || todayISO();
      let meta = findExerciseMeta("musculacao", nome) || findExerciseMeta("calistenia", nome);
      const classe = meta ? (LFT_DATA.flatLists.musculacao.concat(state.customExercises.musculacao).some(x=>x.nome.toLowerCase()===nome.toLowerCase()) ? "musculacao" : "calistenia") : "musculacao";
      logExercise({
        date: data, classe, exerciseName: nome,
        musculos: meta? meta.musculos : "",
        habilidade: null, series, reps,
        cargaKg: classe==='calistenia' ? (state.profile? state.profile.peso : null) : (carga||null),
        restSec: null, isTimeBased:false, durationSec:null
      });
      flow.addSaved = flow.addSaved || [];
      flow.addSaved.push({exerciseName:nome, series, reps, cargaKg: carga});
      flow.addExNome=""; flow.addCarga=""; flow.addSeries=3; flow.addReps=12;
      render();
      return;
    }
    if(action === "remove-saved"){ flow.addSaved.splice(Number(btn.dataset.idx),1); render(); return; }
    if(action === "pick-add-exercise"){
      $("#f-add-exercicio").value = btn.dataset.nome;
      flow.addExNome = btn.dataset.nome;
      $("#add-suggest").classList.add("hidden");
      return;
    }

    if(action === "confirm-add-exercise"){
      const classe = $("#f-nex-classe").value;
      const nome = $("#f-nex-nome").value.trim();
      if(!nome || !flow.newEx.musculos.length){ return; }
      state.customExercises[classe] = state.customExercises[classe] || [];
      state.customExercises[classe].push({ nome, comoExecutar:"", musculos: flow.newEx.musculos.join(", ") });
      saveState();
      flow.addExNome = nome;
      flow.newEx = null;
      go("addWorkout");
      return;
    }
    if(action === "pick-muscle"){
      flow.newEx.musculos.push(btn.dataset.value);
      $("#f-nex-musculo").value = "";
      $("#muscle-suggest").classList.add("hidden");
      render(); return;
    }
    if(action === "remove-muscle"){
      flow.newEx.musculos.splice(Number(btn.dataset.idx),1);
      render(); return;
    }

    if(action === "go-week"){ progressWeekOffset = 0; go("progressWeek"); return; }
    if(action === "go-month"){ progressMonthOffset = 0; go("progressMonth"); return; }
    if(action === "week-nav"){ progressWeekOffset += Number(btn.dataset.value); render(); return; }
    if(action === "month-nav"){ progressMonthOffset += Number(btn.dataset.value); render(); return; }
  });

  app.addEventListener("input", (e) => {
    if(e.target.id === "f-add-exercicio"){ renderExerciseSuggestions(); flow.addExNome = e.target.value; }
    if(e.target.id === "f-nex-musculo"){ renderMuscleSuggestions(); }
    if(e.target.id === "f-add-carga"){ flow.addCarga = e.target.value; }
    if(e.target.id === "f-add-series"){ flow.addSeries = e.target.value; }
    if(e.target.id === "f-add-reps"){ flow.addReps = e.target.value; }
    if(e.target.id === "f-add-data"){ flow.addData = e.target.value; }
    if(e.target.id === "f-graus"){ /* validado no submit */ }
  });

  app.addEventListener("change", (e) => {
    if(e.target.dataset && e.target.dataset.action === "birthdate-change"){ refreshBeltFieldsOnBirthdateChange(); }
    if(e.target.dataset && e.target.dataset.action === "belt-change"){ updateGrausMax(); }
    if(e.target.id === "f-nex-classe" && flow.newEx){ flow.newEx.classe = e.target.value; }
    if(e.target.id === "f-nex-nome" && flow.newEx){ flow.newEx.nome = e.target.value; }
  });

  // início
  screen = state.profile ? "menu" : "onboarding";
  render();
});

})();
