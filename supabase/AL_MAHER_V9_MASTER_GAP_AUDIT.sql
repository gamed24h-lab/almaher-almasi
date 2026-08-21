-- =========================================================
-- AL-MAHER V9 — MASTER GAP AUDIT
-- قراءة فقط: لا ينشئ ولا يعدل ولا يحذف أي شيء
-- الهدف: كشف الجداول والأعمدة الناقصة مقارنةً بمرجع V9
-- =========================================================

WITH expected_tables(module_name, table_name) AS (
    VALUES
        ('الأساس','branches'),
        ('الأساس','staff_users'),
        ('الأساس','trips'),
        ('الأساس','bookings'),
        ('الأساس','booking_passengers'),
        ('الأساس','customer_profiles'),
        ('الأساس','suppliers'),
        ('الأساس','transactions'),
        ('النظام والسحابة','system_settings'),
        ('النظام والسحابة','feature_flags'),
        ('النظام والسحابة','system_health_snapshots'),
        ('النظام والسحابة','sync_jobs'),
        ('الصلاحيات والجلسات','role_templates'),
        ('الصلاحيات والجلسات','staff_permission_overrides'),
        ('الصلاحيات والجلسات','user_sessions'),
        ('الصلاحيات والجلسات','permission_delegations'),
        ('المواسم والبرامج','seasons'),
        ('المواسم والبرامج','programs'),
        ('المواسم والبرامج','trip_branches'),
        ('المواسم والبرامج','trip_status_events'),
        ('الأسطول والمقاعد','vehicles'),
        ('الأسطول والمقاعد','vehicle_seats'),
        ('الأسطول والمقاعد','trip_vehicles'),
        ('الأسطول والمقاعد','vehicle_maintenance'),
        ('المجموعات والوثائق','travel_groups'),
        ('المجموعات والوثائق','passenger_documents'),
        ('التشغيل الجغرافي','trip_meeting_points'),
        ('التشغيل الجغرافي','passenger_meeting_points'),
        ('المقاعد والتوزيع','seat_assignments'),
        ('السكن والفنادق','hotels'),
        ('السكن والفنادق','trip_hotels'),
        ('السكن والفنادق','hotel_rooms'),
        ('السكن والفنادق','room_assignments'),
        ('QR والتشغيل الميداني','passenger_qr_tokens'),
        ('QR والتشغيل الميداني','scan_events'),
        ('الإشعارات والرسائل','message_templates'),
        ('الإشعارات والرسائل','notification_rules'),
        ('الإشعارات والرسائل','notifications'),
        ('CRM وخدمة العملاء','leads'),
        ('CRM وخدمة العملاء','service_tickets'),
        ('CRM وخدمة العملاء','tasks'),
        ('الموردون والعقود','supplier_contracts'),
        ('الموردون والعقود','supplier_payables'),
        ('المالية','cash_registers'),
        ('المالية','cash_shifts'),
        ('المالية','approval_requests'),
        ('الوكلاء B2B','agents'),
        ('الوكلاء B2B','agent_allocations'),
        ('التشغيل والمخاطر','checklist_templates'),
        ('التشغيل والمخاطر','trip_checklist_runs'),
        ('التشغيل والمخاطر','incidents'),
        ('التشغيل والمخاطر','lost_found'),
        ('الترجمة والتذاكر','translation_entries'),
        ('الترجمة والتذاكر','ticket_templates'),
        ('الترجمة والتذاكر','print_events'),
        ('التقارير','saved_reports'),
        ('التقارير','export_jobs'),
        ('النسخ والإصدارات','backup_runs'),
        ('النسخ والإصدارات','schema_migrations'),
        ('النسخ والإصدارات','system_snapshots'),
        ('الجودة والتشخيص','error_events'),
        ('الجودة والتشخيص','performance_events'),
        ('الجودة والتشخيص','feedback_reports'),
        ('النسخ والإصدارات','system_releases'),
        ('الإشعارات المتقدمة','notification_jobs'),
        ('الإشعارات المتقدمة','notification_provider_events'),
        ('العودة والقطاعات','booking_segments')
),
expected_columns(module_name, table_name, column_name) AS (
    VALUES
        ('الموظفون','staff_users','preferred_language'),
        ('الموظفون','staff_users','home_branch_id'),
        ('الموظفون','staff_users','last_login_at'),
        ('الموظفون','staff_users','force_password_reset'),
        ('الموظفون','staff_users','security_meta'),
        ('الرحلات','trips','program_id'),
        ('الرحلات','trips','lead_branch_id'),
        ('الرحلات','trips','is_shared'),
        ('الرحلات','trips','default_bus_capacity'),
        ('الرحلات','trips','booking_capacity'),
        ('الرحلات','trips','public_seat_selection'),
        ('الرحلات','trips','staff_seat_selection'),
        ('الرحلات','trips','seat_selection_required'),
        ('الرحلات','trips','return_meeting_time'),
        ('الرحلات','trips','return_departure_time'),
        ('الرحلات','trips','return_meeting_point'),
        ('الرحلات','trips','attendance_lead_minutes'),
        ('الرحلات','trips','boarding_close_minutes'),
        ('الرحلات','trips','reminder_mode'),
        ('الرحلات','trips','reminder_settings'),
        ('الرحلات','trips','operations_status'),
        ('الرحلات','trips','version_no'),
        ('العملاء','customer_profiles','preferred_language'),
        ('العملاء','customer_profiles','marketing_opt_in'),
        ('العملاء','customer_profiles','tags'),
        ('العملاء','customer_profiles','communication_preferences'),
        ('الحجوزات','bookings','group_id'),
        ('الحجوزات','bookings','source_channel'),
        ('الحجوزات','bookings','booking_type'),
        ('الحجوزات','bookings','price_snapshot'),
        ('الحجوزات','bookings','version_no'),
        ('الحجوزات','bookings','soft_deleted_at'),
        ('الحجوزات','bookings','archived_at'),
        ('الحجوزات','bookings','agent_id'),
        ('المسافرون','booking_passengers','group_id'),
        ('المسافرون','booking_passengers','passenger_type'),
        ('المسافرون','booking_passengers','preferred_language'),
        ('المسافرون','booking_passengers','assistance_flags'),
        ('المسافرون','booking_passengers','document_status'),
        ('المسافرون','booking_passengers','boarding_outbound_at'),
        ('المسافرون','booking_passengers','boarding_return_at'),
        ('المسافرون','booking_passengers','arrival_outbound_at'),
        ('المسافرون','booking_passengers','arrival_return_at'),
        ('الموردون','suppliers','score'),
        ('الموردون','suppliers','settings'),
        ('المالية','transactions','cash_shift_id'),
        ('المالية','transactions','status'),
        ('المالية','transactions','reversed_transaction_id'),
        ('المالية','transactions','idempotency_key')
),
table_status AS (
    SELECT
        'TABLE'::text AS check_type,
        e.module_name,
        e.table_name AS object_name,
        CASE WHEN to_regclass('public.' || e.table_name) IS NULL
             THEN 'MISSING'
             ELSE 'OK'
        END AS status,
        CASE WHEN to_regclass('public.' || e.table_name) IS NULL
             THEN 'الجدول غير موجود'
             ELSE 'موجود'
        END AS details
    FROM expected_tables e
),
column_status AS (
    SELECT
        'COLUMN'::text AS check_type,
        e.module_name,
        e.table_name || '.' || e.column_name AS object_name,
        CASE
            WHEN to_regclass('public.' || e.table_name) IS NULL THEN 'TABLE_MISSING'
            WHEN c.column_name IS NULL THEN 'MISSING'
            ELSE 'OK'
        END AS status,
        CASE
            WHEN to_regclass('public.' || e.table_name) IS NULL THEN 'الجدول الأساسي نفسه غير موجود'
            WHEN c.column_name IS NULL THEN 'العمود غير موجود'
            ELSE 'موجود'
        END AS details
    FROM expected_columns e
    LEFT JOIN information_schema.columns c
      ON c.table_schema = 'public'
     AND c.table_name = e.table_name
     AND c.column_name = e.column_name
),
public_inventory AS (
    SELECT
        c.relname AS object_name,
        CASE c.relkind
            WHEN 'r' THEN 'TABLE'
            WHEN 'p' THEN 'PARTITIONED_TABLE'
            WHEN 'v' THEN 'VIEW'
            WHEN 'm' THEN 'MATERIALIZED_VIEW'
            ELSE c.relkind::text
        END AS object_type,
        c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p','v','m')
),
summary AS (
    SELECT
        (SELECT count(*) FROM expected_tables) AS expected_tables,
        (SELECT count(*) FROM table_status WHERE status='OK') AS existing_expected_tables,
        (SELECT count(*) FROM table_status WHERE status='MISSING') AS missing_tables,
        (SELECT count(*) FROM expected_columns) AS expected_columns,
        (SELECT count(*) FROM column_status WHERE status='OK') AS existing_expected_columns,
        (SELECT count(*) FROM column_status WHERE status<>'OK') AS missing_columns,
        (SELECT count(*) FROM public_inventory) AS total_public_objects
)
SELECT
    'SUMMARY' AS check_type,
    'ملخص الفحص' AS module_name,
    'V9 MASTER AUDIT' AS object_name,
    CASE
        WHEN missing_tables=0 AND missing_columns=0 THEN 'ALL_OK'
        ELSE 'GAPS_FOUND'
    END AS status,
    format(
        'expected_tables=%s | existing_tables=%s | missing_tables=%s | expected_columns=%s | existing_columns=%s | missing_columns=%s | total_public_objects=%s',
        expected_tables, existing_expected_tables, missing_tables,
        expected_columns, existing_expected_columns, missing_columns,
        total_public_objects
    ) AS details
FROM summary

UNION ALL

SELECT check_type,module_name,object_name,status,details
FROM table_status
WHERE status <> 'OK'

UNION ALL

SELECT check_type,module_name,object_name,status,details
FROM column_status
WHERE status <> 'OK'

ORDER BY
    CASE check_type WHEN 'SUMMARY' THEN 0 WHEN 'TABLE' THEN 1 ELSE 2 END,
    module_name,
    object_name;
