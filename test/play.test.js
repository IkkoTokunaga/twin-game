// ブロック掘り＆スター探しの通しテスト:  node test/play.test.js
const fs=require('fs');
let src=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
src=src.slice(src.indexOf('<script>')+8, src.lastIndexOf('</script>'));
const noop=()=>{};
const ctxStub=new Proxy({},{get:(t,k)=>{
  if(k==='createLinearGradient')return ()=>({addColorStop:noop});
  if(k==='measureText')return ()=>({width:10});
  if(k==='arc')return (x,y,r)=>{ if(r<0) throw new Error('負の半径 '+r); };
  return noop;}});
const el={addEventListener:noop,getContext:()=>ctxStub,style:{},width:0,height:0,
  setPointerCapture:noop,releasePointerCapture:noop,
  getBoundingClientRect:()=>({left:0,top:0,width:800,height:1200})};
global.document={getElementById:()=>el,addEventListener:noop,documentElement:{},fullscreenElement:null,hidden:false};
global.window={innerWidth:800,innerHeight:1200,devicePixelRatio:2,addEventListener:noop,
  visualViewport:null,AudioContext:null,webkitAudioContext:null};
global.screen={}; global.performance={now:()=>Date.now()}; global.requestAnimationFrame=noop; global.setTimeout=noop;

const api=new Function(src+'\n;return {onDown,onMove,onUp,update,draw,G,FIELD,Z,blockAt,playerShoot,idxAt,makeField,damageBlock,B_LOCK0,B_LOCK1};')();
const {onDown,onMove,onUp,update,draw,G,FIELD,Z,playerShoot,idxAt,makeField,damageBlock,B_LOCK0,B_LOCK1}=api;
const ev=(id,x,y)=>({pointerId:id,clientX:x,clientY:y,preventDefault:noop});
let fail=0;
const check=(n,c,e='')=>{console.log((c?'  PASS  ':'  FAIL  ')+n+(c?'':'   '+e)); if(!c)fail++;};

onDown(ev(1,400,1000));                       // ゲーム開始
check('ブロック畑が生成される', FIELD.grid.length > 0 && FIELD.cols>3 && FIELD.rows===5,
      `cols=${FIELD.cols} rows=${FIELD.rows} cell=${Math.round(FIELD.cell)}`);
const total=FIELD.grid.filter(Boolean).length;
check('スターが隠されている', G.starsTotal >= 2 && G.starsFound === 0, `total=${G.starsTotal}`);
const starCells=FIELD.grid.filter(b=>b&&b.star).length;
check('スターの数が畑の中身と一致', starCells === G.starsTotal, `畑=${starCells} 宣言=${G.starsTotal}`);
check('畑が中央帯に収まる',
      FIELD.y0 >= Z.top.y1 && FIELD.y0+FIELD.rows*FIELD.cell <= Z.bot.y0+0.01,
      `y0=${Math.round(FIELD.y0)} y1=${Math.round(FIELD.y0+FIELD.rows*FIELD.cell)} zone=${Math.round(Z.top.y1)}..${Math.round(Z.bot.y0)}`);

// --- 強攻撃（貫通ビーム）が列を消し尽くさないこと ---
{
  onUp(ev(1,400,1000));                       // いったん指を離して自動連射を止める
  G.bullets.length = 0;
  const p = G.players[0];
  p.firing = false; p.cool = 99;
  const col = Math.floor(FIELD.cols / 2);
  const cx = FIELD.x0 + (col + 0.5) * FIELD.cell;
  p.x = p.tx = cx; p.y = p.ty = 900;
  // ビーム単体の威力だけを見たいので、星とばくだん（連鎖爆発）を取り除く
  for (const b of FIELD.grid) if (b) { b.star = false; b.type = 0; b.hp = b.maxHp = 24; }
  const before = FIELD.grid.filter(Boolean).length;
  p.charge = p.maxCharge;
  playerShoot(p);                             // ビームを1発だけ撃つ
  const beamCount = G.bullets.length;
  const angs = G.bullets.map(b => Math.atan2(b.vx || 0, -b.vy * (p.bottom ? 1 : -1)));
  check('扇状の内訳がまっすぐ1本＋斜め2本',
        angs.filter(a => Math.abs(a) < 0.01).length === 1 &&
        angs.filter(a => a < -0.05).length === 1 &&
        angs.filter(a => a > 0.05).length === 1,
        `角度=${angs.map(a => a.toFixed(2)).join(', ')}`);
  let guard = 0;
  while (G.bullets.length && guard++ < 600) { p.cool = 99; p.firing = false; update(1/60); }
  const broken = before - FIELD.grid.filter(Boolean).length;
  // まっすぐ(貫通3)＋斜め2本(貫通1ずつ) = 最大5
  check('強攻撃が壊すのは5ブロックまで', broken <= 5 && broken >= 1,
        `壊した数=${broken} / 縦${FIELD.rows}列`);
  check('強攻撃は3本の扇状で出る', beamCount === 3, `本数=${beamCount}`);
  check('強攻撃ではチャージが溜まらない', p.charge < p.maxCharge, `charge=${p.charge}`);
  G.bullets.length = 0;
  p.cool = 0;                                  // 検証用に伸ばした発射待ちを戻す
  onDown(ev(1,400,1000));
  makeField(G.stage);                          // 星を消した畑を作り直す
}

// --- どの★も必ずどちらかのプレイヤーが到達できる（詰みが無い） ---
{
  let bad = 0, checked = 0;
  for (let trial = 0; trial < 300; trial++) {
    makeField(1 + (trial % 8));                       // 色つきの割合が高いステージも含める
    for (let r = 0; r < FIELD.rows; r++) {
      for (let c = 0; c < FIELD.cols; c++) {
        const b = FIELD.grid[idxAt(c, r)];
        if (!b || !b.star) continue;
        checked++;
        // 下からP1が掘れるか（経路に赤ブロックが無いか）
        let okBottom = b.type !== B_LOCK1;
        for (let rr = r + 1; rr < FIELD.rows && okBottom; rr++) {
          const n = FIELD.grid[idxAt(c, rr)];
          if (n && n.type === B_LOCK1) okBottom = false;
        }
        // 上からP2が掘れるか（経路に青ブロックが無いか）
        let okTop = b.type !== B_LOCK0;
        for (let rr = r - 1; rr >= 0 && okTop; rr--) {
          const n = FIELD.grid[idxAt(c, rr)];
          if (n && n.type === B_LOCK0) okTop = false;
        }
        if (!okBottom && !okTop) bad++;
      }
    }
  }
  check('どの★にも到達経路がある（300畑ぶん）', bad === 0, `到達不能=${bad} / 検査した★=${checked}`);
  makeField(G.stage);
}

// --- 色つきブロックは持ち主しか壊せない ---
{
  // 直前のテストで壊れている場合もあるので、必ず作り直す
  const set=(t)=>{ const b={type:t,hp:24,maxHp:24,star:false,flash:0}; FIELD.grid[idxAt(0,0)]=b; return b; };

  let b=set(B_LOCK0);
  check('青ブロックは赤プレイヤーの弾を弾く', damageBlock(0,0,999,1)==='blocked' && FIELD.grid[idxAt(0,0)]===b);
  check('弾かれた時はHPも減らない', b.hp===24, `hp=${b.hp}`);
  check('青ブロックは青プレイヤーが壊せる', damageBlock(0,0,999,0)==='hit' && FIELD.grid[idxAt(0,0)]===null);

  b=set(B_LOCK1);
  check('赤ブロックは青プレイヤーの弾を弾く', damageBlock(0,0,999,0)==='blocked' && FIELD.grid[idxAt(0,0)]===b);
  check('赤ブロックは赤プレイヤーが壊せる', damageBlock(0,0,999,1)==='hit' && FIELD.grid[idxAt(0,0)]===null);

  // 弾かれてもチャージは溜まらない
  const p=G.players[0];
  set(B_LOCK1); p.charge=0;
  G.bullets.length=0;
  G.bullets.push({x:FIELD.x0+FIELD.cell*0.5, y:FIELD.y0+FIELD.cell*0.5, vy:-1, r:5, dmg:8, owner:0, pierce:false, color:'#fff'});
  update(1/60);
  check('色違いに当ててもチャージは増えない', p.charge===0, `charge=${p.charge}`);
  makeField(G.stage);
}

// 2人で掘り進める
onDown(ev(2,400,200));
let frames=0, cleared=0, maxStage=1, chipSeen=0, bugSeen=0;
for(let i=0;i<60*180;i++){                    // 3分ぶん
  frames++;
  const x=26+ (i*9)%(800-52);
  onMove(ev(1,x,900+ (i%200)));
  onMove(ev(2,800-x,300-(i%200)));
  update(1/60); draw();
  if(G.stage>maxStage){maxStage=G.stage; cleared++;}
  chipSeen=Math.max(chipSeen,G.chips.length);
  bugSeen=Math.max(bugSeen,G.bugs.length);
  if(G.stage>=4) break;
}
check('ブロックが掘れている', G.players[0].dug+G.players[1].dug > 20,
      `P1=${G.players[0].dug} P2=${G.players[1].dug}`);
check('スターを回収してステージが進む', maxStage>=2, `stage=${maxStage} 経過=${(frames/60).toFixed(1)}秒`);
check('スコアが加算される', G.score>0, `score=${G.score}`);
check('新ステージでスターが再配置される',
      G.starsTotal>=2 && FIELD.grid.filter(b=>b&&b.star).length + G.starsFound >= G.starsTotal,
      `total=${G.starsTotal} found=${G.starsFound}`);
check('スターの取りこぼしがない', G.starsFound<=G.starsTotal, `${G.starsFound}/${G.starsTotal}`);
check('畑が機体の可動範囲に収まる',
      FIELD.x0 >= 20*1.8-0.01 && FIELD.x0+FIELD.cols*FIELD.cell <= 800-20*1.8+0.01,
      `x0=${FIELD.x0.toFixed(1)} x1=${(FIELD.x0+FIELD.cols*FIELD.cell).toFixed(1)}`);
check('かけらが落ちてくる', chipSeen > 0, `観測=${chipSeen}`);
check('かけらを受け止められる', G.players[0].caught + G.players[1].caught > 0,
      `P1=${G.players[0].caught} P2=${G.players[1].caught}`);
check('おじゃまむしが出る', bugSeen > 0, `観測=${bugSeen}`);
check('おじゃまむしは倒せる/消える', G.bugs.length < 12, `残=${G.bugs.length}`);
check('弾が無限に溜まらない', G.bullets.length<200, `bullets=${G.bullets.length}`);
check('粒子が無限に溜まらない', G.parts.length<2000, `parts=${G.parts.length}`);
console.log(`\n  参考: ${(frames/60).toFixed(1)}秒でステージ${maxStage}到達 / スコア${G.score} / 掘った数 P1=${G.players[0].dug} P2=${G.players[1].dug}`);
console.log(fail===0?'\n=== 全テスト通過 ===':`\n=== ${fail}件 失敗 ===`);
process.exit(fail?1:0);
