// 체스 오답노트 — Copyright (C) 2026 Katherine Nahm
// SPDX-License-Identifier: GPL-3.0-or-later
// Stockfish (WASM, lite single-threaded) wrapper.
// Every call returns the final "info" line for each multipv slot, scored from the side to move.

// No output at all for this long means the worker hung. Every engine line re-arms the timer, so a
// slow phone that is still searching is never cut off (a fixed wall-clock limit used to do that).
const WATCHDOG_MS = 60000;

export class Engine {
  constructor(url = "vendor/stockfish-19-lite-single.js") {
    this.worker = new Worker(url);
    this.queue = [];
    this.current = null;
    this.dead = null;
    this.critical = null;
    this.ready = new Promise((resolve, reject) => {
      this._onReady = resolve;
      this._readyFail = reject;
      setTimeout(() => {
        if (this._onReady) this._fail(new Error("timeout 30s"));
      }, 30000);
    });
    this.worker.onmessage = (e) => this._line(typeof e.data === "string" ? e.data : String(e.data));
    // Stockfish 19 prints "info string CRITICAL ERROR ..." and exits on a position it does not support.
    // Keep that reason, so the caller can skip the game and start a new engine instead of giving up.
    this.worker.onerror = (e) => this._fail(this.critical
      ? Object.assign(new Error(this.critical), { badPosition: true })
      : new Error("engine error: " + (e.message || "unknown")));
    this.worker.postMessage("uci");
    this.worker.postMessage("setoption name Hash value 32");
    this.worker.postMessage("isready");
  }

  _fail(err) {
    if (this.dead) return;
    this.dead = err;
    if (this._readyFail) this._readyFail(err);
    this._onReady = null;
    if (this.current) { clearTimeout(this.current.timer); this.current.reject(err); }
    this.queue.forEach((j) => j.reject(err));
    this.queue = [];
    this.current = null;
    try { this.worker.terminate(); } catch (_) {}
  }

  _arm(job) {
    clearTimeout(job.timer);
    const due = Date.now() + WATCHDOG_MS;
    job.timer = setTimeout(() => {
      // a timer that fires far too late means the page was frozen or throttled, not the engine
      if (Date.now() - due > 5000) this._arm(job);
      else this._fail(new Error("no response"));
    }, WATCHDOG_MS);
  }

  _line(line) {
    if (line === "readyok" && this._onReady) {
      this._onReady();
      this._onReady = null;
      this._next();
      return;
    }
    if (line.startsWith("info string CRITICAL ERROR")) { this.critical = line.slice(12); return; }
    const job = this.current;
    if (!job) return;
    this._arm(job);
    if (job.newGame) {
      if (line === "readyok") { clearTimeout(job.timer); this.current = null; job.resolve(); this._next(); }
      return;
    }
    if (line.startsWith("info ") && line.includes(" pv ") && line.includes(" score ")) {
      const t = line.split(" ");
      const get = (k) => t[t.indexOf(k) + 1];
      const mpv = t.includes("multipv") ? +get("multipv") : 1;
      const si = t.indexOf("score");
      const kind = t[si + 1];
      const val = +t[si + 2];
      const pv = t.slice(t.indexOf("pv") + 1);
      job.infos[mpv] = { kind, val, pv, depth: +get("depth") };
    } else if (line.startsWith("bestmove")) {
      const best = line.split(" ")[1];
      const infos = Object.keys(job.infos)
        .map(Number)
        .sort((a, b) => a - b)
        .map((k) => job.infos[k]);
      clearTimeout(job.timer);
      this.current = null;
      if (job.cancelled) job.reject(job.cancelled);
      else job.resolve({ infos, best: best && best !== "(none)" ? best : null });
      this._next();
    }
  }

  _next() {
    if (this.current || this._onReady || this.dead || !this.queue.length) return;
    const job = (this.current = this.queue.shift());
    this._arm(job);
    if (job.newGame) {
      this.worker.postMessage("ucinewgame");
      this.worker.postMessage("isready");
      return;
    }
    this.worker.postMessage(`setoption name MultiPV value ${job.multipv}`);
    this.worker.postMessage(`position fen ${job.fen}`);
    this.worker.postMessage(`go depth ${job.depth}` + (job.searchmoves ? ` searchmoves ${job.searchmoves.join(" ")}` : ""));
  }

  // searchmoves (UCI moves) limits the search to those root moves.
  analyse(fen, depth, multipv = 1, searchmoves = null) {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, depth, multipv, searchmoves, resolve, reject, infos: {} });
      this._next();
    });
  }

  // Forget the hash and history tables of the previous game, so a game is analysed the same way
  // whatever was analysed before it.
  newGame() {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => {
      this.queue.push({ newGame: true, resolve, reject });
      this._next();
    });
  }

  // Drops queued work and ends the running search early; their promises reject with `cancelled`.
  cancel() {
    const err = Object.assign(new Error("cancelled"), { cancelled: true });
    this.queue.forEach((j) => j.reject(err));
    this.queue = [];
    if (this.current && !this.dead && !this.current.newGame) {
      this.current.cancelled = err;
      this.worker.postMessage("stop");
    }
  }

  // Releases the worker; anything pending rejects.
  stop() {
    this._fail(new Error("stopped"));
  }
}

// Score of an engine line in centipawns from the side to move. Mates map to +-100000.
export function scoreOf(info) {
  if (!info) return 0;
  if (info.kind === "mate") {
    const m = info.val;
    if (m === 0) return -100000;
    return m > 0 ? 100000 - Math.abs(m) * 100 : -100000 + Math.abs(m) * 100;
  }
  return info.val;
}
