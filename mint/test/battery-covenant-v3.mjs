/* THE BATTERY — full covenant, 9 state fields, 2^32. Split → state machine v3 → rebuild → compare. */
const SDK='/home/sundive/Documents/GitHub/grafverse/mint/node_modules/@bsv/sdk/dist/esm/';
const { LockingScript, UnlockingScript, Spend, OP } = await import(SDK+'src/script/index.js');
const { TransactionSignature } = await import(SDK+'src/primitives/index.js');
const pushtx = await import('/home/sundive/Documents/GitHub/grafverse/mint/src/pushtx.ts');
const cov    = await import('/home/sundive/Documents/GitHub/grafverse/mint/src/covenant.ts');
const sm     = await import('./battery-statemachine.mjs');

const SCOPE=0xc1, MAXFEE=308;
const C = pushtx.pushTxConstants(SCOPE);
const { S, W, H, STEP0, MX0 } = sm;

const snum=n=>{ if(n===0) return []; const g=n<0; let v=Math.abs(n); const b=[];
  while(v>0){ b.push(v%256); v=Math.floor(v/256); }
  if(b[b.length-1]&0x80) b.push(g?0x80:0x00); else if(g) b[b.length-1]|=0x80; return b; };
const PN=n=>{ const d=snum(n); return d.length===0?{op:OP.OP_0}:{op:d.length,data:d}; };
const D=d=> d.length<76?({op:d.length,data:d}) : d.length<256?({op:OP.OP_PUSHDATA1,data:d}) : ({op:OP.OP_PUSHDATA2,data:d});
const o=n=>({op:OP[n]});

/* fixed-width sign-magnitude fields */
const fixed=(v,n)=>{ const g=v<0; let x=Math.abs(v); const b=[];
  for(let k=0;k<n;k++){ b.push(x%256); x=Math.floor(x/256); }
  if(g) b[n-1]|=0x80; return b; };
const WID={cr:5,ci:5,zr:5,zi:5,i:2,step:5,cx:5,cy:5,mx:2};
const F=['cr','ci','zr','zi','i','step','cx','cy','mx'];

const fields=s=>[ D([0x50]), D([0x01]), D([0x07]), ...F.map(k=>D(fixed(s[k],WID[k]))) ];

function lockOps(s, off){
  const ops=[ ...fields(s), o('OP_2DROP'),o('OP_2DROP'),o('OP_2DROP'),o('OP_2DROP'),o('OP_2DROP'),o('OP_2DROP'),
    ...pushtx.pushTxVerifyOps(C),                       // [SO, NV, preimage]
    o('OP_DUP'), o('OP_DUP'),
    ...cov.extractHashOutputsOps(), o('OP_TOALTSTACK'),                     // alt:[HO]
    o('OP_SIZE'), D([52]), o('OP_SUB'), o('OP_SPLIT'), o('OP_NIP'),
      D([8]), o('OP_SPLIT'), o('OP_DROP'), o('OP_BIN2NUM'), o('OP_TOALTSTACK'),  // alt:[HO,V]
    ...cov.extractScriptCodeFieldOps(),                                    // [SO, NV, field]
    PN(off), o('OP_SPLIT') ];                                              // [.., PRE, rest]
  // peel the nine fields
  F.forEach((k,idx)=>{
    if(idx>0){ ops.push(o('OP_1'), o('OP_SPLIT'), o('OP_NIP')); }          // drop the push opcode
    ops.push(PN(WID[k]), o('OP_SPLIT'));
  });
  ops.push(o('OP_TOALTSTACK'));                                            // alt:[HO,V,SUF]
  // fields -> numbers, in F order on the main stack
  for(let k=0;k<F.length-1;k++) ops.push(o('OP_BIN2NUM'), o('OP_TOALTSTACK'));
  ops.push(o('OP_BIN2NUM'));
  for(let k=0;k<F.length-1;k++) ops.push(o('OP_FROMALTSTACK'));
  // ── the verified state machine ──
  ops.push(...sm.ASM.ops);
  // numbers -> fixed fields, rebuild the script
  for(let k=F.length-1;k>0;k--) ops.push(PN(WID[F[k]]), o('OP_NUM2BIN'), o('OP_TOALTSTACK'));
  ops.push(PN(WID[F[0]]), o('OP_NUM2BIN'));
  ops.push(o('OP_CAT'));                                                   // PRE‖cr
  for(let k=1;k<F.length;k++){ ops.push(D([WID[F[k]]]), o('OP_CAT'), o('OP_FROMALTSTACK'), o('OP_CAT')); }
  ops.push(o('OP_FROMALTSTACK'), o('OP_CAT'));                             // ‖SUF
  // value rule, out0, compare
  ops.push(o('OP_SWAP'), o('OP_DUP'), o('OP_BIN2NUM'),
    o('OP_FROMALTSTACK'), PN(MAXFEE), o('OP_SUB'), o('OP_GREATERTHANOREQUAL'), o('OP_VERIFY'),
    o('OP_SWAP'), o('OP_CAT'), o('OP_SWAP'), o('OP_CAT'),
    o('OP_HASH256'), o('OP_FROMALTSTACK'), o('OP_EQUAL'));
  return ops;
}
function buildLock(s){
  const O = 2+2+2+1;
  const probe=new LockingScript(lockOps(s,1)).toBinary().length;
  const vi = probe<253?1:probe<65536?3:5;
  return new LockingScript(lockOps(s, vi+O));
}

const u64=n=>{const b=[];let v=BigInt(n);for(let k=0;k<8;k++){b.push(Number(v&0xffn));v>>=8n;}return b;};
const varInt=n=> n<0xfd?[n]:[0xfd,n&0xff,n>>8];
const serOut=(sats,script)=>[...u64(sats),...varInt(script.length),...script];

function tick(s,V,newV,extra=[]){
  const prev=buildLock(s), next=buildLock(sm.ref(s));
  const outputs=[{satoshis:newV,lockingScript:next},...extra];
  const SO=extra.flatMap(x=>serOut(x.satoshis,x.lockingScript.toBinary()));
  const preimage=TransactionSignature.format({
    sourceTXID:'ab'.repeat(32), sourceOutputIndex:0, sourceSatoshis:V, transactionVersion:2,
    otherInputs:[], inputIndex:0, outputs, inputSequence:0xffffffff, subscript:prev, lockTime:0, scope:SCOPE });
  const unlock=new UnlockingScript([ SO.length?D(SO):{op:OP.OP_0}, D(u64(newV)), D(preimage) ]);
  const sp=new Spend({ sourceTXID:'ab'.repeat(32), sourceOutputIndex:0, sourceSatoshis:V,
    lockingScript:prev, transactionVersion:2, otherInputs:[], outputs, inputIndex:0,
    unlockingScript:unlock, inputSequence:0xffffffff, lockTime:0 });
  let ok=false, err=null;
  try{ ok=sp.validate(); }catch(e){ err=e.message.split('\n')[0]; }
  return { ok, err, lock:prev.toBinary().length, unlock:unlock.toBinary().length };
}

console.log('THE BATTERY v3 — 9 fields, 2^32, pan + restart\n');
let s={cr:0-Math.floor(W/2)*STEP0, ci:0-Math.floor(H/2)*STEP0, zr:0, zi:0, i:0, step:STEP0, cx:0, cy:0, mx:MX0};
const first=tick(s,1000000,1000000-MAXFEE);
console.log('  lock  ', first.lock, 'bytes');
console.log('  unlock', first.unlock, 'bytes');
console.log('  tick 1:', first.ok?'✓ VALID':'✗ '+first.err);
if(first.ok){
  let V=1000000, ok=0;
  for(let n=0;n<40;n++){ const r=tick(s,V,V-MAXFEE); if(!r.ok){ console.log('  fail at',n,r.err); break; } ok++; V-=MAXFEE; s=sm.ref(s); }
  console.log('  '+ok+' consecutive ticks validated');
  const txBytes = 4+1+(36+3+first.unlock+4)+1+(8+1+first.lock)+4;
  console.log('\n  minimal tick tx ~'+txBytes.toLocaleString()+' bytes  →  fee '+Math.ceil(txBytes/1000*100)+' sat at 100 sat/KB');
}

// ── boundary + adversarial ──────────────────────────────────────────────────
console.log('\n  boundary and adversarial:');
let V2=1000000;
const at   = tick(s, V2, V2-308);   console.log('    drop exactly MAX_FEE (308) :', at.ok?'✓ accepted':'✗ '+at.err);
const over = tick(s, V2, V2-309);   console.log('    drop MAX_FEE+1      (309) :', over.ok?'✗ ACCEPTED (bug)':'✓ refused');
const under= tick(s, V2, V2-100);   console.log('    drop less           (100) :', under.ok?'✓ accepted':'✗ '+under.err);
const up   = tick(s, V2, V2+500000);console.log('    top up +500,000           :', up.ok?'✓ accepted':'✗ '+up.err);
const p2pkh=new LockingScript([o('OP_DUP'),o('OP_HASH160'),D(new Array(20).fill(9)),o('OP_EQUALVERIFY'),o('OP_CHECKSIG')]);
const chg  = tick(s, V2, V2-308, [{satoshis:990000,lockingScript:p2pkh}]);
console.log('    tick WITH a change out    :', chg.ok?'✓ accepted':'✗ '+chg.err);
