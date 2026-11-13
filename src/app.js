// 체스 오답노트 — Copyright (C) 2026 Katherine Nahm
// SPDX-License-Identifier: GPL-3.0-or-later
// 체스 오답노트 — main UI
import { Chess } from "../vendor/chess.js";
import { PIECE } from "./pieces.js";
import { Engine } from "./engine.js";
import { fetchChessCom, parsePgnFile, normalizeUser } from "./data.js";
import { findDecisiveMove, buildPuzzle, buildReport } from "./analyze.js";

const FILES = "abcdefgh";
const FILTERS = ["전체","안 푼 것","손버릇","기물 흘림","오프닝","잡을 수 있었음","이기던 판 놓침","메이트 있음"];
const QUALITY = { fast: [8, 11], normal: [10, 13], deep: [12, 16] };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let USER = "", PUZ = [], REPORT = null, CACHE = null;
let store = {done:{}, clean:{}, habit:{}};
let filter = "전체", view = [], pos = 0, st = null;

/* ---------- storage ---------- */
const key = u => "ccq:v1:" + u.toLowerCase();
function readCache(u){ try { return JSON.parse(localStorage.getItem(key(u)) || "null"); } catch(_) { return null; } }
function writeCache(){
  if (!CACHE) return;
  CACHE.progress = store;
  try { localStorage.setItem(key(USER), JSON.stringify(CACHE)); } catch(_) {}
  try {
    const list = JSON.parse(localStorage.getItem("ccq:users") || "[]").filter(x => x.toLowerCase() !== USER.toLowerCase());
    list.unshift(USER); localStorage.setItem("ccq:users", JSON.stringify(list.slice(0, 6)));
  } catch(_) {}
}
const save = () => writeCache();
function savedUsers(){ try { return JSON.parse(localStorage.getItem("ccq:users") || "[]"); } catch(_) { return []; } }

/* ---------- screens ---------- */
function show(name){
  for (const [id, n] of [["landing","home"],["progress","progress"],["puzzleView","puzzle"],["reportView","report"]])
    $(id).classList.toggle("hidden", n !== name);
  $("tabs").classList.toggle("hidden", !(name === "puzzle" || name === "report"));
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  window.scrollTo(0, 0);
}
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => {
  if (b.dataset.tab === "home"){ renderSaved(); show("home"); return; }
  if (b.dataset.tab === "report") renderReport();
  show(b.dataset.tab);
  if (b.dataset.tab === "puzzle" && st) draw();
});
$("logoIc").style.backgroundImage = `url("${PIECE.wn}")`;

function renderSaved(){
  const el = $("saved"); el.innerHTML = "";
  savedUsers().forEach(u => {
    const c = readCache(u); if (!c) return;
    const b = document.createElement("button");
    b.textContent = `${u} · 퍼즐 ${c.puzzles.length}개 이어서`;
    b.onclick = () => openCache(u, c);
    el.appendChild(b);
  });
}

function openCache(u, c){
  USER = c.user || u; CACHE = c; PUZ = c.puzzles;
  store = Object.assign({done:{}, clean:{}, habit:{}}, c.progress || {});
  filter = "전체"; pos = 0;
  REPORT = buildReport(c.games, PUZ);
  if (!PUZ.length){ renderReport(); show("report"); return; }
  rebuildView(); load(); show("puzzle");
}

/* ---------- analysis pipeline ---------- */
let cancelled = false, engine = null, running = false;
$("cancelBtn").onclick = () => { cancelled = true; $("progSub").textContent = "정리하는 중…"; };

async function run(user, getGames){
  if (running) return;
  running = true;
  try { await runInner(user, getGames); }
  finally { running = false; }
}
async function runInner(user, getGames){
  $("err").textContent = "";
  cancelled = false;
  show("progress");
  $("progTitle").textContent = "기록 불러오는 중…"; $("progBar").style.width = "0%"; $("progSub").textContent = "";
  let games;
  try { games = await getGames(msg => $("progSub").textContent = msg); }
  catch (e){ show("home"); $("err").textContent = e.message || String(e); return; }
  const losses = games.filter(g => g.res === "L");
  if (!losses.length){ show("home"); $("err").textContent = "이 조건으로는 진 판이 없어. 시간 종류를 더 골라 봐."; return; }
  const prev = readCache(user);
  const done = new Set(prev ? prev.analyzed || [] : []);
  const puzzles = prev ? prev.puzzles.slice() : [];
  const todo = losses.filter(g => !done.has(g.link || String(g.ts)));
  const [d1, d2] = QUALITY[$("quality").value] || QUALITY.normal;
  USER = user;
  CACHE = { user, puzzles, analyzed: [...done], games: games.map(g => ({ts: g.ts, res: g.res})), progress: prev ? prev.progress : null, at: Date.now() };
  store = Object.assign({done:{}, clean:{}, habit:{}}, CACHE.progress || {});
  $("progTitle").textContent = todo.length ? `진 판 ${todo.length}개 분석 중` : "이미 분석한 판이야";
  if (todo.length){
    $("progSub").textContent = "엔진 준비 중…";
    try { if (!engine || engine.dead) engine = new Engine(); await engine.ready; }
    catch (e){ engine = null; show("home"); $("err").textContent = "엔진을 불러오지 못했어. 브라우저를 최신으로 업데이트하거나 다른 브라우저로 해 봐. (" + e.message + ")"; return; }
  }
  const t0 = Date.now();
  for (let i = 0; i < todo.length && !cancelled; i++){
    const g = todo[i];
    const left = i ? Math.round((Date.now() - t0) / i * (todo.length - i) / 1000) : null;
    $("progSub").textContent = `${i+1}/${todo.length} · vs ${g.me === "w" ? g.black : g.white}` + (left !== null ? ` · 약 ${left >= 60 ? Math.round(left/60) + "분" : left + "초"} 남음` : "");
    $("progBar").style.width = (100 * i / todo.length) + "%";
    try {
      const d = await findDecisiveMove(engine, g, d1, () => cancelled);
      if (cancelled) break;
      if (d){
        const p = await buildPuzzle(engine, g, d, d2);
        if (p.steps.length) puzzles.push(p);
      }
      CACHE.analyzed.push(g.link || String(g.ts));
    } catch (e){
      console.warn("skip game", g.link, e);
      if (engine && engine.dead){ $("err").textContent = "분석 중 엔진이 멈췄어. 지금까지 만든 퍼즐만 보여 줄게."; break; }
    }
    puzzles.sort((a, b) => b.date.localeCompare(a.date));
    CACHE.puzzles = puzzles; writeCache();
  }
  $("progBar").style.width = "100%";
  openCache(user, CACHE);
}

$("form").addEventListener("submit", e => {
  e.preventDefault();
  const raw = $("user").value.trim();
  if (!raw){ $("err").textContent = "아이디를 입력해 줘."; return; }
  const user = normalizeUser(raw);
  if (!user){ $("err").textContent = "아이디 형식이 이상해. Chess.com 아이디나 프로필 주소를 넣어 줘."; return; }
  const tcs = [...document.querySelectorAll(".tc:checked")].map(x => x.value);
  if (!tcs.length){ $("err").textContent = "시간 종류를 하나 이상 골라 줘."; return; }
  const want = +$("nLoss").value;
  run(user, onProgress => fetchChessCom(user, { timeClasses: tcs, wantLosses: want, onProgress }).then(gs => {
    // keep games up to the oldest of the wanted losses
    let n = 0, cut = gs.length;
    for (let i = 0; i < gs.length; i++){ if (gs[i].res === "L" && ++n === want){ cut = i + 1; break; } }
    return gs.slice(0, cut);
  }));
});
$("pgnFile").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  const raw = $("user").value.trim();
  const user = normalizeUser(raw) || raw.toLowerCase();
  if (!raw){ $("err").textContent = "PGN 속 내 아이디를 먼저 입력해 줘."; e.target.value = ""; return; }
  const text = await f.text();
  const want = +$("nLoss").value;
  run(user, async () => {
    const gs = parsePgnFile(text, user);
    if (!gs.length) throw new Error("PGN에서 이 아이디가 둔 판을 찾지 못했어.");
    let n = 0, cut = gs.length;
    for (let i = 0; i < gs.length; i++){ if (gs[i].res === "L" && ++n === want){ cut = i + 1; break; } }
    return gs.slice(0, cut);
  });
  e.target.value = "";
});

/* ---------- report ---------- */
function pct(a, b){ return b ? Math.round(100 * a / b) + "%" : "-"; }
function renderReport(){
  const r = REPORT; if (!r) return;
  const t = r.total;
  const rules = [];
  if (r.after2.n >= 4 && r.after2.L / r.after2.n > r.fresh.L / Math.max(r.fresh.n, 1) + 0.1)
    rules.push(`<b>2연패 하면 10분 쉬기.</b> 평소엔 다음 판 패배율이 ${pct(r.fresh.L, r.fresh.n)}인데, 같은 세션에서 2연패 뒤엔 ${pct(r.after2.L, r.after2.n)}로 올라가.`);
  else rules.push(`<b>연패해도 막 무너지진 않는 편이야.</b> 2연패 뒤 패배율 ${pct(r.after2.L, r.after2.n)} (평소 ${pct(r.fresh.L, r.fresh.n)}). 그래도 3연패면 쉬는 게 좋아.`);
  if (r.nPuz && r.early / r.nPuz >= 0.4) rules.push(`<b>초반 10수가 제일 위험해.</b> 승부가 갈린 순간의 ${pct(r.early, r.nPuz)}가 10수 안에서 나왔어. "오프닝" 분류 퍼즐부터 풀어 봐.`);
  if (r.nPuz && r.hung / r.nPuz >= 0.4) rules.push(`<b>기물을 공짜로 주는 게 1순위 문제야.</b> ${r.hung}판이 그렇게 기울었어. 두기 전에 "이 기물 누가 잡을 수 있지?"만 확인해도 확 줄어.`);
  if (r.thrown) rules.push(`<b>이기던 판을 ${r.thrown}번 놓쳤어.</b> 앞서 있을 땐 기물을 맞교환해서 판을 단순하게 만들자.`);
  if (r.missed) rules.push(`<b>상대 실수를 못 잡은 판이 ${r.missed}개야.</b> 상대가 방금 둔 수가 뭘 비웠는지 한 번씩 봐.`);
  $("reportView").innerHTML = `
    <h2>${esc(USER)}의 리포트</h2>
    <div class="rgrid">
      <div class="rcard"><b>${t.n}</b><span>불러온 판 (${t.W}승 ${t.D}무 ${t.L}패)</span></div>
      <div class="rcard"><b>${r.nPuz}</b><span>만든 오답 퍼즐</span></div>
      <div class="rcard"><b>${r.longest}</b><span>최장 연패</span></div>
      <div class="rcard"><b>${pct(r.after2.L, r.after2.n)}</b><span>2연패 뒤 다음 판 패배율</span></div>
    </div>
    <div class="advice"><ul style="margin:0;padding-left:18px">${rules.map(x => `<li>${x}</li>`).join("")}</ul></div>
    <div class="small">진 판마다 엔진 평가가 처음으로 폰 2개 이상 떨어진 내 수를 "승부가 갈린 수"로 봤어. 빠른 분석이라 숫자는 경향으로만 봐 줘.</div>`;
}

/* ---------- puzzle view ---------- */
function rebuildView(keepId){
  view = PUZ.map((p,i)=>i).filter(i => {
    const p = PUZ[i];
    if (filter === "전체") return true;
    if (filter === "안 푼 것") return !store.done[p.id];
    if (filter === "손버릇") return !!store.habit[p.id];
    return p.theme.includes(filter);
  });
  if (keepId !== undefined){ const k = view.indexOf(keepId); pos = k >= 0 ? k : 0; }
  if (pos >= view.length) pos = 0;
}

function renderSide(){
  const f = $("filters"); f.innerHTML = "";
  FILTERS.forEach(name => {
    const n = name === "전체" ? PUZ.length : name === "안 푼 것" ? PUZ.filter(p=>!store.done[p.id]).length
      : name === "손버릇" ? PUZ.filter(p=>store.habit[p.id]).length : PUZ.filter(p=>p.theme.includes(name)).length;
    if (!n && !["안 푼 것","손버릇"].includes(name)) return;
    const b = document.createElement("button");
    b.className = "chip" + (name === filter ? " on" : "");
    b.textContent = `${name} ${n}`;
    b.onclick = () => { const cur = view[pos]; filter = name; rebuildView(cur); renderSide(); load(); };
    f.appendChild(b);
  });
  const g = $("grid"); g.innerHTML = "";
  view.forEach((i, k) => {
    const b = document.createElement("button");
    const p = PUZ[i];
    b.textContent = k + 1;
    if (store.done[p.id]) b.classList.add("done");
    if (store.habit[p.id]) b.classList.add("habit");
    if (k === pos) b.classList.add("cur");
    b.title = `${p.date} vs ${p.opp}`;
    b.onclick = () => { pos = k; load(); };
    g.appendChild(b);
  });
  $("sDone").textContent = `${PUZ.filter(p=>store.done[p.id]).length}/${PUZ.length}`;
  $("sClean").textContent = PUZ.filter(p=>store.clean[p.id]).length;
  $("sHabit").textContent = PUZ.filter(p=>store.habit[p.id]).length;
}

function setTop(kind, title, sub){
  const t = $("ptop"); t.className = "ptop " + kind;
  const ic = $("pic");
  if (kind === "w" || kind === "b"){ ic.className = "ic"; ic.style.backgroundImage = `url("${PIECE[kind + "k"]}")`; ic.textContent = ""; }
  else { ic.className = "ic circ"; ic.style.backgroundImage = "none"; ic.textContent = kind === "ok" ? "✓" : "✕"; }
  $("ptxt").innerHTML = title + (sub ? `<small>${sub}</small>` : "");
}
const msg = h => { $("msg").innerHTML = h; };

function load(){
  if (!view.length){ $("board").innerHTML = ""; setTop("ok","다 풀었어!","이 분류엔 남은 퍼즐이 없어"); msg(""); renderSide(); return; }
  const idx = view[pos], p = PUZ[idx];
  const game = new Chess(p.fen);
  st = {p, idx, game, step:0, sel:null, hint:0, last:p.lastmove, done:false, busy:false, wrongs:0, usedAnswer:false, badge:null, hintSq:[]};
  const meW = p.me === "w";
  $("oppName").textContent = p.opp;
  $("meName").textContent = USER;
  $("oppAv").style.backgroundImage = `url("${PIECE[(meW ? "b" : "w") + "k"]}")`;
  $("meAv").style.backgroundImage = `url("${PIECE[p.me + "k"]}")`;
  setTop(p.me, `${meW ? "백" : "흑"} 차례`, p.steps.length > 1 ? `최선의 수를 찾아봐 · 내 수 ${p.steps.length}개` : "최선의 수를 찾아봐");
  $("meta").textContent = `${p.date.replaceAll(".","/")} · ${p.moveno}수째`;
  $("glink").href = p.link || "#"; $("glink").style.visibility = p.link ? "visible" : "hidden";
  $("tags").innerHTML = (store.habit[p.id] ? `<span class="tag warn">손버릇</span>` : "") + p.theme.map(t=>`<span class="tag">${t}</span>`).join("");
  msg("기물을 끌어서 놓거나, 누르고 갈 칸을 눌러.");
  $("explain").classList.remove("show");
  $("count").textContent = `${pos+1} / ${view.length}`;
  $("nextBtn").textContent = "다음 퍼즐";
  draw(); renderSide();
  }

/* ---------- board rendering ---------- */
function sqName(r, f){ const flip = st.p.me === "b"; return (flip ? FILES[7-f] : FILES[f]) + (flip ? r + 1 : 8 - r); }
function sqEl(sq){ return document.querySelector(`.sq[data-sq="${sq}"]`); }

function draw(){
  const el = $("board"); el.innerHTML = "";
  const flip = st.p.me === "b";
  const legal = st.sel ? st.game.moves({square: st.sel, verbose: true}) : [];
  const targets = {}; legal.forEach(m => targets[m.to] = m.captured || m.flags.includes("e") ? "cap" : "dot");
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++){
    const sq = sqName(r, f);
    const fi = FILES.indexOf(sq[0]), rk = +sq[1];
    const d = document.createElement("div");
    d.className = "sq " + ((fi + rk) % 2 === 1 ? "l" : "d");
    d.dataset.sq = sq;
    if ((st.last && (st.last.slice(0,2) === sq || st.last.slice(2,4) === sq)) || st.sel === sq) d.classList.add("hl");
    if (st.hintSq.includes(sq)) d.classList.add("hint");
    if (targets[sq]) d.classList.add(targets[sq]);
    if (f === 0){ const c = document.createElement("span"); c.className = "coord r"; c.textContent = rk; d.appendChild(c); }
    if (r === 7){ const c = document.createElement("span"); c.className = "coord f"; c.textContent = sq[0]; d.appendChild(c); }
    const pc = st.game.get(sq);
    if (pc){
      const s = document.createElement("div");
      s.className = "pc" + (pc.color === st.p.me && !st.done ? " mine" : "");
      s.style.backgroundImage = `url("${PIECE[pc.color + pc.type]}")`;
      d.appendChild(s);
    }
    if (st.badge && st.badge.sq === sq){
      const b = document.createElement("div");
      b.className = "badge " + st.badge.kind;
      b.textContent = st.badge.kind === "bad" ? "✕" : st.badge.kind === "best" ? "★" : "✓";
      d.appendChild(b);
    }
    el.appendChild(d);
  }
}

/* ---------- input ---------- */
let drag = null, boardBound = false;
function sqAt(x, y){ const el = document.elementFromPoint(x, y); const s = el && el.closest && el.closest(".sq"); return s ? s.dataset.sq : null; }
function clearGhosts(){ document.querySelectorAll(".pc.drag").forEach(g => g.remove()); }
function bindBoard(){
  if (boardBound) return; boardBound = true;
  const bd = $("board");
  bd.addEventListener("pointerdown", e => {
    if (!st || st.done || st.busy) return;
    if (e.button !== undefined && e.button > 0) return;
    const sq = sqAt(e.clientX, e.clientY); if (!sq) return;
    e.preventDefault();
    clearGhosts();
    const pc = st.game.get(sq);
    drag = {from: sq, own: !!(pc && pc.color === st.p.me), sx: e.clientX, sy: e.clientY, moved: false, ghost: null, over: null, id: e.pointerId};
    try { bd.setPointerCapture(e.pointerId); } catch(_) {}
  });
  bd.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved){
      if (!drag.own || Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 6) return;
      drag.moved = true;
      st.sel = drag.from; draw();
      const node = sqEl(drag.from).querySelector(".pc");
      const r = node.getBoundingClientRect();
      const g = node.cloneNode(); g.classList.add("drag");
      g.style.width = r.width + "px"; g.style.height = r.height + "px";
      document.body.appendChild(g); drag.ghost = g; drag.w = r.width;
      node.style.opacity = ".35";
    }
    drag.ghost.style.left = (e.clientX - drag.w/2) + "px";
    drag.ghost.style.top = (e.clientY - drag.w/2) + "px";
    const s = sqAt(e.clientX, e.clientY);
    if (s !== drag.over){ if (drag.over) sqEl(drag.over)?.classList.remove("over"); drag.over = s; if (s && s !== drag.from) sqEl(s)?.classList.add("over"); }
  });
  const end = (e, cancel) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    clearGhosts();
    try { bd.releasePointerCapture(e.pointerId); } catch(_) {}
    if (cancel){ draw(); return; }
    if (d.moved){
      const to = sqAt(e.clientX, e.clientY);
      if (to && to !== d.from) tryMove(d.from, to); else draw();
    } else clickSq(d.from);
  };
  bd.addEventListener("pointerup", e => end(e, false));
  bd.addEventListener("pointercancel", e => end(e, true));
  bd.addEventListener("lostpointercapture", e => { if (drag && e.pointerId === drag.id) end(e, true); });
}
function clickSq(sq){
  if (st.done || st.busy) return;
  const pc = st.game.get(sq);
  if (st.sel && st.sel !== sq && !(pc && pc.color === st.p.me)){ tryMove(st.sel, sq); return; }
  if (pc && pc.color === st.p.me){ st.sel = st.sel === sq ? null : sq; draw(); return; }
  st.sel = null; draw();
}

function tryMove(from, to){
  const legal = st.game.moves({square: from, verbose: true}).filter(m => m.to === to);
  st.sel = null;
  if (!legal.length){ draw(); return; }
  if (legal.some(m => m.promotion)){ askPromo(from, to); return; }
  attempt(from + to);
}

function askPromo(from, to){
  const pr = $("promo"); pr.innerHTML = "";
  const flip = st.p.me === "b";
  const fi = FILES.indexOf(to[0]);
  const col = document.createElement("div"); col.className = "col";
  col.style.left = ((flip ? 7 - fi : fi) * 12.5) + "%"; col.style.top = "0";
  ["q","n","r","b"].forEach(k => {
    const c = document.createElement("div");
    c.style.backgroundImage = `url("${PIECE[st.p.me + k]}")`;
    c.onclick = e => { e.stopPropagation(); pr.classList.remove("show"); attempt(from + to + k); };
    col.appendChild(c);
  });
  pr.appendChild(col);
  pr.onclick = () => { pr.classList.remove("show"); draw(); };
  pr.classList.add("show");
}

/* ---------- puzzle logic ---------- */
function play(uci){
  const m = st.game.move({from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || "q"});
  st.last = uci.slice(0,4); return m;
}

function attempt(uci){
  const p = st.p, step = p.steps[st.step];
  const ok = step.accept.some(a => a === uci || (a.slice(0,4) === uci.slice(0,4) && (a.length === 4 || !uci[4] || a[4] === uci[4])));
  const isPlayed = st.step === 0 && uci.slice(0,4) === p.played_uci.slice(0,4);
  if (!ok){
    st.wrongs++;
    play(uci); st.badge = {sq: uci.slice(2,4), kind: "bad"}; st.hintSq = []; draw();
    st.busy = true;
    if (isPlayed && !st.usedAnswer){
      if (!store.habit[p.id]){ store.habit[p.id] = 1; save(); }
      setTop("bad", "그 수야, 그때 둔 수", "손이 먼저 나갔지? 괜찮아, 그래서 푸는 거야");
      msg(`이게 실제로 지게 된 수 <span class="mv">${p.played}</span>야. 상대는 <span class="mv">${p.refline[0] || "?"}</span>로 받아. 다시 해 보자.`);
    } else {
      setTop("bad", "틀렸어", "다시 해 봐");
      msg("체크 → 잡기 → 위협 순서로 다시 훑어 봐.");
    }
    setTimeout(() => {
      st.game.undo(); st.last = st.step === 0 ? p.lastmove : p.steps[st.step-1].reply; st.badge = null; st.busy = false;
      setTop(p.me, `${p.me === "w" ? "백" : "흑"} 차례`, "다시 해 봐"); draw(); renderSide();
    }, 900);
    return;
  }
  const real = step.accept.find(a => a.slice(0,4) === uci.slice(0,4)) || uci;
  play(real);
  const isBest = real.slice(0,4) === step.best.slice(0,4);
  st.badge = {sq: real.slice(2,4), kind: isBest ? "best" : "ok"}; st.hintSq = [];
  st.step++;
  draw();
  if (st.step >= p.steps.length){ finish(true); return; }
  setTop("ok", isBest ? "최고의 수!" : "좋은 수야!", "계속 가 보자");
  msg("상대가 응수할게…");
  st.busy = true;
  setTimeout(() => {
    play(step.reply); st.badge = null; st.busy = false;
    setTop(p.me, `${p.me === "w" ? "백" : "흑"} 차례`, "다음 수는?");
    msg("계속해 봐."); draw();
  }, 700);
}

function finish(solved){
  st.done = true;
  const p = st.p;
  if (solved && !st.usedAnswer){
    store.done[p.id] = 1;
    if (st.wrongs === 0 && st.hint === 0) store.clean[p.id] = 1;
    save();
  }
  if (solved && !st.usedAnswer){
    setTop("ok", st.wrongs === 0 && st.hint === 0 ? "한 번에 정답! 🔥" : "정답!", "퍼즐 해결");
    msg(store.habit[p.id] ? "이번엔 손버릇 이겼다. 실전에서도 이 장면 기억해." : "잘했어.");
  } else {
    setTop("bad", "정답 공개", "나중에 다시 풀어 보자");
    msg("");
  }
  showExplain(); draw(); renderSide();
}

function numbered(arr, startNo, whiteFirst){
  let n = startNo, white = whiteFirst, out = [];
  arr.forEach((m, i) => {
    out.push(white ? `${n}.${m}` : (i === 0 ? `${n}...${m}` : m));
    if (!white) n++;
    white = !white;
  });
  return out.join(" ");
}
function evalTxt(v){ if (Math.abs(v) >= 90000) return v > 0 ? "메이트" : "메이트 당함"; return (v > 0 ? "+" : "") + (v/100).toFixed(1); }
function showExplain(){
  const p = st.p, meW = p.me === "w";
  $("explain").innerHTML =
    `<b>정답 수순</b> <span style="float:right">${evalTxt(p.eval_best)}</span><br><span class="mv">${numbered(p.san_line, p.moveno, meW)}</span><br>` +
    `<b>실제로 둔 수</b> <span class="mv">${p.played}</span> <span style="float:right">${evalTxt(p.eval_played)}</span><br>` +
    `상대 응징: <span class="mv">${numbered(p.refline, meW ? p.moveno : p.moveno + 1, !meW)}</span><br>` +
    `<span style="font-size:12px;color:var(--dim)">평가는 네 기준 · 폰 1개 = 1.0</span>`;
  $("explain").classList.add("show");
}

$("hintBtn").onclick = () => {
  if (st.done || st.busy) return;
  const best = st.p.steps[st.step].best;
  st.hint++;
  st.hintSq = st.hint === 1 ? [best.slice(0,2)] : [best.slice(0,2), best.slice(2,4)];
  msg(st.hint === 1 ? "파란 칸의 기물을 움직여 봐." : "여기서 여기로!");
  draw();
};
$("showBtn").onclick = () => {
  if (st.done || st.busy) return;
  st.usedAnswer = true; st.busy = true; st.hintSq = [];
  const go = () => {
    const s = st.p.steps[st.step];
    play(s.best); st.badge = {sq: s.best.slice(2,4), kind: "best"}; st.step++; draw();
    if (st.step < st.p.steps.length && s.reply){
      setTimeout(() => { play(s.reply); st.badge = null; draw(); setTimeout(go, 650); }, 650);
    } else { st.busy = false; finish(false); }
  };
  go();
};
$("playedBtn").onclick = () => {
  if (st.busy) return;
  const p = st.p;
  st.game = new Chess(p.fen); st.step = 0; st.sel = null; st.hintSq = []; st.done = true; st.busy = true;
  play(p.played_uci); st.badge = {sq: p.played_uci.slice(2,4), kind: "bad"}; draw();
  setTop("bad", `실제로 둔 수: ${p.played}`, "↻ 다시를 누르면 처음부터 풀 수 있어");
  setTimeout(() => {
    if (p.refline[0]){
      const m = st.game.move(p.refline[0]);
      if (m){ st.last = m.from + m.to; st.badge = null; }
    }
    st.busy = false; draw(); showExplain();
    msg(`상대가 <span class="mv">${p.refline[0] || ""}</span>로 받아쳤어.`);
  }, 900);
};
$("retryBtn").onclick = () => load();
$("prevBtn").onclick = () => { if (!view.length) return; pos = (pos - 1 + view.length) % view.length; load(); };
$("nextBtn").onclick = () => {
  if (!view.length) return;
  if (filter === "안 푼 것"){ const cur = view[pos]; rebuildView(); const k = view.findIndex(i => i > cur); pos = k >= 0 ? k : 0; }
  else pos = (pos + 1) % view.length;
  load();
};
document.addEventListener("keydown", e => {
  if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || $("puzzleView").classList.contains("hidden")) return;
  if (e.key === "ArrowRight") $("nextBtn").click();
  if (e.key === "ArrowLeft") $("prevBtn").click();
});


bindBoard();
renderSaved();
try { const last = savedUsers()[0]; if (last) $("user").value = last; } catch(_) {}
