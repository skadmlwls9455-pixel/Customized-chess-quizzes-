// Finds the move that decided each lost game and turns the position before it into a puzzle.
import { Chess } from "../vendor/chess.js";
import { scoreOf } from "./engine.js";

const CLAMP = 1000;
const clamp = (v) => Math.max(-CLAMP, Math.min(CLAMP, v));
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Eval of a position from `me`'s point of view, clamped.
async function evalFor(engine, chess, me, depth) {
  if (chess.isCheckmate()) return chess.turn() === me ? -CLAMP : CLAMP;
  if (chess.isDraw() || chess.isStalemate()) return 0;
  const { infos } = await engine.analyse(chess.fen(), depth, 1);
  const s = scoreOf(infos[0]);
  return clamp(chess.turn() === me ? s : -s);
}

// Walks a lost game until the first move of mine that drops >= 2 pawns from a not-yet-lost position.
export async function findDecisiveMove(engine, game, depth, isCancelled) {
  const c = new Chess();
  c.loadPgn(game.pgn);
  const moves = c.history({ verbose: true });
  const me = game.me;
  const board = new Chess(moves.length ? moves[0].before : undefined);
  let prevEval = null;
  for (let i = 0; i < moves.length; i++) {
    if (isCancelled()) return null;
    const mv = moves[i];
    if (mv.color !== me) {
      board.move(mv.san);
      prevEval = null;
      continue;
    }
    const before = prevEval !== null ? prevEval : await evalFor(engine, board, me, depth);
    const fenBefore = board.fen();
    board.move(mv.san);
    const after = await evalFor(engine, board, me, depth);
    prevEval = null;
    if (before - after >= 200 && before > -300) {
      return {
        ply: i + 1,
        fen: fenBefore,
        played: mv.san,
        playedUci: mv.from + mv.to + (mv.promotion || ""),
        lastmove: i > 0 ? moves[i - 1].from + moves[i - 1].to : null,
        moveno: +fenBefore.split(" ")[5],
        before,
        after,
      };
    }
  }
  return null;
}

export function mv(uci) {
  const o = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
  if (uci[4]) o.promotion = uci[4];
  return o;
}

function san(fen, uci) {
  const c = new Chess(fen);
  const m = c.move(mv(uci));
  return { san: m.san, fen: c.fen(), capture: !!m.captured, check: c.inCheck(), mate: c.isCheckmate(), c };
}

export async function buildPuzzle(engine, game, d, depth) {
  const me = game.me;
  const pov = (fen, s) => (fen.split(" ")[1] === me ? s : -s);
  const steps = [];
  const sanLine = [];
  let fen = d.fen;
  let evalBest = null;
  for (let step = 0; step < 3; step++) {
    const { infos } = await engine.analyse(fen, depth, 4);
    if (!infos.length || !infos[0].pv.length) break;
    const scores = infos.map((i) => pov(fen, scoreOf(i)));
    const best = scores[0];
    if (evalBest === null) evalBest = best;
    const tol = Math.abs(best) < 3000 ? 60 : 2000;
    let accept = infos.filter((_, k) => scores[k] >= best - tol && scores[k] > -150).map((i) => i.pv[0]);
    if (!accept.length) accept = [infos[0].pv[0]];
    const bestMv = infos[0].pv[0];
    const second = scores.length > 1 ? scores[1] : -999999;
    const inCheck = new Chess(fen).inCheck();
    const bm = san(fen, bestMv);
    const forcing = best - second >= 150 || inCheck || bm.capture || bm.check;
    if (step > 0 && !forcing) break;
    sanLine.push(bm.san);
    fen = bm.fen;
    let reply = null;
    if (!bm.c.isGameOver()) {
      const r = await engine.analyse(fen, depth, 1);
      reply = r.infos[0] && r.infos[0].pv[0] ? r.infos[0].pv[0] : r.best;
    }
    steps.push({ accept, best: bestMv, reply });
    if (!reply) break;
    const rm = san(fen, reply);
    sanLine.push(rm.san);
    fen = rm.fen;
    if (rm.c.isGameOver()) break;
  }
  // what happens after the move actually played
  const p = san(d.fen, d.playedUci);
  let refline = [], evalPlayed = d.after;
  if (!p.c.isGameOver()) {
    const r = await engine.analyse(p.fen, depth, 1);
    if (r.infos[0]) {
      evalPlayed = pov(p.fen, scoreOf(r.infos[0]));
      const c = new Chess(p.fen);
      for (const u of r.infos[0].pv.slice(0, 3)) {
        try {
          const m = c.move(mv(u));
          refline.push(m.san);
        } catch (_) {
          break;
        }
      }
    }
  }
  if (steps.length && steps[0].accept.some((a) => a.slice(0, 4) === d.playedUci.slice(0, 4))) steps.length = 0;
  const theme = [];
  if (refline[0] && refline[0].includes("x")) theme.push("기물 흘림");
  if (evalBest > 300 && evalPlayed < 100) theme.push("이기던 판 놓침");
  if (Math.abs(evalBest) >= 90000 || sanLine.some((s) => s.includes("#"))) theme.push("메이트 있음");
  if (sanLine[0] && sanLine[0].includes("x")) theme.push("잡을 수 있었음");
  if (d.ply <= 20) theme.push("오프닝");
  if (new Chess(d.fen).inCheck()) theme.push("체크 대응");
  if (!theme.length) theme.push("포지션");
  return {
    id: game.link || `${game.ts}-${d.ply}`,
    link: game.link,
    date: new Date(game.ts).toISOString().slice(0, 10).replace(/-/g, "."),
    opp: me === "w" ? game.black : game.white,
    fen: d.fen,
    me,
    moveno: d.moveno,
    played: d.played,
    played_uci: d.playedUci,
    refline,
    steps,
    san_line: sanLine,
    eval_best: evalBest ?? 0,
    eval_played: evalPlayed,
    theme,
    lastmove: d.lastmove,
    ply: d.ply,
  };
}

// Simple report: results, losing streaks within a session, early collapses.
export function buildReport(games, puzzles) {
  const chrono = [...games].sort((a, b) => a.ts - b.ts);
  const count = (arr, r) => arr.filter((g) => g.res === r).length;
  const total = { n: chrono.length, W: count(chrono, "W"), D: count(chrono, "D"), L: count(chrono, "L") };
  // sessions: a gap of more than an hour starts a new one
  const rows = [];
  let streak = 0, prevTs = null;
  for (const g of chrono) {
    if (prevTs !== null && g.ts - prevTs > 3600 * 1000) streak = 0;
    rows.push({ streak, res: g.res });
    streak = g.res === "L" ? streak + 1 : 0;
    prevTs = g.ts;
  }
  const bucket = (f) => {
    const rs = rows.filter((r) => f(r.streak));
    return { n: rs.length, L: rs.filter((r) => r.res === "L").length, W: rs.filter((r) => r.res === "W").length };
  };
  const fresh = bucket((k) => k === 0);
  const after2 = bucket((k) => k >= 2);
  let longest = 0, cur = 0;
  for (const g of chrono) { cur = g.res === "L" ? cur + 1 : 0; longest = Math.max(longest, cur); }
  const early = puzzles.filter((p) => p.ply <= 20).length;
  const thrown = puzzles.filter((p) => p.theme.includes("이기던 판 놓침")).length;
  const hung = puzzles.filter((p) => p.theme.includes("기물 흘림")).length;
  const missed = puzzles.filter((p) => p.theme.includes("잡을 수 있었음")).length;
  return { total, fresh, after2, longest, early, thrown, hung, missed, nPuz: puzzles.length };
}

export { VAL };
