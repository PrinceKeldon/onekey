"use client";

import { useEffect, useState } from "react";
import { getThing, checkIdentity, claimThing, mediaUrl, requestTransfer, confirmTransfer } from "../../../lib/api";
import MagicLinkGate from "../../../components/MagicLinkGate";

type Thing = {
  onekey_code:string; name:string; status:string; owner_display_name:string;
  identity_type:"serial"|"barcode"|"qr_tag"; identity_value:string; created_at:string;
  history:{type:string;detail?:string;created_at:string}[];
  documents:{label:string;url?:string|null;body?:string|null;uploaded_at:string}[];
  photos:{url:string;is_primary:boolean;created_at:string}[];
};

const dateTime=(v:string)=>new Date(v).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});

export default function ThingPage({params}:{params:{code:string}}){
  const [loading,setLoading]=useState(true), [thing,setThing]=useState<Thing|null>(null);
  useEffect(()=>{getThing(params.code).then(setThing).finally(()=>setLoading(false));},[params.code]);
  if(loading) return <main className="claim"><div className="eyebrow">ONEKEY RECORD</div><p className="empty">Retrieving memory…</p></main>;
  return thing ? <KnownThing thing={thing}/> : <UnclaimedThing code={params.code}/>;
}

function KnownThing({thing}:{thing:Thing}){
  const photo=thing.photos.find(p=>p.is_primary)||thing.photos[0];
  const [message,setMessage]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
  useEffect(()=>{
    const q=new URLSearchParams(window.location.search), transferId=q.get("transfer"), token=q.get("token");
    if(!transferId||!token)return;
    confirmTransfer(transferId,token).then(r=>setMessage(r.message||"Ownership transfer confirmed.")).catch((e:any)=>setError(e.message||"Transfer confirmation failed."));
  },[thing.onekey_code]);
  return <main className="record">
    <div className="onekey-container">
      {message&&<div className="success" style={{marginBottom:16}}>{message}</div>}
      {error&&<div className="alert" style={{marginBottom:16}}>{error}</div>}
      <div className="record-grid">
        <div className="media">{photo?<img src={mediaUrl(photo.url,thing.onekey_code)} alt={thing.name}/>:<div className="media-empty">No reference image</div>}</div>
        <div className="record-panel">
          <div className="eyebrow">ONEKEY / {thing.onekey_code}</div>
          <h1 className="record-title">{thing.name}</h1>
          <div className="status">{thing.status}</div>
          <div className="meta">
            <div className="meta-card"><span>Owner</span><strong>{thing.owner_display_name}</strong></div>
            <div className="meta-card"><span>Identity</span><strong>{thing.identity_value}</strong></div>
            <div className="meta-card"><span>Created</span><strong>{dateTime(thing.created_at)}</strong></div>
            <div className="meta-card"><span>Record</span><strong className="mono">#{thing.onekey_code}</strong></div>
          </div>
          <TransferOwnership code={thing.onekey_code} onTransferred={()=>window.location.reload()}/>
          <section className="section"><h3>Documents</h3>
            {thing.documents.length===0?<p className="empty">No documents added yet.</p>:thing.documents.map((d,i)=><div className="doc" key={i}>
              <div>{d.url?<a href={d.url} target="_blank" rel="noreferrer">{d.label} ↗</a>:<span>{d.label}</span>}{d.body&&<div className="event-detail">{d.body}</div>}</div>
              <span className="event-time">{dateTime(d.uploaded_at)}</span>
            </div>)}
          </section>
          <section className="section"><h3>History</h3>
            <div className="timeline">{thing.history.map((h,i)=><div className="event" key={i}><span className="event-dot"/><div><div className="event-title">{h.type.replace(/_/g," ")}</div>{h.detail&&<div className="event-detail">{h.detail}</div>}</div><span className="event-time">{dateTime(h.created_at)}</span></div>)}</div>
          </section>
        </div>
      </div>
    </div>
  </main>;
}

function TransferOwnership({code,onTransferred}:{code:string;onTransferred:()=>void}){
  const [open,setOpen]=useState(false),[current,setCurrent]=useState(""),[name,setName]=useState(""),[contact,setContact]=useState(""),[submitting,setSubmitting]=useState(false),[sent,setSent]=useState(false),[error,setError]=useState<string|null>(null);
  async function submit(e:React.FormEvent){e.preventDefault();setSubmitting(true);setError(null);try{const r=await requestTransfer(code,{current_owner_contact:current.trim(),new_owner_contact:contact.trim(),new_owner_display_name:name.trim()});if(!r.transfer_id)throw new Error("Could not create transfer request.");setSent(true);}catch(e:any){setError(e.message||"Could not start the transfer.");}finally{setSubmitting(false);}}
  if(!open)return <button className="secondary-btn" onClick={()=>setOpen(true)}>Transfer ownership</button>;
  if(sent)return <div className="success">Transfer request sent. Both parties must confirm before ownership changes.</div>;
  return <form className="form-stack" onSubmit={submit}>
    <p className="empty">Confirmation is required from the current owner and the new owner.</p>
    <div className="field"><label>CURRENT OWNER EMAIL</label><input className="input" type="email" value={current} onChange={e=>setCurrent(e.target.value)} required/></div>
    <div className="field"><label>NEW OWNER NAME</label><input className="input" value={name} onChange={e=>setName(e.target.value)} required/></div>
    <div className="field"><label>NEW OWNER EMAIL</label><input className="input" type="email" value={contact} onChange={e=>setContact(e.target.value)} required/></div>
    {error&&<div className="alert">{error}</div>}
    <div style={{display:"flex",gap:8}}><button className="primary-btn" disabled={submitting}>{submitting?"Sending…":"Start transfer"}</button><button type="button" className="secondary-btn" onClick={()=>setOpen(false)}>Cancel</button></div>
  </form>;
}

function UnclaimedThing({code}:{code:string}){
  const [authEmail,setAuthEmail]=useState<string|null>(null), [hasSerial,setHasSerial]=useState<boolean|null>(null),[identity,setIdentity]=useState(""),[conflict,setConflict]=useState<string|null>(null),[name,setName]=useState(""),[owner,setOwner]=useState(""),[contact,setContact]=useState(""),[photo,setPhoto]=useState<File|null>(null),[submitting,setSubmitting]=useState(false),[result,setResult]=useState<any>(null),[error,setError]=useState<string|null>(null);
  async function check(){if(!identity)return;const r=await checkIdentity("serial",identity);setConflict(r.available?null:r.existing_onekey_code||"another record");}
  async function submit(e:React.FormEvent){e.preventDefault();if(!photo)return setError("A reference photo is required.");setSubmitting(true);setError(null);try{const f=new FormData();f.append("name",name);f.append("owner_contact",contact);f.append("owner_display_name",owner);f.append("photo",photo);if(hasSerial){f.append("identity_type","serial");f.append("identity_value",identity)}else{f.append("identity_type","qr_tag");f.append("tag_code",code)}setResult(await claimThing(f));}catch(e:any){setError(e.message)}finally{setSubmitting(false)}}
  if(!authEmail)return <MagicLinkGate onReady={setAuthEmail}/>;
  if(result)return <main className="claim"><div className="eyebrow">MEMORY CREATED</div><h1>This thing has a memory now.</h1><p className="empty mono">ONEKEY #{result.onekey_code}</p>{result.photo_warning&&<div className="alert">This reference photo looks similar to ONEKEY #{result.photo_warning.similar_thing_code}. Please confirm this is a different item.</div>}<a className="primary-btn" style={{display:"inline-flex",alignItems:"center",textDecoration:"none",marginTop:22}} href={`/t/${result.onekey_code}`}>View the record →</a></main>;
  return <main className="claim">
    <div className="eyebrow">UNCLAIMED THING / {code}</div><h1>This thing has no memory yet.</h1><p className="empty">Create its ONEKEY and give it a persistent record.</p>
    {hasSerial===null?<div className="choice-grid" style={{marginTop:28}}><button className="secondary-btn" onClick={()=>setHasSerial(true)}>It has a serial / barcode</button><button className="secondary-btn" onClick={()=>setHasSerial(false)}>No serial — use this QR</button></div>:
    <form className="form-stack" onSubmit={submit}>
      {hasSerial&&<><div className="field"><label>SERIAL / BARCODE</label><input className="input" value={identity} onChange={e=>setIdentity(e.target.value)} onBlur={check} required/></div>{conflict&&<div className="alert">Already claimed as ONEKEY #{conflict}. <a href={`/t/${conflict}`}>View it instead.</a></div>}</>}
      <div className="field"><label>NAME THIS THING</label><input className="input" value={name} onChange={e=>setName(e.target.value)} required placeholder="e.g. Leica M6"/></div>
      <div className="field"><label>YOUR NAME</label><input className="input" value={owner} onChange={e=>setOwner(e.target.value)} required/></div>
      
      <div className="field"><label>REFERENCE PHOTO</label><input className="input" type="file" accept="image/*" onChange={e=>setPhoto(e.target.files?.[0]||null)} required/></div>
      {error&&<div className="alert">{error}</div>}<button className="primary-btn" disabled={submitting||!!conflict}>{submitting?"Creating…":"Create ONEKEY"}</button>
    </form>}
  </main>;
}
