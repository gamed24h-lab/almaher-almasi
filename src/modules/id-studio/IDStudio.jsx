import React,{useMemo,useState} from 'react';
import {Badge,Button,Card,PageHeader} from '../../components/UI.jsx';
import {useAuth} from '../../core/AuthContext.jsx';
import {has} from '../../lib/permissions.js';
import './id-studio.css';

const templates=[
  {code:'makkah_luxury',name:'مكة الفاخر',sub:'أبيض + أزرق + ذهبي',kind:'luxury'},
  {code:'executive_side',name:'التنفيذي الجانبي',sub:'شريط كحلي جانبي + QR',kind:'side'},
  {code:'clean_formal',name:'الرسمي النظيف',sub:'رسمي واضح للطباعة اليومية',kind:'formal'},
  {code:'royal_dark',name:'Royal Dark',sub:'كحلي داكن + ذهبي',kind:'dark'},
  {code:'minimal_corporate',name:'Minimal Corporate',sub:'مؤسسي حديث وبسيط',kind:'minimal'},
];

const stats=[['فعالة',0,'active'],['مسودة',0,'draft'],['بانتظار الاعتماد',0,'pending'],['قرب الانتهاء',0,'expiry']];

export default function IDStudio(){
  const {user}=useAuth();
  const [mode,setMode]=useState('full');
  const [template,setTemplate]=useState('makkah_luxury');
  const [source,setSource]=useState('standalone');
  const [autoTranslate,setAutoTranslate]=useState(true);
  const selected=useMemo(()=>templates.find(x=>x.code===template)||templates[0],[template]);
  const canCreate=has(user,'id_card_create');
  const canManageTemplates=has(user,'id_card_manage_templates');

  return <div className="idstudio-page">
    <PageHeader title="ID Studio" subtitle="إصدار وإدارة بطاقات الموظفين والموسميين والمتعاونين — بصلاحيات مستقلة عن إدارة الموظفين"/>

    <div className="idstudio-stats">{stats.map(([label,value,tone])=><Card key={label} className="idstudio-stat"><span>{label}</span><strong>{value}</strong><Badge>{tone}</Badge></Card>)}</div>

    <div className="idstudio-grid">
      <Card className="idstudio-control">
        <div className="idstudio-section-title"><div><h3>إنشاء بطاقة جديدة</h3><small>المرحلة الحالية: واجهة تأسيس آمنة قبل تفعيل الكتابة على قاعدة Test.</small></div></div>

        <label className="idstudio-label">مصدر حامل البطاقة</label>
        <div className="idstudio-segment">
          <button className={source==='standalone'?'active':''} onClick={()=>setSource('standalone')}>بطاقة مستقلة</button>
          <button className={source==='linked'?'active':''} onClick={()=>setSource('linked')}>ربط بموظف موجود</button>
        </div>
        <div className="idstudio-note">{source==='standalone'?'لن يتم إنشاء مستخدم أو موظف في النظام. البطاقة تعيش كسجل مستقل داخل ID Studio.':'سيتم لاحقًا اختيار موظف موجود وسحب بياناته، مع بقاء بيانات البطاقة وصلاحياتها منفصلة.'}</div>

        <label className="idstudio-label">طريقة البطاقة والطباعة</label>
        <div className="idstudio-segment">
          <button className={mode==='full'?'active':''} onClick={()=>setMode('full')}>وجه واحد — Full ID</button>
          <button className={mode==='front_back'?'active':''} onClick={()=>setMode('front_back')}>وجهين — Front & Back</button>
        </div>

        <label className="idstudio-label">الترجمة التلقائية</label>
        <button className={`idstudio-switch ${autoTranslate?'on':''}`} onClick={()=>setAutoTranslate(x=>!x)} aria-pressed={autoTranslate}><span></span><b>{autoTranslate?'مفعلة':'متوقفة'}</b></button>
        <div className="idstudio-note">الاسم = Transliteration، والمسمى والقسم = ترجمة فعلية، مع السماح بالتعديل اليدوي.</div>

        <div className="idstudio-actions"><Button variant="primary" disabled={!canCreate}>بدء إصدار بطاقة</Button><Button>Quick Issue</Button></div>
        {!canCreate&&<div className="idstudio-warning">هذا الحساب لا يملك صلاحية <code>id_card_create</code>. دخول الموديول لا يعني صلاحية الإصدار.</div>}
      </Card>

      <Card className="idstudio-preview-card">
        <div className="idstudio-section-title"><div><h3>المعاينة</h3><small>{selected.name} · {mode==='full'?'وجه واحد كامل':'أمامي وخلفي'}</small></div><Badge>CR80</Badge></div>
        <div className={`idstudio-mock ${selected.kind}`}>
          <div className="mock-head"><span className="mock-logo">الماهر</span><span>ID STUDIO</span></div>
          <div className="mock-photo">صورة</div>
          <div className="mock-name">اسم حامل البطاقة</div>
          <div className="mock-job">المسمى الوظيفي</div>
          <div className="mock-meta"><span>MA-001</span><span>QR</span></div>
        </div>
        <div className="idstudio-safe">85.60 × 53.98 مم · سيتم إضافة معايرة Offset وحواف الأمان قبل تفعيل الطباعة.</div>
      </Card>
    </div>

    <Card>
      <div className="idstudio-section-title"><div><h3>معرض القوالب</h3><small>القوالب مختلفة فعليًا في التكوين، وليست مجرد تغيير ألوان.</small></div>{canManageTemplates&&<Button>إدارة القوالب</Button>}</div>
      <div className="idstudio-templates">{templates.map(t=><button key={t.code} className={`idstudio-template ${template===t.code?'selected':''}`} onClick={()=>setTemplate(t.code)}><div className={`template-thumb ${t.kind}`}><i></i><b></b><em></em></div><strong>{t.name}</strong><span>{t.sub}</span></button>)}</div>
    </Card>
  </div>
}
