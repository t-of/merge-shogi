'use strict';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'merge-shogi.' で始める。
const STORE = 'merge-shogi.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'merge-shogi', text: '中央のマスがところどころ長方形につながった盤で遊ぶ、2人対戦の将棋' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// 音を使うときは、鳴らす前と音の設定を切り替えたときにこれを呼ぶ（RULES.md §5「音」）。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

// ---- ここからアプリ本体 ----

const $ = (id) => document.getElementById(id);
// 効果音（Web Audio）。設定は覚えておく。
let soundOn = load('sound', true) !== false;
let actx = null;
function beep(freq, dur, delay) {
  if (!soundOn) return;
  try {
    setAudioSession(true);
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), gn = actx.createGain();
    const t0 = actx.currentTime + (delay || 0);
    o.type = 'triangle'; o.frequency.value = freq;
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(0.18, t0 + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(gn); gn.connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  } catch { /* 鳴らせなくても遊べる */ }
}
function soundBtn() {
  $('btn-sound').textContent = soundOn ? '音：入' : '音：切';
  $('btn-sound').setAttribute('aria-pressed', String(soundOn));
}

const NUM = '一二三四五六七八九';
const SIDE = { s: '先手', g: '後手' };
const MARK = { s: '☗', g: '☖' };
const PROMOTED = 'DHAMQT';

let T, states, keys, checks, notes, lastMoves, cur, selected = null, selectedDrop = null, pending = null, flipped = false, seed;

function newSeed() { return Math.floor(Math.random() * 1000000); }

function startGame(s) {
  seed = s;
  T = MS.generateTerrain(seed);
  const st = MS.initialState();
  states = [st]; keys = [MS.positionKey(st)]; checks = [false]; notes = []; lastMoves = [null];
  selected = null; selectedDrop = null; pending = null;
  cur = MS.evaluate(st, T, keys, checks);
  save('seed', seed);
  render();
}

function curState() { return states[states.length - 1]; }

function play(m) {
  const st = curState();
  let note = MS.notation(st, T, m);
  const ns = MS.applyMove(st, T, m);
  states.push(ns); keys.push(MS.positionKey(ns)); lastMoves.push(m);
  checks.push(MS.inCheck(ns, T, ns.turn));
  cur = MS.evaluate(ns, T, keys, checks);
  if (cur.check) note += cur.result && cur.result.winner ? '詰' : '+';
  notes.push(note);
  selected = null; selectedDrop = null; pending = null;
  if (cur.result) { beep(523, 0.15); beep(392, 0.15, 0.15); beep(262, 0.3, 0.3); }
  else if (cur.check) { beep(660, 0.1); beep(880, 0.15, 0.1); }
  else beep(m.capture ? 300 : 440, 0.09);
  render();
}

function undo() {
  if (states.length < 2) return;
  states.pop(); keys.pop(); checks.pop(); notes.pop(); lastMoves.pop();
  cur = MS.evaluate(curState(), T, keys, checks);
  selected = null; selectedDrop = null; pending = null;
  render();
}

function onCell(id) {
  if (cur.result) return;
  const st = curState();
  if (pending) { pending = null; selected = null; selectedDrop = null; render(); return; }
  let ms = [];
  if (selectedDrop) ms = cur.moves.filter((m) => m.drop === selectedDrop && m.to === id);
  else if (selected != null) ms = cur.moves.filter((m) => m.from === selected && m.to === id);
  if (ms.length === 1) { play(ms[0]); return; }
  if (ms.length > 1) { pending = ms; render(); return; }
  const p = st.board[id];
  selectedDrop = null;
  if (p && MS.colorOf(p) === st.turn && cur.moves.some((m) => m.from === id)) selected = selected === id ? null : id;
  else selected = null;
  render();
}

function onHand(type) {
  if (cur.result) return;
  pending = null; selected = null;
  selectedDrop = selectedDrop === type ? null : type;
  render();
}

// 駒 1 枚の要素。rot: 180° 回す。
function pieceEl(p, rot) {
  const s = document.createElement('span');
  s.className = 'pc' + (PROMOTED.includes(p.toUpperCase()) ? ' up' : '') + (rot ? ' rot' : '');
  s.textContent = MS.pieceName(p);
  return s;
}

function renderHand(el, color) {
  const st = curState();
  el.textContent = '';
  const lbl = document.createElement('span');
  lbl.className = 'lbl';
  lbl.textContent = MARK[color] + SIDE[color] + 'の持ち駒';
  el.appendChild(lbl);
  let any = false;
  for (const t of MS.HAND_TYPES) {
    const n = st.hands[color][t];
    if (!n) continue;
    any = true;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', MS.pieceName(t) + ' ' + n + '枚');
    const mine = color === st.turn && !cur.result && cur.moves.some((m) => m.drop === t);
    b.disabled = !mine;
    if (selectedDrop === t && color === st.turn) b.classList.add('sel');
    b.appendChild(pieceEl(color === 's' ? t : t.toLowerCase(), false));
    if (n > 1) { const c = document.createElement('span'); c.className = 'cnt'; c.textContent = '×' + n; b.appendChild(c); }
    b.addEventListener('click', () => onHand(t));
    el.appendChild(b);
  }
  if (!any) { const e = document.createElement('span'); e.textContent = 'なし'; el.appendChild(e); }
}

function render() {
  const st = curState();
  const board = $('board');
  board.textContent = '';
  const lm = lastMoves[lastMoves.length - 1];
  const kc = cur.check ? st.board.indexOf(st.turn === 's' ? 'K' : 'k') : -1;
  const targets = new Map();
  if (selectedDrop) { for (const m of cur.moves) if (m.drop === selectedDrop) targets.set(m.to, false); }
  else if (selected != null) { for (const m of cur.moves) if (m.from === selected) targets.set(m.to, m.capture); }
  const dr = (r) => (flipped ? 8 - r : r);
  const dc = (c) => (flipped ? 8 - c : c);
  for (const id of T.cellIds) {
    const cell = T.cells[id];
    const b = document.createElement('button');
    b.type = 'button';
    const rows = [dr(cell.r0), dr(cell.r1)], cols = [dc(cell.c0), dc(cell.c1)];
    b.style.gridRow = (Math.min(...rows) + 1) + ' / ' + (Math.max(...rows) + 2);
    b.style.gridColumn = (Math.min(...cols) + 1) + ' / ' + (Math.max(...cols) + 2);
    let cls = 'cell';
    if (cell.merged) cls += ' merged';
    if (lm && (lm.from === id || lm.to === id)) cls += ' last';
    if (id === kc) cls += ' chk';
    if (id === selected) cls += ' sel';
    if (targets.has(id)) cls += ' tgt' + (targets.get(id) ? ' cap' : '');
    b.className = cls;
    const p = st.board[id];
    b.setAttribute('aria-label', MS.cellLabel(T, id) + (p ? ' ' + MS.pieceName(p) : ''));
    if (p) b.appendChild(pieceEl(p, (MS.colorOf(p) === 'g') !== flipped));
    b.addEventListener('click', () => onCell(id));
    board.appendChild(b);
  }

  // 筋と段の目印
  const fl = $('fl'), rl = $('rl');
  fl.textContent = ''; rl.textContent = '';
  for (let i = 0; i < 9; i++) {
    const c = flipped ? 8 - i : i;
    const f = document.createElement('span'); f.textContent = 9 - c; fl.appendChild(f);
    const r = flipped ? 8 - i : i;
    const g = document.createElement('span'); g.textContent = NUM[r]; rl.appendChild(g);
  }

  // 持ち駒（盤の向きに合わせて、手前側が下）
  const bottom = flipped ? 'g' : 's';
  renderHand($('hand-top'), MS.other(bottom));
  renderHand($('hand-bottom'), bottom);

  // 手番・王手
  const statusEl = $('status');
  statusEl.textContent = '';
  if (!cur.result) {
    statusEl.append(MARK[st.turn] + SIDE[st.turn] + 'の番');
    if (cur.check) { const s = document.createElement('span'); s.className = 'chk'; s.textContent = '　王手！'; statusEl.appendChild(s); }
  } else statusEl.textContent = '対局終了';

  // 結果
  const res = $('result');
  res.hidden = !cur.result;
  if (cur.result) res.textContent = (cur.result.winner ? SIDE[cur.result.winner] + 'の勝ち' : '引き分け') + '：' + cur.result.reason;

  // 成りの選択
  const promo = $('promo');
  promo.hidden = !pending;
  promo.textContent = '';
  if (pending) {
    promo.append('成りますか？');
    for (const m of pending) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = m.promo ? '成る' : '成らない';
      btn.addEventListener('click', () => play(m));
      promo.appendChild(btn);
    }
  }

  $('seed').textContent = seed;
  $('btn-undo').disabled = states.length < 2;

  // 棋譜
  const mv = $('moves');
  mv.textContent = '';
  notes.forEach((n, i) => {
    const s = document.createElement('span'); s.className = 'm'; s.textContent = (i + 1) + ' ' + n; mv.appendChild(s);
  });
  mv.scrollTop = mv.scrollHeight;
}

$('btn-new').addEventListener('click', () => startGame(newSeed()));
$('btn-sound').addEventListener('click', () => { soundOn = !soundOn; save('sound', soundOn); setAudioSession(soundOn); soundBtn(); beep(440, 0.08); });
$('btn-undo').addEventListener('click', undo);
$('btn-flip').addEventListener('click', () => { flipped = !flipped; render(); });
$('seedform').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = parseInt($('seedin').value, 10);
  if (Number.isFinite(v) && v >= 0 && v <= 999999) startGame(v);
});

soundBtn();
startGame(newSeed());
