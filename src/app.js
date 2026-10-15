(function(){
"use strict";
const DAY = 86400000, BAR_H = 30, GAP = 4, PAD = 8, HDR_H = 52;
const PALETTE = ["#3366CC","#1F9E89","#D9822B","#B83280","#6B5BD6","#2F855A","#C53030","#2B6CB0","#B7791F","#4A5568"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WD = ["S","M","T","W","T","F","S"];
const $ = id => document.getElementById(id);

let state = {people:[], projects:[], allocs:[]};
let readOnly = true, ready = false;
let saving = false, pendingSave = false;
let drag = null;
const now = new Date();
const todayDay = toDay(isoLocal(now));
const view = {y: now.getFullYear(), m: now.getMonth(), months: 1};
let dw = 32;

function isoLocal(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
function toDay(s){const [y,m,d]=s.split("-").map(Number);return Math.round(Date.UTC(y,m-1,d)/DAY)}
function fromDay(n){return new Date(n*DAY).toISOString().slice(0,10)}
function dow(n){return new Date(n*DAY).getUTCDay()}
function uid(){return Math.random().toString(36).slice(2,10)}
function clone(o){return JSON.parse(JSON.stringify(o))}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function leftW(){return window.innerWidth < 640 ? 150 : 240}
function vStart(){return Math.round(Date.UTC(view.y,view.m,1)/DAY)}
function vEnd(){return Math.round(Date.UTC(view.y,view.m+view.months,1)/DAY)-1}
function projById(id){return state.projects.find(p=>p.id===id)}
function personById(id){return state.people.find(p=>p.id===id)}

function normalize(d){
  const s = {people:[],projects:[],allocs:[]};
  if(d && Array.isArray(d.people)) s.people = d.people.filter(p=>p&&p.id).map(p=>({id:String(p.id),name:String(p.name||"Unnamed"),role:String(p.role||"")}));
  if(d && Array.isArray(d.projects)) s.projects = d.projects.filter(p=>p&&p.id).map((p,i)=>({id:String(p.id),name:String(p.name||"Untitled"),color:/^#[0-9a-f]{6}$/i.test(p.color)?p.color:PALETTE[i%PALETTE.length]}));
  if(d && Array.isArray(d.allocs)) s.allocs = d.allocs.filter(a=>a&&a.id&&/^\d{4}-\d\d-\d\d$/.test(a.start)&&/^\d{4}-\d\d-\d\d$/.test(a.end)).map(a=>({id:String(a.id),personId:String(a.personId),projectId:String(a.projectId),start:a.start,end:a.end,load:Math.min(100,Math.max(10,Number(a.load)||100)),note:String(a.note||"")}));
  return s;
}

/* ---------- persistence (Rust + SQLite via Tauri) ---------- */
function invoke(cmd,args){return window.__TAURI__.core.invoke(cmd,args)}
function errMsg(e){return typeof e==="string"?e:(e&&e.message)||String(e)}
function setStatus(t,warn){const el=$("status");el.textContent=t;el.title=t;el.classList.toggle("warn",!!warn)}
function snapshot(){const s=clone(state);s.allocs=s.allocs.filter(a=>a.id!=="__ghost");return s}
async function persist(){
  if(readOnly||!ready) return;
  if(saving){pendingSave=true;return}
  saving=true;setStatus("Saving…");
  try{await invoke("save_plan",{plan:snapshot()});setStatus("Saved")}
  catch(e){setStatus("Couldn't save: "+errMsg(e),true)}
  saving=false;
  if(pendingSave){pendingSave=false;persist()}
}
function commit(){render();persist()}

async function boot(){
  render();
  try{
    state=normalize(await invoke("load_plan"));
    ready=true;readOnly=false;document.body.classList.remove("ro");
    setStatus("Saved");
  }catch(e){setStatus("Couldn't open the plan: "+errMsg(e),true)}
  render();
}

/* ---------- layout ---------- */
function lanesFor(pid){
  const list=state.allocs.filter(a=>a.personId===pid).map(a=>({a,s:toDay(a.start),e:toDay(a.end)}))
    .sort((x,y)=>x.s-y.s||x.e-y.e);
  const ends=[];const out=new Map();
  for(const it of list){let i=ends.findIndex(e=>e<it.s);if(i<0){i=ends.length;ends.push(it.e)}else ends[i]=it.e;out.set(it.a.id,i)}
  return {map:out,count:Math.max(1,ends.length)};
}

function computeDw(){
  const days=vEnd()-vStart()+1;
  const avail=$("scroller").clientWidth-leftW()-2;
  const min = view.months===1?30:view.months===2?20:16;
  dw=Math.max(min,Math.floor(avail/days));
}

/* ---------- render ---------- */
function render(){
  computeDw();
  const vs=vStart(),ve=vEnd(),days=ve-vs+1,LW=leftW(),TW=days*dw;
  const endM=new Date(Date.UTC(view.y,view.m+view.months-1,1));
  $("period").textContent = view.months===1 ? MONTHS[view.m]+" "+view.y :
    MONTHS[view.m].slice(0,3)+" "+(endM.getUTCFullYear()!==view.y?view.y+" ":"")+"to "+MONTHS[endM.getUTCMonth()].slice(0,3)+" "+endM.getUTCFullYear();
  document.querySelectorAll(".seg button").forEach(b=>b.setAttribute("aria-pressed",String(+b.dataset.m===view.months)));
  $("addPerson").disabled = $("importBtn").disabled = $("exportBtn").disabled = readOnly||!ready;

  // legend
  const lg=$("legend");
  lg.innerHTML = state.projects.length ? state.projects.map(p=>`<button class="chip" data-proj="${esc(p.id)}" style="--c:${p.color}"><span class="sw"></span>${esc(p.name)}</button>`).join("")
    : `<span class="hint">${readOnly?"No projects yet.":"No projects yet. Add one under Projects."}</span>`;

  const board=$("board");
  board.style.width=(LW+TW)+"px";
  let h=`<div class="row hdr"><div class="person" style="width:${LW}px">People</div><div class="track" style="width:${TW}px">`;
  for(let d=vs;d<=ve;d++){
    const dt=new Date(d*DAY),x=(d-vs)*dw,w=dow(d);
    if(dt.getUTCDate()===1) h+=`<div class="mlabel" style="left:${x}px">${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</div>`;
    h+=`<div class="dcell${w===0||w===6?" we":""}${d===todayDay?" today":""}" style="left:${x}px;width:${dw}px"><small>${WD[w]}</small>${dt.getUTCDate()}</div>`;
  }
  h+=`</div></div>`;

  // grid overlay
  let g=`<div class="grid" style="left:${LW}px;top:${HDR_H+1}px;width:${TW}px;bottom:0;background-image:repeating-linear-gradient(to right,transparent 0 ${dw-1}px,var(--line) ${dw-1}px ${dw}px)">`;
  for(let d=vs;d<=ve;d++){const w=dow(d);if(w===0||w===6)g+=`<div class="we" style="left:${(d-vs)*dw}px;width:${dw}px"></div>`;
    if(new Date(d*DAY).getUTCDate()===1&&d!==vs)g+=`<div class="mline" style="left:${(d-vs)*dw}px"></div>`}
  if(todayDay>=vs&&todayDay<=ve)g+=`<div class="todayline" style="left:${(todayDay-vs)*dw+dw/2}px"></div>`;
  g+=`</div>`;

  let rows="";
  if(!ready){
    rows=`<div class="empty" style="width:${Math.min(LW+TW,$("scroller").clientWidth)}px;position:sticky;left:0"><p>Loading the plan…</p></div>`;
  }else if(!state.people.length){
    rows=`<div class="empty" style="width:${Math.min(LW+TW,$("scroller").clientWidth)}px;position:sticky;left:0"><p>${readOnly?"No one is on the plan yet.":"Add the first person to start planning."}</p>${readOnly?"":`<button class="btn primary" data-act="addPerson">Add person</button>`}</div>`;
  }
  for(const p of state.people){
    const {map,count}=lanesFor(p.id);
    const rh=PAD*2+count*BAR_H+(count-1)*GAP;
    // load per day
    const load=new Map();
    for(const a of state.allocs){if(a.personId!==p.id)continue;
      const s=Math.max(toDay(a.start),vs),e=Math.min(toDay(a.end),ve);
      for(let d=s;d<=e;d++)load.set(d,(load.get(d)||0)+a.load)}
    let wd=0,sum=0;for(let d=vs;d<=ve;d++){const w=dow(d);if(w===0||w===6)continue;wd++;sum+=Math.min(load.get(d)||0,200)}
    const util=wd?Math.round(sum/wd):0;
    let over=false,ov="";
    for(let d=vs;d<=ve;d++){if((load.get(d)||0)>100){over=true;ov+=`<div class="over" style="left:${(d-vs)*dw+2}px;width:${dw-4}px" title="${(load.get(d))}% booked on ${fromDay(d)}"></div>`}}
    let bars="";
    for(const a of state.allocs){
      if(a.personId!==p.id)continue;
      const s=toDay(a.start),e=toDay(a.end);if(e<vs||s>ve)continue;
      const cs=Math.max(s,vs),ce=Math.min(e,ve);
      const pr=projById(a.projectId)||{name:"(no project)",color:"#7A8796"};
      const cls="bar"+(a.load<100?" partial":"")+(s<vs?" cut-l":"")+(e>ve?" cut-r":"")+(drag&&drag.id===a.id&&drag.moved?" dragging":"")+(a.id==="__ghost"?" ghost":"");
      const tip=`${pr.name} · ${a.start} to ${a.end} · ${a.load}%${a.note?" · "+a.note:""}`;
      bars+=`<div class="${cls}" tabindex="0" role="button" data-id="${esc(a.id)}" title="${esc(tip)}" aria-label="${esc(p.name+": "+tip)}" style="--c:${pr.color};left:${(cs-vs)*dw+1}px;width:${Math.max(dw-3,(ce-cs+1)*dw-3)}px;top:${PAD+map.get(a.id)*(BAR_H+GAP)}px">`+
        (s>=vs?`<span class="h l"></span>`:"")+`<span class="lbl">${esc(pr.name)}</span>`+(a.load<100?`<span class="pct">${a.load}%</span>`:"")+(e<=ve?`<span class="h r"></span>`:"")+`</div>`;
    }
    rows+=`<div class="row${drag&&drag.mode==="reorder"&&drag.pid===p.id?" lifting":""}" data-pid="${esc(p.id)}" style="height:${rh}px">
      <div class="person" style="width:${LW}px">
        ${readOnly?`<span style="width:8px"></span>`:`<button class="grip" data-grip="${esc(p.id)}" aria-label="Reorder ${esc(p.name)}" title="Drag to reorder"><svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg></button>`}
        <button class="pinfo" data-edit-person="${esc(p.id)}"><span class="pname">${esc(p.name)}</span>${p.role?`<span class="prole">${esc(p.role)}</span>`:""}</button>
        <div class="util${over?" over":""}" title="Average booking on weekdays in this view"><b>${util}%</b>booked</div>
      </div>
      <div class="track" data-track="${esc(p.id)}" style="width:${TW}px">${ov}${bars}</div>
    </div>`;
  }
  board.innerHTML=h+g+rows+`<div class="dropline" id="dropline" style="width:${LW+TW}px"></div>`;
  if(drag&&drag.focusId){const el=board.querySelector(`.bar[data-id="${CSS.escape(drag.focusId)}"]`);if(el)el.focus({preventScroll:true});drag=null}
}

/* ---------- navigation ---------- */
function shift(n){const d=new Date(view.y,view.m+n,1);view.y=d.getFullYear();view.m=d.getMonth();render()}
$("prev").onclick=()=>shift(-1);
$("next").onclick=()=>shift(1);
$("todayBtn").onclick=()=>{view.y=now.getFullYear();view.m=now.getMonth();render();
  const x=(todayDay-vStart())*dw;$("scroller").scrollLeft=Math.max(0,x-200)};
document.querySelectorAll(".seg button").forEach(b=>b.onclick=()=>{view.months=+b.dataset.m;render()});
let rz;window.addEventListener("resize",()=>{clearTimeout(rz);rz=setTimeout(render,120)});

/* ---------- pointer interactions ---------- */
function personAtY(y){
  for(const r of document.querySelectorAll(".row[data-pid]")){const b=r.getBoundingClientRect();if(y>=b.top&&y<b.bottom)return r.dataset.pid}
  return null;
}
function dayAtX(x,track){const b=track.getBoundingClientRect();return vStart()+Math.floor((x-b.left)/dw)}

$("board").addEventListener("pointerdown",e=>{
  if(e.button!==0||!ready) return;
  const bar=e.target.closest(".bar");
  const grip=e.target.closest("[data-grip]");
  const track=e.target.closest("[data-track]");
  if(bar && bar.dataset.id!=="__ghost"){
    const a=state.allocs.find(x=>x.id===bar.dataset.id);if(!a)return;
    if(readOnly){openAlloc(a.id);return}
    e.preventDefault();
    const m=e.target.classList.contains("h")?(e.target.classList.contains("l")?"rl":"rr"):"move";
    drag={mode:m,id:a.id,x0:e.clientX,y0:e.clientY,orig:{start:a.start,end:a.end,personId:a.personId},moved:false};
  }else if(grip&&!readOnly){
    e.preventDefault();
    drag={mode:"reorder",pid:grip.dataset.grip,x0:e.clientX,y0:e.clientY,moved:false,target:null};
  }else if(track&&!readOnly&&!e.target.closest(".over")){
    const d=dayAtX(e.clientX,track);
    if(e.pointerType==="touch"){drag={mode:"tap",pid:track.dataset.track,d0:d,x0:e.clientX,y0:e.clientY,moved:false};return}
    e.preventDefault();
    drag={mode:"create",pid:track.dataset.track,d0:d,d1:d,x0:e.clientX,y0:e.clientY,moved:true,track};
    state.allocs.push({id:"__ghost",personId:drag.pid,projectId:"",start:fromDay(d),end:fromDay(d),load:100,note:""});
    render();
  }
});
window.addEventListener("pointermove",e=>{
  if(!drag) return;
  const dx=e.clientX-drag.x0,dy=e.clientY-drag.y0;
  if(!drag.moved&&Math.abs(dx)<4&&Math.abs(dy)<4) return;
  if(drag.mode==="tap"){drag.moved=true;return}
  drag.moved=true;
  if(drag.mode==="reorder"){
    document.body.classList.add("dragging");
    const rows=[...document.querySelectorAll(".row[data-pid]")];
    let idx=rows.length;
    for(let i=0;i<rows.length;i++){const b=rows[i].getBoundingClientRect();if(e.clientY<b.top+b.height/2){idx=i;break}}
    drag.target=idx;
    const line=$("dropline"),boardTop=$("board").getBoundingClientRect().top;
    const ref=idx<rows.length?rows[idx].getBoundingClientRect().top:rows[rows.length-1].getBoundingClientRect().bottom;
    line.style.display="block";line.style.top=(ref-boardTop-1)+"px";
    rows.forEach(r=>r.classList.toggle("lifting",r.dataset.pid===drag.pid));
    return;
  }
  if(drag.mode==="create"){
    const t=document.querySelector(`[data-track="${CSS.escape(drag.pid)}"]`);if(!t)return;
    const d=dayAtX(e.clientX,t);const g=state.allocs.find(a=>a.id==="__ghost");
    g.start=fromDay(Math.min(drag.d0,d));g.end=fromDay(Math.max(drag.d0,d));render();return;
  }
  const a=state.allocs.find(x=>x.id===drag.id);if(!a)return;
  const dd=Math.round(dx/dw),os=toDay(drag.orig.start),oe=toDay(drag.orig.end);
  if(drag.mode==="move"){
    document.body.classList.add("dragging");
    a.start=fromDay(os+dd);a.end=fromDay(oe+dd);
    a.personId=personAtY(e.clientY)||a.personId;
  }else if(drag.mode==="rl"){document.body.classList.add("resizing");a.start=fromDay(Math.min(os+dd,oe))}
  else{document.body.classList.add("resizing");a.end=fromDay(Math.max(oe+dd,os))}
  render();
});
function endDrag(e,cancel){
  if(!drag) return;
  const d=drag;drag=null;
  document.body.classList.remove("dragging","resizing");
  if(d.mode==="tap"){if(!d.moved&&!cancel)createBooking(d.pid,d.d0,d.d0+4);return}
  if(d.mode==="reorder"){
    if(!cancel&&d.moved&&d.target!=null){
      const from=state.people.findIndex(p=>p.id===d.pid);let to=d.target;
      if(from>-1){const [p]=state.people.splice(from,1);if(to>from)to--;state.people.splice(to,0,p);commit();return}
    }
    render();return;
  }
  if(d.mode==="create"){
    const g=state.allocs.find(a=>a.id==="__ghost");state.allocs=state.allocs.filter(a=>a.id!=="__ghost");
    if(cancel||!g){render();return}
    createBooking(d.pid,toDay(g.start),toDay(g.end));return;
  }
  const a=state.allocs.find(x=>x.id===d.id);
  if(cancel&&a){Object.assign(a,d.orig);render();return}
  if(!d.moved){render();openAlloc(d.id);return}
  if(a&&(a.start!==d.orig.start||a.end!==d.orig.end||a.personId!==d.orig.personId))commit();else render();
}
window.addEventListener("pointerup",e=>endDrag(e,false));
window.addEventListener("pointercancel",e=>endDrag(e,true));
window.addEventListener("keydown",e=>{if(e.key==="Escape"&&drag)endDrag(e,true)});

let lastProject=null;
function createBooking(pid,s,e){
  if(!state.projects.length){openProjects("Add a project first, then book people on it.");return}
  const proj=(lastProject&&projById(lastProject))?lastProject:state.projects[0].id;
  const a={id:uid(),personId:pid,projectId:proj,start:fromDay(s),end:fromDay(e),load:100,note:""};
  state.allocs.push(a);render();openAlloc(a.id,true);
}

/* keyboard on bars */
$("board").addEventListener("keydown",e=>{
  const bar=e.target.closest&&e.target.closest(".bar");if(!bar)return;
  const a=state.allocs.find(x=>x.id===bar.dataset.id);if(!a)return;
  if(e.key==="Enter"||e.key===" "){e.preventDefault();openAlloc(a.id);return}
  if(readOnly)return;
  const k={ArrowLeft:-1,ArrowRight:1}[e.key];if(!k)return;
  e.preventDefault();
  if(e.shiftKey){a.end=fromDay(Math.max(toDay(a.start),toDay(a.end)+k))}
  else{a.start=fromDay(toDay(a.start)+k);a.end=fromDay(toDay(a.end)+k)}
  drag={focusId:a.id};commit();
});

$("board").addEventListener("click",e=>{
  const ep=e.target.closest("[data-edit-person]");if(ep){openPerson(ep.dataset.editPerson);return}
  if(e.target.closest('[data-act="addPerson"]'))openPerson(null);
});
$("legend").addEventListener("click",e=>{if(e.target.closest(".chip"))openProjects()});
$("addPerson").onclick=()=>openPerson(null);
$("projBtn").onclick=()=>openProjects();

/* ---------- arm-to-confirm buttons ---------- */
function arm(btn,label,fn){
  if(btn.classList.contains("armed")){btn.classList.remove("armed");btn.textContent=btn.dataset.orig;fn();return}
  btn.classList.add("armed");btn.dataset.orig=btn.textContent;btn.textContent=label;
  setTimeout(()=>{if(btn.classList.contains("armed")){btn.classList.remove("armed");btn.textContent=btn.dataset.orig}},3500);
}
function disarm(btn){if(btn.classList.contains("armed")){btn.classList.remove("armed");btn.textContent=btn.dataset.orig}}

/* ---------- booking dialog ---------- */
let editing=null;
function openAlloc(id,isNew){
  const a=state.allocs.find(x=>x.id===id);if(!a)return;
  editing={id,isNew:!!isNew};
  $("allocTitle").textContent=isNew?"New booking":readOnly?"Booking":"Edit booking";
  $("aProject").innerHTML=state.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")+(projById(a.projectId)?"":`<option value="" selected>(no project)</option>`);
  $("aPerson").innerHTML=state.people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  $("aProject").value=a.projectId;$("aPerson").value=a.personId;
  $("aStart").value=a.start;$("aEnd").value=a.end;$("aLoad").value=a.load;$("aLoadOut").value=a.load+"%";$("aNote").value=a.note;
  $("aErr").textContent="";
  for(const el of ["aProject","aPerson","aStart","aEnd","aLoad","aNote"])$(el).disabled=readOnly;
  $("aDelete").style.display=readOnly?"none":"";$("aSave").style.display=readOnly?"none":"";
  $("aCancel").textContent=readOnly?"Close":"Cancel";disarm($("aDelete"));$("aDelete").textContent="Delete";
  $("allocDlg").showModal();
}
$("aLoad").oninput=()=>{$("aLoadOut").value=$("aLoad").value+"%"};
function closeAlloc(saved){
  if(editing&&editing.isNew&&!saved){state.allocs=state.allocs.filter(a=>a.id!==editing.id);render()}
  editing=null;if($("allocDlg").open)$("allocDlg").close();
}
$("aCancel").onclick=()=>closeAlloc(false);
$("allocDlg").addEventListener("cancel",e=>{e.preventDefault();closeAlloc(false)});
$("allocForm").onsubmit=e=>{
  e.preventDefault();if(readOnly||!editing)return closeAlloc(false);
  const a=state.allocs.find(x=>x.id===editing.id);if(!a)return closeAlloc(false);
  const s=$("aStart").value,en=$("aEnd").value;
  if(!s||!en){$("aErr").textContent="Pick a start and an end date.";return}
  if(en<s){$("aErr").textContent="The end date is before the start date.";return}
  if(!$("aProject").value){$("aErr").textContent="Choose a project.";return}
  Object.assign(a,{projectId:$("aProject").value,personId:$("aPerson").value,start:s,end:en,load:+$("aLoad").value,note:$("aNote").value.trim()});
  lastProject=a.projectId;
  editing.isNew=false;closeAlloc(true);commit();
};
$("aDelete").onclick=()=>arm($("aDelete"),"Delete booking",()=>{
  if(!editing)return;state.allocs=state.allocs.filter(a=>a.id!==editing.id);editing.isNew=false;closeAlloc(true);commit();
});

/* ---------- person dialog ---------- */
let editingPerson=null;
function openPerson(id){
  if(readOnly&&!id)return;
  const p=id?personById(id):null;editingPerson=id;
  $("personTitle").textContent=p?(readOnly?p.name:"Edit person"):"Add person";
  $("pName").value=p?p.name:"";$("pRole").value=p?p.role:"";$("pErr").textContent="";
  $("pName").disabled=$("pRole").disabled=readOnly;
  $("pDelete").style.display=p&&!readOnly?"":"none";disarm($("pDelete"));$("pDelete").textContent="Remove";
  $("personForm").querySelector('[type=submit]').style.display=readOnly?"none":"";
  $("personDlg").showModal();if(!readOnly)$("pName").focus();
}
$("pCancel").onclick=()=>$("personDlg").close();
$("personForm").onsubmit=e=>{
  e.preventDefault();if(readOnly){$("personDlg").close();return}
  const name=$("pName").value.trim();if(!name){$("pErr").textContent="Enter a name.";return}
  if(editingPerson){const p=personById(editingPerson);if(p){p.name=name;p.role=$("pRole").value.trim()}}
  else state.people.push({id:uid(),name,role:$("pRole").value.trim()});
  $("personDlg").close();commit();
};
$("pDelete").onclick=()=>{
  const n=state.allocs.filter(a=>a.personId===editingPerson).length;
  arm($("pDelete"),n?`Remove with ${n} booking${n>1?"s":""}`:"Remove person",()=>{
    state.people=state.people.filter(p=>p.id!==editingPerson);state.allocs=state.allocs.filter(a=>a.personId!==editingPerson);
    $("personDlg").close();commit();
  });
};

/* ---------- projects dialog ---------- */
let projTimer;
function projChanged(){render();clearTimeout(projTimer);projTimer=setTimeout(persist,500)}
function renderProjList(){
  $("plist").innerHTML=state.projects.length?state.projects.map(p=>{
    const n=state.allocs.filter(a=>a.projectId===p.id).length;
    return `<div class="prow" data-pid="${esc(p.id)}"><input type="color" value="${p.color}" aria-label="Colour for ${esc(p.name)}" ${readOnly?"disabled":""}>
      <input type="text" value="${esc(p.name)}" maxlength="50" aria-label="Project name" ${readOnly?"disabled":""}>
      <span class="count">${n} booking${n===1?"":"s"}</span>${readOnly?"":`<button type="button" class="btn danger icon" data-del aria-label="Delete ${esc(p.name)}">✕</button>`}</div>`}).join("")
    :`<p style="margin:0;color:var(--muted)">No projects yet.</p>`;
}
function openProjects(msg){
  $("projMsg").textContent=msg||"";$("projMsg").style.display=msg?"":"none";
  $("addProj").style.display=readOnly?"none":"";
  renderProjList();$("projDlg").showModal();
}
$("plist").addEventListener("input",e=>{
  if(readOnly)return;const row=e.target.closest(".prow");const p=row&&projById(row.dataset.pid);if(!p)return;
  if(e.target.type==="color")p.color=e.target.value;else p.name=e.target.value||"Untitled";
  projChanged();
});
$("plist").addEventListener("click",e=>{
  const b=e.target.closest("[data-del]");if(!b)return;const pid=b.closest(".prow").dataset.pid;
  const n=state.allocs.filter(a=>a.projectId===pid).length;
  arm(b,n?`Delete + ${n}`:"Delete",()=>{
    state.projects=state.projects.filter(p=>p.id!==pid);state.allocs=state.allocs.filter(a=>a.projectId!==pid);
    renderProjList();commit();
  });
});
$("addProj").onclick=()=>{
  const used=new Set(state.projects.map(p=>p.color.toLowerCase()));
  const color=PALETTE.find(c=>!used.has(c.toLowerCase()))||PALETTE[state.projects.length%PALETTE.length];
  state.projects.push({id:uid(),name:"New project",color});renderProjList();commit();
  const inputs=$("plist").querySelectorAll('input[type=text]');const last=inputs[inputs.length-1];if(last){last.focus();last.select()}
};
$("projForm").onsubmit=e=>{e.preventDefault();clearTimeout(projTimer);$("projDlg").close();persist()};

/* ---------- export / import ---------- */
$("exportBtn").onclick=async()=>{
  if(!ready) return;
  try{const p=await invoke("export_plan",{plan:snapshot()});if(p)setStatus("Exported to "+p)}
  catch(e){setStatus("Export failed: "+errMsg(e),true)}
};
$("importBtn").onclick=()=>{
  if(!ready) return;
  arm($("importBtn"),"Replace current plan?",async()=>{
    try{
      const plan=await invoke("import_plan");
      if(plan){state=normalize(plan);render();setStatus("Imported")}
    }catch(e){setStatus("Import failed: "+errMsg(e),true)}
  });
};

boot();
})();
