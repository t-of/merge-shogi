'use strict';
// merge-shogi の遊ぶ部分（画面に依存しない）。ブラウザでは MS として、Node では require で使う。
//
// 盤は小マス 81 個（index = 段*9 + 列、段 0 = 1 段目、列 0 = 先手から見て左端 = 9 筋）。
// 先手（☗）は盤の下側から上へ（段が減る方向へ）進む。後手（☖）はその逆。
// 駒は「マス（大きいマスなら 1 つ）」に置く。マスの id は、その中で最小の小マスの index
// （つながっていない普通のマスは、小マスの index そのまま）。
// 駒は文字で持つ。大文字 = 先手、小文字 = 後手。
//   K 玉  R 飛  B 角  G 金  S 銀  N 桂  L 香  P 歩
//   D 竜  H 馬  A 全（成銀）  M 圭（成桂）  Q 杏（成香）  T と
(function (root) {
  const N = 9;
  const KANJI_NUM = '一二三四五六七八九';
  const rowOf = (s) => Math.floor(s / N);
  const colOf = (s) => s % N;
  const isSente = (p) => p === p.toUpperCase();
  const colorOf = (p) => (isSente(p) ? 's' : 'g');
  const other = (c) => (c === 's' ? 'g' : 's');
  const HAND_TYPES = 'RBGSNLP';
  const PROMOTE = { R: 'D', B: 'H', S: 'A', N: 'M', L: 'Q', P: 'T' };
  const DEMOTE = { D: 'R', H: 'B', A: 'S', M: 'N', Q: 'L', T: 'P' };
  const NAME_S = { K: '王', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩', D: '竜', H: '馬', A: '全', M: '圭', Q: '杏', T: 'と' };
  const pieceName = (p) => (p === 'k' ? '玉' : NAME_S[p.toUpperCase()]);

  // 小マスの名前（7六 など）。筋は列 0 = 9 筋。
  const sqName = (s) => (N - colOf(s)) + KANJI_NUM[rowOf(s)];

  // ---- 地形 ----

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // rects: [{r0,c0,r1,c1}]（両端を含む）から地形を作る。
  function makeTerrain(rects, seed) {
    const cellOf = new Array(N * N);
    for (let s = 0; s < N * N; s++) cellOf[s] = s;
    const cells = new Array(N * N);
    for (const q of rects) {
      const squares = [];
      for (let r = q.r0; r <= q.r1; r++) for (let c = q.c0; c <= q.c1; c++) squares.push(r * N + c);
      const id = Math.min(...squares);
      for (const s of squares) cellOf[s] = id;
      cells[id] = { id, squares, r0: q.r0, c0: q.c0, r1: q.r1, c1: q.c1, merged: true };
    }
    const cellIds = [];
    for (let s = 0; s < N * N; s++) {
      if (cellOf[s] !== s) continue;
      if (!cells[s]) cells[s] = { id: s, squares: [s], r0: rowOf(s), c0: colOf(s), r1: rowOf(s), c1: colOf(s), merged: false };
      cellIds.push(s);
    }
    return { seed: seed == null ? null : seed, rects, cellOf, cells, cellIds };
  }

  // [幅, 高さ]。初期配置で駒のないマスに収まる長方形すべて（1×1 を除く）。高さは 4〜6 段目の 3 まで。
  // 大きい形ほど盤を大きく変えるので、面積の 2 乗に反比例する重みで選ぶ
  const SHAPES = [];
  for (let w = 1; w <= 9; w++) for (let h = 1; h <= 3; h++) if (w * h > 1) SHAPES.push([w, h]);
  const SHAPE_W = SHAPES.map(([w, h]) => 1 / (w * h) ** 2);
  const SHAPE_SUM = SHAPE_W.reduce((x, y) => x + y, 0);
  function pickShape(rnd) {
    let x = rnd() * SHAPE_SUM;
    for (let i = 0; i < SHAPES.length; i++) { x -= SHAPE_W[i]; if (x < 0) return SHAPES[i]; }
    return SHAPES[SHAPES.length - 1];
  }

  // 形は初期配置で駒のないマス（4〜6 段目と、二段目・八段目の空き）に置く。
  // 盤の中心で 180° 回転した位置にも同じ形を置く。1〜5 組。
  function generateTerrain(seed) {
    const rnd = mulberry32(seed);
    const occ = new Array(N * N).fill(false);
    const rects = [];
    const target = 1 + Math.floor(rnd() * 5);
    let groups = 0;
    const squaresOf = (q) => {
      const a = [];
      for (let r = q.r0; r <= q.r1; r++) for (let c = q.c0; c <= q.c1; c++) a.push(r * N + c);
      return a;
    };
    const start = initialState().board;
    for (let attempt = 0; attempt < 200 && groups < target; attempt++) {
      const [w, h] = pickShape(rnd);
      const c0 = Math.floor(rnd() * (N + 1 - w));
      const r0 = 1 + Math.floor(rnd() * (8 - h));
      const a = { r0, c0, r1: r0 + h - 1, c1: c0 + w - 1 };
      const b = { r0: 8 - a.r1, r1: 8 - a.r0, c0: 8 - a.c1, c1: 8 - a.c0 };
      const self = a.r0 === b.r0 && a.c0 === b.c0 && a.r1 === b.r1 && a.c1 === b.c1;
      const list = self ? [a] : [a, b];
      const sq = list.map(squaresOf);
      if (sq[0].some((s) => start[s])) continue; // 初期配置の駒と重なる（回転した側も対称なので同じ）
      if (!self && sq[0].some((s) => sq[1].includes(s))) continue; // 回転した形が元と重なる
      if (sq.some((l) => l.some((s) => occ[s]))) continue;
      sq.forEach((l) => l.forEach((s) => { occ[s] = true; }));
      list.forEach((q) => rects.push(q));
      groups++;
    }
    return makeTerrain(rects, seed);
  }

  // マスの名前。つながったマスは「左上:右下」（先手から見て）。
  function cellLabel(T, id) {
    const c = T.cells[id];
    return c.merged ? sqName(c.r0 * N + c.c0) + ':' + sqName(c.r1 * N + c.c1) : sqName(id);
  }

  // ---- 局面 ----

  const emptyHand = () => ({ R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 });

  function initialState() {
    const board = new Array(N * N).fill(null);
    const back = 'LNSGKGSNL';
    for (let c = 0; c < N; c++) {
      board[c] = back[c].toLowerCase();
      board[6 * N + c] = 'P';
      board[2 * N + c] = 'p';
      board[8 * N + c] = back[c];
    }
    board[1 * N + 1] = 'r'; board[1 * N + 7] = 'b';
    board[7 * N + 1] = 'B'; board[7 * N + 7] = 'R';
    return { board, hands: { s: emptyHand(), g: emptyHand() }, turn: 's', ply: 0 };
  }

  // 先手から見た動き。steps = 1 歩ずつ、slides = 走り。後手は点対称にして使う。
  const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const GOLD = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]];
  const MOVES = {
    K: { steps: ORTH.concat(DIAG), slides: [] },
    R: { steps: [], slides: ORTH },
    B: { steps: [], slides: DIAG },
    G: { steps: GOLD, slides: [] },
    S: { steps: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 1]], slides: [] },
    N: { steps: [[-2, -1], [-2, 1]], slides: [] },
    L: { steps: [], slides: [[-1, 0]] },
    P: { steps: [[-1, 0]], slides: [] },
    D: { steps: DIAG, slides: ORTH },
    H: { steps: ORTH, slides: DIAG },
    A: { steps: GOLD, slides: [] },
    M: { steps: GOLD, slides: [] },
    Q: { steps: GOLD, slides: [] },
    T: { steps: GOLD, slides: [] },
  };
  const inB = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  // 敵陣（相手側の 3 段）。二段目・八段目の大きいマスは高さ 1 なので、その段で判定すればよい。
  const inZone = (color, r) => (color === 's' ? r <= 2 : r >= 6);
  // 行き所のない段か（歩・香は最奥、桂は奥 2 段）
  function deadRank(color, type, r) {
    const d = color === 's' ? r : 8 - r; // 相手側の端からの距離
    return ((type === 'P' || type === 'L') && d === 0) || (type === 'N' && d <= 1);
  }

  // 擬似合法手（王の安全は見ない）。forCheck のときは王手の判定用に、成り分けも打つ手も作らない。
  function pseudo(st, T, color, forCheck) {
    const board = st.board;
    const out = new Map();
    const sign = color === 's' ? 1 : -1;
    for (const id of T.cellIds) {
      const p = board[id];
      if (!p || colorOf(p) !== color) continue;
      const type = p.toUpperCase();
      const def = MOVES[type];
      const fromRow = T.cells[id].r0;
      const emit = (tc, q) => {
        const base = { from: id, to: tc, capture: !!q };
        if (forCheck) { out.set(id + '-' + tc, base); return; }
        const toRow = T.cells[tc].r0;
        const canPromo = PROMOTE[type] && (inZone(color, fromRow) || inZone(color, toRow));
        if (canPromo) {
          if (!deadRank(color, type, toRow)) out.set(id + '-' + tc + '-n', Object.assign({ promo: false, opt: true }, base));
          out.set(id + '-' + tc + '-p', Object.assign({ promo: true, opt: !deadRank(color, type, toRow) }, base));
        } else out.set(id + '-' + tc, Object.assign({ promo: false, opt: false }, base));
      };
      for (const s of T.cells[id].squares) {
        const r0 = rowOf(s), c0 = colOf(s);
        for (const [dr, dc] of def.steps) {
          const r = r0 + dr * sign, c = c0 + dc * sign;
          if (!inB(r, c)) continue;
          const tc = T.cellOf[r * N + c];
          if (tc === id) continue;
          const q = board[tc];
          if (q && colorOf(q) === color) continue;
          emit(tc, q);
        }
        for (const [dr, dc] of def.slides) {
          let r = r0 + dr * sign, c = c0 + dc * sign;
          while (inB(r, c)) {
            const tc = T.cellOf[r * N + c];
            if (tc !== id) {
              const q = board[tc];
              if (!q) emit(tc, null);
              else {
                if (colorOf(q) !== color) emit(tc, q);
                break;
              }
            }
            r += dr * sign; c += dc * sign;
          }
        }
      }
    }
    return [...out.values()];
  }

  // 打つ手（二歩・行き所のない段は除く。打ち歩詰めは legalMoves で見る）。
  function dropMoves(st, T, color) {
    const hand = st.hands[color];
    const out = [];
    const pawnCols = new Set();
    for (const id of T.cellIds) {
      if (st.board[id] === (color === 's' ? 'P' : 'p')) {
        const cell = T.cells[id];
        for (let c = cell.c0; c <= cell.c1; c++) pawnCols.add(c); // 大きいマスの歩は、含むすべての筋にいる扱い
      }
    }
    for (const type of HAND_TYPES) {
      if (!hand[type]) continue;
      for (const id of T.cellIds) {
        if (st.board[id]) continue;
        const cell = T.cells[id];
        if (deadRank(color, type, cell.r0)) continue;
        if (type === 'P') {
          let dup = false;
          for (let c = cell.c0; c <= cell.c1; c++) if (pawnCols.has(c)) dup = true;
          if (dup) continue;
        }
        out.push({ from: null, drop: type, to: id, capture: false, promo: false, opt: false });
      }
    }
    return out;
  }

  function kingCell(st, color) {
    return st.board.indexOf(color === 's' ? 'K' : 'k');
  }

  function inCheck(st, T, color) {
    const k = kingCell(st, color);
    return k >= 0 && pseudo(st, T, other(color), true).some((m) => m.to === k);
  }

  function applyMove(st, T, m) {
    const board = st.board.slice();
    const hands = { s: Object.assign({}, st.hands.s), g: Object.assign({}, st.hands.g) };
    const color = st.turn;
    if (m.drop) {
      board[m.to] = color === 's' ? m.drop : m.drop.toLowerCase();
      hands[color][m.drop]--;
    } else {
      let p = board[m.from];
      const q = board[m.to];
      if (q) {
        const t = q.toUpperCase();
        hands[color][DEMOTE[t] || t]++;
      }
      board[m.from] = null;
      if (m.promo) {
        const t = PROMOTE[p.toUpperCase()];
        p = color === 's' ? t : t.toLowerCase();
      }
      board[m.to] = p;
    }
    return { board, hands, turn: other(color), ply: st.ply + 1 };
  }

  // opts.noUchi: 打ち歩詰めの判定の中で「指せる手があるか」を調べるときに使う。
  function legalMoves(st, T, opts) {
    const color = st.turn;
    const moves = pseudo(st, T, color, false).concat(dropMoves(st, T, color));
    const out = [];
    for (const m of moves) {
      const ns = applyMove(st, T, m);
      if (inCheck(ns, T, color)) continue;
      if (m.drop === 'P' && !(opts && opts.noUchi) && inCheck(ns, T, other(color)) && legalMoves(ns, T, { noUchi: true }).length === 0) continue; // 打ち歩詰め
      out.push(m);
    }
    return out;
  }

  // 同じ局面かどうかの鍵（盤・持ち駒・手番）。
  function positionKey(st) {
    let h = '';
    for (const c of ['s', 'g']) for (const t of HAND_TYPES) h += st.hands[c][t];
    return st.board.map((p) => p || '.').join('') + h + st.turn;
  }

  // keys: これまでの局面の鍵（いまの局面を含む）。checks[i]: i 手目で王手がかかったか。
  function evaluate(st, T, keys, checks) {
    const moves = legalMoves(st, T);
    const check = inCheck(st, T, st.turn);
    let result = null;
    if (!moves.length) {
      result = { winner: other(st.turn), reason: '詰み' };
    } else if (keys && keys.length) {
      const cur = keys[keys.length - 1];
      const idx = [];
      keys.forEach((k, i) => { if (k === cur) idx.push(i); });
      if (idx.length >= 4) {
        const i1 = idx[idx.length - 4], i4 = idx[idx.length - 1];
        let allA = true, allB = true; // A = 最後に指した側、B = いま指す側
        for (let j = i4; j > i1; j -= 2) if (!checks[j]) allA = false;
        for (let j = i4 - 1; j > i1; j -= 2) if (!checks[j]) allB = false;
        if (allA && !allB) result = { winner: st.turn, reason: '千日手（連続王手をかけ続けた側の負け）' };
        else if (allB && !allA) result = { winner: other(st.turn), reason: '千日手（連続王手をかけ続けた側の負け）' };
        else result = { winner: null, reason: '千日手（同一局面4回）' };
      }
    }
    return { moves, check, result };
  }

  // 棋譜の 1 手分（王手の記号は付けない）。例: ☗7六歩(7七)、☖5五角打、☗2二角成(8八)
  function notation(st, T, m) {
    const mark = st.turn === 's' ? '☗' : '☖';
    if (m.drop) return mark + cellLabel(T, m.to) + NAME_S[m.drop] + '打';
    const p = st.board[m.from];
    return mark + cellLabel(T, m.to) + NAME_S[p.toUpperCase()] + (m.promo ? '成' : m.opt ? '不成' : '') + '(' + cellLabel(T, m.from) + ')';
  }

  function perft(st, T, depth) {
    if (depth === 0) return 1;
    const ms = legalMoves(st, T);
    if (depth === 1) return ms.length;
    let n = 0;
    for (const m of ms) n += perft(applyMove(st, T, m), T, depth - 1);
    return n;
  }

  const api = { N, HAND_TYPES, pieceName, sqName, cellLabel, makeTerrain, generateTerrain, initialState, legalMoves, applyMove, inCheck, positionKey, evaluate, notation, colorOf, other, mulberry32, perft, PROMOTE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MS = api;
})(typeof self !== 'undefined' ? self : this);
