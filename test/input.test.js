// 入力まわりの回帰テスト:  node test/input.test.js
const fs = require('fs');
const path = require('path');
let src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
src = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'));

// --- 最小限のDOM/Canvasスタブ ---
const noop = () => {};
const ctxStub = new Proxy({}, { get: (t, k) => {
  if (k === 'createLinearGradient') return () => ({ addColorStop: noop });
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

const api = new Function(src + '\n;return {onDown,onMove,onUp,update,G,pointers,Z,SHIP,updateRect};')();
const { onDown, onMove, onUp, update, G, pointers, Z, updateRect } = api;

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
onDown(ev(2, 500, BOT));                 // 下側を2本目の指で触る
check('2本目の指が操作を引き継ぐ', G.players[0].pointer === 2);
onUp(ev(2, 500, BOT));                   // 2本目だけ離す（1本目はまだ触れている）
check('2本目を離すと1本目に操作が戻る', G.players[0].pointer === 1 && G.players[0].firing === true,
      `pointer=${G.players[0].pointer} firing=${G.players[0].firing}`);
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

console.log(fail === 0 ? '\n=== 全テスト通過 ===' : `\n=== ${fail}件 失敗 ===`);
process.exit(fail ? 1 : 0);
