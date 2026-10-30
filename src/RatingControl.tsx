import { useState } from 'react';
import { saveOrderRating } from './ratings';

export function RatingControl({orderId,value,onSaved}:{orderId:string;value:number|null|undefined;onSaved:(rating:number)=>void}){
 const [rating,setRating]=useState(value||0),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const submit=async()=>{if(busy||rating<1)return;setBusy(true);setMessage('');try{await saveOrderRating(orderId,rating);onSaved(rating);window.dispatchEvent(new Event('ratings-updated'));setMessage('Rating saved.');}catch(e){setMessage(e instanceof Error?e.message:'Rating could not be saved.');}finally{setBusy(false)}};
 return <fieldset className="rating-control" disabled={busy}><legend>{value?'Edit rating':'Rate this service'}</legend><div role="radiogroup" aria-label="Rating from 1 to 5 stars">{[1,2,3,4,5].map(star=><label key={star} aria-label={`${star} ${star===1?'star':'stars'}`}><input type="radio" name={`rating-${orderId}`} value={star} checked={rating===star} onChange={()=>setRating(star)}/><span aria-hidden="true">{star<=rating?'★':'☆'}</span></label>)}</div><button type="button" className="button small" disabled={busy||rating<1} onClick={()=>void submit()}>{busy?'Saving…':value?'Save rating':'Submit rating'}</button>{message&&<small role="status">{message}</small>}</fieldset>;
}
