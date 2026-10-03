// Verbatim from Albion Journal index.html (vanatoliyv/albion-craft-profit @ 5231a21):
// the live hare logo (header) and the anvil mark (home). Only wrapped for deterministic
// time-driven rendering in the film; drawing code is unchanged.
var ANIM_ON = true;
const LOGO_BIG="65,96,AAAGkAAAAAAAAAAAAAAAAAAAAqkAAAAAAAAAAAAAAAAAAACqgAAAAAAAAAAAAAAAAAAAKqgAAAAAAAAAAABkAAAAAAaqgAAAAAAAAAABqQAAAAAWqqQAAAAAAAAAAqpAAAAAAGqqUAAAAAAAAAKqkAAAAABqqqAAAAAAAAACqqkAAAAAGqaoAAAAAAAAAZWqAAAAAAapKoAAAAAAAACRapAAAAABqgKoAAAAAAAAoBqoAAAAAGqAKgAAAAAAACQGqlQAAAAakAqgAAAAAAAoAGqAAAAAAaAAagAAAAAAGQBqqAAAAABoAAqQAAAAABkABqgAAAABWpAAqAAAAAAGQABqAAAAAAKkACpUAAAAAaQAGoAAAAACqAAClAAAAAGgAAagAAAAQCpAAKoAAAAAaAABqUAAAAAKkAAZAAAAABkAAWoAAAAABqgAApAAAAAaVAAKQAAAAACqVABkAAAABlAABpAAAAAAKoAACgAAAAGQAAGkAAAAAAagVQKAAAAApBAAqAAAAAAFqVAAoAAAASkAAGoAAAAAAWpUQCgAAABaAAAqAAAAAAAClQAKQqqABkAACoAAAAAAAKlAAZamqkGAABaQAAAAAABqkABqQaqqoAACkAAAAAAAAaQAGkFqlaQAFaQAAAAAAAAqAAYBWqkKQAClAAAAAAAABpABQFaqoYAEaAAAAAAAAACkAAAVqqlUABoAAAAAAAAAClAABWqqlAAKAAAAAAAAAAGAAAVWqpkACkAAAAAAAAAAZAAFqWqpQAZAAAAAAAAAACkABZqmmVQGkAAAAAAAAAAoQAVRlqlVQZAAAAAAAAAAGQABAalpVVQoAAAAAAAAAAoAAAGqlVVVRkAAAAAAAAACQAAGpVpVVVSgAAAAAAAAAYAAGpABpVVVCgAAAAAAAACQAGpAAAZFVVKAAAAAAAAAJABoAAAAaFVUYAAAAAAAABkAaAAAAAaVVVkAAAAAAAAKAGQAAAAAGlVSgAAAAAAABkBkAAAAAAClVWQAAAAAAAKAZAAAAAAABkVKAAAAAAAAkCQAAAAAAABkUkAAAAAAABQkAQAAAAAABgRkAAAAAAAoKAGgCQAoBkBgCgAAAAAACRkAagqAGkagBgJAAAAAAAIJABqWkAKmpABkoAAAAAACSQABqqAAKqQAChlQAAAAAIkAABqgAAakAACiVAAAAABVAAAGpAAAqkAACZAAAAAAFkAABqoAAKqgAAGZAAAAAAZAAAKqoACqqQAFakAAAAABkAABqKoAahqQAAKQAAAAAKAAAGgKgBpBoAAAYAAAAAAoQABUAIFRQBQAACQAAAAABkAABAAAqQAFAAApAAAAAACgAABQAGqQBUAACQAAAABVGQAABUBqqQVAAAoAAAAAAVaQAABkaqqlQAAWgBAAAAAGWAAABWqqqkAACSkJAAAABkGAAAEaqqlQAAUClAAAABpAGAAASaqqRAAGAGpAAAAaQAGAABFimVEABgBlpAAAGAAAGAAAWGZUQAZAFBlABCpQAAGAABYYlQAFQBVaqQUqpAAAGAAFhiVABkAFVUKhCoBQAAGQAFGZUAYABVVVaABVBAAAGQAEYkAGAAVVVVAAApAAAAGQARSQBgAAVVFAAABBQAAAGAAFFAYAAFVZAAAAEFUEAAGQAUQGAAAAAgAAAAQRQAAAGQBQBUAAAACQAAABAFABAAGAFAFAAAAAIAAAAEAAAEAAFQABQAAAUAgAAAAQAAAQBBFAAUAAAFABAAAABAAACQEIFAFAAAVQAEAAAAAAAQJABgFAUAABQAAAAAAAAAAAgAGAEBAAFABQAAAAAAAAAAAAYQEUAAUAAAAAAAAAAAAAABQABQFBQAAAAAAAAAAAAEAFAAFAUFAAAAAAAAAAAAAQAAAAUAAUAAAAAAAAAAAABAAAABQABQAAAAAAAAAAAAEAABQAAUEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAFAAAAAAAAAA", LOGO_SMALL="32,48,ACgAAAAAAAAAKQAAAAAEAAAqQAAAACkAAGqQAAABqQAAaaAAAAJaAABoZAAABRpAACQYAAAIGkAAKAoAABQKAAAoBkAAJAoAACgCQAAgCkAAGQFAAGAGAAAZAYAAkAoAABpBgAGQGQAACkCZlIAYAAAGQKGmQCQAAAGAQaVAYAAAAJAFqUCQAAAAUBWqQUAAAACQVmlCAAAAAUAKlVJAAAABAGVlVYAAAAUFQAVVgAAABRgAAZVQAAAIYAAAFWAAABSAAAAFEAAAFUYUJYEUAAAVAqQagFQAAFQBkAoAFAAAYAKgGoAZAABQBmglkAgAAFAEAUBABAAAJAEGkUAgAABUAFqpAFRAAYUAGqQBSkAFAUAWVAUVgBkAUBVUFBVkFQAUBVBQVVQFQAUBUUBVAARQAUEBAAEABABAEAQAAQAEAEAUEAEBAAAAQEQQAAAAAAAAQEAQAAAAAABAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
function logoUnpack(str, k){
  const p=str.split(','), w=+p[0], h=+p[1], bin=atob(p[2]);
  const px=[];
  const EAR_Y=26*k, EY0=49*k, EY1=59*k, L0=20*k, L1=31*k, R0=33*k, R1=43*k;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const i=y*w+x, v=(bin.charCodeAt(i>>2)>>(6-2*(i&3)))&3;
    if(!v) continue;
    let part='head';
    if(y>=EY0&&y<=EY1&&x>=L0&&x<=L1) part='eyeL';
    else if(y>=EY0&&y<=EY1&&x>=R0&&x<=R1) part='eyeR';
    else if(y<EAR_Y) part = x<w/2 ? 'earL' : 'earR';
    px.push({x,y,v,part});
  }
  return {w,h,px,k,eyeL:{x0:20*k,x1:31*k,y:54*k},eyeR:{x0:33*k,x1:43*k,y:54*k},earY:26*k,pivot:80*k};
}
const LOGO={}; let logoRAF=null, LOGO_T0=0;
function logoHash(i,k){ let n=(i*374761393+k*668265263)&0x7fffffff; n=(n^(n>>13))*1274126177&0x7fffffff; return ((n^(n>>16))&0xffff)/0xffff; }
const logoBell = p => p<=0||p>=1 ? 0 : Math.sin(p*Math.PI);
function logoEv(t,at,dur,period){ const p=((t-at)%period+period)%period; return p<dur ? logoBell(p/dur) : 0; }
function logoDraw(t, ctx, g){
  // Рисуем не полутора тысячами вызовов fillRect, а одним куском памяти: складываем
  // кадр в буфер и отдаём его целиком. На пиксельной картинке это в разы дешевле,
  // а на глаз результат тот же.
  const buf = g._buf || (g._buf = ctx.createImageData(g.w, g.h));
  const u32 = g._u32 || (g._u32 = new Uint32Array(buf.data.buffer));
  u32.fill(0);
  const INK = 0x00E9EFF2;                 // цвет пикселя, альфа добавляется отдельно
  const set = (x,y,a)=>{
    x=x|0; y=y|0;
    if(x<0||y<0||x>=g.w||y>=g.h) return;
    const v = (Math.min(255, a*255|0)<<24) | INK;
    const i = y*g.w+x;
    if((u32[i]>>>24) < (v>>>24)) u32[i] = v;
  };
  const k=g.k, P=9600;
  let sway = 0.020*Math.sin(t/2300) + 0.011*Math.sin(t/1370);
  sway += logoEv(t,7000,1400,P)*0.055;
  const bob = Math.round(0.8*Math.sin(t/1900)*k);
  const twL = Math.max(logoEv(t,4400,420,P), logoEv(t,8600,380,P));
  const twR = Math.max(logoEv(t,1200,420,P), logoEv(t,8700,380,P));
  const closedR = logoEv(t,2600,620,P)>0.35 || logoEv(t,5600,300,P)>0.35;
  const closedL = logoEv(t,5600,300,P)>0.35;
  const shear = y => Math.round(sway*(g.pivot-y));
  const noise = Math.floor(t/90);
  for(let i=0;i<g.px.length;i++){
    const q=g.px[i];
    if((q.part==='eyeL'&&closedL)||(q.part==='eyeR'&&closedR)) continue;
    let a=1;
    // Полутон в движении мерцает: часть точек выпадает, у остальных гуляет яркость.
    // Неподвижным такой кадр выглядит грязно, поэтому без анимации — ровно и все точки.
    if(q.v===1){ if(!ANIM_ON) a=0.55; else { const r=logoHash(i,noise); if(r>0.62) continue; a=0.30+r*0.75; } }
    let dx=shear(q.y);
    if(q.part==='earL'||q.part==='earR'){
      const r=(g.earY-q.y)/g.earY;
      dx += Math.round((q.part==='earL'?-twL:twR)*r*r*3.4*k);
    }
    set(q.x+dx, q.y+bob, a);
  }
  const lid = e => { const y=Math.round(e.y+bob), dx=shear(e.y), u=Math.max(1,Math.round(k));
    for(let x=e.x0+1;x<e.x1;x++) for(let j=0;j<u;j++) set(x+dx, y+j, 1);
    for(let j=0;j<u;j++){ set(e.x0+dx, y-u+j, 1); set(e.x1+dx, y-u+j, 1); } };
  if(closedL) lid(g.eyeL);
  if(closedR) lid(g.eyeR);
  ctx.putImageData(buf, 0, 0);
}

const ANVIL_BODY="44,36,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD////AAAgAAAOAAIAAAAcACAAAAAwAgAAABwAIAAADgAD/4A/AAAABAQAAAAAQEAAAAACCAAAAAAggAAAAAEQAAAAABEAAAAAAggAAAAAQEAAAAAEBAAAAACAIAAAABABAAAAAgAIAAAAIACAAAA8AAeAAAIAAAgAACAAAIAAA///+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
let ANVIL_HITS=[0,2150,2380,4600,6900,7130], ANVIL_PERIOD=9200;  // film: "let" so the idle strikes can be re-timed to the beat
const ANVIL_DY=22, ANVIL_TOP=8+ANVIL_DY;   // тело опущено вниз, сверху место под замах
let anvilClickT=null;
// Молот по клику. Пиксельную картинку крутить нельзя — рассыпается, поэтому фигура
// задана точками, а поворот считается для каждой точки и округляется до пикселя.
// Угол небольшой, ±30 градусов, на таком повороте ступеньки почти не видны.
const HAMMER = (()=>{
  const px=[];
  for(let x=-4;x<=4;x++){ px.push([x,-6]); px.push([x,0]); }      // боёк, верх и низ
  for(let y=-5;y<=-1;y++){ px.push([-4,y]); px.push([4,y]); }     // боковины бойка
  for(let y=-19;y<=-7;y++) px.push([0,y]);                        // рукоять
  px.push([1,-7]); px.push([1,-8]);                               // утолщение у бойка
  return px;
})();
const HIT_X=18, HIT_Y=8+22, SWING=430;
// фазы: замах вниз → удар → отскок → уход вверх
function hammerPose(age){
  if(age<0||age>SWING) return null;
  if(age<150){ const k=age/150, e=k*k; return {y:6+(HIT_Y-6)*e, a:(-20+20*e)*Math.PI/180, o:1}; }
  if(age<300){ const k=(age-150)/150; return {y:HIT_Y-9*k, a:(-20*k)*Math.PI/180, o:1}; }
  const k=(age-300)/(SWING-300);
  return {y:HIT_Y-9-14*k, a:(-20-12*k)*Math.PI/180, o:1-k};
}
function drawHammer(ctx, age){
  const p=hammerPose(age); if(!p) return;
  const c=Math.cos(p.a), sn=Math.sin(p.a);
  ctx.fillStyle = p.o>=1 ? '#f2efe9' : 'rgba(242,239,233,'+p.o.toFixed(2)+')';
  for(const [x,y] of HAMMER){
    const X=Math.round(HIT_X + x*c - y*sn), Y=Math.round(p.y + x*sn + y*c);
    if(X<-2||X>60||Y<-2||Y>60) continue;
    ctx.fillRect(X, Y, 1, 1);
  }
}

let ANVIL=null;
function anvilUnpack(str){
  const p=str.split(','), w=+p[0], h=+p[1], bin=atob(p[2]), core=[];
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const i=y*w+x;
    if((bin.charCodeAt(i>>3)>>(7-(i&7)))&1) core.push([x,y+ANVIL_DY]);
  }
  return {w,h:h+ANVIL_DY,core};
}
function anvilHit(t){
  let e=0;
  for(const at of ANVIL_HITS){
    const p=((t-at)%ANVIL_PERIOD+ANVIL_PERIOD)%ANVIL_PERIOD;
    if(p<260) e=Math.max(e, 1-p/260);
  }
  if(anvilClickT!=null){                 // удар от клика: сильнее обычного
    const p=t-anvilClickT-150;           // 150 мс уходит на замах
    if(p>=0 && p<300) e=Math.max(e, 1-p/300);
  }
  return e;
}
function anvilDraw(t, ctx, g){
  ctx.clearRect(0,0,g.w,g.h);
  const e=anvilHit(t);
  const dy = e>0.55 ? 1 : 0;
  const dx0 = e>0.45 ? (Math.floor(t/40)%2 ? 1 : -1) : 0;
  const shake = e>0.25 ? 0.13+e*0.22 : 0.13;
  const noise=Math.floor(t/120);
  for(let i=0;i<g.core.length;i++){
    const [x,y]=g.core[i];
    ctx.fillStyle='#f2efe9';
    ctx.fillRect(x+dx0, y+dy, 1, 1);
    if(!ANIM_ON) continue;                     // стоп-кадр: контур без ряби
    for(let k=0;k<4;k++){
      const r=logoHash(i*4+k, noise);
      if(r>shake) continue;
      ctx.fillStyle='rgba(242,239,233,'+(0.28+r*2.4)+')';
      ctx.fillRect(x+[1,-1,0,0][k]+dx0, y+[0,0,1,-1][k]+dy, 1, 1);
    }
  }
  if(ANIM_ON) for(let i=0;i<4;i++){           // подтёки под подошвой
    const per=1900+i*430, p=((t+i*700)%per)/per;
    const y=32+ANVIL_DY+Math.round(p*3.4);
    if(y<g.h){ ctx.fillStyle='rgba(242,239,233,0.85)'; ctx.fillRect([13,18,24,29][i]+dx0, y+dy, 1, 1); }
  }
  const spark=(age, seed, n, spread)=>{
    if(age<0||age>620) return;
    for(let i=0;i<n;i++){
      const r1=logoHash(seed+i,1), r2=logoHash(seed+i,2), r3=logoHash(seed+i,3);
      const x=HIT_X-spread/2+r1*spread+(r2-0.5)*0.034*age;
      const y=ANVIL_TOP-1-(0.048+r3*0.040)*age+0.000058*age*age;
      if(y<-3||y>ANVIL_TOP+2) continue;
      ctx.fillStyle='rgba(242,239,233,'+(Math.max(0,1-age/620)*(0.55+r3*0.45))+')';
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  };
  if(ANIM_ON) for(const at of ANVIL_HITS)     // искры от обычных ударов
    spark(((t-at)%ANVIL_PERIOD+ANVIL_PERIOD)%ANVIL_PERIOD, Math.round(at), 14, 18);
  if(anvilClickT!=null){                      // клик: свой молот и вдвое больше искр
    const age=t-anvilClickT;
    spark(age-150, 7717, 26, 22);
    drawHammer(ctx, age);
    if(age>SWING+700) anvilClickT=null;
  }
}

window.AJLogo = { setIdleHits: (a, p) => { ANVIL_HITS = a; ANVIL_PERIOD = p; }, LOGO, logoUnpack, logoDraw, LOGO_BIG, LOGO_SMALL, anvilUnpack, anvilDraw, ANVIL_BODY,
  setClick: t => { anvilClickT = t; }, getClick: () => anvilClickT, HIT_X, HIT_Y, ANVIL_TOP, ANVIL_DY, logoHash };
