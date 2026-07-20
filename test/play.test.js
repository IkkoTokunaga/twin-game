// ブロック掘り＆スター探しの通しテスト:  node test/play.test.js
const fs=require('fs');
let src=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
src=src.slice(src.indexOf('<script>')+8, src.lastIndexOf('</script>'));
const noop=()=>{};
// save/restore の釣り合いを見るため深さを数える
const gfx = { depth: 0, maxDepth: 0 };
const ctxStub=new Proxy({},{get:(t,k)=>{
  if(k==='createLinearGradient'||k==='createRadialGradient')return ()=>({addColorStop:noop});
  if(k==='measureText')return ()=>({width:10});
  if(k==='arc')return (x,y,r)=>{ if(r<0) throw new Error('負の半径 '+r); };
  if(k==='save')return ()=>{ gfx.depth++; gfx.maxDepth=Math.max(gfx.maxDepth,gfx.depth); };
  if(k==='restore')return ()=>{ gfx.depth--; if(gfx.depth<0) throw new Error('restore が save より多い'); };
  return noop;}});
const el={addEventListener:noop,getContext:()=>ctxStub,style:{},width:0,height:0,
  setPointerCapture:noop,releasePointerCapture:noop,
  getBoundingClientRect:()=>({left:0,top:0,width:800,height:1200})};
global.document={getElementById:()=>el,addEventListener:noop,documentElement:{},fullscreenElement:null,hidden:false};
global.window={innerWidth:800,innerHeight:1200,devicePixelRatio:2,addEventListener:noop,
  visualViewport:null,AudioContext:null,webkitAudioContext:null};
global.screen={}; global.performance={now:()=>Date.now()}; global.requestAnimationFrame=noop; global.setTimeout=noop;

const api=new Function(src+'\n;return {onDown,onMove,onUp,update,draw,G,FIELD,Z,blockAt,playerShoot,idxAt,makeField,damageBlock,B_LOCK0,B_LOCK1,explode,BLAST_STUN,B_BOMB,MENU,resetGame,makePlayer,collectGem,CHIPS_PER_POWER,BEAM_LEVELS,SHOT_LEVELS,zoneRect,B_BRICK,B_ROCK,B_DIAMOND,BLOCK_HP,BLOCK_DEBUT};')();
const {onDown,onMove,onUp,update,draw,G,FIELD,Z,playerShoot,idxAt,makeField,damageBlock,B_LOCK0,B_LOCK1,explode,BLAST_STUN,B_BOMB,MENU,resetGame,makePlayer,collectGem,CHIPS_PER_POWER,BEAM_LEVELS,SHOT_LEVELS,zoneRect,B_BRICK,B_ROCK,B_DIAMOND,BLOCK_HP,BLOCK_DEBUT}=api;
const ev=(id,x,y)=>({pointerId:id,clientX:x,clientY:y,preventDefault:noop});

// 残っているブロックを狙う簡易ボット。画面を等速で往復するだけだと
// 端の列を撃ち残すことがあり、人間の遊び方とも違うため。
function aimFinger(bottom, tick) {
  const rc = zoneRect(bottom);
  const cols = [];
  for (let c = 0; c < FIELD.cols; c++) {
    for (let r = 0; r < FIELD.rows; r++) {
      if (FIELD.grid[idxAt(c, r)]) { cols.push(c); break; }
    }
  }
  if (!cols.length) return 400;
  const col = cols[Math.floor(tick / 18) % cols.length];       // 残っている列を順に狙う
  const tx = FIELD.x0 + (col + 0.5) * FIELD.cell;
  const u = (tx - rc.x0) / Math.max(1, rc.x1 - rc.x0);         // 指の位置へ逆変換
  return 26 + u * (800 - 52);
}
let fail=0;
const check=(n,c,e='')=>{console.log((c?'  PASS  ':'  FAIL  ')+n+(c?'':'   '+e)); if(!c)fail++;};

onDown(ev(1, MENU.duo.x + MENU.duo.w/2, MENU.duo.y + MENU.duo.h/2));   // ふたりで開始
check('ブロック畑が生成される', FIELD.grid.length > 0 && FIELD.cols > 3 && FIELD.rows >= 5,
      `cols=${FIELD.cols} rows=${FIELD.rows} cell=${Math.round(FIELD.cell)}`);
check('砲口が畑にめり込まない',
      FIELD.y0 + FIELD.rows*FIELD.cell <= Z.bot.y0 - 20*1.8 &&
      FIELD.y0 >= Z.top.y1 + 20*1.8,
      `畑=${FIELD.y0.toFixed(0)}..${(FIELD.y0+FIELD.rows*FIELD.cell).toFixed(0)} 陣地=${Z.top.y1.toFixed(0)}/${Z.bot.y0.toFixed(0)}`);
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
  check('強攻撃はまっすぐ1本だけ',
        beamCount === 1 && Math.abs(angs[0]) < 0.01,
        `本数=${beamCount} 角度=${angs.map(a => a.toFixed(2)).join(', ')}`);
  let guard = 0;
  while (G.bullets.length && guard++ < 600) { p.cool = 99; p.firing = false; update(1/60); }
  const broken = before - FIELD.grid.filter(Boolean).length;
  check('強攻撃が壊すのは3ブロックまで', broken <= 3 && broken >= 1,
        `壊した数=${broken} / 縦${FIELD.rows}列`);
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

// --- 硬さの違うブロックがステージごとに増える ---
{
  const kinds = [
    { t: B_BRICK,   name: 'レンガ' },
    { t: B_ROCK,    name: 'いわ' },
    { t: B_DIAMOND, name: 'ダイヤ' },
  ];
  check('硬さの順序が ふつう < レンガ < いわ < ダイヤ',
        BLOCK_HP[0] < BLOCK_HP[B_BRICK] && BLOCK_HP[B_BRICK] < BLOCK_HP[B_ROCK] &&
        BLOCK_HP[B_ROCK] < BLOCK_HP[B_DIAMOND],
        `${BLOCK_HP[0]} / ${BLOCK_HP[B_BRICK]} / ${BLOCK_HP[B_ROCK]} / ${BLOCK_HP[B_DIAMOND]}`);

  const seenAt = (stage, type) => {              // そのステージで出るか（80畑ぶん見る）
    let n = 0;
    for (let i = 0; i < 80; i++) {
      makeField(stage);
      n += FIELD.grid.filter(b => b && b.type === type).length;
    }
    return n;
  };

  for (const k of kinds) {
    const debut = BLOCK_DEBUT[k.t];
    check(`${k.name}はステージ${debut - 1}までは出ない`, seenAt(debut - 1, k.t) === 0,
          `見つかった数=${seenAt(debut - 1, k.t)}`);
    check(`${k.name}はステージ${debut}から出る`, seenAt(debut, k.t) > 0);
  }

  // 深いステージほど硬いブロックの割合が増える
  const hardRatio = (stage) => {
    let hard = 0, all = 0;
    for (let i = 0; i < 60; i++) {
      makeField(stage);
      for (const b of FIELD.grid) {
        if (!b) continue;
        all++;
        if (b.type === B_BRICK || b.type === B_ROCK || b.type === B_DIAMOND) hard++;
      }
    }
    return hard / all;
  };
  const r3 = hardRatio(3), r9 = hardRatio(9);
  check('ステージが進むほど硬いブロックが増える', r9 > r3,
        `ステージ3=${(r3*100).toFixed(1)}% ステージ9=${(r9*100).toFixed(1)}%`);

  // 硬いブロックもちゃんと壊せる
  makeField(9);
  const b = { type: B_DIAMOND, hp: BLOCK_HP[B_DIAMOND], maxHp: BLOCK_HP[B_DIAMOND], star: false, flash: 0 };
  FIELD.grid[idxAt(0, 0)] = b;
  let hits = 0;
  while (FIELD.grid[idxAt(0, 0)] && hits < 200) { damageBlock(0, 0, 8, 0); hits++; }
  check('ダイヤも通常ショットで壊せる', FIELD.grid[idxAt(0, 0)] === null,
        `${hits}発`);
  console.log(`  参考: ダイヤは通常ショット${hits}発ぶん`);
  makeField(G.stage);
}

// --- 強化段階ごとの機体の描画 ---
{
  resetGame(false);
  G.mode = 'play';
  const p = G.players[0];
  let bad = [];
  for (let shot = 0; shot < SHOT_LEVELS.length; shot++) {
    for (let beam = 0; beam < BEAM_LEVELS.length; beam++) {
      p.shot = shot; p.beam = beam;
      for (const charged of [0, p.maxCharge]) {
        for (const stun of [0, 1]) {
          p.charge = charged; p.stun = stun;
          gfx.depth = 0;
          draw();
          if (gfx.depth !== 0) bad.push(`shot${shot}/beam${beam} 深さ=${gfx.depth}`);
        }
      }
    }
  }
  p.shot = 0; p.beam = 0; p.stun = 0; p.charge = 0;
  check('どの強化段階でも描画の save/restore が釣り合う', bad.length === 0, bad.join(', '));

  // 強化のかけらは光の演出が重いので、描画の釣り合いを個別にも確かめる
  for (const kind of ['beam', 'shot']) {
    for (const side of [0, 1]) {
      G.chips.length = 0;
      G.chips.push({ x: 400, y: Z.cy, vx: 0, vy: 0, side, t: 1.2, power: true, kind });
      gfx.depth = 0;
      draw();
      if (gfx.depth !== 0) bad.push(`${kind}/side${side} 深さ=${gfx.depth}`);
    }
  }
  G.chips.length = 0;
  check('強化のかけらを描いても save/restore が釣り合う', bad.length === 0, bad.join(', '));
  check('描画の入れ子が深くなりすぎない', gfx.maxDepth < 20, `最大の深さ=${gfx.maxDepth}`);
}

// --- かけらを集めるとビームが強化される ---
{
  resetGame(false);
  const p = G.players[0];
  p.x = 400; p.y = Z.bot.y0 + 40;
  const put = (power, kind) => {                 // 機体の目の前にかけらを置く
    G.chips.length = 0;
    G.chips.push({ x: p.x, y: p.y, vx: 0, vy: 0, side: 0, t: 0, power: !!power, kind });
    update(1/60);
  };
  const grab = () => {                           // 落ちてきた強化かけらを受け取る
    const c = G.chips.find(c => c.power);
    if (!c) return null;
    c.x = p.x; c.y = p.y;
    update(1/60);
    return c.kind;
  };

  check('最初のビームはLv1', p.beam === 0, `beam=${p.beam}`);

  for (let i = 0; i < CHIPS_PER_POWER - 1; i++) put(false);
  check(`かけら${CHIPS_PER_POWER - 1}個ではまだ強化されない`,
        p.beam === 0 && !G.chips.some(c => c.power), `beam=${p.beam}`);

  put(false);                                    // ちょうど規定数
  check(`かけら${CHIPS_PER_POWER}個で強化アイテムが落ちてくる`,
        G.chips.some(c => c.power), `chips=${JSON.stringify(G.chips.map(c => !!c.power))}`);
  check('強化アイテムは拾った人の側へ落ちる',
        G.chips.filter(c => c.power).every(c => c.side === 0));

  const kind1 = grab();                          // 1個目の強化アイテム
  check('受け止めるとビームがLv2になる', kind1 === 'beam' && p.beam === 1, `beam=${p.beam}`);

  // 2個目は通常ショットの強化が来る
  for (let i = 0; i < CHIPS_PER_POWER; i++) put(false);
  const kind2 = grab();
  check('2個目は通常ショットの強化', kind2 === 'shot' && p.shot === 1,
        `kind=${kind2} shot=${p.shot}`);

  // 通常ショットが実際に強くなっているか
  const volley = () => {
    G.bullets.length = 0; p.charge = 0; p.cool = 0; p.firing = false;
    playerShoot(p);
    return G.bullets.slice();
  };
  const s2 = volley();
  p.shot = 0;
  const s1 = volley();
  check('強化すると通常ショットの弾数が増える', s2.length > s1.length,
        `Lv1=${s1.length}発 -> Lv2=${s2.length}発`);
  check('強化すると通常ショットの威力も上がる', s2[0].dmg > s1[0].dmg,
        `威力 ${s1[0].dmg} -> ${s2[0].dmg}`);
  check('通常ショットの強化は貫通しない', s2.every(b => !b.pierce));
  p.shot = 1;

  // 実際にビームが強くなっているか
  const shoot = () => {
    G.bullets.length = 0; p.charge = p.maxCharge; p.cool = 0; p.firing = false;
    playerShoot(p);
    return G.bullets[0];
  };
  const lv2 = shoot();
  p.beam = 0;
  const lv1 = shoot();
  check('強化するとビームが太く・強く・貫通が増える',
        lv2.r > lv1.r && lv2.dmg > lv1.dmg && lv2.pierceLeft > lv1.pierceLeft,
        `Lv1(r${lv1.r} 威力${lv1.dmg} 貫通${lv1.pierceLeft}) -> Lv2(r${lv2.r} 威力${lv2.dmg} 貫通${lv2.pierceLeft})`);

  // --- ダメージを受けると1段階下がる ---
  p.beam = 2; p.shot = 0; p.stun = 0;
  explode(p.x, p.y);
  check('ダメージを受けると高い方が1段階下がる', p.beam === 1 && p.shot === 0,
        `beam=${p.beam} shot=${p.shot}`);
  check('同時に動けなくなる', p.stun > 0, `stun=${p.stun}`);

  // 連鎖爆発で一気に丸裸にならないこと（動けない間は重ねて下がらない）
  explode(p.x, p.y);
  explode(p.x, p.y);
  check('動けない間は重ねて下がらない', p.beam === 1, `beam=${p.beam}`);

  // 解除してからもう一度当たれば下がる
  for (let i = 0; i < 60 * 4 && p.stun > 0; i++) update(1/60);
  p.x = 400; p.y = Z.bot.y0 + 40;
  explode(p.x, p.y);
  check('解除後に当たればまた下がる', p.beam === 0, `beam=${p.beam}`);

  // Lv1より下がらない
  for (let i = 0; i < 60 * 4 && p.stun > 0; i++) update(1/60);
  explode(p.x, p.y);
  check('Lv1より下には下がらない', p.beam === 0, `beam=${p.beam}`);
  for (let i = 0; i < 60 * 4 && p.stun > 0; i++) update(1/60);

  // 上限（両方とも最大なら出ない）
  p.beam = BEAM_LEVELS.length - 1;
  p.shot = SHOT_LEVELS.length - 1;
  p.stun = 0;
  p.caught = 0;
  for (let i = 0; i < CHIPS_PER_POWER; i++) put(false);
  check('両方とも最大なら強化アイテムは出ない',
        !G.chips.some(c => c.power), `chips=${G.chips.length}`);

  // 片方だけ最大なら、伸びしろのある方が出る
  p.shot = 0; p.caught = 0;
  for (let i = 0; i < CHIPS_PER_POWER; i++) put(false);
  const only = G.chips.find(c => c.power);
  check('片方が最大なら、もう片方の強化が出る', only && only.kind === 'shot',
        `kind=${only && only.kind}`);
  G.chips.length = 0;

  G.chips.length = 0;
  resetGame(false);
  check('やり直すと両方Lv1に戻る', G.players[0].beam === 0 && G.players[0].shot === 0);
  onDown(ev(1,400,1000)); onDown(ev(2,400,200));
}

// --- 10ステージごとのお祝い演出 ---
{
  const clearStage = (n) => {                    // ステージnをクリアした状態を作る
    resetGame(false);
    G.stage = n; G.starsTotal = 1; G.starsFound = 0;
    G.celebrate = null; G.parts.length = 0;
    const gem = { x: 400, y: Z.cy, r: 20, t: 0, taken: false, life: 1, owner: 0 };
    G.gems.push(gem);
    collectGem(gem, 0);
  };

  clearStage(9);
  check('9ステージ目は通常のクリア', G.celebrate === null && Math.abs(G.nextT - 2.2) < 0.01,
        `celebrate=${!!G.celebrate} nextT=${G.nextT}`);

  clearStage(10);
  check('10ステージ目でお祝い演出が出る', !!G.celebrate && G.celebrate.stage === 10,
        `celebrate=${JSON.stringify(G.celebrate)}`);
  check('お祝いは通常より長い', G.nextT > 4, `nextT=${G.nextT}`);

  const partsBefore = G.parts.length;
  for (let i = 0; i < 60; i++) update(1/60);     // 1秒ぶん
  check('お祝い中は花火が上がり続ける', G.parts.length > partsBefore,
        `粒子 ${partsBefore} -> ${G.parts.length}`);

  for (let i = 0; i < 60 * 6; i++) update(1/60); // 演出が終わるまで
  check('お祝いは自動で終わる', G.celebrate === null);
  check('お祝いのあと次のステージへ進む', G.stage === 11, `stage=${G.stage}`);

  clearStage(20);
  check('20ステージ目でもお祝いが出る', !!G.celebrate && G.celebrate.stage === 20);
  clearStage(15);
  check('15ステージ目はお祝いなし', G.celebrate === null);

  resetGame(false);
  onDown(ev(1,400,1000)); onDown(ev(2,400,200));
}

// --- ひとり用モード ---
{
  resetGame(true);
  check('ひとり用は青のプレイヤーだけ', G.players.length === 1 && G.players[0].bottom === true,
        `機数=${G.players.length}`);

  // 畑がふたり用より広いこと（2人目の陣地まで使う）
  makeField(1);
  const soloRows = FIELD.rows, soloCount = FIELD.grid.filter(Boolean).length, soloStars = G.starsTotal;
  const soloTop = FIELD.y0;
  check('ひとり用の畑は2人目の陣地まで広がる', soloTop <= Z.top.y1 + 1,
        `畑の上端=${soloTop.toFixed(0)} 上陣地の下端=${Z.top.y1.toFixed(0)}`);
  check('ひとり用は青の陣地に食い込まない',
        FIELD.y0 + FIELD.rows * FIELD.cell <= Z.bot.y0 + 1,
        `畑の下端=${(FIELD.y0 + FIELD.rows * FIELD.cell).toFixed(0)} 下陣地=${Z.bot.y0.toFixed(0)}`);
  let locks = 0;
  for (let i = 0; i < 60; i++) {
    makeField(1 + (i % 8));
    locks += FIELD.grid.filter(b => b && (b.type === B_LOCK0 || b.type === B_LOCK1)).length;
  }
  check('ひとり用では色つきブロックが出ない（60畑ぶん）', locks === 0, `色つき=${locks}`);

  // 上側を触っても何も起きない
  const before = G.players[0].tx;
  onDown(ev(80, 400, 200));
  check('ひとり用では上側を触っても無反応',
        G.players.length === 1 && G.players[0].tx === before, `tx=${G.players[0].tx}`);
  onUp(ev(80, 400, 200));

  // 実際に掘ってクリアできるか
  onDown(ev(81, 400, 1000));
  let cleared = false, soloFrames = 0;
  for (let i = 0; i < 60 * 240; i++) {
    soloFrames = i;
    onMove(ev(81, aimFinger(true, i), 900 + (i % 200)));
    update(1/60); draw();
    if (G.stage >= 2) { cleared = true; break; }
  }
  check('ひとりでもステージをクリアできる', cleared,
        `stage=${G.stage} 掘=${G.players[0].dug} 経過=${(soloFrames/60).toFixed(1)}秒`);
  console.log(`  参考: ひとり用のクリア時間 ${(soloFrames/60).toFixed(1)}秒`);
  onUp(ev(81, 400, 1000));

  // ふたり用に戻す
  resetGame(false);
  makeField(1);
  check('ふたり用に戻すと2機になる', G.players.length === 2);
  check('ひとり用の畑はふたり用より広い',
        soloRows > FIELD.rows && soloCount > FIELD.grid.filter(Boolean).length,
        `ひとり=${soloRows}段/${soloCount}個 ふたり=${FIELD.rows}段/${FIELD.grid.filter(Boolean).length}個`);
  check('ひとり用はスターも多い', soloStars > G.starsTotal, `ひとり★${soloStars} ふたり★${G.starsTotal}`);
  onDown(ev(1, 400, 1000)); onDown(ev(2, 400, 200));
}

// --- 通常攻撃は扇状 ---
{
  const p = G.players[0];
  p.charge = 0; p.cool = 0; p.firing = false;
  G.bullets.length = 0;
  playerShoot(p);
  const angs = G.bullets.map(b => Math.atan2(b.vx || 0, -b.vy));
  check('通常攻撃はまっすぐ1発＋斜め2発',
        G.bullets.length === 3 &&
        angs.filter(a => Math.abs(a) < 0.01).length === 1 &&
        angs.filter(a => a < -0.05).length === 1 &&
        angs.filter(a => a > 0.05).length === 1,
        `本数=${G.bullets.length} 角度=${angs.map(a => a.toFixed(2)).join(', ')}`);
  check('通常攻撃は貫通しない', G.bullets.every(b => !b.pierce));
  G.bullets.length = 0; p.cool = 0;
}

// --- 爆発の巻き込み ---
{
  const p0 = G.players[0], p1 = G.players[1];
  p0.stun = 0; p1.stun = 0;
  p0.x = 400; p0.y = Z.bot.y0;                  // 畑のすぐそばに立つ
  p1.x = 400; p1.y = Z.top.y0;                  // 遠くにいる
  G.blasts.length = 0; G.flash = 0;
  // 待機中に流れ弾が別の爆弾を誘爆させると検証がぶれるので、爆弾を取り除いておく
  for (const b of FIELD.grid) if (b && b.type === B_BOMB) { b.type = 0; b.hp = b.maxHp = 24; }

  // 爆風の広さも確認する（陣地の奥まで届くこと）
  explode(400, Z.bot.y0 - FIELD.cell);          // 近くで爆発
  check('爆風に巻き込まれると動けなくなる', p0.stun === BLAST_STUN, `stun=${p0.stun}`);
  check('離れていれば巻き込まれない', p1.stun === 0, `stun=${p1.stun}`);
  check('衝撃波と閃光が出る', G.blasts.length === 1 && G.flash > 0.5,
        `blasts=${G.blasts.length} flash=${G.flash.toFixed(2)}`);
  // 陣地の奥にいても届く広さか（爆心から2セルぶん奥）
  p0.stun = 0; p0.y = Z.bot.y0 - FIELD.cell + FIELD.cell * 2.4;
  explode(400, Z.bot.y0 - FIELD.cell);
  check('陣地の奥に下がっていても爆風が届く', p0.stun === BLAST_STUN,
        `距離=${(FIELD.cell*2.4).toFixed(0)}px stun=${p0.stun}`);
  p0.y = Z.bot.y0; p0.stun = BLAST_STUN;
  // スタン中は撃てず、解除されたら指を置き直さずに撃ち始められる
  p0.firing = true; p0.cool = 0; G.bullets.length = 0;
  for (let i = 0; i < 20; i++) update(1/60);
  const mine = () => G.bullets.filter(b => b.owner === 0).length;
  check('爆発で動けない間は撃てない', mine() === 0, `弾=${mine()}`);

  // 時間が経てば解除され、衝撃波も消える
  const stunFrames = Math.ceil(BLAST_STUN * 60);
  for (let i = 0; i < stunFrames + 60 && p0.stun > 0; i++) update(1/60);
  check(`フリーズは${BLAST_STUN}秒で解除される`, p0.stun === 0, `stun=${p0.stun.toFixed(2)}`);
  // 撃ち始めるかどうかを見たいので、いったん弾を空にしてから数フレームだけ進める
  G.bullets.length = 0;
  let fired = 0;
  for (let i = 0; i < 20; i++) { update(1/60); fired = Math.max(fired, mine()); }
  check('解除後は指を置き直さずに撃てる', fired > 0, `弾=${fired}`);
  for (let i = 0; i < 60; i++) update(1/60);
  check('衝撃波は後片付けされる', G.blasts.length === 0, `blasts=${G.blasts.length}`);
  check('閃光も消える', G.flash === 0, `flash=${G.flash}`);
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
  G.chips.length=0;    // かけらを拾うとチャージが増えるので、混ざらないよう空にする
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
  onMove(ev(1, aimFinger(true, i), 900 + (i % 200)));
  onMove(ev(2, aimFinger(false, i + 9), 300 - (i % 200)));
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
