/* State machine v3 — 9 fields, pan, restart, derived bounds.
   Built with a DEPTH-TRACKING assembler: every reference to a value is by NAME, and the OP_PICK
   offset is computed from the live stack model. Hand-counting depths caused two bugs today. */
import * as pkg from '/home/sundive/Documents/GitHub/grafverse/mint/node_modules/@bsv/sdk/dist/esm/src/script/index.js';
const { LockingScript, UnlockingScript, Spend, OP } = pkg;

export const SHIFT=32, S=Math.pow(2,SHIFT), ESCAPE=4*S;
export const W=16, H=12, SPAN0=4.0;
export const STEP0=Math.round(SPAN0/W*S);
export const TX=Math.round(-1.423288564770*S), TY=Math.round(0.127278891029*S);
export const MX0=6, K=4, MXCAP=65535;
const HW=Math.floor(W/2), HH=Math.floor(H/2);

const snum=n=>{ if(n===0) return []; const g=n<0; let v=Math.abs(n); const b=[];
  while(v>0){ b.push(v%256); v=Math.floor(v/256); }
  if(b[b.length-1]&0x80) b.push(g?0x80:0x00); else if(g) b[b.length-1]|=0x80; return b; };
const PN=n=>{ const d=snum(n); return d.length===0?{op:OP.OP_0}:{op:d.length,data:d}; };
const op=n=>({op:OP[n]});

/* Assembler: `stack` is an array of names, last = top. */
class Asm {
  constructor(names){ this.ops=[]; this.st=names.slice(); }
  raw(o, pop=0, push=[]){ this.ops.push(o); for(let i=0;i<pop;i++) this.st.pop(); push.forEach(n=>this.st.push(n)); return this; }
  o(name, pop, push){ return this.raw(op(name), pop, push); }
  num(n, as){ return this.raw(PN(n), 0, [as||('#'+n)]); }
  depth(name){ const i=this.st.lastIndexOf(name); if(i<0) throw new Error('unknown: '+name+' | '+this.st.join(',')); return this.st.length-1-i; }
  pick(name, as){ const d=this.depth(name); this.raw(PN(d),0,['_d']); return this.raw(op('OP_PICK'),1,[as||name+"'"]); }
  bin(opname, as){ return this.o(opname, 2, [as]); }
  drop(n){ for(let i=0;i<n;i++) this.o('OP_DROP',1,[]); return this; }
  /* Branches: BOTH arms start from the same real stack, so the model must be snapshotted at IF,
     restored at ELSE, and the two arms must agree at ENDIF. Without this every depth in the
     else-path is computed against the if-path's pushes. */
  ifBegin(){ this.o('OP_IF',1,[]); this._snap=(this._snap||[]); this._snap.push(this.st.slice()); return this; }
  elseArm(){ this.raw(op('OP_ELSE'),0,[]); const sn=this._snap[this._snap.length-1];
    this._ifEnd=(this._ifEnd||[]); this._ifEnd.push(this.st.slice()); this.st=sn.slice(); return this; }
  endIf(){ this.raw(op('OP_ENDIF'),0,[]);
    const a=this._ifEnd.pop(), b=this.st; this._snap.pop();
    if(a.length!==b.length) throw new Error('branch mismatch: if='+a.length+' else='+b.length+'\n  if : '+a.join(',')+'\n  else: '+b.join(','));
    return this; }
  /* Leave EXACTLY these values above the branch's entry baseline, dropping every intermediate.
     Both arms then agree by construction instead of by careful bookkeeping. */
  armReturn(names){
    names.slice().reverse().forEach(n=>{ this.pick(n,'_r'); this.raw(op('OP_TOALTSTACK'),1,[]); });
    const base=this._snap[this._snap.length-1].length;
    this.drop(this.st.length-base);
    names.forEach(n=>this.raw(op('OP_FROMALTSTACK'),0,[n]));
    return this;
  }
  armReturnFinal(names){
    names.slice().reverse().forEach(n=>{ this.pick(n,'_r'); this.raw(op('OP_TOALTSTACK'),1,[]); });
    this.drop(this.st.length);
    names.forEach(n=>this.raw(op('OP_FROMALTSTACK'),0,[n]));
    return this;
  }
  toAlt(n){ for(let i=0;i<n;i++) this.o('OP_TOALTSTACK',1,[]); return this; }
  fromAlt(names){ names.forEach(n=>this.raw(op('OP_FROMALTSTACK'),0,[n])); return this; }
}

const F=['cr','ci','zr','zi','i','step','cx','cy','mx'];

function build(){
  const a=new Asm(F.slice());
  // ── z² + c, magnitude, and the escape/cap test ───────────────────────────────────────────────
  a.pick('zr','a'); a.pick('zr','b'); a.bin('OP_MUL','zrzr'); a.num(S); a.bin('OP_DIV','zr2');
  a.pick('zi','a'); a.pick('zi','b'); a.bin('OP_MUL','zizi'); a.num(S); a.bin('OP_DIV','zi2');
  a.pick('zr','a'); a.pick('zi','b'); a.bin('OP_MUL','zrzi'); a.num(2); a.bin('OP_MUL','x2'); a.num(S); a.bin('OP_DIV','cross');
  a.pick('zr2','p'); a.pick('zi2','q'); a.bin('OP_ADD','mag');
  a.num(ESCAPE); a.bin('OP_GREATERTHAN','esc');
  a.pick('i','p'); a.pick('mx','q'); a.bin('OP_GREATERTHANOREQUAL','maxed');
  a.bin('OP_BOOLOR','done');

  // ── the two futures, each leaving exactly 9 values, then the originals are discarded ─────────
  const keep=(b)=>{ b.toAlt(9); b.st=b.st.slice(0, b.st.length); };
  a.ifBegin();
    // PASS / PIXEL ADVANCE
    a.pick('cx','p'); a.num(HW); a.pick('step','q'); a.bin('OP_MUL','hs'); a.bin('OP_SUB','cr0');
    a.pick('cr0','p'); a.num(W-1); a.pick('step','q'); a.bin('OP_MUL','ws'); a.bin('OP_ADD','crMax');
    a.pick('cr','p'); a.pick('step','q'); a.bin('OP_ADD','crN');
    a.pick('crN','p'); a.pick('crMax','q'); a.bin('OP_GREATERTHAN','rowEnd');
    a.ifBegin();
      a.pick('cy','p'); a.num(HH); a.pick('step','q'); a.bin('OP_MUL','hs2'); a.bin('OP_SUB','ci0');
      a.pick('ci0','p'); a.num(H-1); a.pick('step','q'); a.bin('OP_MUL','hs3'); a.bin('OP_ADD','ciMax');
      a.pick('ci','p'); a.pick('step','q'); a.bin('OP_ADD','ciN');
      a.pick('ciN','p'); a.pick('ciMax','q'); a.bin('OP_GREATERTHAN','passEnd');
      a.ifBegin();
        // ── end of pass: refine or restart ──
        a.pick('step','p'); a.num(1); a.bin('OP_GREATERTHAN','deeper');
        a.ifBegin();
          a.pick('step','p'); a.num(2); a.bin('OP_DIV','nStep');
          a.pick('mx','p'); a.num(K); a.bin('OP_ADD','mxr'); a.num(MXCAP); a.bin('OP_MIN','nMx');
          a.pick('cx','p'); a.num(TX); a.pick('cx','q'); a.bin('OP_SUB','dx'); a.num(3); a.bin('OP_MUL','dx3');
            a.num(4); a.bin('OP_DIV','dx4'); a.bin('OP_ADD','nCx');
          a.pick('cy','p'); a.num(TY); a.pick('cy','q'); a.bin('OP_SUB','dy'); a.num(3); a.bin('OP_MUL','dy3');
            a.num(4); a.bin('OP_DIV','dy4'); a.bin('OP_ADD','nCy');
        a.elseArm();
          a.num(STEP0,'nStep'); a.num(MX0,'nMx'); a.num(0,'nCx'); a.num(0,'nCy');
        a.endIf();
        a.pick('nCx','p'); a.num(HW); a.pick('nStep','q'); a.bin('OP_MUL','m1'); a.bin('OP_SUB','oCr');
        a.pick('nCy','p'); a.num(HH); a.pick('nStep','q'); a.bin('OP_MUL','m2'); a.bin('OP_SUB','oCi');
        a.armReturn(['oCr','oCi','nStep','nMx','nCx','nCy']);
      a.elseArm();
        a.pick('cr0','nn'); a.raw({op:OP.OP_NOP},0,[]); a.st.pop(); a.st.push('oCr');
        a.pick('ciN','nn'); a.st.pop(); a.st.push('oCi');
        a.pick('step','nn'); a.st.pop(); a.st.push('nStep');
        a.pick('mx','nn'); a.st.pop(); a.st.push('nMx');
        a.pick('cx','nn'); a.st.pop(); a.st.push('nCx');
        a.pick('cy','nn'); a.st.pop(); a.st.push('nCy');
        a.armReturn(['oCr','oCi','nStep','nMx','nCx','nCy']);
      a.endIf();
      a.armReturn(['oCr','oCi','nStep','nMx','nCx','nCy']);
    a.elseArm();
      a.pick('crN','nn'); a.st.pop(); a.st.push('oCr');
      a.pick('ci','nn');  a.st.pop(); a.st.push('oCi');
      a.pick('step','nn');a.st.pop(); a.st.push('nStep');
      a.pick('mx','nn');  a.st.pop(); a.st.push('nMx');
      a.pick('cx','nn');  a.st.pop(); a.st.push('nCx');
      a.pick('cy','nn');  a.st.pop(); a.st.push('nCy');
      a.armReturn(['oCr','oCi','nStep','nMx','nCx','nCy']);
    a.endIf();
    a.pick('oCr','o1'); a.pick('oCi','o2'); a.num(0,'o3'); a.num(0,'o4'); a.num(0,'o5');
    a.pick('nStep','o6'); a.pick('nCx','o7'); a.pick('nCy','o8'); a.pick('nMx','o9');
    a.armReturn(['o1','o2','o3','o4','o5','o6','o7','o8','o9']);
  a.elseArm();
    a.pick('cr','o1'); a.pick('ci','o2');
    a.pick('zr2','p'); a.pick('zi2','q'); a.bin('OP_SUB','d'); a.pick('cr','r'); a.bin('OP_ADD','o3');
    a.pick('cross','p'); a.pick('ci','q'); a.bin('OP_ADD','o4');
    a.pick('i','p'); a.o('OP_1ADD',1,['o5']);
    a.pick('step','o6'); a.pick('cx','o7'); a.pick('cy','o8'); a.pick('mx','o9');
    a.armReturn(['o1','o2','o3','o4','o5','o6','o7','o8','o9']);
  a.endIf();
  /* Nine originals still sit below the nine results — drop them. */
  a.armReturnFinal(['o1','o2','o3','o4','o5','o6','o7','o8','o9']);
  return a;
}

let ASM=null, OPS=null;
try{ ASM=build(); OPS=ASM.ops; }catch(e){ console.log('BUILD ERROR:', e.message); }

export function ref(s){
  const zr2=Math.trunc(s.zr*s.zr/S), zi2=Math.trunc(s.zi*s.zi/S), mag=zr2+zi2;
  if(mag>ESCAPE || s.i>=s.mx){
    const cr0=s.cx-HW*s.step, crMax=cr0+(W-1)*s.step;
    let cr=s.cr+s.step, ci=s.ci, step=s.step, mx=s.mx, cx=s.cx, cy=s.cy;
    if(cr>crMax){
      const ci0=s.cy-HH*s.step, ciMax=ci0+(H-1)*s.step;
      cr=cr0; ci=s.ci+s.step;
      if(ci>ciMax){
        if(step>1){ step=Math.trunc(step/2); mx=Math.min(MXCAP,mx+K);
          cx=cx+Math.trunc((TX-cx)*3/4); cy=cy+Math.trunc((TY-cy)*3/4); }
        else { step=STEP0; mx=MX0; cx=0; cy=0; }
        cr=cx-HW*step; ci=cy-HH*step;
      }
    }
    return {cr,ci,zr:0,zi:0,i:0,step,cx,cy,mx};
  }
  return {cr:s.cr,ci:s.ci,zr:zr2-zi2+s.cr,zi:Math.trunc(2*s.zr*s.zi/S)+s.ci,
          i:s.i+1,step:s.step,cx:s.cx,cy:s.cy,mx:s.mx};
}

export function run(s){
  if(!OPS) return {err:'no ops'};
  const unlock=new UnlockingScript(F.map(k=>PN(s[k])));
  const lock=new LockingScript([...OPS]);
  const sp=new Spend({ sourceTXID:'00'.repeat(32), sourceOutputIndex:0, sourceSatoshis:1,
    lockingScript:lock, transactionVersion:2, otherInputs:[], outputs:[], inputIndex:0,
    unlockingScript:unlock, inputSequence:0xffffffff, lockTime:0 });
  let err=null; try{ sp.validate(); }catch(e){ err=e.message.split('\n')[0]; }
  const dec=b=>{ if(!b||!b.length) return 0; const a=Array.from(b); let n=false;
    if(a[a.length-1]&0x80){ n=true; a[a.length-1]&=0x7f; }
    let v=0; for(let k=a.length-1;k>=0;k--) v=v*256+a[k]; return n?-v:v; };
  const st=sp.stack.map(dec), L=st.length, out={};
  F.forEach((k,idx)=>{ out[k]=st[L-9+idx]; });
  return { err, depth:L, size:lock.toBinary().length, out };
}
export { ASM };
