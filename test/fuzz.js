// 画面外・不正座標を含むランダム操作の総当たり:  node test/fuzz.js [html] [seed]
const fs = require('fs');
const target = process.argv[2] || require('path').join(__dirname, '..', 'index.html');
let src = fs.readFileSync(target, 'utf8');
src = src.slice(src.indexOf('<script>') + 8, src.lastIndexOf('</script>'));

const noop = () => {};
const ctxStub = new Proxy({}, { get: (t, k) => {
  if (k === 'createLinearGradient') return () => ({ addColorStop: noop });
  if (k === 'measureText') return () => ({ width: 10 });
  if (k === 'canvas') return {};
  return noop;
}});
const el = { addEventListener: noop, getContext: () => ctxStub, style:{}, width:0, height:0,
             setPointerCapture: noop, releasePointerCapture: noop,
             getBoundingClientRect:()=>({left:0,top:0,width:800,height:1200}) };
global.document = { getElementById:()=>el, addEventListener:noop, documentElement:{}, fullscreenElement:null, hidden:false };
global.window = { innerWidth:800, innerHeight:1200, devicePixelRatio:2, addEventListener:noop,
                  visualViewport:null, AudioContext:null, webkitAudioContext:null };
global.screen = {};
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = noop;
global.setTimeout = noop;

const api = new Function(src + '\n;return {onDown,onMove,onUp,update,draw,G};')();
const { onDown, onMove, onUp, update, draw, G } = api;
const ev = (id,x,y) => ({ pointerId:id, clientX:x, clientY:y, preventDefault:noop });

// 再現性のある乱数
let seed = Number(process.argv[3] || 12345);
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

const live = [];
let steps = 0;
try {
  for (let i = 0; i < 300000; i++) {
    steps = i;
    const r = rnd();
    const wild = rnd() < 0.25;   // 4回に1回は画面外や不正値を混ぜる
    const X = () => wild ? (rnd()<0.5 ? (rnd()*3000-1000) : (rnd()<0.5?NaN:Infinity)) : rnd()*800;
    const Y = () => wild ? (rnd()<0.5 ? (rnd()*4000-1400) : (rnd()<0.5?NaN:-Infinity)) : rnd()*1200;
    if (r < 0.30) {                                  // 指を置く（最大4本）
      if (live.length < 4) {
        const id = Math.floor(rnd() * 1000);
        if (!live.includes(id)) { live.push(id); onDown(ev(id, X(), Y())); }
      }
    } else if (r < 0.70) {                           // 動かす
      if (live.length) onMove(ev(live[Math.floor(rnd()*live.length)], X(), Y()));
    } else if (r < 0.85) {                           // 離す
      if (live.length) { const k = Math.floor(rnd()*live.length); onUp(ev(live[k], X(), Y())); live.splice(k,1); }
    } else {                                         // 1フレーム進める
      update(0.016); draw();
      for (const p of G.players) if (!isFinite(p.x)||!isFinite(p.y)||!isFinite(p.tx)||!isFinite(p.ty))
        throw new Error('機体の座標が非数値になった: '+p.x+','+p.y+','+p.tx+','+p.ty);
    }
  }
  console.log(`OK: 30万操作を例外なく完走 (seed=${process.argv[3]||12345})`);
} catch (e) {
  console.log(`*** 例外で停止 step=${steps} seed=${process.argv[3]||12345}`);
  console.log(e.stack.split('\n').slice(0,4).join('\n'));
  process.exit(1);
}
