import React,{useEffect,useMemo,useState} from 'react';
import {Plus,RefreshCw,Pencil,UsersRound,XCircle,CalendarDays,CheckCircle2,AlertTriangle} from 'lucide-react';
import {useAppData} from '../../core/AppDataContext.jsx';
import {api} from '../../lib/api.js';
import {Card,PageHeader,Button,Table,Modal,Field,Input,Select,ErrorBox,Badge} from '../../components/UI.jsx';
import {money,statusLabel} from '../../lib/format.js';
import {useAuth} from '../../core/AuthContext.jsx';
import {has} from '../../lib/permissions.js';

const DEFAULT_CITIES=['مكة المكرمة','المدينة المنورة','تبوك','تيماء','عرعر','سكاكا','دومة الجندل','طبرجل','القريات','طريف','جدة','الرياض'];
const DAY_NAMES=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const addDays=(d,n)=>{if(!d)return'';const x=new Date(d+'T12:00:00');x.setDate(x.getDate()+Number(n||0));return x.toISOString().slice(0,10)};
const dayDiff=(a,b)=>{if(!a||!b)return null;const x=new Date(a+'T12:00:00'),y=new Date(b+'T12:00:00');return Math.round((y-x)/86400000)};
const datesBetween=(s,e,days)=>{const out=[];for(let d=s;d&&d<=e;d=addDays(d,1)){const k=new Date(d+'T12:00:00').getDay();if(!days.length||days.includes(k))out.push(d)}return out};
const blankStop=branch=>({branchId:branch.id,branchName:branch.name||'',city:branch.name||'',outboundTime:'',returnTime:'',order:1});
const weekdayAr=d=>d?DAY_NAMES[new Date(d+'T12:00:00').getDay()]||'':'—';
const dateCode=d=>String(d||'').replaceAll('-','').slice(2);
const friendlyError=e=>{const m=String(e?.message||e||'');if(/Return date cannot be before departure date/i.test(m))return 'تاريخ العودة لا يمكن أن يكون قبل تاريخ الذهاب.';if(/trips_status_check/i.test(m))return 'حالة الرحلة غير متوافقة مع إعدادات النظام.';return m||'تعذر تنفيذ العملية.'};
function branchCode(name=''){const n=String(name);if(n.includes('تبوك'))return'TAB';if(n.includes('تيماء'))return'TYM';if(n.includes('عرعر'))return'ARR';if(n.includes('سكاكا'))return'SAK';if(n.includes('دومة'))return'DOM';if(n.includes('طبرجل'))return'TBJ';if(n.includes('القريات'))return'QUR';if(n.includes('طريف'))return'TUR';if(n.includes('مكة'))return'MAK';if(n.includes('المدينة'))return'MED';if(n.includes('جدة'))return'JED';if(n.includes('الرياض'))return'RUH';return'BRN'}

export default function Trips({go}){
 const {user}=useAuth(),{data,refresh}=useAppData();
 const [open,setOpen]=useState(false),[err,setErr]=useState(''),[showPast,setShowPast]=useState(false),[editing,setEditing]=useState(null);
 const [mainBranch,setMainBranch]=useState(''),[shared,setShared]=useState([]),[stops,setStops]=useState({}),[saving,setSaving]=useState(false);
 const [scheduleMode,setScheduleMode]=useState('single'),[rangeEnd,setRangeEnd]=useState(''),[weekdays,setWeekdays]=useState([]),[notice,setNotice]=useState(null);
 const today=new Date().toISOString().slice(0,10);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(null),4500);return()=>clearTimeout(t)},[notice]);
 const rows=useMemo(()=>data.trips.filter(t=>showPast||!t.departure_date||t.departure_date>=today),[data.trips,showPast,today]);
 const cities=useMemo(()=>[...new Set([...DEFAULT_CITIES,...data.branches.flatMap(b=>[b.city,b.name]).filter(Boolean)])],[data.branches]);
 const relByTrip=useMemo(()=>{const m=new Map();for(const r of data.tripBranches||[]){const a=m.get(String(r.trip_id))||[];a.push(r);m.set(String(r.trip_id),a)}return m},[data.tripBranches]);
 function toast(type,message){setNotice({type,message,id:Date.now()})}
 function makeTripCode(date,branchId){const branch=data.branches.find(b=>String(b.id)===String(branchId));const prefix=`MAH-${branchCode(branch?.name||branch?.city||'')}-${dateCode(date)}-`;const used=data.trips.map(t=>String(t.trip_code||'')).filter(c=>c.startsWith(prefix)).map(c=>Number(c.slice(-3))).filter(Number.isFinite);return `${prefix}${String((used.length?Math.max(...used):0)+1).padStart(3,'0')}`}
 function reset(){setEditing(null);setMainBranch(data.scope?.branch_id||'');setShared([]);setStops({});setErr('');setScheduleMode('single');setRangeEnd('');setWeekdays([])}
 function openNew(){reset();const bid=data.scope?.branch_id||'';if(bid){const b=data.branches.find(x=>String(x.id)===String(bid));setStops({[bid]:blankStop(b||{id:bid,name:''})})}setOpen(true)}
 function openEdit(t){setEditing(t);setMainBranch(t.branch_id||data.scope?.branch_id||'');const rels=relByTrip.get(String(t.id))||[];const ids=rels.filter(r=>String(r.branch_id)!==String(t.branch_id)).map(r=>String(r.branch_id));setShared(ids);const map={};rels.forEach((r,i)=>{const b=data.branches.find(x=>String(x.id)===String(r.branch_id));map[String(r.branch_id)]={branchId:r.branch_id,branchName:b?.name||'',city:r.boarding_point||b?.name||'',outboundTime:r.boarding_time||'',returnTime:r.return_drop_time||'',order:Number(r.stop_order||i+1)}});setStops(map);setOpen(true)}
 function toggleBranch(id,checked){setShared(a=>checked?[...new Set([...a,String(id)])]:a.filter(x=>String(x)!==String(id)));if(checked)setStops(x=>{const b=data.branches.find(y=>String(y.id)===String(id));return {...x,[id]:x[id]||blankStop(b||{id,name:''})}})}
 function updateStop(id,key,value){setStops(x=>({...x,[id]:{...(x[id]||{}),branchId:id,[key]:value}}))}
 async function save(e){
  e.preventDefault();setErr('');setNotice(null);setSaving(true);const f=Object.fromEntries(new FormData(e.currentTarget));
  const returnOffset=dayDiff(f.departure_date,f.return_date);
  if(returnOffset!==null&&returnOffset<0){setSaving(false);setErr('تاريخ العودة لا يمكن أن يكون قبل تاريخ الذهاب.');toast('error','راجع تاريخ الذهاب والعودة ثم حاول الحفظ مرة أخرى.');return}
  const selected=[String(mainBranch),...shared.filter(x=>String(x)!==String(mainBranch))].filter(Boolean);
  const routeStops=selected.map((bid,i)=>{const b=data.branches.find(x=>String(x.id)===String(bid));const s=stops[bid]||{};return {branchId:bid,branchName:b?.name||'',city:s.city||b?.name||'',outboundTime:s.outboundTime||null,returnTime:s.returnTime||null,order:Number(s.order||i+1)}});
  const row={...(editing?.id?{id:editing.id}:{}),trip_code:editing?.trip_code||makeTripCode(f.departure_date,mainBranch),branch_id:mainBranch,from_city:String(f.from_city||'').trim(),to_city:String(f.to_city||'').trim(),departure_date:f.departure_date,departure_time:f.departure_time||null,return_date:f.return_date||null,return_time:f.return_time||null,bus_capacity:Number(f.bus_capacity||49),booking_capacity:Number(f.bus_capacity||49),status:f.status||'active',price_one_way:Number(f.price_one_way||0),price_no_accommodation:Number(f.price_no_accommodation||0),price_shared:Number(f.price_shared||0),price_private_room:Number(f.price_private_room||0),operational_notes:f.operational_notes||editing?.operational_notes||'',_shared_branch_ids:shared.filter(x=>String(x)!==String(mainBranch)),route_stops:routeStops};
  let rowsToSave=[row];
  if(!editing&&scheduleMode==='range'){
   const ds=datesBetween(f.departure_date,rangeEnd||f.departure_date,weekdays);if(!ds.length){setSaving(false);setErr('لا توجد تواريخ مطابقة لاختيار التكرار.');toast('error','لم يتم إنشاء أي رحلة لأن الأيام المحددة لا تطابق الفترة.');return}
   rowsToSave=ds.map(d=>({...row,trip_code:makeTripCode(d,mainBranch),departure_date:d,return_date:returnOffset===null?null:addDays(d,returnOffset)}));
  }
  try{await api.admin({action:'sync_trips',rows:rowsToSave});setOpen(false);setErr('');await refresh();toast('success',editing?'تم تحديث الرحلة بنجاح ✅':rowsToSave.length>1?`تم إنشاء ${rowsToSave.length} رحلات بنجاح ✅`:'تم إنشاء الرحلة بنجاح ✅')}catch(e2){const m=friendlyError(e2);setErr(m);toast('error',m)}finally{setSaving(false)}
 }
 async function cancelTrip(r,e){e.stopPropagation();const reason=prompt('سبب إلغاء الرحلة:','');if(reason===null)return;try{await api.admin({action:'sync_trips',rows:[{...r,status:'cancelled',operational_notes:`${r.operational_notes||''}\n[إلغاء] ${reason||'بدون سبب'}`}]});await refresh();setErr('');toast('success',`تم إلغاء الرحلة ${r.trip_code||''} بنجاح`)}catch(x){const m=friendlyError(x);setErr(m);toast('error',m)}}
 const tripColumns=[
  {key:'trip_code',label:'الرحلة'},
  {key:'route',label:'المسار',render:r=><strong>{r.from_city||r.origin||'—'} ← {r.to_city||r.destination||'—'}</strong>},
  {key:'departure_date',label:'اليوم / التاريخ',render:r=><div><strong>{weekdayAr(r.departure_date)}</strong><div>{r.departure_date||'—'}</div><div className="muted-small">{r.departure_time||''}</div></div>},
  {key:'shared',label:'الفروع',render:r=>{const count=(relByTrip.get(String(r.id))||[]).length||1;return <Badge tone={count>1?'orange':'blue'}><UsersRound size={12}/> {count}</Badge>}},
  {key:'capacity',label:'السعة',render:r=>r.booking_capacity||r.default_bus_capacity||r.bus_capacity||'—'},
  {key:'price',label:'ذهاب',render:r=>money(r.price_one_way||0)},
  {key:'status',label:'الحالة',render:r=><Badge tone={String(r.status).toLowerCase()==='cancelled'?'red':'green'}>{statusLabel(r.status)}</Badge>},
  {key:'edit',label:'',render:r=>has(user,'trips')?<div className="row-actions"><Button onClick={e=>{e.stopPropagation();openEdit(r)}}><Pencil size={14}/> تعديل</Button>{String(r.status).toLowerCase()!=='cancelled'&&<Button onClick={e=>cancelTrip(r,e)}><XCircle size={14}/> إلغاء</Button>}</div>:null}
 ];
 return <>
  {notice&&<div role="status" style={{position:'fixed',top:18,left:'50%',transform:'translateX(-50%)',zIndex:99999,minWidth:320,maxWidth:'min(92vw,680px)',padding:'14px 18px',borderRadius:14,boxShadow:'0 12px 34px rgba(0,0,0,.18)',display:'flex',alignItems:'center',gap:10,direction:'rtl',fontWeight:700,background:notice.type==='success'?'#ecfdf3':'#fff1f2',color:notice.type==='success'?'#166534':'#b42318',border:`1px solid ${notice.type==='success'?'#bbf7d0':'#fecdd3'}`}}>{notice.type==='success'?<CheckCircle2 size={21}/>:<AlertTriangle size={21}/>}<span>{notice.message}</span><button type="button" onClick={()=>setNotice(null)} style={{marginInlineStart:'auto',border:0,background:'transparent',fontSize:20,cursor:'pointer'}}>×</button></div>}
  <PageHeader title="الرحلات" subtitle="الذهاب والعودة والتسعير والرحلات المشتركة بين الفروع" actions={<><label className="toggle"><input type="checkbox" checked={showPast} onChange={e=>setShowPast(e.target.checked)}/>إظهار القديمة</label><Button onClick={()=>refresh()}><RefreshCw size={16}/> تحديث</Button>{has(user,'trips')&&<Button variant="primary" onClick={openNew}><Plus size={16}/> إنشاء رحلة</Button>}</>}/>
  <ErrorBox error={err}/><Card><Table rows={rows} onRow={r=>go('/trips/'+r.id)} columns={tripColumns}/></Card>
  <Modal open={open} onClose={()=>!saving&&setOpen(false)} title={editing?`تعديل الرحلة ${editing.trip_code}`:'إنشاء رحلة جديدة'} wide>
   <form className="form-grid" onSubmit={save} key={editing?.id||'new'}>
    <div className="field"><span>كود الرحلة</span><div className="price-suggestion"><strong>{editing?.trip_code||'يُنشأ تلقائيًا عند الحفظ'}</strong></div></div>
    <Field label="الفرع الرئيسي"><Select value={mainBranch} onChange={e=>{const bid=e.target.value;setMainBranch(bid);setShared(a=>a.filter(x=>String(x)!==String(bid)));if(bid)setStops(x=>{const b=data.branches.find(y=>String(y.id)===String(bid));return {...x,[bid]:x[bid]||blankStop(b||{id:bid,name:''})}})}} required><option value="">اختر</option>{data.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
    <Field label="من"><Select name="from_city" required defaultValue={editing?.from_city||editing?.origin||''}><option value="">اختر وجهة الانطلاق</option>{cities.map(c=><option key={`from-${c}`} value={c}>{c}</option>)}</Select></Field>
    <Field label="إلى"><Select name="to_city" required defaultValue={editing?.to_city||editing?.destination||''}><option value="">اختر وجهة الوصول</option>{cities.map(c=><option key={`to-${c}`} value={c}>{c}</option>)}</Select></Field>
    {!editing&&<Field label="إنشاء الرحلات"><Select value={scheduleMode} onChange={e=>setScheduleMode(e.target.value)}><option value="single">رحلة واحدة</option><option value="range">فترة / أسبوع / شهر / أيام محددة</option></Select></Field>}
    <Field label="تاريخ الذهاب"><Input type="date" name="departure_date" required defaultValue={editing?.departure_date||today}/></Field>
    {!editing&&scheduleMode==='range'&&<><Field label="حتى تاريخ"><Input type="date" min={today} value={rangeEnd} onChange={e=>setRangeEnd(e.target.value)} required/></Field><div className="schedule-days"><strong><CalendarDays size={16}/> الأيام المحددة</strong>{[['أحد',0],['اثنين',1],['ثلاثاء',2],['أربعاء',3],['خميس',4],['جمعة',5],['سبت',6]].map(([l,d])=><label key={d}><input type="checkbox" checked={weekdays.includes(d)} onChange={()=>setWeekdays(a=>a.includes(d)?a.filter(x=>x!==d):[...a,d])}/>{l}</label>)}<small>حدّد أول ذهاب وعودة فقط؛ النظام يحافظ تلقائيًا على نفس عدد الأيام بينهما في كل الرحلات داخل الفترة.</small></div></>}
    <Field label="وقت الذهاب"><Input type="time" name="departure_time" required defaultValue={editing?.departure_time||''}/></Field>
    <Field label="تاريخ العودة"><Input type="date" name="return_date" defaultValue={editing?.return_date||''}/></Field>
    <Field label="وقت العودة"><Input type="time" name="return_time" defaultValue={editing?.return_time||''}/></Field>
    <Field label="سعة الحجز"><Input type="number" min="1" name="bus_capacity" defaultValue={editing?.booking_capacity||editing?.bus_capacity||49}/></Field>
    <Field label="الحالة"><Select name="status" defaultValue={editing?.status||'active'}><option value="active">نشطة</option><option value="scheduled">مجدولة</option><option value="completed">مكتملة</option><option value="cancelled">ملغاة</option></Select></Field>
    <Field label="سعر ذهاب فقط"><Input type="number" min="0" step="0.01" name="price_one_way" defaultValue={editing?.price_one_way||0}/></Field>
    <Field label="ذهاب وعودة بدون سكن"><Input type="number" min="0" step="0.01" name="price_no_accommodation" defaultValue={editing?.price_no_accommodation||0}/></Field>
    <Field label="ذهاب وعودة + سكن مشترك"><Input type="number" min="0" step="0.01" name="price_shared" defaultValue={editing?.price_shared||0}/></Field>
    <Field label="سعر الغرفة الخاصة / يوم"><Input type="number" min="0" step="0.01" name="price_private_room" defaultValue={editing?.price_private_room||0}/></Field>
    <Field label="ملاحظات تشغيلية"><Input name="operational_notes" defaultValue={editing?.operational_notes||''}/></Field>
    <div className="shared-branches-box"><div className="card-title"><div><h3>الفروع المشاركة</h3><small>تظهر الرحلة لهذه الفروع تشغيليًا، وتظل المالية معزولة.</small></div><Badge>{shared.length+1} فرع</Badge></div>
     {mainBranch&&(()=>{const b=data.branches.find(x=>String(x.id)===String(mainBranch));const st=stops[mainBranch]||blankStop(b||{id:mainBranch,name:''});return <div className="shared-stop-list"><div className="shared-stop main-stop"><strong>{b?.name||'الفرع الرئيسي'} · رئيسي</strong><Input value={st.city||''} onChange={e=>updateStop(mainBranch,'city',e.target.value)} placeholder="نقطة الصعود الرئيسية"/><Input type="time" value={st.outboundTime||''} onChange={e=>updateStop(mainBranch,'outboundTime',e.target.value)}/><Input type="time" value={st.returnTime||''} onChange={e=>updateStop(mainBranch,'returnTime',e.target.value)}/><Input type="number" min="1" value={st.order||1} onChange={e=>updateStop(mainBranch,'order',Number(e.target.value))}/></div></div>})()}
     <div className="branch-picker">{data.branches.filter(b=>String(b.id)!==String(mainBranch)).map(b=><label className="permission-check" key={b.id}><input type="checkbox" checked={shared.includes(String(b.id))} onChange={e=>toggleBranch(String(b.id),e.target.checked)}/><span>{b.name}</span></label>)}</div>
     {shared.length>0&&<div className="shared-stop-list">{shared.map((id,i)=>{const b=data.branches.find(x=>String(x.id)===String(id));const s=stops[id]||blankStop(b||{id,name:''});return <div className="shared-stop" key={id}><strong>{b?.name||id}</strong><Input value={s.city||''} onChange={e=>updateStop(id,'city',e.target.value)} placeholder="نقطة الصعود"/><Input type="time" value={s.outboundTime||''} onChange={e=>updateStop(id,'outboundTime',e.target.value)}/><Input type="time" value={s.returnTime||''} onChange={e=>updateStop(id,'returnTime',e.target.value)}/><Input type="number" min="1" value={s.order||i+2} onChange={e=>updateStop(id,'order',Number(e.target.value))}/></div>})}</div>}
    </div>
    <div className="modal-actions"><Button type="button" onClick={()=>setOpen(false)} disabled={saving}>إلغاء</Button><Button variant="primary" type="submit" disabled={saving}>{saving?'جاري حفظ الرحلة...':'حفظ الرحلة'}</Button></div>
   </form>
  </Modal>
 </>;
}
