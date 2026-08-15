// Does the COVENANT enforce BLOW_V, or only the reference? Drive a real move through Spend.
import { Transaction, Spend, UnlockingScript, TransactionSignature, PrivateKey, P2PKH, Hash } from '@bsv/sdk'
import { emptyShell, loadCar, loadTrack, arm, refTick, buildShellLock, shellUnlockingOps,
  SHELL_SCOPE, SHELL_MAX_FEE, RACER_REGS as R, S, PHASE, PHASE_NAMES, type ShellState }
  from '../src/shell.ts'
import { serializeOutput } from '../src/covenant.ts'
const KEY=PrivateKey.fromRandom(), DRV=Hash.hash160(KEY.toPublicKey().encode(true) as number[])
const u64=(n:number)=>{const b:number[]=[];let x=n;for(let i=0;i<8;i++){b.push(x%256);x=Math.floor(x/256)}return b}
async function move(st:ShellState,next:ShellState,thr:number,value:number,out:number,at:number){
  const lock=buildShellLock({state:st,maxFee:SHELL_MAX_FEE})
  const src=new Transaction(); src.addOutput({lockingScript:lock,satoshis:value})
  const tx=new Transaction(); tx.version=2
  tx.addInput({sourceTransaction:src,sourceOutputIndex:0,sequence:0xfffffffe})
  tx.addOutput({lockingScript:buildShellLock({state:next,maxFee:SHELL_MAX_FEE}),satoshis:out})
  tx.lockTime=at
  const pre=TransactionSignature.format({sourceTXID:src.id('hex'),sourceOutputIndex:0,sourceSatoshis:value,
    transactionVersion:2,otherInputs:[],inputIndex:0,outputs:tx.outputs,inputSequence:0xfffffffe,
    subscript:lock,lockTime:at,scope:SHELL_SCOPE})
  const ch=(await new P2PKH().unlock(KEY).sign(tx,0)).chunks
  tx.inputs[0].unlockingScript=new UnlockingScript(shellUnlockingOps({
    spenderOutputs:[], newValue:u64(out), preimage:pre, sig:ch[0].data??[], pubKey:ch[1].data??[],
    throttle:thr, load:{driver:next.driver,pool:next.pool,eng:next.eng,tyr:next.tyr,
      finish:next.finish,slip:next.slip,green:next.green,gap:next.gap}}))
  try { return new Spend({sourceTXID:src.id('hex'),sourceOutputIndex:0,sourceSatoshis:value,lockingScript:lock,
    transactionVersion:2,otherInputs:[],outputs:tx.outputs,inputIndex:0,
    unlockingScript:tx.inputs[0].unlockingScript,inputSequence:0xfffffffe,lockTime:at}).validate()===true }
  catch { return false }
}
// race until the reference says the engine let go on SPEED, then put that exact move to the covenant
let st=arm(loadTrack(loadCar({...emptyShell(),driver:DRV},{driver:DRV,eng:18,tyr:10},R),
  {finish:Math.round(402*S),slip:1000,green:1700000000,gap:1,pool:new Array(36).fill(0)}))
let fuel=28000, blew=false, mph=(v:number)=>(v/S)*22.3694

/* ⚠ THE DRIVER HAS TO BE EXACTLY THIS RECKLESS AND NO MORE. Full throttle spins an eng 18 car off the
   line, so the run ends at tick 0 by GRIP and the speed rule is never reached — the first version of
   this test "passed" having proved nothing. And the ordinary strategy avoids `ended` altogether, so it
   lifts for the rev limit and never reaches it either. What is needed is a driver who respects
   traction and refuses to lift for the revs: the largest throttle that does not SPIN, ignoring the
   blow. That is the only driver who can put this rule to the covenant. */
const noSpin=(st:ShellState,fuel:number)=>{
  let best=0
  for(let t=0;t<=R.THROTTLE_MAX;t++){
    try { if(!refTick(st,{throttle:t,lockTime:Math.max(st.green,st.last+st.gap),fuel},R).spun) best=t } catch {}
  }
  return best
}
for (let i=0;i<400 && !blew;i++){
  const at=Math.max(st.green,st.last+st.gap)
  const thr=noSpin(st,fuel)
  const w=refTick(st,{throttle:thr,lockTime:at,fuel},R)
  const spun=w.spun
  if (w.ended && !spun) {          // ended without wheelspin ⇒ it can only be the speed rule
    blew=true
    console.log('reference: ENGINE LET GO at', mph(st.v).toFixed(0), 'mph  → phase', PHASE_NAMES[w.state.phase])
    const ok=await move(st,w.state,thr,fuel,fuel-w.burn,at)
    console.log('covenant accepts that exact successor :', ok ? '✓ YES — the Script enforces it too' : '⚠ NO')
    // and the control: does the covenant REFUSE a successor that carries on racing instead?
    const pretend={...st, phase:PHASE.RACING, last:at, n:st.n+1, v:st.v, s:st.s+st.v}
    const bad=await move(st,pretend,thr,fuel,fuel-w.burn,at)
    console.log('covenant refuses "carry on regardless" :', bad ? '⚠ NO — it let it through' : '✓ YES')
    break
  }
  if (w.ended) { console.log('ended by wheelspin at tick', st.n, '— not the speed rule'); break }
  st=w.state; fuel-=w.burn
  if (fuel<1){ console.log('ran dry before reaching the limit'); break }
}
if (!blew) console.log('⚠ never reached the blow speed — the rule was NOT exercised')
