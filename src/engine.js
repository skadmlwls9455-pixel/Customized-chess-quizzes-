// Stockfish (WASM, lite single-threaded) wrapper.
// Every call returns the final "info" line for each multipv slot, scored from the side to move.

export class Engine {
  constructor(url = "vendor/stockfish-19-lite-single.js") {
    this.worker = new Worker(url);
    this.queue = [];
    this.current = null;
    this.dead = null;
    this.ready = new Promise((resolve, reject) => {
      this._onReady = resolve;
      this._readyFail = reject;
      setTimeout(() => {
        if (this._onReady) this._fail(new Error("엔진이 30초 안에 켜지지 않았어"));
      }, 30000);
    });
    this.worker.onmessage = (e) => this._line(typeof e.data === "string" ? e.data : String(e.data));
    this.worker.onerror = (e) => this._fail(new Error("엔진 오류: " + (e.message || "unknown")));
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

  _line(line) {
    if (line === "readyok" && this._onReady) {
      this._onReady();
      this._onReady = null;
      this._next();
      return;
    }
    const job = this.current;
    if (!job) return;
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
      job.resolve({ infos, best: best && best !== "(none)" ? best : null });
      this._next();
    }
  }

  _next() {
    if (this.current || this._onReady || !this.queue.length) return;
    const job = (this.current = this.queue.shift());
    this.worker.postMessage(`setoption name MultiPV value ${job.multipv}`);
    this.worker.postMessage(`position fen ${job.fen}`);
    this.worker.postMessage(`go depth ${job.depth}`);
    // watchdog: ask for a move after 20s, give up after 40s
    job.timer = setTimeout(() => {
      this.worker.postMessage("stop");
      job.timer = setTimeout(() => this._fail(new Error("엔진이 응답하지 않아")), 20000);
    }, 20000);
  }

  analyse(fen, depth, multipv = 1) {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, depth, multipv, resolve, reject, infos: {} });
      this._next();
    });
  }

  stop() {
    this.queue = [];
    try {
      this.worker.terminate();
    } catch (_) {}
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
