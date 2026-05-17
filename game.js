const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const W = 800, H = 500, GROUND_Y = 442, LEVEL_W = 7400;
const GRAVITY = 0.55, SPEED = 4.5, JUMP_F = -13;
const TOTAL_WALLS = 5;
const PAV_H = Math.round((H - GROUND_Y) * 0.4); // ~23px pavement
const ROAD_Y = GROUND_Y + PAV_H;                 // road starts here

// ─── Language ──────────────────────────────────────────────────────────────
const LANGS = {
  en: {
    title1:'Adventures of', name:'Anthony',
    subtitle:'Tag 5 walls to own the city!',
    walls:(n,t)=>`Walls: ${n} / ${t}`,
    play:'PLAY', playAgain:'Play Again', tryAgain:'Try Again',
    winTitle:'🎨 City Owned!', winSub:'Anthony tagged the whole block!',
    goTitle:'Game Over',
    tagLabel:'[E] Tag',
    controls:['← → Move','↑ / Space  Jump','Z  Attack','E  Tag wall'],
    langBtn:'🇵🇱 PL',
    signShop:'SHOP', signGarage:'GARAŻ', signBit:'BIT', signBiedronka:'Biedronka',
    yourTime:'Your time:', bestTimes:'🏆 Best Times', namePH:'Your name…', anon:'Anon',
  },
  pl: {
    title1:'Przygody', name:'Antoniego',
    subtitle:'Otaguj 5 ścian, żeby rządzić miastem!',
    walls:(n,t)=>`Ściany: ${n} / ${t}`,
    play:'GRAJ', playAgain:'Zagraj ponownie', tryAgain:'Spróbuj ponownie',
    winTitle:'🎨 Miasto zdobyte!', winSub:'Antoni otagował całą dzielnicę!',
    goTitle:'Koniec gry',
    tagLabel:'[E] Taguj',
    controls:['← → Ruch','↑ / Spacja  Skok','Z  Atak','E  Taguj ścianę'],
    langBtn:'🇬🇧 EN',
    signShop:'SKLEP', signGarage:'GARAŻ', signBit:'BIT', signBiedronka:'Biedronka',
    yourTime:'Twój czas:', bestTimes:'🏆 Najlepsze czasy', namePH:'Twoje imię…', anon:'Anonim',
  },
};
let lang = 'en';
const t = (k,...a)=>{ const v=LANGS[lang][k]; return typeof v==='function'?v(...a):v; };

function renderLang() {
  document.getElementById('ui-title1').textContent    = t('title1');
  document.getElementById('ui-name').textContent      = t('name');
  document.getElementById('ui-subtitle').textContent  = t('subtitle');
  document.getElementById('ui-win-title').textContent = t('winTitle');
  document.getElementById('ui-win-sub').textContent   = t('winSub');
  document.getElementById('ui-go-title').textContent  = t('goTitle');
  document.getElementById('start-btn').textContent    = t('play');
  document.getElementById('restart-btn').textContent  = t('playAgain');
  document.getElementById('retry-btn').textContent    = t('tryAgain');
  document.getElementById('lang-btn').textContent     = t('langBtn');
  document.getElementById('ui-lb-title').textContent     = t('bestTimes');
  document.getElementById('ui-lb-title-win').textContent = t('bestTimes');
  document.getElementById('player-name').placeholder  = t('namePH');
  document.getElementById('ui-controls').innerHTML    = t('controls').map(c=>`<span>${c}</span>`).join('');
  updateHUD();
}

// ─── Input ─────────────────────────────────────────────────────────────────
const keys={}, jp={};
window.addEventListener('keydown', e=>{
  if(!keys[e.key]) jp[e.key]=true;
  keys[e.key]=true;
  if([' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
});
window.addEventListener('keyup', e=>{ keys[e.key]=false; });

// ─── Gamepad (PS5 DualSense / any standard BT controller) ─────────────────
// Tracks which keys were injected by the gamepad so we don't stomp keyboard.
const _gpKeys = new Set();

function pollGamepad(){
  const gp = (navigator.getGamepads?.() ?? [])[0];
  if(!gp) return;

  // gpset: feeds a virtual key into the existing keys/jp system.
  // Rising edge (inactive→active) fires jp[] just like a keydown event.
  function gpset(k, active){
    if(active){
      if(!keys[k]) jp[k] = true;   // rising edge → "just pressed"
      keys[k] = true;
      _gpKeys.add(k);
    } else if(_gpKeys.has(k)){
      delete keys[k];
      _gpKeys.delete(k);
    }
  }

  const DEAD = 0.25;
  const lx = gp.axes[0] ?? 0;

  // ── Movement: left stick OR D-pad ─────────────────────────────────────────
  const goLeft  = lx < -DEAD || (gp.buttons[14]?.pressed ?? false); // stick-L / D-left
  const goRight = lx >  DEAD || (gp.buttons[15]?.pressed ?? false); // stick-R / D-right
  gpset('ArrowLeft',  goLeft  && !goRight);
  gpset('ArrowRight', goRight && !goLeft);

  // ── Buttons ────────────────────────────────────────────────────────────────
  // Cross (×) btn 0  → Jump          (also D-pad up btn 12)
  // Square (□) btn 2  → Attack (Z)
  // Triangle (△) btn 3 → Tag wall (E)
  const jump   = (gp.buttons[0]?.pressed  ?? false)  // ×
               ||(gp.buttons[12]?.pressed ?? false);  // D-up
  gpset('ArrowUp', jump);
  gpset('z',       gp.buttons[2]?.pressed ?? false);  // □ attack
  gpset('e',       gp.buttons[3]?.pressed ?? false);  // △ tag
}

// ─── Scoring ───────────────────────────────────────────────────────────────
let gameStartTime=null, gameWinMs=null;
const timerEl = document.getElementById('timer');
function formatTime(ms){ const s=Math.floor(ms/1000),m=Math.floor(s/60);return `${m}:${String(s%60).padStart(2,'0')}`; }
function formatTimeFull(ms){ const s=Math.floor(ms/1000),m=Math.floor(s/60),cs=String(Math.floor((ms%1000)/10)).padStart(2,'0');return `${m}:${String(s%60).padStart(2,'0')}.${cs}`; }
// ── Local cache (fallback when offline) ───────────────────────────────────
function lbGetLocal(){ try{ return JSON.parse(localStorage.getItem('anthonyLB')||'[]'); }catch{ return []; } }
function lbSetLocal(lb){ localStorage.setItem('anthonyLB', JSON.stringify(lb)); }

// ── Online leaderboard via /api/scores ────────────────────────────────────
async function lbSave(name,ms){
  const n=name||t('anon');
  // 1. Always persist locally first
  const loc=lbGetLocal();
  const li=loc.findIndex(e=>e.name.toLowerCase()===n.toLowerCase());
  if(li!==-1){if(ms<loc[li].time)loc[li].time=ms;}else loc.push({name:n,time:ms});
  loc.sort((a,b)=>a.time-b.time);loc.splice(10);lbSetLocal(loc);
  // 2. Try to sync online; if it returns an updated board, refresh local cache
  try{
    const r=await fetch('/api/scores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,time:ms})});
    if(r.ok){ const fresh=await r.json(); if(Array.isArray(fresh)&&fresh.length) lbSetLocal(fresh); }
  }catch{}
}

async function lbRender(elId,highlightMs=null){
  const el=document.getElementById(elId);
  let lb=lbGetLocal();
  // Try to pull fresh global board
  try{
    const r=await fetch('/api/scores');
    if(r.ok){ const data=await r.json(); if(Array.isArray(data)&&data.length){ lb=data; lbSetLocal(data); } }
  }catch{}
  if(!lb.length){ el.innerHTML=`<div class="lb-empty">No records yet</div>`; return; }
  el.innerHTML=lb.slice(0,5).map((e,i)=>{
    const cls=(highlightMs!==null&&e.time===highlightMs)?'lb-row lb-you':'lb-row';
    return `<div class="${cls}"><span class="lb-rank">${i+1}.</span><span class="lb-name">${e.name}</span><span class="lb-time">${formatTimeFull(e.time)}</span></div>`;
  }).join('');
}

// ─── State ─────────────────────────────────────────────────────────────────
let gameState='start', camX=0, wallsTagged=0, lives=3;
const particles=[];
function overlap(ax,ay,aw,ah,bx,by,bw,bh){ return ax<bx+bw&&ax+aw>bx&&ay<by+bh&&ay+ah>by; }

// ─── Level data ────────────────────────────────────────────────────────────
const platforms = [
  // ── BIT store ──────────────────────────────────────────────────────────────
  { x:30,   y:268, w:260, h:13, type:'ledge', btype:'building', sign:'BIT' },
  // ── Paczkomat ──────────────────────────────────────────────────────────────
  { x:295,  y:322, w:55,  h:120, type:'paczkomat' },
  // ── buildings / garages ────────────────────────────────────────────────────
  { x:870,  y:262, w:165, h:13, type:'ledge', btype:'garage'        },
  { x:1580, y:242, w:185, h:13, type:'ledge', btype:'building'      },
  { x:2390, y:228, w:220, h:13, type:'ledge', btype:'school'        },
  { x:2980, y:242, w:260, h:13, type:'ledge', btype:'double_garage' },
  { x:3720, y:360, w:110, h:13, type:'ledge', btype:'skate_ramp'   },
  { x:3980, y:232, w:160, h:13, type:'ledge', btype:'building'      },
  { x:4680, y:224, w:195, h:13, type:'ledge', btype:'church'        },
  { x:5480, y:228, w:210, h:13, type:'ledge', btype:'garage'        },
  { x:5970, y:222, w:190, h:13, type:'ledge', btype:'building'      },
  { x:6500, y:242, w:225, h:13, type:'ledge', btype:'garage'        },
  // ── Biedronka ──────────────────────────────────────────────────────────────
  { x:6900, y:224, w:270, h:13, type:'ledge', btype:'biedronka'     },

  // ── cars: grey/white/black sedans & combis ─────────────────────────────────
  { x:560,  y:400, w:130, h:42, type:'car', color:'#8a8a8a', style:'sedan'  },
  { x:1790, y:400, w:140, h:42, type:'car', color:'#eeeeee', style:'combi'  },
  { x:3110, y:400, w:130, h:42, type:'car', color:'#222222', style:'sedan'  },
  { x:4460, y:400, w:140, h:42, type:'car', color:'#555555', style:'combi'  },
  { x:5660, y:400, w:130, h:42, type:'car', color:'#aaaaaa', style:'sedan'  },

  // ── vans: white only, double car height ────────────────────────────────────
  { x:1200, y:358, w:155, h:84, type:'van', color:'#eeeeee' },
  { x:3420, y:358, w:155, h:84, type:'van', color:'#eeeeee' },
  { x:5300, y:358, w:155, h:84, type:'van', color:'#eeeeee' },

  // ── dumpsters ──────────────────────────────────────────────────────────────
  { x:1090, y:404, w:82, h:38, type:'dumpster', color:'#27ae60' },
  { x:2590, y:404, w:82, h:38, type:'dumpster', color:'#16a085' },
  { x:5130, y:404, w:82, h:38, type:'dumpster', color:'#27ae60' },

  // ── solid walls (cops bounce) ──────────────────────────────────────────────
  { x:1370, y:362, w:26, h:80,  type:'wall' },
  { x:2170, y:350, w:26, h:92,  type:'wall' },
  { x:3570, y:340, w:26, h:102, type:'wall' },
  { x:4770, y:362, w:26, h:80,  type:'wall' },
  { x:5950, y:342, w:26, h:100, type:'wall' },

  // ── European wheeled trash bins: ONE per building ──────────────────────────
  { x:26,   y:370, w:28, h:72, type:'trashcan' }, // BIT
  { x:848,  y:370, w:28, h:72, type:'trashcan' }, // garage x=870
  { x:1558, y:370, w:28, h:72, type:'trashcan' }, // building x=1580
  { x:2368, y:370, w:28, h:72, type:'trashcan' }, // school x=2390
  { x:2958, y:370, w:28, h:72, type:'trashcan' }, // double_garage x=2980
  { x:3958, y:370, w:28, h:72, type:'trashcan' }, // building x=3980
  { x:4658, y:370, w:28, h:72, type:'trashcan' }, // church x=4680
  { x:5458, y:370, w:28, h:72, type:'trashcan' }, // garage x=5480
  { x:5948, y:370, w:28, h:72, type:'trashcan' }, // building x=5970
  { x:6878, y:370, w:28, h:72, type:'trashcan' }, // Biedronka x=6900
];

// Graffiti sections — lower facade, visually part of the building wall
const graffitiWalls = [
  { x:900,  y:300, w:80, h:130, tagged:false, prog:0 }, // garage x=870
  { x:1640, y:285, w:80, h:145, tagged:false, prog:0 }, // building x=1580
  { x:2450, y:280, w:80, h:148, tagged:false, prog:0 }, // school x=2390
  { x:4730, y:275, w:80, h:155, tagged:false, prog:0 }, // church x=4680
  { x:6970, y:270, w:80, h:160, tagged:false, prog:0 }, // Biedronka x=6900
];

// Birch tree (decorative)
const BIRCH = { x:360, w:70, h:174 };

// School yard (decorative, drawn in drawDecor)
const SCHOOL = { x:2390, w:220 };

// ─── Player ────────────────────────────────────────────────────────────────
const player = {
  x:160, y:386, w:30, h:56,
  vx:0, vy:0, onGround:false, jumpCount:0,
  dir:1, state:'idle',
  atkTimer:0, ATK_DUR:22,
  invTimer:0,
  tagTimer:0, TAG_DUR:115,
  nearWall:null,
};

// ─── Police enemy ── ground-only patrol ───────────────────────────────────
class Police {
  constructor(x,y){ this.x=x;this.y=y;this.w=40;this.h=84;this.vx=-0.85;this.vy=0;this.onGround=false;this.state='walk';this.hitTimer=0;this.deadTimer=0;this.dir=-1;this.startX=x;this.range=130;this.step=0;this.stepT=0; }
  update(){
    if(this.state==='dead'){this.deadTimer++;return;}
    if(this.state==='hit'){this.vx*=0.78;this.vy+=GRAVITY;this.x+=this.vx;this.y+=this.vy;this._ground();this._walls();if(--this.hitTimer<=0)this.state='dead';return;}
    if(++this.stepT>14){this.step^=1;this.stepT=0;}
    this.x+=this.vx;this._walls();
    if(this.x<this.startX-this.range||this.x>this.startX+this.range){this.vx*=-1;this.dir*=-1;}
    this.vy+=GRAVITY;this.y+=this.vy;this._ground();
  }
  // Police only land on the street — no building/car rooftop patrol
  _ground(){
    if(this.y+this.h>=GROUND_Y){this.y=GROUND_Y-this.h;this.vy=0;this.onGround=true;}
  }
  _walls(){
    for(const p of platforms){
      if(p.type!=='wall') continue;
      if(!overlap(this.x,this.y,this.w,this.h,p.x,p.y,p.w,p.h)) continue;
      const ox=Math.min(this.x+this.w,p.x+p.w)-Math.max(this.x,p.x);
      if(this.x+this.w/2<p.x+p.w/2)this.x-=ox;else this.x+=ox;
      this.vx*=-1;this.dir*=-1;
    }
  }
  hit(dir){this.state='hit';this.hitTimer=28;this.vx=dir*5;this.vy=-6;}
  draw(){
    if(this.state==='dead'&&this.deadTimer>55) return;
    const sx=this.x-camX;
    if(sx>W+60||sx+this.w<-60) return;
    const a=this.state==='dead'?Math.max(0,1-this.deadTimer/55):1;
    ctx.globalAlpha=a;
    _shadow(sx+this.w/2,Math.round(this.w*.65));
    _drawPolice(sx,this.y,this.w,this.h,this.dir,this.step,this.state!=='walk');
    ctx.globalAlpha=1;
  }
}

let enemies=[];
function initEnemies(){
  enemies=[
    new Police(460,  390),
    new Police(970,  390),
    new Police(1310, 390),
    new Police(1690, 390),
    new Police(2210, 390),
    new Police(2840, 390),
    new Police(3620, 390),
    new Police(4100, 390),
    new Police(4540, 390),
    new Police(5870, 390),
    new Police(6390, 390),
    new Police(6980, 390),
  ];
}

// ─── Draw utilities ────────────────────────────────────────────────────────
function _shadow(cx,rx){ ctx.fillStyle='rgba(0,0,0,0.22)';ctx.beginPath();ctx.ellipse(cx,GROUND_Y+1,rx,5,0,0,Math.PI*2);ctx.fill(); }
function _darken(hex,amt=40){ const n=parseInt(hex.slice(1),16);return `rgb(${Math.max(0,((n>>16)&255)-amt)},${Math.max(0,((n>>8)&255)-amt)},${Math.max(0,(n&255)-amt)})`; }
function _lighten(hex,amt=30){ const n=parseInt(hex.slice(1),16);return `rgb(${Math.min(255,((n>>16)&255)+amt)},${Math.min(255,((n>>8)&255)+amt)},${Math.min(255,(n&255)+amt)})`; }
function _rr(x,y,w,h,r){ ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath(); }

// ─── Police drawing ────────────────────────────────────────────────────────
function _drawPolice(x,y,w,h,dir,step,hurt){
  const navy='#1a2550',navyL='#1e2f62',skin=hurt?'#f0d0a0':'#f5cba7';
  const lw=Math.round(w*.32); // leg width proportional to body
  const sw=Math.round(w*.38); // shoe width
  const sh=Math.round(h*.09); // shoe height
  const capH=Math.round(h*.13);
  // ── legs ──────────────────────────────────────────────────────────────────
  ctx.fillStyle=navy;
  ctx.fillRect(x+2,         y+h*.62-(step?4:0), lw, h*.38+(step?4:0));
  ctx.fillRect(x+w-2-lw,    y+h*.62+(step?4:0), lw, Math.max(4,h*.38-(step?4:0)));
  // shoes
  ctx.fillStyle='#111';
  ctx.fillRect(x+1,       y+h-sh, sw, sh);
  ctx.fillRect(x+w-1-sw,  y+h-sh, sw, sh);
  // ── body / uniform ────────────────────────────────────────────────────────
  ctx.fillStyle=navy;ctx.fillRect(x+2,y+h*.34,w-4,h*.29);
  ctx.fillStyle='#dde';ctx.fillRect(x+w/2-5,y+h*.34,10,Math.round(h*.09)); // collar/shirt
  ctx.fillStyle='#f1c40f';ctx.fillRect(x+6,y+h*.41,Math.round(w*.22),Math.round(h*.07)); // badge bar
  ctx.fillStyle='#111';ctx.fillRect(x+2,y+h*.61,w-4,4);                    // belt
  ctx.fillStyle='#555';ctx.fillRect(x+w/2-4,y+h*.61,8,4);                  // belt buckle
  ctx.fillStyle='#333';ctx.fillRect(x+w-Math.round(w*.32),y+h*.58,Math.round(w*.22),6); // holster
  // ── arms ──────────────────────────────────────────────────────────────────
  const aw=Math.round(w*.22);
  ctx.fillStyle=navyL;ctx.fillRect(x-4,y+h*.36,aw,Math.round(h*.26));ctx.fillRect(x+w+4-aw,y+h*.36,aw,Math.round(h*.26));
  ctx.fillStyle=skin;ctx.fillRect(x-4,y+h*.58,aw,Math.round(h*.09));ctx.fillRect(x+w+4-aw,y+h*.58,aw,Math.round(h*.09));
  // baton
  ctx.fillStyle='#222';
  if(dir>0)ctx.fillRect(x+w,y+Math.round(h*.1),Math.round(w*.28),5);
  else     ctx.fillRect(x-Math.round(w*.28),y+Math.round(h*.1),Math.round(w*.28),5);
  // ── head ──────────────────────────────────────────────────────────────────
  ctx.fillStyle=skin;ctx.fillRect(x+Math.round(w*.15),y+capH,Math.round(w*.7),h*.3);
  // police cap
  ctx.fillStyle=navy;ctx.fillRect(x+Math.round(w*.1),y,Math.round(w*.8),capH);
  ctx.fillStyle='#ccd';ctx.fillRect(x+Math.round(w*.1),y+capH-3,Math.round(w*.8),3); // cap band
  // cap peak
  ctx.fillStyle='#141b3a';
  if(dir>0)ctx.fillRect(x+Math.round(w*.7),y+capH-4,Math.round(w*.4),5);
  else     ctx.fillRect(x-Math.round(w*.1),y+capH-4,Math.round(w*.4),5);
  // badge disc on cap
  ctx.fillStyle='#f1c40f';ctx.beginPath();ctx.ellipse(x+w/2,y+Math.round(capH*.55),Math.round(w*.14),Math.round(capH*.36),0,0,Math.PI*2);ctx.fill();
  // eyes
  const eox=dir>0?Math.round(w*.08):-Math.round(w*.05);
  ctx.fillStyle='#2c3e50';
  ctx.fillRect(x+Math.round(w*.22)+eox,y+capH+Math.round(h*.1),Math.round(w*.14),Math.round(h*.06));
  ctx.fillRect(x+w-Math.round(w*.36)+eox,y+capH+Math.round(h*.1),Math.round(w*.14),Math.round(h*.06));
}

// ─── Player drawing ────────────────────────────────────────────────────────
function drawPlayer(){
  const{x,y,w,h,dir,atkTimer,invTimer,state}=player;
  const sx=x-camX;
  if(invTimer>0&&Math.floor(invTimer/5)%2===0) return;
  const tagging=!!(player.nearWall&&player.tagTimer>0);
  const lo=state==='run'&&!tagging?Math.sin(Date.now()*.016)*5:0;

  // ── Red skateboard (horizontal under feet while riding) ────────────────────
  if(!tagging){
    const bx=sx-10, by=y+h-3, bw=w+20, bh=9;
    // deck
    ctx.fillStyle='#c0392b'; ctx.fillRect(bx+5,by,bw-10,bh);
    // nose & tail (rounded kicks)
    ctx.fillStyle='#922b21'; ctx.fillRect(bx,by+3,8,bh-3); ctx.fillRect(bx+bw-8,by+3,8,bh-3);
    // top stripe
    ctx.fillStyle='#e74c3c'; ctx.fillRect(bx+5,by,bw-10,3);
    // grip-tape texture
    ctx.fillStyle='rgba(0,0,0,0.22)'; ctx.fillRect(bx+5,by,bw-10,4);
    // trucks (grey axle bars)
    ctx.fillStyle='#999';
    ctx.fillRect(bx+8,by+bh,13,3); ctx.fillRect(bx+bw-21,by+bh,13,3);
    // 4 wheels
    ctx.fillStyle='#1a1a1a';
    for(const wx of [bx+10,bx+17,bx+bw-18,bx+bw-11]){
      ctx.beginPath(); ctx.arc(wx,by+bh+5,5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#555'; ctx.beginPath(); ctx.arc(wx,by+bh+5,2,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#1a1a1a';
    }
  }

  _shadow(sx+w/2,22);

  // ── Legs — blue jeans ──────────────────────────────────────────────────────
  ctx.fillStyle='#1e4fa8';
  ctx.fillRect(sx+4,    y+h*.61-lo, 11, h*.39+lo);
  ctx.fillRect(sx+w-15, y+h*.61+lo, 11, Math.max(4,h*.39-lo));
  // highlight seam
  ctx.fillStyle='#2d65cc';
  ctx.fillRect(sx+6,    y+h*.65, 4, h*.28);
  ctx.fillRect(sx+w-13, y+h*.65, 4, h*.28);
  // white sneakers
  ctx.fillStyle='#eeeeee';
  ctx.fillRect(sx+2,    y+h-8, 14, 8); ctx.fillRect(sx+w-16,y+h-8,14,8);
  ctx.fillStyle='#cccccc'; // grey sole
  ctx.fillRect(sx+2,    y+h-4, 14, 4); ctx.fillRect(sx+w-16,y+h-4,14,4);
  ctx.fillStyle='#e74c3c'; // red sole stripe
  ctx.fillRect(sx+2,    y+h-5, 14, 1); ctx.fillRect(sx+w-16,y+h-5,14,1);

  // ── Torso — white t-shirt ──────────────────────────────────────────────────
  ctx.fillStyle='#f0f0f0'; ctx.fillRect(sx+2,y+h*.34,w-4,h*.29);
  ctx.fillStyle='rgba(0,0,0,0.07)'; ctx.fillRect(sx+w/2-1,y+h*.34,2,h*.29); // crease

  // ── Arms / attack / tagging ───────────────────────────────────────────────
  if(tagging){
    // Board vertical in front, leaning on ground
    const vbX=dir>0 ? sx+w+3 : sx-17;
    const vbY=y+h*.2, vbW=13, vbH=h*.8;
    ctx.fillStyle='#c0392b'; ctx.fillRect(vbX,vbY,vbW,vbH);
    ctx.fillStyle='#922b21';
    ctx.fillRect(vbX,vbY,vbW,5); ctx.fillRect(vbX,vbY+vbH-5,vbW,5); // nose/tail
    ctx.fillStyle='rgba(0,0,0,0.22)'; ctx.fillRect(vbX+2,vbY+7,vbW-4,vbH-14); // grip
    // side wheels
    const wX=dir>0 ? vbX-5 : vbX+vbW+5;
    ctx.fillStyle='#1a1a1a';
    ctx.beginPath(); ctx.arc(wX,vbY+10,  6,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(wX,vbY+vbH-10,6,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#555';
    ctx.beginPath(); ctx.arc(wX,vbY+10,  2,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(wX,vbY+vbH-10,2,0,Math.PI*2); ctx.fill();
    // arm holding board
    ctx.fillStyle='#f5cba7';
    if(dir>0){ ctx.fillRect(sx+w-3,y+h*.4,11,16); }
    else      { ctx.fillRect(sx-8,  y+h*.4,11,16); }
    // other arm: spray can
    ctx.fillStyle='#f5cba7';
    if(dir>0){ ctx.fillRect(sx-4,y+h*.38,9,20); _drawSprayCan(sx-20,y+h*.30,-1); }
    else      { ctx.fillRect(sx+w-5,y+h*.38,9,20); _drawSprayCan(sx+w+6,y+h*.30,1); }
  } else if(atkTimer>0){
    ctx.fillStyle='#f5cba7';
    const ax=dir>0?sx+w-2:sx-18; ctx.fillRect(ax,y+h*.36,20,9);
    _drawSprayCan(dir>0?sx+w+14:sx-28,y+h*.31,dir);
  } else {
    ctx.fillStyle='#f5cba7'; // short-sleeve arms (skin)
    ctx.fillRect(sx-3,y+h*.36,8,20); ctx.fillRect(sx+w-5,y+h*.36,8,20);
  }

  // ── Head ──────────────────────────────────────────────────────────────────
  const hx=sx+(w-24)/2, hy=y, hw=24, hh=Math.round(h*.32);
  // face
  ctx.fillStyle='#f5cba7'; ctx.fillRect(hx,hy+7,hw,hh-2);
  // blonde hair peeking below/sides of helmet
  ctx.fillStyle='#d4a820';
  ctx.fillRect(hx-4,hy+11,5,hh-4);      // left
  ctx.fillRect(hx+hw-1,hy+11,5,hh-4);   // right
  ctx.fillRect(hx,hy+hh+3,hw,5);         // back/bottom strands

  // white skater helmet (dome)
  ctx.fillStyle='#efefef';
  ctx.beginPath();
  ctx.arc(hx+hw/2, hy+10, hw/2+5, Math.PI,0); ctx.fill();
  ctx.fillRect(hx-5, hy+8, hw+10, 9); // lower band that wraps around
  // helmet vents
  ctx.strokeStyle='#d0d0d0'; ctx.lineWidth=1;
  for(const vx of [hx+4, hx+hw/2-1, hx+hw-4]){
    ctx.beginPath(); ctx.moveTo(vx,hy+3); ctx.lineTo(vx,hy+14); ctx.stroke();
  }
  // shine
  ctx.fillStyle='rgba(255,255,255,0.52)';
  ctx.beginPath(); ctx.ellipse(hx+hw/2-4,hy+5,5,3,-0.4,0,Math.PI*2); ctx.fill();
  // chin strap
  ctx.strokeStyle='#bbb'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(hx+1,hy+15); ctx.lineTo(hx+4,hy+hh+2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx+hw-1,hy+15); ctx.lineTo(hx+hw-4,hy+hh+2); ctx.stroke();
  ctx.fillStyle='#aaa'; ctx.fillRect(hx+hw/2-3,hy+hh+1,6,3); // buckle

  // face features
  const eox=dir>0?3:-2;
  ctx.fillStyle='#fff'; ctx.fillRect(hx+4+eox,hy+11,5,4); ctx.fillRect(hx+14+eox,hy+11,5,4);
  ctx.fillStyle='#2c3e50'; ctx.fillRect(hx+5+eox,hy+12,3,3); ctx.fillRect(hx+15+eox,hy+12,3,3);
  ctx.fillStyle='#c8a020'; ctx.fillRect(hx+3+eox,hy+10,7,2); ctx.fillRect(hx+13+eox,hy+10,7,2); // brows
  ctx.fillStyle='#c0392b'; ctx.fillRect(hx+6+eox,hy+hh-4,10,2); // mouth
}
function _drawSprayCan(x,y,dir){
  ctx.fillStyle='#f1c40f';ctx.fillRect(x,y,12,20);
  ctx.fillStyle='#d4ac0d';ctx.fillRect(x+2,y-5,8,6);
  const cols=['#e74c3c','#f39c12','#2ecc71','#3498db','#9b59b6'];
  for(let i=0;i<5;i++){const px=x+(dir>0?12+Math.random()*18:-Math.random()*18),py=y+Math.random()*12;ctx.fillStyle=cols[i%cols.length];ctx.beginPath();ctx.arc(px,py,2+Math.random()*3,0,Math.PI*2);ctx.fill();}
}

// ─── Graffiti wall ─────────────────────────────────────────────────────────
// Tag is drawn ON the building facade (no background rect override)
function drawGraffitiWall(gw){
  const sx=gw.x-camX;
  if(sx>W+90||sx+gw.w<-90) return;

  if(gw.tagged){
    _drawBubbleTag(sx, gw.y, gw.w, gw.h);
  } else {
    // Subtle yellow border hint on the taggable zone
    ctx.strokeStyle='rgba(255,255,80,0.35)';ctx.lineWidth=2;
    ctx.strokeRect(sx+1,gw.y+1,gw.w-2,gw.h-2);
    // [E] Tag label above
    ctx.fillStyle='rgba(255,255,80,0.92)';ctx.font='11px Arial';ctx.textAlign='center';
    ctx.fillText(t('tagLabel'),sx+gw.w/2,gw.y-6);
    if(gw.prog>0){
      ctx.fillStyle='rgba(0,0,0,0.55)';ctx.fillRect(sx,gw.y-20,gw.w,11);
      const pc=['#e74c3c','#f39c12','#2ecc71'];
      ctx.fillStyle=pc[Math.floor(Date.now()/280)%pc.length];
      ctx.fillRect(sx,gw.y-20,gw.w*(gw.prog/100),11);
    }
  }
}

// Bubble-letter graffiti tag matching the reference image style
function _drawBubbleTag(sx, gy, gw, gh){
  ctx.save();
  ctx.beginPath();ctx.rect(sx, gy, gw, gh);ctx.clip();

  const n=4, lw=gw/(n*0.78);

  for(let i=0;i<n;i++){
    const lx = sx + i*(gw*0.78/n);
    const topY = gy + gh*0.04;
    const botY = gy + gh*0.68;
    const topH = gh*0.38, topW=lw*0.62;
    const topX = lx + lw*0.14;

    // drop shadow
    ctx.globalAlpha = 0.55;
    ctx.fillStyle='#000';
    _rr(topX+5, topY+5, topW, topH, 9); ctx.fill();
    ctx.beginPath();ctx.ellipse(lx+lw*0.5+5, botY+gh*0.17+5, lw*0.42, gh*0.2, 0,0,Math.PI*2);ctx.fill();

    // bubble body — semi-transparent so brick shows through
    ctx.globalAlpha = 0.78;
    ctx.fillStyle='#e8e8e8';
    _rr(topX, topY, topW, topH, 9); ctx.fill();
    ctx.strokeStyle='#111';ctx.lineWidth=3.5;
    _rr(topX, topY, topW, topH, 9); ctx.stroke();

    // waist
    ctx.fillStyle='#d8d8d8';
    ctx.fillRect(topX+topW*0.1, topY+topH-4, topW*0.8, gh*0.14);
    ctx.strokeStyle='#111';ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(topX+topW*0.1, topY+topH-4);ctx.lineTo(topX+topW*0.9, topY+topH-4);
    ctx.moveTo(topX+topW*0.1, topY+topH+gh*0.14-4);ctx.lineTo(topX+topW*0.9, topY+topH+gh*0.14-4);
    ctx.stroke();

    // bottom bulge
    ctx.fillStyle='#e8e8e8';
    ctx.beginPath();ctx.ellipse(lx+lw*0.5, botY+gh*0.17, lw*0.42, gh*0.2, 0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#111';ctx.lineWidth=3.5;
    ctx.beginPath();ctx.ellipse(lx+lw*0.5, botY+gh*0.17, lw*0.42, gh*0.2, 0,0,Math.PI*2);ctx.stroke();

    // highlight gloss
    ctx.globalAlpha=0.45;
    ctx.fillStyle='rgba(255,255,255,0.8)';
    ctx.beginPath();ctx.ellipse(topX+topW*0.3, topY+topH*0.25, topW*0.14, topH*0.12, -0.3,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.ellipse(lx+lw*0.38, botY+gh*0.08, lw*0.1, gh*0.07, -0.3,0,Math.PI*2);ctx.fill();
  }

  // "TOY" in red drip style — on top, full opacity
  ctx.globalAlpha=1;
  const fs=Math.min(22, Math.round(gh*0.19));
  ctx.font=`bold ${fs}px Arial Black`;
  ctx.textAlign='center';
  ctx.strokeStyle='#6a0000';ctx.lineWidth=4;
  ctx.strokeText('TOY', sx+gw/2, gy+gh*0.52);
  ctx.fillStyle='#e74c3c';
  ctx.fillText('TOY', sx+gw/2, gy+gh*0.52);
  // drip from Y
  const drx=sx+gw/2+fs*0.32, dry=gy+gh*0.54;
  ctx.fillRect(drx-1.5, dry, 3, gh*0.28);
  ctx.beginPath();ctx.arc(drx, dry+gh*0.28+4, 4, 0, Math.PI*2);ctx.fill();

  ctx.restore();
}

// ─── Platform drawing ──────────────────────────────────────────────────────
function drawPlatforms(){
  for(const p of platforms){
    if(p.type!=='ledge') continue;
    const sx=p.x-camX;if(sx>W+80||sx+p.w<-80) continue;
    _drawBuilding(sx,p.y,p.w,p.h,p.btype,p.x,p.sign||null);
  }
  for(const p of platforms){
    if(p.type==='ledge') continue;
    const sx=p.x-camX;if(sx>W+70||sx+p.w<-70) continue;
    if     (p.type==='car')      _drawCar(sx,p.y,p.w,p.h,p.color,p.style||'sedan');
    else if(p.type==='van')      _drawVan(sx,p.y,p.w,p.h,p.color);
    else if(p.type==='dumpster') _drawDumpster(sx,p.y,p.w,p.h,p.color);
    else if(p.type==='trashcan') _drawTrashCan(sx,p.y,p.w,p.h);
    else if(p.type==='paczkomat')_drawPaczkomat(sx,p.y,p.w,p.h);
    else if(p.type==='wall'){
      ctx.fillStyle='#7f8c8d';ctx.fillRect(sx,p.y,p.w,p.h);
      ctx.strokeStyle='#6c7a7d';ctx.lineWidth=1;
      for(let r=0;r<Math.ceil(p.h/11);r++) ctx.strokeRect(sx,p.y+r*11,p.w,11);
    }
  }
}

function _drawBuilding(sx,py,pw,ph,btype,worldX,sign){
  const facTop=py+ph, facH=GROUND_Y-facTop+2;
  if(btype==='biedronka'){ _drawBiedronka(sx,py,pw,ph,facTop,facH,worldX); return; }
  if(btype==='school')   { _drawSchool(sx,py,pw,ph,facTop,facH,worldX);    return; }
  if(btype==='church')   { _drawChurch(sx,py,pw,ph,facTop,facH,worldX);    return; }
  if(btype==='double_garage'){ _drawDoubleGarage(sx,py,pw,ph,facTop,facH,worldX); return; }
  if(btype==='skate_ramp')   { _drawSkateRamp(sx,py,pw,ph,facTop,facH);    return; }

  const winLit=(r,c)=>((Math.floor(worldX/10)+r*7+c*3)%3)!==0;
  const isBIT=(sign==='BIT');

  if(btype==='garage'){
    ctx.fillStyle=isBIT?'#f5c020':'#586374';ctx.fillRect(sx,facTop,pw,facH);
    ctx.strokeStyle=isBIT?'#d4a010':'#48535f';ctx.lineWidth=1;
    for(let y=facTop+16;y<GROUND_Y;y+=16){ctx.beginPath();ctx.moveTo(sx,y);ctx.lineTo(sx+pw,y);ctx.stroke();}
    const dw=pw*.72,dh=facH*.74,dx=sx+(pw-dw)/2,dy=GROUND_Y-dh;
    ctx.fillStyle='#3a3d4a';ctx.fillRect(dx,dy,dw,dh);
    ctx.strokeStyle='#52566a';ctx.lineWidth=1.5;
    for(let i=1;i<6;i++){const ry=dy+i*(dh/6);ctx.beginPath();ctx.moveTo(dx,ry);ctx.lineTo(dx+dw,ry);ctx.stroke();}
    ctx.fillStyle='#888';ctx.fillRect(dx+dw/2-18,dy+dh-10,36,5);
    ctx.fillStyle=isBIT?'#1a4fa0':'rgba(50,50,50,0.6)';ctx.fillRect(sx+4,facTop+4,pw-8,18);
    ctx.font='bold '+(isBIT?'14':'10')+'px Arial Black';ctx.textAlign='center';ctx.fillStyle='#fff';
    ctx.fillText(sign||t('signGarage'),sx+pw/2,facTop+15);
  } else {
    const wallCols=['#4a5568','#4e5a70','#57606f','#506070'];
    ctx.fillStyle=isBIT?'#f5c020':wallCols[Math.floor(worldX/300)%4];ctx.fillRect(sx,facTop,pw,facH);
    ctx.strokeStyle='rgba(0,0,0,0.15)';ctx.lineWidth=1;
    for(let y=facTop+12;y<GROUND_Y;y+=12){ctx.beginPath();ctx.moveTo(sx,y);ctx.lineTo(sx+pw,y);ctx.stroke();}
    const wCols=Math.max(1,Math.floor((pw-20)/38)),wRows=Math.max(1,Math.floor((facH-44)/40));
    const wStartX=sx+(pw-wCols*38+10)/2;
    for(let r=0;r<wRows;r++) for(let c=0;c<wCols;c++){
      const wx=wStartX+c*38,wy=facTop+10+r*40;
      ctx.fillStyle='#2c3e50';ctx.fillRect(wx-2,wy-2,24,28);
      ctx.fillStyle=winLit(r,c)?'rgba(255,210,70,0.58)':'#1e2d3d';
      ctx.fillRect(wx,wy,10,24);ctx.fillRect(wx+12,wy,10,24);
    }
    const dw2=Math.min(pw*.36,55),dh2=Math.min(facH*.42,50),dx2=sx+(pw-dw2)/2,dy2=GROUND_Y-dh2;
    ctx.fillStyle='#1e2d3d';ctx.fillRect(dx2,dy2,dw2,dh2);
    ctx.fillStyle='#85c1e9';ctx.fillRect(dx2+2,dy2+2,dw2/2-3,dh2-4);ctx.fillRect(dx2+dw2/2+1,dy2+2,dw2/2-3,dh2-4);
    ctx.fillStyle=isBIT?'#1a4fa0':'#e74c3c';ctx.fillRect(sx+4,facTop+4,pw-8,18);
    ctx.font='bold '+(isBIT?'14':'10')+'px Arial Black';ctx.textAlign='center';ctx.fillStyle='#fff';
    ctx.fillText(sign||t('signShop'),sx+pw/2,facTop+16);
  }
  // rooftop
  const rc=isBIT?'#7a3010':'#383838',rh=isBIT?'#9a4828':'#505050',rp=isBIT?'#5e2008':'#404040',rph=isBIT?'#9a4828':'#585858';
  ctx.fillStyle=rc;ctx.fillRect(sx,py,pw,ph);
  ctx.fillStyle=rh;ctx.fillRect(sx,py,pw,3);
  ctx.fillStyle=rp;ctx.fillRect(sx,py-9,pw,9);
  ctx.fillStyle=rph;ctx.fillRect(sx,py-9,pw,2);
  ctx.fillStyle='#353535';ctx.fillRect(sx+pw*.7,py-22,24,13);
  ctx.fillStyle='#444';ctx.fillRect(sx+pw*.7+2,py-26,20,6);
}

function _drawSchool(sx,py,pw,ph,facTop,facH,worldX){
  const winLit=(r,c)=>((Math.floor(worldX/10)+r*7+c*3)%3)!==0;
  // cream facade
  ctx.fillStyle='#f0e6cc';ctx.fillRect(sx,facTop,pw,facH);
  // horizontal banding
  ctx.strokeStyle='#d8ceb4';ctx.lineWidth=1;
  for(let y=facTop+14;y<GROUND_Y;y+=14){ctx.beginPath();ctx.moveTo(sx,y);ctx.lineTo(sx+pw,y);ctx.stroke();}
  // windows — many small ones
  const wCols=Math.max(2,Math.floor((pw-20)/34)),wRows=Math.max(1,Math.floor((facH-48)/38));
  const wStartX=sx+(pw-wCols*34+8)/2;
  for(let r=0;r<wRows;r++) for(let c=0;c<wCols;c++){
    const wx=wStartX+c*34, wy=facTop+12+r*38;
    ctx.fillStyle='#2e6090';ctx.fillRect(wx-1,wy-1,22,26);
    ctx.fillStyle=winLit(r,c)?'rgba(180,230,255,0.75)':'#5a8a9a';
    ctx.fillRect(wx,wy,10,24);ctx.fillRect(wx+12,wy,8,24);
  }
  // entrance double door
  const ew=40,eh=50,ex=sx+(pw-ew)/2,ey=GROUND_Y-eh;
  ctx.fillStyle='#8B4513';ctx.fillRect(ex,ey,ew,eh);
  ctx.fillStyle='rgba(150,220,255,0.6)';ctx.fillRect(ex+2,ey+2,ew/2-4,eh-4);ctx.fillRect(ex+ew/2+2,ey+2,ew/2-4,eh-4);
  // steps
  ctx.fillStyle='#d0c8b8';ctx.fillRect(ex-10,GROUND_Y-8,ew+20,8);ctx.fillRect(ex-6,GROUND_Y-14,ew+12,6);
  // sign
  ctx.fillStyle='#3a5a8a';ctx.fillRect(sx+4,facTop+4,pw-8,20);
  ctx.font='bold 11px Arial Black';ctx.textAlign='center';ctx.fillStyle='#fff';
  ctx.fillText('SZKOŁA',sx+pw/2,facTop+17);
  // flag pole
  ctx.strokeStyle='#555';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(sx+pw-20,facTop-30);ctx.lineTo(sx+pw-20,facTop+10);ctx.stroke();
  ctx.fillStyle='#e74c3c';ctx.fillRect(sx+pw-20,facTop-30,18,12);
  // rooftop
  ctx.fillStyle='#b04020';ctx.fillRect(sx,py,pw,ph);
  ctx.fillStyle='#c85030';ctx.fillRect(sx,py,pw,3);
  ctx.fillStyle='#8c3010';ctx.fillRect(sx,py-9,pw,9);
}

function _drawChurch(sx,py,pw,ph,facTop,facH,worldX){
  const winLit=(r,c)=>((Math.floor(worldX/10)+r*7+c*3)%3)!==0;
  // white plaster facade
  ctx.fillStyle='#f0ede8';ctx.fillRect(sx,facTop,pw,facH);
  ctx.strokeStyle='#dddad4';ctx.lineWidth=1;
  for(let y=facTop+12;y<GROUND_Y;y+=12){ctx.beginPath();ctx.moveTo(sx,y);ctx.lineTo(sx+pw,y);ctx.stroke();}
  // arched windows
  const wn=Math.max(2,Math.floor((pw-30)/44));
  const wStartX=sx+(pw-wn*44+14)/2;
  for(let c=0;c<wn;c++){
    const wx=wStartX+c*44, wy=facTop+22;
    ctx.fillStyle='#3a3060';ctx.fillRect(wx,wy,22,32);
    ctx.beginPath();ctx.arc(wx+11,wy,11,Math.PI,0);ctx.fill();
    ctx.fillStyle=winLit(0,c)?'rgba(180,150,255,0.65)':'#5a4870';
    ctx.fillRect(wx+1,wy+1,9,30);ctx.fillRect(wx+12,wy+1,9,30);
    ctx.beginPath();ctx.arc(wx+11,wy,10,Math.PI,0);ctx.fill();
    // stone arch border
    ctx.strokeStyle='#c0b8a8';ctx.lineWidth=2;
    ctx.strokeRect(wx-1,wy-1,24,34);
    ctx.beginPath();ctx.arc(wx+11,wy,12,Math.PI,0);ctx.stroke();
  }
  // large arched entrance
  const dw=50,dh=55,dx=sx+(pw-dw)/2,dy=GROUND_Y-dh;
  ctx.fillStyle='#4a3860';ctx.fillRect(dx,dy,dw,dh);
  ctx.beginPath();ctx.arc(dx+dw/2,dy,dw/2,Math.PI,0);ctx.fill();
  ctx.fillStyle='rgba(150,120,220,0.5)';ctx.fillRect(dx+2,dy+2,dw/2-4,dh-2);ctx.fillRect(dx+dw/2+2,dy+2,dw/2-4,dh-2);
  ctx.strokeStyle='#c0b8a8';ctx.lineWidth=2;
  ctx.strokeRect(dx-1,dy-1,dw+2,dh+2);
  ctx.beginPath();ctx.arc(dx+dw/2,dy,dw/2+1,Math.PI,0);ctx.stroke();
  // bell tower (right side)
  const tw=38,txs=sx+pw-tw-4,tftop=facTop-40;
  ctx.fillStyle='#e8e4de';ctx.fillRect(txs,tftop,tw,40);
  ctx.fillStyle='#dddad4';ctx.strokeStyle='#ccc';ctx.lineWidth=1;
  ctx.fillRect(txs+6,tftop+8,tw-12,22);
  ctx.strokeRect(txs+6,tftop+8,tw-12,22);
  // bell
  ctx.fillStyle='#d4a020';ctx.beginPath();ctx.arc(txs+tw/2,tftop+16,7,0,Math.PI);ctx.fill();
  // pyramidal tower roof
  ctx.fillStyle='#707868';
  ctx.beginPath();ctx.moveTo(txs-4,tftop);ctx.lineTo(txs+tw/2,tftop-30);ctx.lineTo(txs+tw+4,tftop);ctx.closePath();ctx.fill();
  // cross on top
  ctx.fillStyle='#d4a020';ctx.fillRect(txs+tw/2-2,tftop-48,4,18);ctx.fillRect(txs+tw/2-8,tftop-42,16,4);
  // main roof
  ctx.fillStyle='#606860';ctx.fillRect(sx,py,pw,ph);
  ctx.fillStyle='#707868';ctx.fillRect(sx,py,pw,3);
  ctx.fillStyle='#505848';ctx.fillRect(sx,py-8,pw,8);
  // main cross
  ctx.fillStyle='#d4a020';ctx.fillRect(sx+pw/2-2,py-22,4,14);ctx.fillRect(sx+pw/2-7,py-18,14,4);
}

function _drawDoubleGarage(sx,py,pw,ph,facTop,facH,worldX){
  // shared facade
  ctx.fillStyle='#5a6070';ctx.fillRect(sx,facTop,pw,facH);
  ctx.strokeStyle='#4a5060';ctx.lineWidth=1;
  for(let y=facTop+14;y<GROUND_Y;y+=14){ctx.beginPath();ctx.moveTo(sx,y);ctx.lineTo(sx+pw,y);ctx.stroke();}
  // two garage doors side by side
  const gw=(pw-36)/2,gh=facH*.72;
  for(let g=0;g<2;g++){
    const gx=sx+12+g*(gw+12),gy=GROUND_Y-gh;
    ctx.fillStyle='#3a3d4a';ctx.fillRect(gx,gy,gw,gh);
    ctx.strokeStyle='#52566a';ctx.lineWidth=1.5;
    for(let i=1;i<6;i++){const ry=gy+i*(gh/6);ctx.beginPath();ctx.moveTo(gx,ry);ctx.lineTo(gx+gw,ry);ctx.stroke();}
    // horizontal panels
    ctx.strokeStyle='#6a6e7e';ctx.lineWidth=1;
    for(let i=1;i<4;i++){const ry=gy+i*(gh/4);ctx.beginPath();ctx.moveTo(gx+4,ry);ctx.lineTo(gx+gw-4,ry);ctx.stroke();}
    // handle
    ctx.fillStyle='#aaa';ctx.fillRect(gx+gw/2-10,gy+gh-12,20,5);
  }
  // divider pillar
  ctx.fillStyle='#4a5060';ctx.fillRect(sx+12+gw,facTop,12,facH);
  // number sign
  ctx.fillStyle='rgba(40,44,55,0.8)';ctx.fillRect(sx+4,facTop+4,pw-8,18);
  ctx.font='bold 10px Arial Black';ctx.textAlign='center';ctx.fillStyle='#aaa';
  ctx.fillText('GARAŻE',sx+pw/2,facTop+15);
  // rooftop
  ctx.fillStyle='#353535';ctx.fillRect(sx,py,pw,ph);
  ctx.fillStyle='#454545';ctx.fillRect(sx,py,pw,3);
  ctx.fillStyle='#2a2a2a';ctx.fillRect(sx,py-8,pw,8);
  // chimneys
  ctx.fillStyle='#3a3a3a';ctx.fillRect(sx+pw*.25,py-18,18,10);ctx.fillRect(sx+pw*.65,py-18,18,10);
  ctx.fillStyle='#444';ctx.fillRect(sx+pw*.25+2,py-22,14,6);ctx.fillRect(sx+pw*.65+2,py-22,14,6);
}

function _drawSkateRamp(sx,py,pw,ph,facTop,facH){
  // Quarter-pipe ramp — curved concrete quarter circle
  const rh=facH, rb=sx, rt=sx;
  ctx.fillStyle='#9a9890';
  ctx.beginPath();
  ctx.moveTo(sx, GROUND_Y);
  ctx.lineTo(sx, py+ph);
  // quarter-circle arc: from top-left going right and down
  ctx.quadraticCurveTo(sx, GROUND_Y, sx+pw, GROUND_Y);
  ctx.closePath();
  ctx.fill();
  // concrete texture lines
  ctx.strokeStyle='#8a8880';ctx.lineWidth=1;
  for(let i=1;i<6;i++){
    const t2=i/6;
    const arcX=sx+pw*Math.sin(t2*Math.PI/2);
    const arcY=GROUND_Y-rh*(1-Math.cos(t2*Math.PI/2));
    if(i===1){ctx.beginPath();ctx.moveTo(arcX,arcY);}
    else ctx.lineTo(arcX,arcY);
    if(i===5)ctx.stroke();
  }
  // top flat ledge
  ctx.fillStyle='#b0aea8';ctx.fillRect(sx,py,pw,ph);
  ctx.fillStyle='#c0beb8';ctx.fillRect(sx,py,pw,3);
  // "SKATE" text on ramp face
  ctx.save();
  ctx.translate(sx+pw*0.3, GROUND_Y-rh*0.55);
  ctx.rotate(-0.7);
  ctx.font='bold 11px Arial Black';ctx.textAlign='center';ctx.fillStyle='rgba(255,255,255,0.55)';
  ctx.fillText('SKATE',0,0);
  ctx.restore();
  // safety rail on top
  ctx.strokeStyle='#888';ctx.lineWidth=3;
  ctx.beginPath();ctx.moveTo(sx+pw-4,py-16);ctx.lineTo(sx+pw-4,py);ctx.stroke();
  ctx.strokeStyle='#aaa';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(sx,py-8);ctx.lineTo(sx+pw,py-8);ctx.stroke();
}

function _drawBiedronka(sx,py,pw,ph,facTop,facH,worldX){
  const winLit=(r,c)=>((Math.floor(worldX/10)+r*7+c*3)%3)!==0;
  ctx.fillStyle='#ede8e0';ctx.fillRect(sx,facTop,pw,facH);
  ctx.fillStyle='#c0392b';ctx.fillRect(sx,facTop,pw,22);
  ctx.font='bold 13px Arial Black';ctx.textAlign='center';ctx.fillStyle='#fff';
  ctx.fillText(t('signBiedronka').toUpperCase(),sx+pw/2,facTop+15);
  const lx=sx+pw-28,ly=facTop+4;
  ctx.fillStyle='#e74c3c';ctx.beginPath();ctx.arc(lx,ly+8,10,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#111';ctx.beginPath();ctx.arc(lx,ly+2,5,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(lx-4,ly+9,2.5,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(lx+4,ly+9,2.5,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#111';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(lx,ly+3);ctx.lineTo(lx,ly+17);ctx.stroke();
  const wCols=Math.max(1,Math.floor((pw-20)/42)),wRows=Math.max(1,Math.floor((facH-60)/40)),wStartX=sx+(pw-wCols*42+10)/2;
  for(let r=0;r<wRows;r++) for(let c=0;c<wCols;c++){
    const wx=wStartX+c*42,wy=facTop+28+r*40;
    ctx.fillStyle='#9ab0c0';ctx.fillRect(wx-2,wy-2,26,28);
    ctx.fillStyle=winLit(r,c)?'rgba(220,240,255,0.75)':'#7a9ab0';
    ctx.fillRect(wx,wy,10,24);ctx.fillRect(wx+14,wy,10,24);
  }
  ctx.fillStyle='#c0392b';ctx.fillRect(sx+pw/2-40,GROUND_Y-56,80,56);
  ctx.fillStyle='#aed6f1';ctx.fillRect(sx+pw/2-36,GROUND_Y-52,34,46);ctx.fillRect(sx+pw/2+4,GROUND_Y-52,34,46);
  ctx.fillStyle='#c0392b';ctx.fillRect(sx,py,pw,ph);
  ctx.fillStyle='#a93226';ctx.fillRect(sx,py,pw,3);
  ctx.fillStyle='#e74c3c';ctx.fillRect(sx,py-12,pw,12);
  ctx.fillStyle='#c0392b';ctx.fillRect(sx,py-12,pw,2);
}

// ── Cars ──────────────────────────────────────────────────────────────────
function _drawCar(x,y,w,h,color,style){
  const isCombi = style==='combi';
  const a1=x+w*.22, a2=x+w*.78, wr=11;
  // body
  ctx.fillStyle=color;ctx.fillRect(x+2,y+h*.32,w-4,h*.68);
  // roof — combi extends further back
  if(isCombi){
    ctx.fillStyle=_lighten(color,15);ctx.fillRect(x+w*.1,y,w*.82,h*.36);
  } else {
    ctx.fillStyle=_lighten(color,20);ctx.fillRect(x+w*.15,y,w*.7,h*.36);
  }
  // windows
  if(isCombi){
    ctx.fillStyle='rgba(180,220,240,0.85)';
    ctx.fillRect(x+w*.14,y+2,w*.22,h*.3);
    ctx.fillRect(x+w*.38,y+2,w*.22,h*.3);
    ctx.fillRect(x+w*.62,y+2,w*.22,h*.3);
  } else {
    ctx.fillStyle='rgba(180,220,240,0.88)';
    ctx.fillRect(x+w*.18,y+2,w*.26,h*.31);ctx.fillRect(x+w*.54,y+2,w*.24,h*.31);
  }
  // headlights
  ctx.fillStyle='#fef9c3';ctx.fillRect(x+2,y+h*.36,11,6);
  ctx.fillStyle='#facc15';ctx.fillRect(x+2,y+h*.36,5,6);
  // taillights
  ctx.fillStyle='#ef4444';ctx.fillRect(x+w-13,y+h*.36,11,6);
  ctx.fillStyle='#dc2626';ctx.fillRect(x+w-6,y+h*.36,5,6);
  // front grille
  ctx.fillStyle='#374151';ctx.fillRect(x+2,y+h*.63,14,7);
  ctx.strokeStyle='#4b5563';ctx.lineWidth=1;
  for(let g=5;g<=11;g+=3){ctx.beginPath();ctx.moveTo(x+g,y+h*.63);ctx.lineTo(x+g,y+h*.63+7);ctx.stroke();}
  // sill
  ctx.fillStyle='#9ca3af';ctx.fillRect(x,y+h*.82,w,7);
  // center line / roof edge
  ctx.strokeStyle=_darken(color,20);ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(x+w*.5,y+h*.34);ctx.lineTo(x+w*.5,y+h);ctx.stroke();
  // mirrors
  ctx.fillStyle=_darken(color,20);ctx.fillRect(x+w*.14-5,y+h*.29,7,5);
  // wheels
  ctx.fillStyle='#1f2937';
  ctx.beginPath();ctx.arc(a1,y+h,wr,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(a2,y+h,wr,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#374151';ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(a1,y+h,wr-2,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.arc(a2,y+h,wr-2,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='#d1d5db';
  ctx.beginPath();ctx.arc(a1,y+h,4.5,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(a2,y+h,4.5,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#9ca3af';ctx.lineWidth=1.5;
  for(const ang of[0,2.094,4.189]){
    for(const ax of[a1,a2]){ctx.beginPath();ctx.moveTo(ax+2*Math.cos(ang),y+h+2*Math.sin(ang));ctx.lineTo(ax+9*Math.cos(ang),y+h+9*Math.sin(ang));ctx.stroke();}
  }
  ctx.strokeStyle=_darken(color,20);ctx.lineWidth=2.5;
  ctx.beginPath();ctx.arc(a1,y+h,wr+3,Math.PI,0);ctx.stroke();
  ctx.beginPath();ctx.arc(a2,y+h,wr+3,Math.PI,0);ctx.stroke();
}

function _drawVan(x,y,w,h,color){
  const a1=x+w*.19,a2=x+w*.78,wr=13;
  ctx.fillStyle=color;ctx.fillRect(x+2,y+6,w-4,h-6);
  ctx.fillStyle=_darken(color,18);ctx.fillRect(x+2,y+6,w*.3,h*.62);
  ctx.fillStyle='rgba(180,220,240,0.88)';ctx.fillRect(x+5,y+9,w*.22,h*.44);
  ctx.fillStyle='rgba(180,220,240,0.75)';ctx.fillRect(x+w*.36,y+11,w*.18,h*.36);ctx.fillRect(x+w*.57,y+11,w*.15,h*.36);
  ctx.fillStyle=_darken(color,18);ctx.fillRect(x+2,y+6,w-4,4);
  // "VAN" text on side
  ctx.fillStyle='rgba(160,160,160,0.35)';ctx.font='bold 16px Arial Black';ctx.textAlign='center';
  ctx.fillText('VAN',x+w*0.65,y+h*0.45);
  ctx.fillStyle='#fef9c3';ctx.fillRect(x+2,y+h*.52,11,6);
  ctx.fillStyle='#facc15';ctx.fillRect(x+2,y+h*.52,5,6);
  ctx.fillStyle='#ef4444';ctx.fillRect(x+w-13,y+h*.52,11,6);
  ctx.fillStyle='#374151';ctx.fillRect(x+2,y+h*.73,16,9);
  ctx.fillStyle='#6b7280';ctx.fillRect(x,y+h*.88,w,8);
  ctx.strokeStyle=_darken(color,20);ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(x+w*.32,y+6);ctx.lineTo(x+w*.32,y+h);ctx.stroke();
  ctx.beginPath();ctx.moveTo(x+w*.76,y+6);ctx.lineTo(x+w*.76,y+h);ctx.stroke();
  ctx.fillStyle=_darken(color,20);ctx.fillRect(x-4,y+h*.18,9,7);
  ctx.fillStyle='#1f2937';
  ctx.beginPath();ctx.arc(a1,y+h,wr,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(a2,y+h,wr,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#374151';ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(a1,y+h,wr-2,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.arc(a2,y+h,wr-2,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='#d1d5db';
  ctx.beginPath();ctx.arc(a1,y+h,5,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.arc(a2,y+h,5,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#9ca3af';ctx.lineWidth=1.5;
  for(const ang of[0,2.094,4.189]){
    for(const ax of[a1,a2]){ctx.beginPath();ctx.moveTo(ax+2*Math.cos(ang),y+h+2*Math.sin(ang));ctx.lineTo(ax+9*Math.cos(ang),y+h+9*Math.sin(ang));ctx.stroke();}
  }
  ctx.strokeStyle=_darken(color,20);ctx.lineWidth=2.5;
  ctx.beginPath();ctx.arc(a1,y+h,wr+3,Math.PI,0);ctx.stroke();
  ctx.beginPath();ctx.arc(a2,y+h,wr+3,Math.PI,0);ctx.stroke();
}

function _drawDumpster(x,y,w,h,color){
  ctx.fillStyle=color;ctx.fillRect(x,y,w,h);
  ctx.fillStyle=_darken(color);ctx.fillRect(x,y,w,9);
  ctx.fillRect(x+4,y+13,w-8,3);ctx.fillRect(x+4,y+19,w-8,3);
  ctx.strokeStyle='#888';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x+w/2,y,10,Math.PI,0);ctx.stroke();
}

// ── European wheeled bin — SINGLE center wheel ────────────────────────────
function _drawTrashCan(x,y,w,h){
  ctx.fillStyle='#2e7d32';ctx.fillRect(x+2,y+h*.14,w-4,h*.86);
  ctx.strokeStyle='#1b5e20';ctx.lineWidth=1;
  for(let ry=y+h*.3;ry<y+h*.9;ry+=h*.2){ctx.beginPath();ctx.moveTo(x+2,ry);ctx.lineTo(x+w-2,ry);ctx.stroke();}
  ctx.fillStyle='#1b5e20';ctx.fillRect(x-1,y,w+2,h*.16);
  ctx.fillStyle='#43a047';ctx.fillRect(x,y,w,3);
  ctx.strokeStyle='#1b5e20';ctx.lineWidth=3;ctx.beginPath();ctx.arc(x+w/2,y+h*.08,w*.3,Math.PI,0);ctx.stroke();
  ctx.strokeStyle='rgba(255,255,255,0.2)';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(x+w/2,y+h*.25);ctx.lineTo(x+w*.7,y+h*.55);ctx.lineTo(x+w*.3,y+h*.55);ctx.closePath();ctx.stroke();
  // single center wheel
  ctx.fillStyle='#212121';ctx.beginPath();ctx.arc(x+w/2,y+h,9,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#555';ctx.beginPath();ctx.arc(x+w/2,y+h,3.5,0,Math.PI*2);ctx.fill();
}

// ── InPost Paczkomat ──────────────────────────────────────────────────────
function _drawPaczkomat(x,y,w,h){
  ctx.fillStyle='#FFD100';ctx.fillRect(x,y,w,h);
  ctx.fillStyle='#222';ctx.fillRect(x,y,w,22);
  ctx.font='bold 9px Arial Black';ctx.textAlign='center';ctx.fillStyle='#FFD100';
  ctx.fillText('InPost',x+w/2,y+14);
  ctx.fillStyle='#00B140';ctx.fillRect(x,y+22,w,5);
  ctx.fillStyle='#1a1a2e';ctx.fillRect(x+4,y+30,w-8,22);
  ctx.font='7px Arial';ctx.fillStyle='#4fc3f7';ctx.fillText('Gotowe',x+w/2,y+44);
  const lw2=(w-8)/3,lh=13;
  for(let r=0;r<4;r++) for(let c=0;c<3;c++){
    ctx.fillStyle='#e8c400';ctx.fillRect(x+4+c*lw2,y+56+r*(lh+2),lw2-2,lh);
    ctx.fillStyle='#bfa000';ctx.fillRect(x+4+c*lw2+lw2/2-4,y+56+r*(lh+2)+4,8,3);
  }
  ctx.fillStyle='#555';ctx.fillRect(x,y+h-5,w,5);
}

// ─── Decor ─────────────────────────────────────────────────────────────────
function drawDecor(){
  _drawBirch();
  _drawSchoolYard();
}

function _drawBirch(){
  const sx=BIRCH.x-camX;
  if(sx>W+80||sx+BIRCH.w<-80) return;
  const bh=BIRCH.h,bw=BIRCH.w,by=GROUND_Y-bh;
  const tx=sx+bw/2,trunkW=13;
  ctx.fillStyle='rgba(0,0,0,0.12)';ctx.beginPath();ctx.ellipse(tx,GROUND_Y+1,20,5,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='rgba(0,40,0,0.3)';ctx.beginPath();ctx.ellipse(tx+5,by+bh*.42,bw*.47,bh*.28,0,0,Math.PI*2);ctx.fill();
  const canH=bh*.58;
  ctx.fillStyle='#1e6e1e';ctx.beginPath();ctx.ellipse(tx,by+canH*.52,bw*.48,canH*.5,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#27932a';ctx.beginPath();ctx.ellipse(tx,by+canH*.48,bw*.45,canH*.46,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#38b83b';ctx.beginPath();ctx.ellipse(tx-5,by+canH*.38,bw*.28,canH*.28,-0.2,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#4ec34e';ctx.beginPath();ctx.ellipse(tx+6,by+canH*.55,bw*.22,canH*.22,0.15,0,Math.PI*2);ctx.fill();
  for(let i=0;i<5;i++){
    const a=-0.4+i*(Math.PI/4.5);
    const lx2=tx+Math.cos(a)*bw*.43,ly2=by+canH*.5+Math.sin(a)*canH*.44+10;
    ctx.fillStyle=['#27932a','#38b83b','#1e6e1e','#4ec34e','#27932a'][i];
    ctx.beginPath();ctx.ellipse(lx2,ly2,11,8,a,0,Math.PI*2);ctx.fill();
  }
  const trunkX=sx+(bw-trunkW)/2,trunkTop=by+bh*.44;
  ctx.fillStyle='#e8e8de';ctx.fillRect(trunkX,trunkTop,trunkW,bh*.56);
  ctx.fillStyle='#1e1e10';
  for(const m of[.08,.22,.38,.54,.68,.82]){
    const my=trunkTop+bh*.56*m;
    ctx.fillRect(trunkX-2,my,trunkW+4,3);ctx.fillRect(trunkX+2,my+4,trunkW-5,2);
  }
  ctx.fillStyle='rgba(0,0,0,0.15)';ctx.fillRect(trunkX+trunkW-3,trunkTop,3,bh*.56);
}

function _drawSchoolYard(){
  // School yard is to the LEFT of the school building (x=2390)
  const wx = SCHOOL.x - 120; // yard starts 120px left of school
  const sx = wx - camX;
  if(sx > W+200 || sx+200 < -20) return;

  // === SWING SET ===
  const swX = sx, swY = GROUND_Y;
  const swH = 80, swW = 80;
  // frame posts
  ctx.strokeStyle='#5a4a3a';ctx.lineWidth=4;
  ctx.beginPath();ctx.moveTo(swX+10,swY);ctx.lineTo(swX+20,swY-swH);ctx.stroke();
  ctx.beginPath();ctx.moveTo(swX+swW-10,swY);ctx.lineTo(swX+swW-20,swY-swH);ctx.stroke();
  // top bar
  ctx.beginPath();ctx.moveTo(swX+20,swY-swH);ctx.lineTo(swX+swW-20,swY-swH);ctx.stroke();
  // two swings
  for(let s=0;s<2;s++){
    const chainX = swX+28+s*26;
    const seatY = swY-20;
    ctx.strokeStyle='#888';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(chainX,swY-swH);ctx.lineTo(chainX-4,seatY);ctx.stroke();
    ctx.beginPath();ctx.moveTo(chainX,swY-swH);ctx.lineTo(chainX+4,seatY);ctx.stroke();
    // seat
    ctx.fillStyle='#c0392b';ctx.fillRect(chainX-8,seatY,16,4);
    ctx.strokeStyle='#922b21';ctx.lineWidth=1;ctx.strokeRect(chainX-8,seatY,16,4);
  }

  // === SEESAW ===
  const ssX = sx + 90, ssY = GROUND_Y;
  // pivot base
  ctx.fillStyle='#7a6a5a';
  ctx.beginPath();ctx.moveTo(ssX-8,ssY);ctx.lineTo(ssX+8,ssY);ctx.lineTo(ssX+3,ssY-18);ctx.lineTo(ssX-3,ssY-18);ctx.closePath();ctx.fill();
  // pivot pin
  ctx.fillStyle='#aaa';ctx.beginPath();ctx.arc(ssX,ssY-18,3,0,Math.PI*2);ctx.fill();
  // plank (slightly tilted)
  ctx.save();ctx.translate(ssX,ssY-18);ctx.rotate(-0.12);
  ctx.fillStyle='#8B4513';ctx.fillRect(-45,0,90,8);
  ctx.strokeStyle='#6a3010';ctx.lineWidth=1;ctx.strokeRect(-45,0,90,8);
  // seats on each end
  ctx.fillStyle='#2ecc71';ctx.fillRect(-46,-6,14,8);ctx.fillRect(32,-6,14,8);
  ctx.restore();
}

// ─── Background ────────────────────────────────────────────────────────────
const BLD_SEED=(()=>{
  const a=[];let x=-200,i=0;
  while(x<LEVEL_W+400){
    const house=(i%4===2),bw=house?70+(i*41+7)%50:190+(i*61+11)%130,bh=house?55+(i*13+3)%30:100+(i*27+5)%70;
    a.push({x,w:bw,h:bh,ci:(i*3+1)%6,house});x+=bw+3+(i*29+5)%20;i++;
  }
  return a;
})();
const BLD_COLS=['#72786a','#6a7460','#6e6a5c','#5e6870','#7a7060','#686060'];

function drawBackground(){
  // sunset sky
  const sky=ctx.createLinearGradient(0,0,0,GROUND_Y);
  sky.addColorStop(0,'#1a0535');sky.addColorStop(0.25,'#7b1fa2');
  sky.addColorStop(0.55,'#d84315');sky.addColorStop(0.78,'#f57c00');sky.addColorStop(1,'#ffb300');
  ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
  // sun glow
  const sg=ctx.createRadialGradient(W*.55,GROUND_Y,0,W*.55,GROUND_Y,180);
  sg.addColorStop(0,'rgba(255,220,0,0.45)');sg.addColorStop(1,'rgba(255,100,0,0)');
  ctx.fillStyle=sg;ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#ffd600';ctx.beginPath();ctx.arc(W*.55,GROUND_Y+8,36,Math.PI,0);ctx.fill();
  ctx.fillStyle='rgba(255,180,0,0.5)';ctx.beginPath();ctx.arc(W*.55,GROUND_Y+8,52,Math.PI,0);ctx.fill();

  // distant buildings parallax 0.38
  for(const b of BLD_SEED){
    const sx=b.x-camX*0.38;if(sx>W+10||sx+b.w<-10) continue;
    const sy=GROUND_Y-b.h;
    if(b.house){
      ctx.fillStyle=['#9a6854','#8a7060','#a08060','#907868'][b.ci%4];ctx.fillRect(sx,sy,b.w,b.h);
      ctx.fillStyle='#7a3a20';
      ctx.beginPath();ctx.moveTo(sx-6,sy);ctx.lineTo(sx+b.w/2,sy-b.h*.5);ctx.lineTo(sx+b.w+6,sy);ctx.closePath();ctx.fill();
      ctx.fillStyle='rgba(255,200,50,0.45)';
      if(b.w>80){ctx.fillRect(sx+10,sy+10,18,18);ctx.fillRect(sx+b.w-28,sy+10,18,18);}
      else ctx.fillRect(sx+b.w/2-9,sy+10,18,18);
      ctx.fillStyle='#5a3a1a';ctx.fillRect(sx+b.w/2-7,sy+b.h-22,14,22);
      ctx.fillStyle='#7a3a20';ctx.fillRect(sx+b.w*.65,sy-b.h*.28,8,b.h*.28+4);
    } else {
      ctx.fillStyle=BLD_COLS[b.ci];ctx.fillRect(sx,sy,b.w,b.h);
      ctx.strokeStyle='rgba(255,255,255,0.04)';ctx.lineWidth=1;ctx.strokeRect(sx,sy,b.w,b.h);
      ctx.fillStyle='rgba(255,200,50,0.38)';
      const wc=Math.floor(b.w/24),wr=Math.floor(b.h/22);
      for(let r=0;r<wr;r++) for(let c=0;c<wc;c++){
        if((b.ci*100+r*5+c*3)%5===0) continue;
        ctx.fillRect(sx+6+c*24,sy+6+r*22,14,14);
      }
      ctx.fillStyle='rgba(0,0,0,0.25)';ctx.fillRect(sx,sy,b.w,4);
    }
  }

  // ── PAVEMENT (top 40% of street) ──────────────────────────────────────────
  ctx.fillStyle='#c4c0b8'; // light concrete
  ctx.fillRect(0, GROUND_Y, W, PAV_H);
  // pavement slab joints (world-fixed)
  ctx.strokeStyle='#b0acaa';ctx.lineWidth=1;
  const slabW=60, firstSlab=Math.floor(camX/slabW)*slabW;
  for(let wx=firstSlab;wx<camX+W+slabW;wx+=slabW){
    ctx.beginPath();ctx.moveTo(wx-camX,GROUND_Y);ctx.lineTo(wx-camX,ROAD_Y);ctx.stroke();
  }
  // curb edge
  ctx.fillStyle='#a8a4a0';ctx.fillRect(0,ROAD_Y-3,W,4);

  // ── ROAD (bottom 60% of street) ────────────────────────────────────────────
  ctx.fillStyle='#888884'; // lighter grey road
  ctx.fillRect(0, ROAD_Y, W, H-ROAD_Y);
  // road centre line
  ctx.fillStyle='rgba(201,162,39,0.65)';
  const sw=38,sg2=40,per=sw+sg2,first=Math.floor(camX/per)*per;
  for(let wx=first;wx<camX+W+per;wx+=per) ctx.fillRect(wx-camX,ROAD_Y+8,sw,4);

  // finish flag
  const fx=LEVEL_W-80-camX;
  if(fx>-50&&fx<W+50){
    ctx.fillStyle='#555';ctx.fillRect(fx,GROUND_Y-120,6,120);
    ctx.fillStyle='#e74c3c';ctx.fillRect(fx+6,GROUND_Y-120,40,25);
    ctx.fillStyle='#fff';ctx.font='bold 10px Arial';ctx.textAlign='left';
    ctx.fillText('FINISH',fx+9,GROUND_Y-103);
  }
}

// ─── Particles ─────────────────────────────────────────────────────────────
const SCOLS=['#e74c3c','#f39c12','#2ecc71','#3498db','#9b59b6','#e91e63','#00bcd4'];
function spawnSpray(x,y,n=12){
  for(let i=0;i<n;i++) particles.push({x,y,vx:(Math.random()-.5)*9,vy:(Math.random()-.5)*9-2,color:SCOLS[Math.floor(Math.random()*SCOLS.length)],life:40+Math.random()*20,ml:60,r:2.5+Math.random()*3.5});
}
function updateParticles(){
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.x+=p.vx;p.y+=p.vy;p.vy+=0.22;p.vx*=0.91;if(--p.life<=0)particles.splice(i,1);}
}
function drawParticles(){
  for(const p of particles){ctx.globalAlpha=p.life/p.ml;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x-camX,p.y,p.r,0,Math.PI*2);ctx.fill();}
  ctx.globalAlpha=1;
}

// ─── Collision ─────────────────────────────────────────────────────────────
function resolvePlayer(){
  player.onGround=false;
  if(player.y+player.h>=GROUND_Y){player.y=GROUND_Y-player.h;player.vy=0;player.onGround=true;player.jumpCount=0;}
  for(const p of platforms){
    if(!overlap(player.x,player.y,player.w,player.h,p.x,p.y,p.w,p.h)) continue;
    const{x:px,y:py,w:pw,h:ph,type}=p;
    if(type==='ledge'||type==='car'||type==='van'||type==='dumpster'||type==='trashcan'||type==='paczkomat'){
      if(player.y+player.h-player.vy<=py+6&&player.vy>=0){player.y=py-player.h;player.vy=0;player.onGround=true;player.jumpCount=0;}
    } else if(type==='wall'){
      const ox=Math.min(player.x+player.w,px+pw)-Math.max(player.x,px);
      const oy=Math.min(player.y+player.h,py+ph)-Math.max(player.y,py);
      if(ox<oy){player.x+=player.x<px?-ox:ox;player.vx=0;}
      else{if(player.y<py){player.y=py-player.h;player.vy=0;player.onGround=true;player.jumpCount=0;}else{player.y=py+ph;player.vy=0;}}
    }
  }
  player.x=Math.max(0,player.x);
}

// ─── HUD ───────────────────────────────────────────────────────────────────
function updateHUD(){
  document.getElementById('walls-tagged').textContent=t('walls',wallsTagged,TOTAL_WALLS);
  document.getElementById('lives').textContent='♥ '.repeat(Math.max(0,lives)).trim();
}
function showScreen(id){
  ['start-screen','win-screen','gameover-screen'].forEach(s=>document.getElementById(s).classList.add('hidden'));
  if(id) document.getElementById(id).classList.remove('hidden');
  gameState=id?id.replace('-screen',''):'playing';
}

// ─── Reset ─────────────────────────────────────────────────────────────────
function resetGame(){
  Object.assign(player,{x:160,y:386,vx:0,vy:0,onGround:false,jumpCount:0,dir:1,state:'idle',atkTimer:0,invTimer:0,tagTimer:0,nearWall:null});
  camX=0;wallsTagged=0;lives=3;particles.length=0;
  graffitiWalls.forEach(w=>{w.tagged=false;w.prog=0;});
  initEnemies();updateHUD();
  gameStartTime=Date.now();gameWinMs=null;
  timerEl.textContent='0:00';
}

// ─── Update player ─────────────────────────────────────────────────────────
function updatePlayer(){
  let moving=false;
  if(keys['ArrowLeft']||keys['a']||keys['A']){player.vx=-SPEED;player.dir=-1;moving=true;}
  else if(keys['ArrowRight']||keys['d']||keys['D']){player.vx=SPEED;player.dir=1;moving=true;}
  else{player.vx*=0.78;if(Math.abs(player.vx)<0.2)player.vx=0;}
  if((jp['ArrowUp']||jp['w']||jp['W']||jp[' '])&&player.jumpCount<1){
    player.vy=JUMP_F;player.jumpCount++;
  }
  if((jp['z']||jp['Z']||jp['x']||jp['X'])&&player.atkTimer<=0){
    player.atkTimer=player.ATK_DUR;
    spawnSpray(player.x+(player.dir>0?player.w+8:-8),player.y+player.h*.38,14);
  }
  player.nearWall=null;
  for(const gw of graffitiWalls){
    if(!gw.tagged&&Math.abs((player.x+player.w/2)-(gw.x+gw.w/2))<72&&player.y+player.h>gw.y&&player.y<gw.y+gw.h){player.nearWall=gw;break;}
  }
  if(player.nearWall){
    if(keys['e']||keys['E']){
      player.tagTimer++;player.nearWall.prog=(player.tagTimer/player.TAG_DUR)*100;
      if(player.tagTimer>=player.TAG_DUR){
        player.nearWall.tagged=true;player.nearWall.prog=100;player.tagTimer=0;wallsTagged++;
        spawnSpray(player.nearWall.x+player.nearWall.w/2,player.nearWall.y+player.nearWall.h/2,32);
        updateHUD();
        if(wallsTagged>=TOTAL_WALLS){
          gameWinMs=Date.now()-gameStartTime;
          const name=(document.getElementById('player-name').value.trim()||t('anon'));
          (async()=>{
            await lbSave(name,gameWinMs);
            await new Promise(r=>setTimeout(r,600));
            document.getElementById('win-time').textContent=`${t('yourTime')} ${formatTimeFull(gameWinMs)}`;
            await lbRender('leaderboard-win',gameWinMs);
            showScreen('win-screen');
          })();
        }
      }
    } else {player.tagTimer=Math.max(0,player.tagTimer-2);player.nearWall.prog=(player.tagTimer/player.TAG_DUR)*100;}
  } else {player.tagTimer=0;}

  if(player.atkTimer>0)player.atkTimer--;
  if(player.invTimer>0)player.invTimer--;
  player.vy+=GRAVITY;player.x+=player.vx;player.y+=player.vy;
  resolvePlayer();

  if(player.atkTimer===player.ATK_DUR-4){
    const ax=player.dir>0?player.x+player.w:player.x-42;
    for(const e of enemies) if(e.state==='walk'&&overlap(ax,player.y,42,player.h,e.x,e.y,e.w,e.h)){e.hit(player.dir);spawnSpray(e.x+e.w/2,e.y+e.h/2,22);}
  }
  if(player.invTimer<=0){
    for(const e of enemies){
      if(e.state==='walk'&&overlap(player.x,player.y,player.w,player.h,e.x,e.y,e.w,e.h)){
        lives--;player.invTimer=110;player.vy=-8;player.vx=player.dir*-5;
        updateHUD();if(lives<=0)setTimeout(()=>showScreen('gameover-screen'),300);break;
      }
    }
  }
  player.state=player.atkTimer>0?'attack':!player.onGround?'jump':moving?'run':'idle';
  const tx=player.x-W*.35;camX+=(tx-camX)*.1;camX=Math.max(0,Math.min(LEVEL_W-W,camX));
}

// ─── Game loop ─────────────────────────────────────────────────────────────
function loop(){
  ctx.clearRect(0,0,W,H);
  if(gameState==='playing'){
    pollGamepad();updatePlayer();for(const e of enemies)e.update();updateParticles();
    if(gameStartTime) timerEl.textContent=formatTime(Date.now()-gameStartTime);
  }
  drawBackground();
  drawPlatforms();
  drawDecor();
  for(const gw of graffitiWalls){if(gw.x-camX>W+90||gw.x+gw.w-camX<-90)continue;drawGraffitiWall(gw);}
  for(const e of enemies)e.draw();
  if(gameState!=='start')drawPlayer();
  drawParticles();
  for(const k in jp)delete jp[k];
  requestAnimationFrame(loop);
}

// ─── Wiring ────────────────────────────────────────────────────────────────
document.getElementById('start-btn').onclick=()=>{ resetGame();showScreen(null);gameState='playing'; };
document.getElementById('restart-btn').onclick=()=>{ resetGame();showScreen(null);gameState='playing'; };
document.getElementById('retry-btn').onclick=()=>{ resetGame();showScreen(null);gameState='playing'; };
document.getElementById('lang-btn').onclick=()=>{ lang=lang==='en'?'pl':'en';renderLang(); };

// ─── Boot ──────────────────────────────────────────────────────────────────
initEnemies();
lbRender('leaderboard'); // async, updates DOM when resolved
renderLang();
loop();
