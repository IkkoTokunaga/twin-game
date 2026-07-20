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
      Math.round(G.players[1].tx) === 700 && Math.round(G.players[0].tx) === 200,
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
check('拡大中でもタップ位置が正しく変換される',
      G.players[0].pointer === 7 && Math.round(G.players[0].tx) === 200,
      `tx=${G.players[0].tx}`);
onMove(ev(7, 1100, 1600));                // 変換後: x=600
check('拡大中でもドラッグが追従する', Math.round(G.players[0].tx) === 600, `tx=${G.players[0].tx}`);
pageRect = { left:0, top:0, width:800, height:1200 };
updateRect();

console.log(fail === 0 ? '\n=== 全テスト通過 ===' : `\n=== ${fail}件 失敗 ===`);
process.exit(fail ? 1 : 0);
