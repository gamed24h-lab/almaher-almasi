import React,{useEffect,useMemo,useState} from 'react';
import {Badge,Button,Card,PageHeader} from '../../components/UI.jsx';
import {useAuth} from '../../core/AuthContext.jsx';
import {has} from '../../lib/permissions.js';
import {idStudioApi} from './api.js';
import './id-studio.css';

const FALLBACK_TEMPLATES=[
  {code:'makkah_luxury',name_ar:'مكة الفاخر',name_en:'Makkah Luxury',kind:'luxury'},
  {code:'executive_side',name_ar:'التنفيذي الجانبي',name_en:'Executive Side',kind:'side'},
  {code:'clean_formal',name_ar:'الرسمي النظيف',name_en:'Clean Formal',kind:'formal'},
  {code:'royal_dark',name_ar:'رويال دارك',name_en:'Royal Dark',kind:'dark'},
  {code:'minimal_corporate',name_ar:'المؤسسي البسيط',name_en:'Minimal Corporate',kind:'minimal'},
];
const TEMPLATE_KIND={makkah_luxury:'luxury',executive_side:'side',clean_formal:'formal',royal_dark:'dark',minimal_corporate:'minimal'};
const JOBS={
  'مدير عام':'General Manager','مدير الحجوزات والتسكين':'Reservations & Housing Manager','مدير الحجوزات':'Reservations Manager','مدير التسكين':'Housing Manager','مدير فرع':'Branch Manager','مشرف تشغيل':'Operations Supervisor','مسؤول عمليات العمرة':'Umrah Operations Officer','مدير عمليات العمرة':'Umrah Operations Manager','موظف حجوزات':'Reservations Officer','محاسب':'Accountant','سائق':'Driver','مشرف':'Supervisor','موظف':'Employee'
};
const DEPTS={'الحجوزات':'Reservations','التسكين':'Housing','التشغيل':'Operations','المالية':'Finance','الإدارة':'Administration','خدمة العملاء':'Customer Service','الأسطول':'Fleet'};
const AR_MAP={'ا':'a','أ':'a','إ':'i','آ':'a','ب':'b','ت':'t','ث':'th','ج':'j','ح':'h','خ':'kh','د':'d','ذ':'th','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'a','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','ة':'a','و':'w','ؤ':'o','ي':'y','ى':'a','ئ':'e','ء':''};
function transliterateArabic(value=''){return String(value).split('').map(ch=>AR_MAP[ch]??ch).join('').replace(/\s+/g,' ').trim().split(' ').map(w=>w?`${w[0].toUpperCase()}${w.slice(1)}`:'').join(' ')}
function initialForm(){return {source_type:'standalone',linked_employee_id:'',holder_type:'employee',name_ar:'',name_en:'',job_title_ar:'',job_title_en:'',department_ar:'',department_en:'',phone:'',license_number:'2015',season_label:'1448هـ',issue_date:new Date().toISOString().slice(0,10),expiry_date:'',print_mode:'full',template_code:'makkah_luxury',translation_auto:true}}
function fmtDate(v){if(!v)return '—';try{return new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(`${v}T00:00:00`))}catch{return v}}

export default function IDStudio(){
  const {user}=useAuth();
  const [stats,setStats]=useState({active:0,draft:0,pending_approval:0,expiring_soon:0,total:0});
  const [cards,setCards]=useState([]),[templates,setTemplates]=useState(FALLBACK_TEMPLATES);
  const [form,setForm]=useState(initialForm()),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [q,setQ]=useState(''),[status,setStatus]=useState('');
  const canCreate=has(user,'id_card_create'),canEdit=has(user,'id_card_edit'),canApprove=has(user,'id_card_approve'),canPrint=has(user,'id_card_print');
  const canLink=has(user,'id_card_link_employee'),canManageTemplates=has(user,'id_card_manage_templates');
  const selected=useMemo(()=>templates.find(x=>x.code===form.template_code)||FALLBACK_TEMPLATES[0],[templates,form.template_code]);
  const selectedKind=TEMPLATE_KIND[selected?.code]||'luxury';

  async function load(filters={}){setLoading(true);setError('');try{const [d,c,t]=await Promise.all([idStudioApi.dashboard(),idStudioApi.listCards(filters),idStudioApi.listTemplates()]);setStats(d?.stats||{});setCards(c?.rows||[]);if(t?.rows?.length)setTemplates(t.rows.map(x=>({...x,kind:TEMPLATE_KIND[x.code]||'minimal'})))}catch(e){setError(e.message)}finally{setLoading(false)}}
  useEffect(()=>{load()},[]);
  useEffect(()=>{const timer=setTimeout(()=>load({q,status}),300);return()=>clearTimeout(timer)},[q,status]);

  function setField(key,value){setForm(prev=>{const next={...prev,[key]:value};if(prev.translation_auto){if(key==='name_ar')next.name_en=transliterateArabic(value);if(key==='job_title_ar')next.job_title_en=JOBS[value]||prev.job_title_en;if(key==='department_ar')next.department_en=DEPTS[value]||prev.department_en}return next})}
  async function createCard(e){e.preventDefault();if(!canCreate)return;setBusy(true);setError('');setNotice('');try{const payload={...form,linked_employee_id:form.source_type==='linked_employee'?form.linked_employee_id||null:null,expiry_date:form.expiry_date||null};const out=await idStudioApi.createCard(payload);setNotice(`تم إنشاء البطاقة ${out?.card?.card_number||''} كمسودة بنجاح.`);setForm(initialForm());await load({q,status})}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function action(fn,success){setBusy(true);setError('');try{await fn();setNotice(success);await load({q,status})}catch(e){setError(e.message)}finally{setBusy(false)}}

  return <div className="idstudio-page">
    <PageHeader title="ID Studio" subtitle="إصدار وإدارة بطاقات الشركة — مستقل بصلاحياته عن إدارة الموظفين"/>
    {error&&<div className="idstudio-error">{error}</div>}{notice&&<div className="idstudio-success">{notice}</div>}

    <div className="idstudio-stats">
      <Card className="idstudio-stat"><span>فعالة</span><strong>{stats.active||0}</strong><Badge>Active</Badge></Card>
      <Card className="idstudio-stat"><span>مسودة</span><strong>{stats.draft||0}</strong><Badge>Draft</Badge></Card>
      <Card className="idstudio-stat"><span>بانتظار الاعتماد</span><strong>{stats.pending_approval||0}</strong><Badge>Pending</Badge></Card>
      <Card className="idstudio-stat"><span>قرب الانتهاء</span><strong>{stats.expiring_soon||0}</strong><Badge>30 يوم</Badge></Card>
    </div>

    <div className="idstudio-grid">
      <Card className="idstudio-control">
        <div className="idstudio-section-title"><div><h3>إصدار بطاقة جديدة</h3><small>رقم البطاقة وQR Token يُولدان من الخادم تلقائيًا.</small></div></div>
        <form onSubmit={createCard} className="idstudio-form">
          <label>مصدر حامل البطاقة<select value={form.source_type} onChange={e=>setField('source_type',e.target.value)}><option value="standalone">بطاقة مستقلة — بدون مستخدم بالنظام</option>{canLink&&<option value="linked_employee">ربط بموظف موجود</option>}</select></label>
          {form.source_type==='linked_employee'&&<label>معرّف الموظف الموجود<input value={form.linked_employee_id} onChange={e=>setField('linked_employee_id',e.target.value)} placeholder="Employee ID" required/></label>}
          <div className="idstudio-form-2"><label>نوع حامل البطاقة<select value={form.holder_type} onChange={e=>setField('holder_type',e.target.value)}><option value="employee">موظف داخلي</option><option value="seasonal">موظف موسمي</option><option value="contractor">متعاون</option><option value="driver">سائق</option><option value="supervisor">مشرف</option><option value="visitor">زائر</option><option value="other">أخرى</option></select></label><label>القالب<select value={form.template_code} onChange={e=>setField('template_code',e.target.value)}>{templates.map(t=><option key={t.code} value={t.code}>{t.name_ar}</option>)}</select></label></div>
          <div className="idstudio-form-2"><label>الاسم بالعربية<input value={form.name_ar} onChange={e=>setField('name_ar',e.target.value)} required/></label><label>الاسم بالإنجليزية<input dir="ltr" value={form.name_en} onChange={e=>setField('name_en',e.target.value)}/></label></div>
          <div className="idstudio-form-2"><label>المسمى الوظيفي<input value={form.job_title_ar} onChange={e=>setField('job_title_ar',e.target.value)}/></label><label>Job Title<input dir="ltr" value={form.job_title_en} onChange={e=>setField('job_title_en',e.target.value)}/></label></div>
          <div className="idstudio-form-2"><label>القسم<input value={form.department_ar} onChange={e=>setField('department_ar',e.target.value)}/></label><label>Department<input dir="ltr" value={form.department_en} onChange={e=>setField('department_en',e.target.value)}/></label></div>
          <div className="idstudio-form-3"><label>الجوال<input dir="ltr" value={form.phone} onChange={e=>setField('phone',e.target.value)}/></label><label>الترخيص<input value={form.license_number} onChange={e=>setField('license_number',e.target.value)}/></label><label>الموسم<input value={form.season_label} onChange={e=>setField('season_label',e.target.value)}/></label></div>
          <div className="idstudio-form-3"><label>تاريخ الإصدار<input type="date" value={form.issue_date} onChange={e=>setField('issue_date',e.target.value)}/></label><label>تاريخ الانتهاء<input type="date" value={form.expiry_date} onChange={e=>setField('expiry_date',e.target.value)}/></label><label>الطباعة<select value={form.print_mode} onChange={e=>setField('print_mode',e.target.value)}><option value="full">وجه واحد كامل</option><option value="front_back">أمامي + خلفي</option></select></label></div>
          <label className="idstudio-check"><input type="checkbox" checked={form.translation_auto} onChange={e=>setField('translation_auto',e.target.checked)}/> ترجمة/تحويل تلقائي للإنجليزية</label>
          <div className="idstudio-actions"><Button type="submit" variant="primary" disabled={!canCreate||busy}>{busy?'جاري الحفظ...':'إنشاء كمسودة'}</Button><Button type="button" onClick={()=>setForm(initialForm())}>مسح الحقول</Button></div>
        </form>
      </Card>

      <Card className="idstudio-preview-card">
        <div className="idstudio-section-title"><div><h3>المعاينة المباشرة</h3><small>{selected?.name_ar||'القالب'} · {form.print_mode==='full'?'وجه واحد كامل':'أمامي وخلفي'}</small></div><Badge>CR80</Badge></div>
        <div className={`idstudio-mock ${selectedKind}`}>
          <div className="mock-head"><span className="mock-logo">الماهر الماسي</span><span>EMPLOYEE ID</span></div>
          <div className="mock-photo">الصورة</div>
          <div className="mock-name">{form.name_ar||'اسم حامل البطاقة'}</div>
          <div className="mock-job">{form.job_title_ar||'المسمى الوظيفي'}{form.department_ar?` · ${form.department_ar}`:''}</div>
          <div className="mock-meta"><span>MA-###</span><span>QR</span></div>
        </div>
        <div className="idstudio-safe">85.60 × 53.98 مم · الحواف الآمنة ومعايرة الطابعة ستُستخدم في مرحلة الطباعة النهائية.</div>
        <div className="idstudio-templates">{templates.map(t=><button type="button" key={t.code} className={`idstudio-template ${form.template_code===t.code?'selected':''}`} onClick={()=>setField('template_code',t.code)}><div className={`template-thumb ${TEMPLATE_KIND[t.code]||'minimal'}`}><i></i><b></b><em></em></div><strong>{t.name_ar}</strong><span>{t.name_en||''}</span></button>)}</div>
        {canManageTemplates&&<div className="idstudio-note">لديك صلاحية إدارة القوالب. نشر إصدار قالب جديد سيتم فصله عن البطاقات التاريخية.</div>}
      </Card>
    </div>

    <Card>
      <div className="idstudio-section-title"><div><h3>البطاقات</h3><small>{loading?'جاري التحميل...':`${cards.length} بطاقة ظاهرة ضمن نطاق صلاحيتك`}</small></div><Button onClick={()=>load({q,status})}>تحديث</Button></div>
      <div className="idstudio-filters"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="بحث بالاسم أو رقم البطاقة"/><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">كل الحالات</option><option value="draft">مسودة</option><option value="pending_approval">بانتظار الاعتماد</option><option value="active">فعالة</option><option value="suspended">موقوفة</option><option value="expired">منتهية</option><option value="lost">مفقودة</option><option value="revoked">ملغاة</option><option value="reissued">معاد إصدارها</option></select></div>
      <div className="idstudio-table-wrap"><table className="idstudio-table"><thead><tr><th>رقم البطاقة</th><th>الاسم</th><th>المسمى</th><th>الحالة</th><th>الإصدار</th><th>الانتهاء</th><th>إجراءات</th></tr></thead><tbody>{cards.length?cards.map(card=><tr key={card.id}><td dir="ltr"><b>{card.card_number}</b></td><td>{card.name_ar}<small>{card.name_en}</small></td><td>{card.job_title_ar||'—'}</td><td><span className={`idstudio-status ${card.status}`}>{card.status}</span></td><td>{card.template_code} · v{card.template_version||1}</td><td>{fmtDate(card.expiry_date)}</td><td><div className="idstudio-row-actions">{canEdit&&card.status==='draft'&&<button disabled={busy} onClick={()=>action(()=>idStudioApi.submitForApproval(card.id),'تم إرسال البطاقة للاعتماد.')}>إرسال للاعتماد</button>}{canApprove&&['draft','pending_approval'].includes(card.status)&&<button disabled={busy} onClick={()=>action(()=>idStudioApi.approveCard(card.id),'تم اعتماد البطاقة وتفعيل QR.')}>اعتماد</button>}{canPrint&&card.status==='active'&&<button disabled={busy} onClick={()=>action(()=>idStudioApi.logPrint(card.id,card.print_mode==='front_back'?'both':'full',1),'تم تسجيل أمر الطباعة.')}>طباعة</button>}</div></td></tr>):<tr><td colSpan="7" className="idstudio-empty">لا توجد بطاقات مطابقة.</td></tr>}</tbody></table></div>
    </Card>
  </div>
}
