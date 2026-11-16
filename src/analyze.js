// 체스 오답노트 — Copyright (C) 2026 Katherine Nahm
// SPDX-License-Identifier: GPL-3.0-or-later
// Finds the move that decided each lost game and turns the position before it into a puzzle.
import { Chess } from "../vendor/chess.js";
import { scoreOf } from "./engine.js";

// Bump whenever findDecisiveMove/buildPuzzle (or the game fields they read) change what gets stored:
// games analysed by an older generator are analysed again on the next run.
export const GEN = 2;

const CLAMP = 1000;
const clamp = (v) => Math.max(-CLAMP, Math.min(CLAMP, v));
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
// Lichess's centipawn -> win-chance curve (0-100).
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamp(cp))) - 1);
const sameMove = (a, b) => a.slice(0, 4) === b.slice(0, 4) && (a[4] || "") === (b[4] || "");
// Close enough to the best move to accept: within 60 cp or 4 points of win chance (so +7 is fine when
// +9 was best), any mate when a mate is on, and only the engine's defence when I am being mated.
const near = (s, best) => (Math.abs(best) >= 3000 ? s >= best - 2000 : s >= best - 60 || winPct(best) - winPct(s) < 4);
const acceptable = (s, best) => near(s, best) && (Math.abs(best) < 3000 || s > -150);

// Eval of a position from `me`'s point of view, clamped.
async function evalFor(engine, chess, me, depth) {
  if (chess.isCheckmate()) return chess.turn() === me ? -CLAMP : CLAMP;
  // only draws that end the game by themselves: threefold and the 50-move rule have to be claimed,
  // and a lost game that went on past one was not drawn
  if (chess.isStalemate() || chess.isInsufficientMaterial()) return 0;
  const { infos } = await engine.analyse(chess.fen(), depth, 1);
  const s = scoreOf(infos[0]);
  return clamp(chess.turn() === me ? s : -s);
}

// Stockfish 19 quits on some positions chess.js accepts (more than 8 pawns or too many promoted
// pieces, the side not to move in check). Only a [FEN] start can be like that: legal moves never are.
export function engineUnsupported(fen) {
  const c = new Chess(fen);
  for (const color of ["w", "b"]) {
    const n = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
    for (const row of c.board()) for (const sq of row) if (sq && sq.color === color) n[sq.type]++;
    const promoted = Math.max(0, n.q - 1) + Math.max(0, n.r - 2) + Math.max(0, n.b - 2) + Math.max(0, n.n - 2);
    if (n.p > 8 || n.p + promoted > 8) return true;
  }
  const them = c.turn() === "w" ? "b" : "w";
  const king = c.findPiece({ type: "k", color: them })[0];
  return !king || c.isAttacked(king, c.turn());
}

// Walks a lost game until the first move of mine (at or after move index `from`) that drops >= 2 pawns
// from a not-yet-lost position and gives the advantage away (a slip from +9 to +7 is not decisive).
export async function findDecisiveMove(engine, game, depth, isCancelled, from = 0) {
  const c = new Chess();
  c.loadPgn(game.pgn);
  const moves = c.history({ verbose: true });
  if (moves.length && engineUnsupported(moves[0].before)) return null;
  const me = game.me;
  const board = new Chess(moves.length ? moves[0].before : undefined);
  for (let i = 0; i < moves.length; i++) {
    if (isCancelled()) return null;
    const mv = moves[i];
    if (mv.color !== me || i < from) {
      board.move(mv.san);
      continue;
    }
    const before = await evalFor(engine, board, me, depth);
    const fenBefore = board.fen();
    board.move(mv.san);
    const after = await evalFor(engine, board, me, depth);
    if (before - after >= 200 && before > -300 && after < 100) {
      const moveno = +fenBefore.split(" ")[5];
      return {
        next: i + 1, // where to resume if this candidate does not make a puzzle
        ply: (moveno - 1) * 2 + (me === "w" ? 1 : 2), // absolute ply, also right for [FEN] starts
        fen: fenBefore,
        played: mv.san,
        playedUci: mv.from + mv.to + (mv.promotion || ""),
        lastmove: i > 0 ? moves[i - 1].from + moves[i - 1].to : null,
        moveno,
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

// Root moves of `fen` with scores from `me`'s side, best first. MultiPV 4, paged with searchmoves while
// the last line of a page is still acceptable, so equally good 5th, 6th... moves are not graded wrong.
async function rootLines(engine, fen, depth, me, exclude) {
  const sign = fen.split(" ")[1] === me ? 1 : -1;
  const legal = new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ""));
  const pool = exclude ? legal.filter((u) => !sameMove(u, exclude)) : legal;
  const out = [];
  while (out.length < pool.length) {
    const rest = pool.filter((u) => !out.some((l) => l.move === u));
    const { infos } = await engine.analyse(fen, depth, 4, rest.length < legal.length ? rest : null);
    const page = infos.filter((i) => i.pv.length && rest.includes(i.pv[0]));
    if (!page.length) break;
    for (const i of page) out.push({ move: i.pv[0], s: sign * scoreOf(i) });
    out.sort((a, b) => b.s - a.s);
    const worst = Math.min(...page.map((i) => sign * scoreOf(i)));
    if (page.length < 4 || !acceptable(worst, out[0].s)) break;
  }
  return out;
}

// Score of playing `uci` in `fen`, from `me`'s side, measured by searching the position after it.
async function childScore(engine, fen, uci, depth, me) {
  const c = new Chess(fen);
  c.move(mv(uci));
  if (c.isCheckmate()) return c.turn() === me ? -100000 : 100000;
  if (c.isStalemate() || c.isInsufficientMaterial()) return 0;
  const { infos } = await engine.analyse(c.fen(), depth, 1);
  if (!infos[0]) return 0;
  const s = scoreOf(infos[0]);
  return c.turn() === me ? s : -s;
}

// The refutation wins a non-pawn piece outright (not a recapture of my own capture, not an even trade)
// and the material is not won back within the next two plies.
export function hungPiece(fen, playedUci, refline) {
  if (!refline || !refline[0]) return false;
  try {
    const c = new Chess(fen);
    const played = c.move(mv(playedUci));
    const me = played.color;
    const take = c.move(refline[0]);
    if (!take.captured || take.captured === "p") return false;
    if (played.captured && played.to === take.to && VAL[played.captured] >= VAL[take.captured]) return false;
    if (VAL[take.piece] >= VAL[take.captured] && c.moves({ verbose: true }).some((x) => x.to === take.to)) return false;
    const bal = () => c.board().flat().reduce((s, q) => s + (q ? (q.color === me ? 1 : -1) * VAL[q.type] : 0), 0);
    const won = bal();
    for (const s of refline.slice(1)) c.move(s);
    return bal() <= won;
  } catch (_) {
    return false;
  }
}

const pad2 = (n) => String(n).padStart(2, "0");
// Calendar day in the viewer's time zone, kept sortable as YYYY.MM.DD.
function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

export async function buildPuzzle(engine, game, d, depth) {
  const me = game.me;
  const pov = (fen, s) => (fen.split(" ")[1] === me ? s : -s);
  const steps = [];
  const sanLine = [];
  let fen = d.fen;
  let evalBest = null;
  let mating = false; // I have a forced mate: play it out (up to 6 moves) instead of stopping at 3
  for (let step = 0; step < (mating ? 6 : 3); step++) {
    // the move actually played is never a candidate: the puzzle asks for something better
    let lines = await rootLines(engine, fen, depth, me, step === 0 ? d.playedUci : null);
    if (!lines.length) break;
    if (step === 0) {
      // MultiPV root scores can miss a refutation that a search of the position after the move finds;
      // the played move is measured that way below, so measure its alternatives the same way.
      const top = lines.slice(0, 4);
      for (const l of top) l.s = await childScore(engine, fen, l.move, depth, me);
      lines = top.sort((a, b) => b.s - a.s).concat(lines.slice(4));
    }
    const best = lines[0].s;
    if (evalBest === null) evalBest = best;
    mating = best >= 90000;
    // after the first move of a mate, only the fastest mates
    let accept = lines.filter((l) => (mating && step > 0 ? l.s >= best : acceptable(l.s, best))).map((l) => l.move);
    if (!accept.length) accept = [lines[0].move];
    const bestMv = lines[0].move;
    const second = lines.length > 1 ? lines[1].s : -999999;
    const inCheck = new Chess(fen).inCheck();
    const bm = san(fen, bestMv);
    const forcing = mating || best - second >= 150 || inCheck || bm.capture || bm.check;
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
  // Keep the puzzle only if this deeper search agrees with the detector: the best alternative beats the
  // move played by 2+ pawns, the position was not already lost, and the move played gave the edge away.
  if (evalBest === null || clamp(evalBest) - clamp(evalPlayed) < 200 || clamp(evalBest) <= -300 || clamp(evalPlayed) >= 100)
    steps.length = 0;
  const theme = [];
  if (Math.abs(evalPlayed) < 90000 && hungPiece(d.fen, d.playedUci, refline)) theme.push("기물 흘림");
  if (evalBest > 300 && evalPlayed < 100) theme.push("이기던 판 놓침");
  // "had a mate" is about my moves only (even indexes of the line), not a mate against me
  if (evalBest >= 90000 || sanLine.some((s, i) => i % 2 === 0 && s.endsWith("#"))) theme.push("메이트 있음");
  if (sanLine[0] && sanLine[0].includes("x")) theme.push("잡을 수 있었음");
  if (d.ply <= 20) theme.push("오프닝");
  if (new Chess(d.fen).inCheck()) theme.push("체크 대응");
  if (!theme.length) theme.push("포지션");
  return {
    id: game.key || game.link || `${game.ts}-${d.ply}`,
    link: game.link,
    date: game.ts > 0 ? game.day || localDay(game.ts) : "?",
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
  // sessions: a gap of more than an hour starts a new one; a game with no known date breaks the chain
  const rows = [];
  let streak = 0, prevTs = null;
  for (const g of chrono) {
    if (!(g.ts > 0)) { streak = 0; prevTs = null; continue; }
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
  // move number, not ply: right for [FEN] starts and for puzzles saved by older versions
  const early = puzzles.filter((p) => p.moveno <= 10).length;
  const thrown = puzzles.filter((p) => p.theme.includes("이기던 판 놓침")).length;
  const hung = puzzles.filter((p) => p.theme.includes("기물 흘림")).length;
  const missed = puzzles.filter((p) => p.theme.includes("잡을 수 있었음")).length;
  return { total, fresh, after2, longest, early, thrown, hung, missed, nPuz: puzzles.length };
}

export { VAL };
