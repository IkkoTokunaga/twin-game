// 入力まわりの回帰テスト:  node test/input.test.js
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
src = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'));

// --- 最小限のDOM/Canvasスタブ ---
const noop = () => {};
const ctxStub = new Proxy({}, { get: (t, k) => {
  if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
  if (k === 'measureText') return () => ({ width: 10 });
  if (k === 'canvas') return {};
  return noop;
}});
// ピンチ拡大やスクロールを再現するために差し替えられるようにしておく
let pageRect = { left:0, top:0, width:800, height:1200 };
const listeners = {};
const el = { addEventListener:(t,f)=>{(listeners[t]=listeners[t]||[]).push(f)},
             getContext:()=>ctxStub, style:{}, width:0, height:0,
             setPointerCapture:noop, releasePointerCapture:noop,
             getBoundingClientRect:()=>pageRect };
global.document = { getElementById:()=>el, addEventListener:noop, documentElement:{},
                    fullscreenElement:null, hidden:false };
global.window = { innerWidth:800, innerHeight:1200, devicePixelRatio:2,
                  addEventListener:noop, visualViewport:null,
                  AudioContext:null, webkitAudioContext:null };
global.screen = {};
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = noop;
global.setTimeout = noop;

const api = new Function(src + '\n;return {onDown,onMove,onUp,update,G,pointers,Z,SHIP,updateRect,PAUSE,zoneRect};')();
const { onDown, onMove, onUp, update, G, pointers, Z, updateRect, PAUSE, zoneRect } = api;

const ev = (id, x, y) => ({ pointerId:id, clientX:x, clientY:y, preventDefault:noop });
const BOT = 1000, TOP = 200;   // 画面高1200 → 中央600
let fail = 0;
const check = (name, cond, extra='') => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   ' + extra));
  if (!cond) fail++;
};

// ゲーム開始
onDown(ev(1, 400, BOT));
check('開始タップがそのまま操作に使われる', G.players[0].pointer === 1 && G.players[0].firing === true,
      `pointer=${G.players[0].pointer} firing=${G.players[0].firing}`);

// --- 症状1: 同じ側を2本目の指で触り、2本目を離す ---
const heldX = G.players[0].tx;
onDown(ev(2, 100, BOT));                 // 下側を2本目の指で触る（手のひら等を想定）
check('2本目の指は操作を奪わない',
      G.players[0].pointer === 1 && Math.abs(G.players[0].tx - heldX) < 1,
      `pointer=${G.players[0].pointer} tx=${G.players[0].tx}`);
onUp(ev(2, 100, BOT));                   // 2本目だけ離す（1本目はまだ触れている）
check('2本目を離しても1本目で操作が続く', G.players[0].pointer === 1 && G.players[0].firing === true,
      `pointer=${G.players[0].pointer} firing=${G.players[0].firing}`);
onDown(ev(3, 150, BOT));                 // 控えの指を置く
onUp(ev(1, 400, BOT));                   // 操作中の指を離す
check('操作中の指を離すと控えの指へ引き継ぐ', G.players[0].pointer === 3 && G.players[0].firing === true,
      `pointer=${G.players[0].pointer}`);
onUp(ev(3, 150, BOT));
onDown(ev(1, 400, BOT));                 // 以降のテストのため元に戻す
const before = G.players[0].x;
onMove(ev(1, 120, BOT));
check('1本目のドラッグで機体が動く', G.players[0].tx !== before, `tx=${G.players[0].tx}`);

// --- 症状2: 画面端まで指を出しても追跡が切れない ---
onMove(ev(1, 0, 1199));
check('画面端でも追従が維持される', pointers.has(1) && G.players[0].pointer === 1);

// --- 2人同時操作が干渉しない ---
onDown(ev(9, 300, TOP));
onMove(ev(9, 700, TOP));
onMove(ev(1, 200, BOT));
check('上下2人が独立して動く',
      G.players[1].pointer === 9 && G.players[0].pointer === 1 &&
      G.players[1].tx > G.players[0].tx,
      `p1.tx=${G.players[0].tx} p2.tx=${G.players[1].tx}`);

// --- 取りこぼしの自己修復（pointerupが来なかった想定） ---
pointers.delete(1);                      // イベントを取りこぼした状態を作る
update(0.016);
check('取りこぼしても撃ちっぱなしにならない',
      G.players[0].pointer === -1 && G.players[0].firing === false,
      `pointer=${G.players[0].pointer} firing=${G.players[0].firing}`);
check('もう一方のプレイヤーは巻き添えにならない', G.players[1].pointer === 9 && G.players[1].firing === true);

// --- 全部離した後にもう一度触れる ---
onUp(ev(9, 700, TOP));
check('全部離すと停止', G.players[1].firing === false && pointers.size === 0);
onDown(ev(5, 400, TOP));
check('再タップで復帰', G.players[1].pointer === 5 && G.players[1].firing === true);

// --- ピンチで拡大・スクロールされても座標が壊れない ---
onUp(ev(5, 400, TOP));
pageRect = { left:-100, top:-200, width:1600, height:2400 };   // 2倍に拡大してずれた状態
updateRect();
onDown(ev(7, 300, 1400));                 // 変換後: x=(300+100)/2=200, y=(1400+200)/2=800 → 下側
const zx = G.players[0].tx;
check('拡大中でもタップが正しい側に届く', G.players[0].pointer === 7 && zx > 100 && zx < 300, `tx=${zx}`);
onMove(ev(7, 1100, 1600));                // 変換後: x=600
check('拡大中でもドラッグが追従する', G.players[0].tx > zx + 200, `tx=${G.players[0].tx}`);
pageRect = { left:0, top:0, width:800, height:1200 };
updateRect();

// --- 画面端まで指を出さなくても陣地の隅々に届くか ---
pointers.clear();
for (const p of G.players) { p.stack.length = 0; p.pointer = -1; }
const H_ = 1200, EDGE = 46;
const reach = (idx, fy) => { const id = 100 + idx; onDown(ev(id, 400, fy)); const v = G.players[idx].ty; onUp(ev(id, 400, fy)); return v; };

// 下側プレイヤー: 指を画面下端の不可侵帯より内側に置いても陣地の一番下へ届く
const botFar = reach(0, H_ - EDGE);
check('下側は指が画面内でも陣地の最下部へ届く',
      Math.abs(botFar - Z.bot.y1) < 1, `ty=${botFar} zone.y1=${Z.bot.y1}`);
const botNear = reach(0, Z.cy + 12);
check('下側は陣地の最上部へも届く', Math.abs(botNear - Z.bot.y0) < 1, `ty=${botNear} zone.y0=${Z.bot.y0}`);

// 上側プレイヤーも同様
const topFar = reach(1, EDGE);
check('上側は指が画面内でも陣地の最上部へ届く',
      Math.abs(topFar - Z.top.y0) < 1, `ty=${topFar} zone.y0=${Z.top.y0}`);

// 操作レンジ全域で、機体が指より敵側に十分離れている（指で隠れない）
const GAP = 64;
let minGap = Infinity, wrongSide = 0;
for (let fy = Z.bot.y0 + GAP; fy <= H_ - EDGE; fy += 5) {
  onDown(ev(500, 400, fy));
  const ty = G.players[0].ty;
  if (ty >= fy) wrongSide++;                       // 下側プレイヤーの機体は必ず指より上
  minGap = Math.min(minGap, fy - ty);
  onUp(ev(500, 400, fy));
}
check('機体は常に指より敵側にある', wrongSide === 0, `逆側になった回数=${wrongSide}`);
check('指と機体は常に60px以上離れる', minGap >= 60, `最小距離=${Math.round(minGap)}px`);

// 操作レンジ外（中央寄り）を触っても反応はする
onDown(ev(501, 400, Z.cy + 20));
check('操作レンジ外を触っても操作は効く',
      G.players[0].pointer === 501 && G.players[0].firing === true &&
      Math.abs(G.players[0].ty - Z.bot.y0) < 1, `ty=${G.players[0].ty}`);
onUp(ev(501, 400, Z.cy + 20));

// 画面外の座標が来ても破綻しない
onDown(ev(600, 400, H_ + 300));
check('画面外の座標でも陣地内に収まる',
      G.players[0].ty >= Z.bot.y0 - 0.01 && G.players[0].ty <= Z.bot.y1 + 0.01, `ty=${G.players[0].ty}`);
onMove(ev(600, -500, -900));
check('画面外へドラッグしても陣地内に収まる',
      G.players[0].tx >= 0 && G.players[0].tx <= 800 &&
      G.players[0].ty >= Z.bot.y0 - 0.01 && G.players[0].ty <= Z.bot.y1 + 0.01,
      `tx=${G.players[0].tx} ty=${G.players[0].ty}`);
onUp(ev(600, 0, 0));

// --- 画面外・不正座標のタップ ---
pointers.clear();
for (const p of G.players) { p.stack.length = 0; p.pointer = -1; p.firing = false; }
onDown(ev(20, 400, 1000));                        // 正常に操作中
const keepX = G.players[0].tx, keepY = G.players[0].ty;

onDown(ev(21, -50, 1000));                        // 画面左外をタップ → ポーズ
check('画面外タップでポーズになる（左）', G.mode === 'pause' && !pointers.has(21), `mode=${G.mode}`);
onDown(ev(24, 400, 1000));                        // ポーズ中はどこを触っても再開
check('タップで再開する', G.mode === 'play' && !pointers.has(24), `mode=${G.mode}`);
check('再開のタップは機体を動かさない', G.players[0].pointer === -1, `pointer=${G.players[0].pointer}`);

onDown(ev(20, 400, 1000));                        // 操作を再開
const keep2X = G.players[0].tx, keep2Y = G.players[0].ty;
onDown(ev(22, 400, 1400));                        // 画面下外 → ポーズ
check('画面外タップでポーズになる（下）', G.mode === 'pause' && !pointers.has(22), `mode=${G.mode}`);
onDown(ev(25, 400, 1000)); onDown(ev(20, 400, 1000));   // 再開して操作し直す

onDown(ev(23, NaN, NaN));                         // 不正値はポーズにもしない
check('不正座標のタップは完全に無視される',
      G.mode === 'play' && G.players[0].pointer === 20 && !pointers.has(23), `mode=${G.mode}`);
check('操作中の機体は影響を受けない',
      G.players[0].tx === keep2X && G.players[0].ty === keep2Y,
      `tx=${G.players[0].tx} ty=${G.players[0].ty}`);

// ポーズ中はゲームが進まない
onDown(ev(26, -50, 600));
const froze = { x:G.players[0].x, wave:G.wave };
for (let i = 0; i < 60; i++) update(0.016);
check('ポーズ中はゲームが進行しない',
      G.mode === 'pause' && G.players[0].x === froze.x && G.wave === froze.wave,
      `x=${G.players[0].x}`);
onDown(ev(27, 400, 1000));                        // 再開
onDown(ev(20, 400, 1000));

onMove(ev(20, NaN, NaN));                         // 移動側に不正値が来た場合
check('不正座標の移動で機体が壊れない',
      isFinite(G.players[0].tx) && isFinite(G.players[0].ty), `tx=${G.players[0].tx}`);
update(0.016);
check('不正座標のあとも描画位置が有限', isFinite(G.players[0].x) && isFinite(G.players[0].y),
      `x=${G.players[0].x} y=${G.players[0].y}`);
onUp(ev(20, 400, 1000));

// --- ポーズボタン ---
onUp(ev(20, 400, 1000));
onDown(ev(30, PAUSE.btn.x, PAUSE.btn.y));
check('ポーズボタンで止まる', G.mode === 'pause' && !pointers.has(30), `mode=${G.mode}`);
onDown(ev(31, PAUSE.btn.x, PAUSE.btn.y));
check('ポーズボタンで再開する', G.mode === 'play' && !pointers.has(31), `mode=${G.mode}`);

// --- 表示される枠と、実際に動ける範囲が一致する ---
pointers.clear();
for (const p of G.players) { p.stack.length = 0; p.pointer = -1; p.firing = false; }
for (const idx of [0, 1]) {
  const p = G.players[idx], r = zoneRect(idx === 0);
  const corners = [];
  // 指を四隅いっぱいに動かして、機体が枠の四隅に届くか
  for (const fx of [0, 800]) {
    // 中央線ちょうど(600)は上側の担当になるので、下側は601から
    for (const fy of (idx === 0 ? [601, 1200] : [0, 599])) {
      const id = 700 + corners.length;
      onDown(ev(id, fx, fy));
      corners.push({ x: p.tx, y: p.ty });
      onUp(ev(id, fx, fy));
    }
  }
  const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
  check(`P${idx + 1}: 機体が枠の左右端まで届く`,
        Math.abs(Math.min(...xs) - r.x0) < 0.01 && Math.abs(Math.max(...xs) - r.x1) < 0.01,
        `x=${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)} 枠=${r.x0.toFixed(1)}..${r.x1.toFixed(1)}`);
  check(`P${idx + 1}: 機体が枠の上下端まで届く`,
        Math.abs(Math.min(...ys) - r.y0) < 0.01 && Math.abs(Math.max(...ys) - r.y1) < 0.01,
        `y=${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)} 枠=${r.y0.toFixed(1)}..${r.y1.toFixed(1)}`);
  check(`P${idx + 1}: 枠の外へは出られない`,
        corners.every(c => c.x >= r.x0 - 0.01 && c.x <= r.x1 + 0.01 &&
                           c.y >= r.y0 - 0.01 && c.y <= r.y1 + 0.01), '');
}

console.log(fail === 0 ? '\n=== 全テスト通過 ===' : `\n=== ${fail}件 失敗 ===`);
process.exit(fail ? 1 : 0);
