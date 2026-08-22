import {useEffect,useRef} from 'react';
import {useLanguage} from './LanguageContext.jsx';

// Transitional full-interface translation bridge.
// It translates legacy hard-coded UI strings while modules are progressively
// moved to useLanguage(). User/customer data is not translated: only phrases
// listed here are eligible.
const P=[
 ['الرئيسية','Home','Ana Sayfa','मुख्य','Home','Accueil','مرکزی صفحہ'],
 ['الرحلات','Trips','Seferler','यात्राएँ','Viaggi','Voyages','سفر'],
 ['الحجوزات','Bookings','Rezervasyonlar','बुकिंग','Prenotazioni','Réservations','بکنگز'],
 ['المسافرون','Passengers','Yolcular','यात्री','Passeggeri','Passagers','مسافر'],
 ['الركاب','Passengers','Yolcular','यात्री','Passeggeri','Passagers','مسافر'],
 ['التسكين','Housing','Konaklama','आवास','Alloggi','Hébergement','رہائش'],
 ['المقاعد','Seats','Koltuklar','सीटें','Posti','Sièges','نشستیں'],
 ['الأسطول والسائقون','Fleet & Drivers','Filo ve Sürücüler','बेड़ा और ड्राइवर','Flotta e Autisti','Flotte et Chauffeurs','فلیٹ اور ڈرائیور'],
 ['المالية','Finance','Finans','वित्त','Finanza','Finance','مالیات'],
 ['الاسترداد','Refunds','İadeler','रिफंड','Rimborsi','Remboursements','رقم واپسی'],
 ['التشغيل','Operations','Operasyon','संचालन','Operazioni','Opérations','آپریشنز'],
 ['المستندات','Documents','Belgeler','दस्तावेज़','Documenti','Documents','دستاویزات'],
 ['الإشعارات','Notifications','Bildirimler','सूचनाएँ','Notifiche','Notifications','اطلاعات'],
 ['الفروع','Branches','Şubeler','शाखाएँ','Filiali','Agences','شاخیں'],
 ['الموظفون','Staff','Personel','कर्मचारी','Personale','Employés','ملازمین'],
 ['التقارير','Reports','Raporlar','रिपोर्ट','Report','Rapports','رپورٹس'],
 ['المطور والنظام','Developer & System','Geliştirici ve Sistem','डेवलपर और सिस्टम','Sviluppatore e Sistema','Développeur et Système','ڈیولپر اور سسٹم'],
 ['المهام والموافقات','Tasks & Approvals','Görevler ve Onaylar','कार्य और अनुमोदन','Attività e Approvazioni','Tâches et Approbations','کام اور منظوری'],
 ['الموردون والوكلاء','Suppliers & Agents','Tedarikçiler ve Acenteler','आपूर्तिकर्ता और एजेंट','Fornitori e Agenti','Fournisseurs et Agents','سپلائرز اور ایجنٹس'],
 ['بوابة العميل','Customer Portal','Müşteri Portalı','ग्राहक पोर्टल','Portale Cliente','Portail Client','کسٹمر پورٹل'],
 ['تسجيل الخروج','Sign out','Çıkış','लॉग आउट','Esci','Déconnexion','سائن آؤٹ'],
 ['تحديث','Refresh','Yenile','रीफ़्रेश','Aggiorna','Actualiser','تازہ کریں'],
 ['حفظ','Save','Kaydet','सहेजें','Salva','Enregistrer','محفوظ کریں'],
 ['إلغاء','Cancel','İptal','रद्द करें','Annulla','Annuler','منسوخ کریں'],
 ['حذف','Delete','Sil','हटाएँ','Elimina','Supprimer','حذف کریں'],
 ['إضافة','Add','Ekle','जोड़ें','Aggiungi','Ajouter','شامل کریں'],
 ['تعديل','Edit','Düzenle','संपादित करें','Modifica','Modifier','ترمیم'],
 ['عرض','View','Görüntüle','देखें','Visualizza','Afficher','دیکھیں'],
 ['بحث','Search','Ara','खोज','Cerca','Rechercher','تلاش'],
 ['طباعة','Print','Yazdır','प्रिंट','Stampa','Imprimer','پرنٹ'],
 ['طباعة التقرير','Print report','Raporu yazdır','रिपोर्ट प्रिंट करें','Stampa report','Imprimer le rapport','رپورٹ پرنٹ کریں'],
 ['طباعة الكشف','Print manifest','Listeyi yazdır','सूची प्रिंट करें','Stampa elenco','Imprimer la liste','فہرست پرنٹ کریں'],
 ['حفظ PDF','Save PDF','PDF kaydet','PDF सहेजें','Salva PDF','Enregistrer PDF','PDF محفوظ کریں'],
 ['تصدير CSV','Export CSV','CSV dışa aktar','CSV निर्यात','Esporta CSV','Exporter CSV','CSV ایکسپورٹ'],
 ['تنزيل','Download','İndir','डाउनलोड','Scarica','Télécharger','ڈاؤن لوڈ'],
 ['رفع','Upload','Yükle','अपलोड','Carica','Téléverser','اپ لوڈ'],
 ['التالي','Next','İleri','अगला','Avanti','Suivant','اگلا'],
 ['السابق','Previous','Geri','पिछला','Precedente','Précédent','پچھلا'],
 ['رجوع','Back','Geri','वापस','Indietro','Retour','واپس'],
 ['العودة للرئيسية','Back to home','Ana sayfaya dön','मुख्य पर वापस','Torna alla home','Retour à l’accueil','مرکزی صفحے پر واپس'],
 ['غير مصرح','Access denied','Yetkisiz','अनधिकृत','Non autorizzato','Non autorisé','رسائی نہیں'],
 ['الصفحة غير موجودة','Page not found','Sayfa bulunamadı','पृष्ठ नहीं मिला','Pagina non trovata','Page introuvable','صفحہ نہیں ملا'],
 ['لا توجد بيانات','No data','Veri yok','कोई डेटा नहीं','Nessun dato','Aucune donnée','کوئی ڈیٹا نہیں'],
 ['لم يتم العثور على سجلات لعرضها.','No records were found.','Gösterilecek kayıt bulunamadı.','कोई रिकॉर्ड नहीं मिला।','Nessun record trovato.','Aucun enregistrement trouvé.','کوئی ریکارڈ نہیں ملا۔'],
 ['جاري التحميل...','Loading...','Yükleniyor...','लोड हो रहा है...','Caricamento...','Chargement...','لوڈ ہو رہا ہے...'],
 ['جاري الحفظ...','Saving...','Kaydediliyor...','सहेजा जा रहा है...','Salvataggio...','Enregistrement...','محفوظ ہو رہا ہے...'],
 ['جاري التنفيذ...','Processing...','İşleniyor...','प्रक्रिया जारी...','Elaborazione...','Traitement...','عمل جاری ہے...'],
 ['جاري التجهيز...','Preparing...','Hazırlanıyor...','तैयार हो रहा है...','Preparazione...','Préparation...','تیاری جاری ہے...'],
 ['جاري الإنشاء...','Creating...','Oluşturuluyor...','बनाया जा रहा है...','Creazione...','Création...','بنایا جا رہا ہے...'],
 ['اختر','Select','Seç','चुनें','Seleziona','Sélectionner','منتخب کریں'],
 ['اختر رحلة','Select trip','Sefer seç','यात्रा चुनें','Seleziona viaggio','Sélectionner le voyage','سفر منتخب کریں'],
 ['اختر الفندق','Select hotel','Otel seç','होटल चुनें','Seleziona hotel','Sélectionner l’hôtel','ہوٹل منتخب کریں'],
 ['كل الفروع','All branches','Tüm şubeler','सभी शाखाएँ','Tutte le filiali','Toutes les agences','تمام شاخیں'],
 ['فرعك فقط','Your branch only','Yalnız şubeniz','केवल आपकी शाखा','Solo la tua filiale','Votre agence uniquement','صرف آپ کی شاخ'],
 ['كل فروع التشغيل','All operating branches','Tüm operasyon şubeleri','सभी संचालन शाखाएँ','Tutte le filiali operative','Toutes les agences opérationnelles','تمام آپریشن شاخیں'],
 ['الفرع','Branch','Şube','शाखा','Filiale','Agence','شاخ'],
 ['الرحلة','Trip','Sefer','यात्रा','Viaggio','Voyage','سفر'],
 ['الحجز','Booking','Rezervasyon','बुकिंग','Prenotazione','Réservation','بکنگ'],
 ['المسافر','Passenger','Yolcu','यात्री','Passeggero','Passager','مسافر'],
 ['الراكب','Passenger','Yolcu','यात्री','Passeggero','Passager','مسافر'],
 ['الاسم','Name','Ad','नाम','Nome','Nom','نام'],
 ['الهوية','ID','Kimlik','पहचान','Documento','Identité','شناخت'],
 ['الجنسية','Nationality','Uyruk','राष्ट्रीयता','Nazionalità','Nationalité','قومیت'],
 ['الجوال','Mobile','Cep telefonu','मोबाइल','Cellulare','Mobile','موبائل'],
 ['التاريخ','Date','Tarih','तारीख','Data','Date','تاریخ'],
 ['الوقت','Time','Saat','समय','Ora','Heure','وقت'],
 ['الحالة','Status','Durum','स्थिति','Stato','Statut','حالت'],
 ['النوع','Type','Tür','प्रकार','Tipo','Type','قسم'],
 ['المبلغ','Amount','Tutar','राशि','Importo','Montant','رقم'],
 ['المدفوع','Paid','Ödenen','भुगतान','Pagato','Payé','ادا شدہ'],
 ['المتبقي','Outstanding','Kalan','बकाया','Residuo','Restant','باقی'],
 ['الإجمالي','Total','Toplam','कुल','Totale','Total','کل'],
 ['الصافي','Net','Net','शुद्ध','Netto','Net','خالص'],
 ['المصروفات','Expenses','Giderler','खर्च','Spese','Dépenses','اخراجات'],
 ['الحركات المالية','Transactions','Mali hareketler','वित्तीय लेनदेन','Movimenti finanziari','Transactions financières','مالی لین دین'],
 ['الخزن','Cash registers','Kasalar','कैश रजिस्टर','Casse','Caisses','کیش رجسٹر'],
 ['الخزنة','Cash register','Kasa','कैश रजिस्टर','Cassa','Caisse','کیش رجسٹر'],
 ['الورديات','Shifts','Vardiyalar','शिफ्ट','Turni','Équipes','شفٹس'],
 ['فتح وردية','Open shift','Vardiya aç','शिफ्ट खोलें','Apri turno','Ouvrir l’équipe','شفٹ کھولیں'],
 ['إغلاق الوردية','Close shift','Vardiyayı kapat','शिफ्ट बंद करें','Chiudi turno','Fermer l’équipe','شفٹ بند کریں'],
 ['رصيد الافتتاح','Opening balance','Açılış bakiyesi','प्रारंभिक शेष','Saldo iniziale','Solde d’ouverture','ابتدائی بیلنس'],
 ['الرصيد الفعلي','Actual balance','Gerçek bakiye','वास्तविक शेष','Saldo effettivo','Solde réel','اصل بیلنس'],
 ['الفرق','Variance','Fark','अंतर','Differenza','Écart','فرق'],
 ['مستحقات الموردين','Supplier payables','Tedarikçi borçları','आपूर्तिकर्ता देय','Debiti fornitori','Dettes fournisseurs','سپلائر واجبات'],
 ['المورد','Supplier','Tedarikçi','आपूर्तिकर्ता','Fornitore','Fournisseur','سپلائر'],
 ['الاستحقاق','Due date','Vade','देय तिथि','Scadenza','Échéance','واجب الادا تاریخ'],
 ['النطاق المالي الحالي','Current financial scope','Mevcut mali kapsam','वर्तमान वित्तीय दायरा','Ambito finanziario attuale','Périmètre financier actuel','موجودہ مالی دائرہ'],
 ['إجمالي الحجوزات','Total bookings','Toplam rezervasyon','कुल बुकिंग','Totale prenotazioni','Total des réservations','کل بکنگز'],
 ['المحصل','Collected','Tahsil edilen','संग्रहित','Incassato','Encaissé','وصول شدہ'],
 ['صافي المحصل','Net collected','Net tahsilat','शुद्ध संग्रह','Netto incassato','Net encaissé','خالص وصولی'],
 ['مصروف','Expense','Gider','खर्च','Spesa','Dépense','خرچ'],
 ['البند','Category','Kategori','श्रेणी','Categoria','Catégorie','زمرہ'],
 ['ملاحظات','Notes','Notlar','टिप्पणियाँ','Note','Notes','نوٹس'],
 ['المرجع','Reference','Referans','संदर्भ','Riferimento','Référence','حوالہ'],
 ['المستندات','Documents','Belgeler','दस्तावेज़','Documenti','Documents','دستاویزات'],
 ['نقطة الصعود','Boarding point','Biniş noktası','बोर्डिंग पॉइंट','Punto di salita','Point d’embarquement','سوار ہونے کا مقام'],
 ['السكن','Housing','Konaklama','आवास','Alloggio','Hébergement','رہائش'],
 ['بدون سكن','No housing','Konaklama yok','बिना आवास','Senza alloggio','Sans hébergement','بغیر رہائش'],
 ['مشترك','Shared','Paylaşımlı','साझा','Condiviso','Partagé','مشترکہ'],
 ['خاص','Private','Özel','निजी','Privato','Privé','نجی'],
 ['غرفة','Room','Oda','कमरा','Camera','Chambre','کمرہ'],
 ['غرفة خاصة','Private room','Özel oda','निजी कमरा','Camera privata','Chambre privée','نجی کمرہ'],
 ['مشترك خماسي','Shared 5-bed','5 kişilik paylaşımlı','5-बेड साझा','Condivisa 5 posti','Partagée 5 places','5 بستروں والا مشترکہ'],
 ['خاصة مزدوجة','Private double','Özel çift kişilik','निजी डबल','Privata doppia','Privée double','نجی ڈبل'],
 ['الفندق','Hotel','Otel','होटल','Hotel','Hôtel','ہوٹل'],
 ['إضافة فندق','Add hotel','Otel ekle','होटल जोड़ें','Aggiungi hotel','Ajouter un hôtel','ہوٹل شامل کریں'],
 ['ربط فندق','Link hotel','Otel bağla','होटल लिंक करें','Collega hotel','Lier un hôtel','ہوٹل لنک کریں'],
 ['إضافة مسافر','Add passenger','Yolcu ekle','यात्री जोड़ें','Aggiungi passeggero','Ajouter un passager','مسافر شامل کریں'],
 ['إخراج','Remove','Çıkar','हटाएँ','Rimuovi','Retirer','نکالیں'],
 ['قفل التسكين','Lock housing','Konaklamayı kilitle','आवास लॉक करें','Blocca alloggi','Verrouiller hébergement','رہائش لاک کریں'],
 ['فتح التسكين','Unlock housing','Konaklamayı aç','आवास अनलॉक करें','Sblocca alloggi','Déverrouiller hébergement','رہائش ان لاک کریں'],
 ['توزيع المشترك تلقائيًا','Auto-allocate shared housing','Paylaşımlıyı otomatik dağıt','साझा आवास स्वतः बाँटें','Assegna condivisi automaticamente','Répartir automatiquement le partagé','مشترکہ رہائش خودکار تقسیم'],
 ['كشف السكن','Housing manifest','Konaklama listesi','आवास सूची','Elenco alloggi','Liste hébergement','رہائش فہرست'],
 ['كشف الركاب','Passenger manifest','Yolcu listesi','यात्री सूची','Elenco passeggeri','Liste passagers','مسافر فہرست'],
 ['كشف تشغيل الرحلة','Trip operations manifest','Sefer operasyon listesi','यात्रा संचालन सूची','Elenco operativo viaggio','Liste opérationnelle du voyage','سفر آپریشن فہرست'],
 ['مركز التشغيل','Operations center','Operasyon merkezi','संचालन केंद्र','Centro operativo','Centre des opérations','آپریشن مرکز'],
 ['فتح مركز التشغيل','Open operations center','Operasyon merkezini aç','संचालन केंद्र खोलें','Apri centro operativo','Ouvrir le centre des opérations','آپریشن مرکز کھولیں'],
 ['مركز الرحلة','Trip center','Sefer merkezi','यात्रा केंद्र','Centro viaggio','Centre du voyage','سفر مرکز'],
 ['رجال','Men','Erkek','पुरुष','Uomini','Hommes','مرد'],
 ['نساء','Women','Kadın','महिलाएँ','Donne','Femmes','خواتین'],
 ['ذكر','Male','Erkek','पुरुष','Maschio','Homme','مرد'],
 ['أنثى','Female','Kadın','महिला','Femmina','Femme','خاتون'],
 ['محجوب','Hidden','Gizli','छिपा हुआ','Nascosto','Masqué','مخفی'],
 ['كاملة','Full','Tam','पूर्ण','Completa','Complète','مکمل'],
 ['كل أنواع السكن','All housing types','Tüm konaklama türleri','सभी आवास प्रकार','Tutti i tipi di alloggio','Tous les types d’hébergement','تمام رہائش اقسام'],
 ['استرداد حجز','Booking refund','Rezervasyon iadesi','बुकिंग रिफंड','Rimborso prenotazione','Remboursement réservation','بکنگ رقم واپسی'],
 ['طلبات الاسترداد','Refund requests','İade talepleri','रिफंड अनुरोध','Richieste rimborso','Demandes de remboursement','رقم واپسی درخواستیں'],
 ['حساب المتاح','Calculate available','Uygun tutarı hesapla','उपलब्ध राशि गणना','Calcola disponibile','Calculer le disponible','دستیاب رقم حساب کریں'],
 ['سبق استرداده','Already refunded','Daha önce iade','पहले रिफंड','Già rimborsato','Déjà remboursé','پہلے واپس'],
 ['المتاح','Available','Mevcut','उपलब्ध','Disponibile','Disponible','دستیاب'],
 ['طريقة الاسترداد','Refund method','İade yöntemi','रिफंड विधि','Metodo rimborso','Mode de remboursement','رقم واپسی طریقہ'],
 ['نقدي','Cash','Nakit','नकद','Contanti','Espèces','نقد'],
 ['تحويل بنكي','Bank transfer','Banka havalesi','बैंक ट्रांसफर','Bonifico bancario','Virement bancaire','بینک ٹرانسفر'],
 ['نفس وسيلة الدفع','Same payment method','Aynı ödeme yöntemi','उसी भुगतान विधि','Stesso metodo di pagamento','Même moyen de paiement','وہی ادائیگی طریقہ'],
 ['أخرى','Other','Diğer','अन्य','Altro','Autre','دیگر'],
 ['اسم المستلم','Recipient name','Alıcı adı','प्राप्तकर्ता नाम','Nome destinatario','Nom du bénéficiaire','وصول کنندہ نام'],
 ['السبب','Reason','Neden','कारण','Motivo','Motif','وجہ'],
 ['إلغاء الحجز بعد الاسترداد','Cancel booking after refund','İade sonrası rezervasyonu iptal et','रिफंड के बाद बुकिंग रद्द करें','Annulla prenotazione dopo rimborso','Annuler la réservation après remboursement','رقم واپسی کے بعد بکنگ منسوخ'],
 ['إنشاء طلب الاسترداد','Create refund request','İade talebi oluştur','रिफंड अनुरोध बनाएँ','Crea richiesta rimborso','Créer une demande de remboursement','رقم واپسی درخواست بنائیں'],
 ['السند','Receipt','Makbuz','रसीद','Ricevuta','Reçu','رسید'],
 ['الإجراء','Action','İşlem','कार्रवाई','Azione','Action','کارروائی'],
 ['اعتماد','Approve','Onayla','स्वीकृत करें','Approva','Approuver','منظور'],
 ['رفض','Reject','Reddet','अस्वीकार','Rifiuta','Rejeter','مسترد'],
 ['تنفيذ','Execute','Uygula','निष्पादित करें','Esegui','Exécuter','عمل کریں'],
 ['التقارير والتصدير','Reports & Export','Raporlar ve Dışa Aktarım','रिपोर्ट और निर्यात','Report ed Esportazione','Rapports et Export','رپورٹس اور ایکسپورٹ'],
 ['تقرير جديد','New report','Yeni rapor','नई रिपोर्ट','Nuovo report','Nouveau rapport','نئی رپورٹ'],
 ['اتجاه الطباعة','Print orientation','Yazdırma yönü','प्रिंट अभिविन्यास','Orientamento stampa','Orientation impression','پرنٹ سمت'],
 ['A4 عمودي','A4 Portrait','A4 Dikey','A4 पोर्ट्रेट','A4 verticale','A4 Portrait','A4 عمودی'],
 ['A4 أفقي','A4 Landscape','A4 Yatay','A4 लैंडस्केप','A4 orizzontale','A4 Paysage','A4 افقی'],
 ['إنشاء طلب تصدير','Create export request','Dışa aktarma talebi oluştur','निर्यात अनुरोध बनाएँ','Crea richiesta esportazione','Créer une demande d’export','ایکسپورٹ درخواست بنائیں'],
 ['طلبات التصدير','Export requests','Dışa aktarma talepleri','निर्यात अनुरोध','Richieste esportazione','Demandes d’export','ایکسپورٹ درخواستیں'],
 ['الطلب','Requested','Talep','अनुरोध','Richiesta','Demande','درخواست'],
 ['الاكتمال','Completed','Tamamlanma','पूर्ण','Completamento','Achèvement','تکمیل'],
 ['تجهيز الملف','Prepare file','Dosyayı hazırla','फ़ाइल तैयार करें','Prepara file','Préparer le fichier','فائل تیار کریں'],
 ['اسم المستخدم / الجوال / البريد','Username / mobile / email','Kullanıcı adı / cep / e-posta','यूज़रनेम / मोबाइल / ईमेल','Utente / cellulare / email','Utilisateur / mobile / e-mail','صارف نام / موبائل / ای میل'],
 ['كلمة المرور','Password','Şifre','पासवर्ड','Password','Mot de passe','پاس ورڈ'],
 ['دخول النظام','Sign in','Giriş','साइन इन','Accedi','Connexion','سائن ان'],
 ['وضع التدريب','Training mode','Eğitim modu','प्रशिक्षण मोड','Modalità formazione','Mode formation','ٹریننگ موڈ'],
 ['تشغيل فعلي','Production','Canlı kullanım','लाइव','Produzione','Production','پروڈکشن'],
 ['بيئة التدريب','Training environment','Eğitim ortamı','प्रशिक्षण वातावरण','Ambiente formazione','Environnement de formation','ٹریننگ ماحول'],
 ['الإصدار','Version','Sürüm','संस्करण','Versione','Version','ورژن'],
 ['مطور النظام','System Developer','Sistem Geliştiricisi','सिस्टम डेवलपर','Sviluppatore di sistema','Développeur système','سسٹم ڈیولپر'],
 ['تطوير وإدارة النظام','System development & administration','Sistem geliştirme ve yönetimi','सिस्टम विकास और प्रशासन','Sviluppo e amministrazione sistema','Développement et administration du système','سسٹم ڈیولپمنٹ اور انتظام'],
 ['مركز النسخ الاحتياطي والبيانات','Backup & Data Center','Yedekleme ve Veri Merkezi','बैकअप और डेटा केंद्र','Centro backup e dati','Centre sauvegarde et données','بیک اپ اور ڈیٹا مرکز'],
 ['تنزيل نسخة على الجهاز','Download backup to device','Cihaza yedek indir','डिवाइस पर बैकअप डाउनलोड','Scarica backup sul dispositivo','Télécharger la sauvegarde','ڈیوائس پر بیک اپ ڈاؤن لوڈ'],
 ['اختيار نسخة للاستعادة','Choose backup to restore','Geri yüklenecek yedeği seç','पुनर्स्थापना बैकअप चुनें','Scegli backup da ripristinare','Choisir la sauvegarde à restaurer','بحالی بیک اپ منتخب کریں'],
 ['استعادة البيانات الأساسية','Restore core data','Temel verileri geri yükle','मुख्य डेटा पुनर्स्थापित करें','Ripristina dati principali','Restaurer les données principales','بنیادی ڈیٹا بحال'],
 ['تحديث العدادات','Refresh counters','Sayaçları yenile','काउंटर रीफ़्रेश','Aggiorna contatori','Actualiser les compteurs','کاؤنٹر تازہ کریں'],
 ['مركز المسميات والنصوص العامة','Labels & Text Center','Etiket ve Metin Merkezi','लेबल और टेक्स्ट केंद्र','Centro etichette e testi','Centre libellés et textes','لیبل اور متن مرکز'],
 ['اسم النظام','System name','Sistem adı','सिस्टम नाम','Nome sistema','Nom du système','سسٹم نام'],
 ['وصف النظام','System description','Sistem açıklaması','सिस्टम विवरण','Descrizione sistema','Description du système','سسٹم وضاحت'],
 ['عنوان الصفحة الرئيسية','Home page title','Ana sayfa başlığı','मुख्य पृष्ठ शीर्षक','Titolo home','Titre accueil','مرکزی صفحہ عنوان'],
 ['وصف الصفحة الرئيسية','Home page description','Ana sayfa açıklaması','मुख्य पृष्ठ विवरण','Descrizione home','Description accueil','مرکزی صفحہ وضاحت'],
 ['تذييل التذكرة','Ticket footer','Bilet alt bilgisi','टिकट फ़ुटर','Piè pagina biglietto','Pied de ticket','ٹکٹ فوٹر'],
 ['تذييل التقارير','Report footer','Rapor alt bilgisi','रिपोर्ट फ़ुटर','Piè pagina report','Pied de rapport','رپورٹ فوٹر'],
 ['شروط وأحكام التذاكر','Ticket terms & conditions','Bilet şartları','टिकट नियम व शर्तें','Termini biglietto','Conditions du billet','ٹکٹ شرائط'],
 ['شرط','Term','Koşul','शर्त','Condizione','Condition','شرط'],
 ['حفظ الشروط','Save terms','Şartları kaydet','शर्तें सहेजें','Salva condizioni','Enregistrer conditions','شرائط محفوظ کریں'],
 ['صحة المكونات','Component health','Bileşen sağlığı','घटक स्वास्थ्य','Salute componenti','Santé composants','اجزاء صحت'],
 ['سلامة البيانات','Data integrity','Veri bütünlüğü','डेटा अखंडता','Integrità dati','Intégrité des données','ڈیٹا سالمیت'],
 ['فحص قبل النشر','Pre-deploy check','Yayın öncesi kontrol','प्री-डिप्लॉय जाँच','Controllo pre-pubblicazione','Contrôle avant déploiement','پری ڈپلائ چیک'],
 ['حالة المتغيرات','Variables status','Değişken durumu','वेरिएबल स्थिति','Stato variabili','État des variables','متغیرات حالت'],
 ['لقطة تشغيلية','Operational snapshot','Operasyon anlık görüntüsü','संचालन स्नैपशॉट','Snapshot operativo','Instantané opérationnel','آپریشن اسنیپ شاٹ'],
 ['سليم','Healthy','Sağlıklı','स्वस्थ','Sano','Sain','درست'],
 ['مراجعة','Review','İncele','समीक्षा','Revisione','Révision','جائزہ'],
 ['جديد','New','Yeni','नया','Nuovo','Nouveau','نیا'],
 ['مؤكد','Confirmed','Onaylandı','पुष्ट','Confermato','Confirmé','تصدیق شدہ'],
 ['مدفوع','Paid','Ödendi','भुगतान','Pagato','Payé','ادا شدہ'],
 ['ملغي','Cancelled','İptal','रद्द','Annullato','Annulé','منسوخ'],
 ['مكتمل','Completed','Tamamlandı','पूर्ण','Completato','Terminé','مکمل'],
 ['نشط','Active','Aktif','सक्रिय','Attivo','Actif','فعال'],
 ['موقوف','Inactive','Pasif','निष्क्रिय','Inattivo','Inactif','غیر فعال'],
 ['قيد المراجعة','Pending','Beklemede','लंबित','In attesa','En attente','زیر جائزہ'],
 ['معتمد','Approved','Onaylı','स्वीकृत','Approvato','Approuvé','منظور'],
 ['مرفوض','Rejected','Reddedildi','अस्वीकृत','Rifiutato','Rejeté','مسترد'],
 ['متاح','Available','Mevcut','उपलब्ध','Disponibile','Disponible','دستیاب'],
 ['مفتوح','Open','Açık','खुला','Aperto','Ouvert','کھلا'],
 ['مغلق','Closed','Kapalı','बंद','Chiuso','Fermé','بند'],
 ['مرحّل','Posted','İşlendi','पोस्टेड','Registrato','Comptabilisé','پوسٹ شدہ'],
 ['مسودة','Draft','Taslak','ड्राफ्ट','Bozza','Brouillon','مسودہ'],
 ['قيد التنفيذ','In progress','Devam ediyor','प्रगति पर','In corso','En cours','جاری'],
 ['منتهٍ','Done','Bitti','पूर्ण','Terminato','Terminé','مکمل'],
 ['عاجل','Urgent','Acil','तत्काल','Urgente','Urgent','فوری'],
 ['عالي','High','Yüksek','उच्च','Alto','Élevé','اعلی'],
 ['عادي','Normal','Normal','सामान्य','Normale','Normal','عام'],
 ['منخفض','Low','Düşük','निम्न','Basso','Faible','کم'],
 ['ذهاب فقط','One way','Tek yön','एक तरफ़ा','Solo andata','Aller simple','یک طرفہ'],
 ['ذهاب وعودة','Round trip','Gidiş-dönüş','आना-जाना','Andata e ritorno','Aller-retour','آنا جانا'],
 ['عودة فقط','Return only','Sadece dönüş','केवल वापसी','Solo ritorno','Retour uniquement','صرف واپسی']
];

const CODES=['ar','en','tr','hi','it','fr','ur'];
const tables=Object.fromEntries(CODES.map((code,idx)=>[code,new Map(P.map(row=>[row[0],row[idx]]))]));
const originals=new WeakMap();
const attrOriginals=new WeakMap();
const escapeRx=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const phrases=[...P].sort((a,b)=>b[0].length-a[0].length);

function translated(source,language){
 if(!source||language==='ar')return source;
 let out=source;
 for(const row of phrases){
  if(out.includes(row[0]))out=out.replace(new RegExp(escapeRx(row[0]),'g'),row[CODES.indexOf(language)]||row[1]);
 }
 return out;
}
function skip(el){return !el||['SCRIPT','STYLE','CODE','PRE','TEXTAREA'].includes(el.tagName)||el.closest?.('[data-no-translate],.json-view,.ticket-page,[contenteditable="true"]')}
function applyText(node,language){
 const el=node.parentElement;if(skip(el))return;
 if(!originals.has(node))originals.set(node,node.nodeValue||'');
 const original=originals.get(node)||'';
 node.nodeValue=language==='ar'?original:translated(original,language);
}
function applyAttrs(el,language){
 if(!(el instanceof Element)||skip(el))return;
 let saved=attrOriginals.get(el);if(!saved){saved={};attrOriginals.set(el,saved)}
 for(const name of ['placeholder','title','aria-label']){
  if(!el.hasAttribute(name)&&saved[name]===undefined)continue;
  if(saved[name]===undefined)saved[name]=el.getAttribute(name)||'';
  el.setAttribute(name,language==='ar'?saved[name]:translated(saved[name],language));
 }
}
function walk(root,language){
 if(!root)return;
 if(root.nodeType===Node.TEXT_NODE){applyText(root,language);return}
 if(root.nodeType!==Node.ELEMENT_NODE&&root.nodeType!==Node.DOCUMENT_FRAGMENT_NODE)return;
 if(root.nodeType===Node.ELEMENT_NODE)applyAttrs(root,language);
 const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
 let n;while((n=w.nextNode())){if(n.nodeType===Node.TEXT_NODE)applyText(n,language);else applyAttrs(n,language)}
}

export default function RuntimeTranslation(){
 const {language}=useLanguage();const busy=useRef(false);
 useEffect(()=>{
  busy.current=true;walk(document.body,language);busy.current=false;
  const obs=new MutationObserver(records=>{
   if(busy.current)return;busy.current=true;
   try{for(const r of records){if(r.type==='characterData')applyText(r.target,language);for(const n of r.addedNodes||[])walk(n,language);if(r.type==='attributes')applyAttrs(r.target,language)}}finally{busy.current=false}
  });
  obs.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['placeholder','title','aria-label']});
  document.documentElement.lang=language;document.documentElement.dir=['ar','ur'].includes(language)?'rtl':'ltr';
  return()=>obs.disconnect();
 },[language]);
 return null;
}
