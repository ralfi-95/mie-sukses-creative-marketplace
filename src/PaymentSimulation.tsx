import { useMemo, useState } from 'react';
import { requestApi } from './apiResponse';
import { formatRupiah as money, paymentMethodLabel, simulatedPaymentReference } from './format';

function api<T=unknown>(path:string,body:unknown):Promise<T>{
 return requestApi<T>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},'Payment confirmation failed.');
}
function makeDemoMatrix(reference:string){
 const seed=[...reference].reduce((sum,char)=>sum+char.charCodeAt(0),0);
 return Array.from({length:21},(_,y)=>Array.from({length:21},(_,x)=>((seed+x*17+y*31+x*y)%7)<3));
}

export function PaymentSimulation({batchId,method,provider,attemptKey,amount,subtotal,tax,phone,onComplete,onConfirm,successMessage,onDone,onCancel,onChangePaymentMethod,cancelLabel='Cancel Payment'}:{batchId:string;method:string;provider?:string|null;attemptKey?:string|null;amount:number|string;subtotal?:number|string;tax?:number|string;phone?:string;onComplete:()=>void;onConfirm?:(demoPin:string)=>Promise<unknown>;successMessage?:string;onDone?:()=>void;onCancel:()=>void|Promise<void>;onChangePaymentMethod?:()=>void;cancelLabel?:string}){
 const [step,setStep]=useState<'instructions'|'review'|'confirmed'>('instructions'),[pin,setPin]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const reference=useMemo(()=>simulatedPaymentReference(method,provider,phone,batchId),[batchId,method,provider,phone]);
 const matrix=useMemo(()=>makeDemoMatrix(reference),[reference]);
 const confirm=async()=>{if(busy)return;setBusy(true);setError('');try{if(onConfirm)await onConfirm(pin);else await api(`/checkout/${batchId}/payment/confirm`,{...['bank_transfer','e_wallet'].includes(method)&&{demoPin:pin},...attemptKey!==undefined&&{attemptKey}});setStep('confirmed');onComplete();}catch(e){setError(e instanceof Error?e.message:'Payment confirmation failed.');}finally{setBusy(false);}};
 const cancel=async()=>{if(busy)return;setBusy(true);setPin('');setError('');try{await onCancel()}catch(e){setError(e instanceof Error?e.message:'Payment cancellation failed.')}finally{setBusy(false)}};
 if(step==='instructions')return <div className="orderactions payment-entry-actions"><button className="button" disabled={busy} onClick={()=>setStep('review')}>Review payment instructions</button>{onChangePaymentMethod&&<button type="button" className="button outline" disabled={busy} onClick={onChangePaymentMethod}>Change Payment Method</button>}<button type="button" className="button outline" disabled={busy} onClick={()=>void cancel()}>{cancelLabel}</button></div>;
 if(step==='confirmed')return <section className="success payment-simulation" role="status"><h3>Payment confirmed</h3><p>Demo reference: <code>{reference}</code></p><p>{successMessage||`${money(amount)} was confirmed as a local payment simulation. Open Orders to follow the seller's next step.`}</p>{onDone&&<button type="button" className="button outline" onClick={onDone}>Done</button>}</section>;
 return <section className="formcard payment-simulation" aria-labelledby="payment-title">
  <span className="eyebrow">DEMO PAYMENT | NO REAL FUNDS</span><h3 id="payment-title">{paymentMethodLabel(method,provider)}</h3>
  {subtotal!==undefined&&tax!==undefined&&<p>Service subtotal: {money(subtotal)} · Tax: {money(tax)}</p>}<p>Payable amount: <b>{money(amount)}</b></p><p>Transaction reference: <code>{reference}</code></p>
  {method==='bank_transfer'&&<p>Simulated destination: {provider||'Selected bank'} | fake account 0000-0000-{reference.slice(-6)}. This account is not real. Confirming only simulates a banking-app redirect.</p>}
  {method==='e_wallet'&&<p>Demo-only e-wallet reference (not a real VA): <code>{reference}</code>{phone&&<> | normalized phone {phone}</>}. No provider payment will occur.</p>}
  {['bank_transfer','e_wallet'].includes(method)&&<><label>Fake demo PIN<input inputMode="numeric" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,6))} minLength={6} maxLength={6} required/></label><small>Use the demo-only PIN 123456. Never enter a real payment PIN.</small></>}
  {method==='qris'&&<><p>This transaction-specific mock QR is non-payable and cannot be scanned by real payment apps.</p><div className="demo-matrix" role="img" aria-label={`Non-scannable demo QR pattern for ${reference}`}>{matrix.flatMap((row,y)=>row.map((active,x)=><i key={`${x}-${y}`} className={active?'active':''}/>))}<b>DEMO ONLY</b></div></>}
  {error&&<p role="alert" className="alert">Payment failed: {error}</p>}
  <div className="orderactions"><button type="button" className="button outline" disabled={busy} onClick={()=>setStep('instructions')}>Back</button>{onChangePaymentMethod&&<button type="button" className="button outline" disabled={busy} onClick={onChangePaymentMethod}>Change Payment Method</button>}<button type="button" className="button outline" disabled={busy} onClick={()=>void cancel()}>{cancelLabel}</button></div>
  <div className="payment-review" role="group" aria-label="Review and confirm payment"><h4>Review payment</h4><p>{paymentMethodLabel(method,provider)} | {money(amount)}</p><p>Confirming records only this local simulation.</p><button type="button" className="button" disabled={busy||(method!=='qris'&&pin.length!==6)} onClick={()=>void confirm()}>{busy?'Processing...':'Confirm simulated payment'}</button></div>
 </section>;
}
