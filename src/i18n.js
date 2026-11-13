// 체스 오답노트 — Copyright (C) 2026 Katherine Nahm
// SPDX-License-Identifier: GPL-3.0-or-later
// UI text in Korean and English. The language follows the browser unless the user picked one.

const DICT = {
  ko: {
    "title": "체스 오답노트 · 진 판으로 만드는 퍼즐",
    "desc": "Chess.com 아이디로 최근 패배한 판에서 승부가 갈린 순간을 퍼즐로 만들어요.",
    "app": "체스 오답노트",
    "tab.puzzle": "퍼즐", "tab.report": "리포트", "tab.home": "다른 아이디",
    "hero": "진 판으로 만드는<br>나만의 오답 퍼즐",
    "lead": "Chess.com 아이디를 입력하면 최근 패배한 판을 엔진으로 분석해 승부가 갈린 순간을 퍼즐로 만들어요. 당시 둔 수를 다시 두면 손버릇으로 표시해요.",
    "ph.user": "Chess.com 아이디",
    "btn.start": "시작",
    "opt.losses": "진 판", "opt.count": "개",
    "tc.rapid": "래피드", "tc.blitz": "블리츠", "tc.bullet": "불릿", "tc.daily": "데일리",
    "opt.quality": "분석", "q.fast": "빠르게", "q.normal": "보통", "q.deep": "꼼꼼하게",
    "note.privacy": "분석은 브라우저 안에서 진행되고 기록은 이 기기에만 저장돼요. 보통 설정 기준 30판에 몇 분 걸려요.",
    "note.pgn": "Chess.com 외 기록이거나 불러오기가 안 될 때는 PGN 파일을 사용해 주세요:",
    "pgn.pick": "PGN 파일 선택",
    "saved": "{u} · 퍼즐 {n}개 · 이어 보기",
    "prog.loading": "기록 불러오는 중",
    "prog.month": "{y}년 {m}월 기록 불러오는 중",
    "prog.analyzing": "패배한 판 {n}개 분석 중",
    "prog.cached": "이미 분석한 판이에요",
    "prog.engine": "엔진 준비 중",
    "prog.left": " · 약 {t} 남음", "unit.min": "{n}분", "unit.sec": "{n}초",
    "prog.wrap": "정리하는 중",
    "prog.screen": "모바일에서는 분석이 끝날 때까지 화면을 켜 두세요. 화면이 꺼지면 분석이 멈춰요.",
    "prog.cancel": "중단하고 결과 보기",
    "err.noLoss": "조건에 맞는 패배한 판이 없어요. 시간 종류를 더 선택해 보세요.",
    "err.engine": "엔진을 불러오지 못했어요. 브라우저를 업데이트하거나 다른 브라우저로 시도해 주세요.",
    "err.engineDied": "분석 중 엔진이 멈췄어요. 지금까지 만든 퍼즐을 보여 드릴게요.",
    "err.empty": "아이디를 입력해 주세요.",
    "err.badId": "아이디 형식이 올바르지 않아요. Chess.com 아이디나 프로필 주소를 입력해 주세요.",
    "err.noTc": "시간 종류를 하나 이상 선택해 주세요.",
    "err.pgnId": "PGN에 기록된 내 아이디를 먼저 입력해 주세요.",
    "err.pgnNone": "PGN에서 이 아이디의 판을 찾지 못했어요.",
    "err.notFound": "Chess.com에서 \"{u}\" 아이디를 찾지 못했어요.",
    "err.noGames": "이 아이디로 둔 게임이 없어요.",
    "err.offline": "Chess.com에 연결하지 못했어요. 잠시 후 다시 시도하거나 PGN 파일을 사용해 주세요.",
    "err.http": "Chess.com에서 기록을 가져오지 못했어요 (HTTP {s})",
    "rep.title": "{u}의 리포트",
    "rep.games": "불러온 판 ({w}승 {d}무 {l}패)",
    "rep.puzzles": "만든 오답 퍼즐",
    "rep.streak": "최장 연패",
    "rep.after2": "2연패 뒤 다음 판 패배율",
    "rep.tilt": "<b>2연패하면 10분 쉬어요.</b> 평소 다음 판 패배율은 {a}인데, 같은 세션에서 2연패한 뒤에는 {b}로 올라가요.",
    "rep.noTilt": "<b>연패해도 크게 무너지지 않는 편이에요.</b> 2연패 뒤 패배율 {b} (평소 {a}). 그래도 3연패면 쉬는 게 좋아요.",
    "rep.early": "<b>초반 10수가 가장 위험해요.</b> 승부가 갈린 순간의 {p}가 10수 안에서 나왔어요. \"오프닝\" 분류 퍼즐부터 풀어 보세요.",
    "rep.hung": "<b>기물을 공짜로 내주는 게 가장 큰 문제예요.</b> {n}판이 그렇게 기울었어요. 두기 전에 \"이 기물을 누가 잡을 수 있지?\"만 확인해도 크게 줄어요.",
    "rep.thrown": "<b>이기던 판을 {n}번 놓쳤어요.</b> 앞서 있을 때는 기물을 맞교환해 판을 단순하게 만드세요.",
    "rep.missed": "<b>상대 실수를 놓친 판이 {n}개예요.</b> 상대가 방금 둔 수로 어디가 비었는지 한 번씩 확인해 보세요.",
    "rep.note": "패배한 판마다 엔진 평가가 처음으로 폰 2개 이상 떨어진 내 수를 \"승부가 갈린 수\"로 봤어요. 빠른 분석이라 숫자는 경향으로만 참고해 주세요.",
    "f.전체": "전체", "f.안 푼 것": "안 푼 것", "f.손버릇": "손버릇", "f.기물 흘림": "기물 흘림", "f.오프닝": "오프닝",
    "f.잡을 수 있었음": "잡을 수 있었음", "f.이기던 판 놓침": "이기던 판 놓침", "f.메이트 있음": "메이트 있음",
    "f.체크 대응": "체크 대응", "f.포지션": "포지션",
    "stat.done": "푼 퍼즐", "stat.clean": "한 번에 맞힘", "stat.habit": "손버릇 재현",
    "side.filters": "분류",
    "side.legend": "빨간 밑줄 = 실제로 졌던 수를 다시 둔 퍼즐",
    "game.link": "원래 판 ↗",
    "btn.hint": "💡 힌트", "btn.show": "정답 보기", "btn.played": "내가 둔 수", "btn.next": "다음 퍼즐",
    "btn.prev": "← 이전", "btn.retry": "↻ 다시",
    "pz.allDone": "다 풀었어요!", "pz.allDoneSub": "이 분류에는 남은 퍼즐이 없어요",
    "pz.turnW": "백 차례", "pz.turnB": "흑 차례",
    "pz.find": "최선의 수를 찾아보세요", "pz.findN": "최선의 수를 찾아보세요 · 내 수 {n}개",
    "pz.meta": "{d} · {n}수째",
    "pz.howto": "기물을 끌어서 놓거나, 기물을 누른 뒤 갈 칸을 눌러 주세요.",
    "pz.habit": "그때 둔 그 수예요", "pz.habitSub": "손이 먼저 나갔군요. 그래서 다시 푸는 거예요",
    "pz.habitMsg": "실제로 판이 기운 수 {m}예요. 상대는 {r}로 받아요. 다시 해 보세요.",
    "pz.wrong": "틀렸어요", "pz.again": "다시 해 보세요",
    "pz.wrongMsg": "체크 → 잡기 → 위협 순서로 다시 살펴보세요.",
    "pz.best": "최고의 수!", "pz.good": "좋은 수예요!", "pz.goOn": "계속 가 볼게요",
    "pz.replying": "상대가 응수하는 중…", "pz.next": "다음 수는?", "pz.continue": "계속해 보세요.",
    "pz.clean": "한 번에 정답! 🔥", "pz.solved": "정답!", "pz.solvedSub": "퍼즐 해결",
    "pz.beatHabit": "이번에는 손버릇을 이겼어요. 실전에서도 이 장면을 기억해 두세요.", "pz.nice": "잘했어요.",
    "pz.revealed": "정답 공개", "pz.later": "나중에 다시 풀어 보세요",
    "pz.hint1": "파란 칸의 기물을 움직여 보세요.", "pz.hint2": "여기서 여기로!",
    "pz.playedTop": "실제로 둔 수: {m}", "pz.playedSub": "↻ 다시를 누르면 처음부터 풀 수 있어요",
    "pz.playedMsg": "상대가 {r}로 받아쳤어요.",
    "ex.line": "정답 수순", "ex.played": "실제로 둔 수", "ex.punish": "상대 응징:",
    "ex.note": "평가는 내 기준 · 폰 1개 = 1.0",
    "ev.mate": "메이트", "ev.mated": "메이트 당함",
  },
  en: {
    "title": "Chess Mistake Notes · Puzzles from your lost games",
    "desc": "Enter your Chess.com username and turn the turning points of your recent losses into puzzles.",
    "app": "Chess Mistake Notes",
    "tab.puzzle": "Puzzles", "tab.report": "Report", "tab.home": "Switch user",
    "hero": "Your lost games are<br>your best puzzles",
    "lead": "Enter your Chess.com username. We analyze your recent losses with an engine and turn the moment each game slipped away into a puzzle. Play the same losing move again and it gets flagged as a habit.",
    "ph.user": "Chess.com username",
    "btn.start": "Start",
    "opt.losses": "Losses", "opt.count": "",
    "tc.rapid": "Rapid", "tc.blitz": "Blitz", "tc.bullet": "Bullet", "tc.daily": "Daily",
    "opt.quality": "Analysis", "q.fast": "Fast", "q.normal": "Normal", "q.deep": "Deep",
    "note.privacy": "Analysis runs in your browser and results are saved only on this device. 30 games take a few minutes on Normal.",
    "note.pgn": "Not on Chess.com, or loading fails? Use a PGN file:",
    "pgn.pick": "Choose PGN file",
    "saved": "{u} · {n} puzzles · Continue",
    "prog.loading": "Loading games",
    "prog.month": "Loading {y}/{m}",
    "prog.analyzing": "Analyzing {n} lost games",
    "prog.cached": "Already analyzed",
    "prog.engine": "Starting engine",
    "prog.left": " · about {t} left", "unit.min": "{n} min", "unit.sec": "{n}s",
    "prog.wrap": "Wrapping up",
    "prog.screen": "On mobile, keep the screen on until analysis finishes. It pauses when the screen turns off.",
    "prog.cancel": "Stop and show results",
    "err.noLoss": "No lost games match these settings. Try selecting more time controls.",
    "err.engine": "Couldn't load the engine. Please update your browser or try another one.",
    "err.engineDied": "The engine stopped during analysis. Showing the puzzles made so far.",
    "err.empty": "Please enter a username.",
    "err.badId": "That doesn't look like a valid username. Enter a Chess.com username or profile URL.",
    "err.noTc": "Please select at least one time control.",
    "err.pgnId": "Enter your username as it appears in the PGN first.",
    "err.pgnNone": "No games for this username were found in the PGN.",
    "err.notFound": "Couldn't find \"{u}\" on Chess.com.",
    "err.noGames": "This account has no games.",
    "err.offline": "Couldn't reach Chess.com. Try again later or use a PGN file.",
    "err.http": "Couldn't load games from Chess.com (HTTP {s})",
    "rep.title": "Report for {u}",
    "rep.games": "Games loaded ({w}W {d}D {l}L)",
    "rep.puzzles": "Puzzles created",
    "rep.streak": "Longest losing streak",
    "rep.after2": "Loss rate after 2 losses in a row",
    "rep.tilt": "<b>After 2 losses in a row, take a 10-minute break.</b> Your usual loss rate is {a}, but after two straight losses in the same session it rises to {b}.",
    "rep.noTilt": "<b>Losing streaks don't seem to break you.</b> Loss rate after 2 losses: {b} (usually {a}). Still, consider stopping after 3.",
    "rep.early": "<b>The first 10 moves are the danger zone.</b> {p} of your turning points came within 10 moves. Start with the \"Opening\" puzzles.",
    "rep.hung": "<b>Hanging pieces is your biggest leak.</b> {n} games turned that way. Before each move, just ask \"who can take this piece?\"",
    "rep.thrown": "<b>You let {n} winning games slip.</b> When ahead, trade pieces and keep it simple.",
    "rep.missed": "<b>You missed your opponent's mistake in {n} games.</b> After each of their moves, check what it left undefended.",
    "rep.note": "In each lost game, the first move of yours that dropped the evaluation by 2+ pawns is treated as the turning point. Numbers come from a quick analysis, so read them as trends.",
    "f.전체": "All", "f.안 푼 것": "Unsolved", "f.손버릇": "Habits", "f.기물 흘림": "Hung piece", "f.오프닝": "Opening",
    "f.잡을 수 있었음": "Missed capture", "f.이기던 판 놓침": "Thrown win", "f.메이트 있음": "Mate",
    "f.체크 대응": "In check", "f.포지션": "Positional",
    "stat.done": "Solved", "stat.clean": "First try", "stat.habit": "Habit repeats",
    "side.filters": "Filters",
    "side.legend": "Red underline = you replayed the move you actually lost with",
    "game.link": "Original game ↗",
    "btn.hint": "💡 Hint", "btn.show": "Solution", "btn.played": "My move", "btn.next": "Next puzzle",
    "btn.prev": "← Prev", "btn.retry": "↻ Retry",
    "pz.allDone": "All done!", "pz.allDoneSub": "No puzzles left in this filter",
    "pz.turnW": "White to move", "pz.turnB": "Black to move",
    "pz.find": "Find the best move", "pz.findN": "Find the best move · {n} moves",
    "pz.meta": "{d} · move {n}",
    "pz.howto": "Drag a piece, or tap a piece and then its destination.",
    "pz.habit": "That's the move you played", "pz.habitSub": "Your hand moved first. That's why we practice",
    "pz.habitMsg": "{m} is the move that lost the game. Your opponent answers with {r}. Try again.",
    "pz.wrong": "Not quite", "pz.again": "Try again",
    "pz.wrongMsg": "Look again: checks → captures → threats.",
    "pz.best": "Best move!", "pz.good": "Good move!", "pz.goOn": "Keep going",
    "pz.replying": "Opponent is replying…", "pz.next": "What's next?", "pz.continue": "Keep going.",
    "pz.clean": "Solved on the first try! 🔥", "pz.solved": "Solved!", "pz.solvedSub": "Puzzle complete",
    "pz.beatHabit": "You beat the habit this time. Remember this position in your games.", "pz.nice": "Well done.",
    "pz.revealed": "Solution shown", "pz.later": "Come back and try it again",
    "pz.hint1": "Move the piece on the blue square.", "pz.hint2": "From here to here!",
    "pz.playedTop": "You played: {m}", "pz.playedSub": "Press ↻ Retry to solve it from the start",
    "pz.playedMsg": "Your opponent answered with {r}.",
    "ex.line": "Solution", "ex.played": "You played", "ex.punish": "Refutation:",
    "ex.note": "Evaluation from your side · 1 pawn = 1.0",
    "ev.mate": "Mate", "ev.mated": "Mated",
  },
};

function detect() {
  try {
    const saved = localStorage.getItem("ccq:lang");
    if (saved === "ko" || saved === "en") return saved;
  } catch (_) {}
  const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
  return String(langs[0] || "en").toLowerCase().startsWith("ko") ? "ko" : "en";
}

export const LANG = detect();

export function t(key, vars) {
  let s = (DICT[LANG] && DICT[LANG][key]) ?? DICT.ko[key] ?? key;
  if (vars) for (const k in vars) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
}

export function setLang(lang) {
  try { localStorage.setItem("ccq:lang", lang); } catch (_) {}
  location.reload();
}

// Fills every element that has data-i18n (text) or data-i18n-html (markup) or data-i18n-ph (placeholder).
export function applyStatic(root = document) {
  document.documentElement.lang = LANG;
  document.title = t("title");
  const md = document.querySelector('meta[name="description"]');
  if (md) md.setAttribute("content", t("desc"));
  root.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => el.setAttribute("placeholder", t(el.dataset.i18nPh)));
}
