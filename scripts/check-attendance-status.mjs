import assert from 'node:assert/strict';
import {ATTENDANCE_WITH_PERMISSION,resolveAttendanceDayStatus} from '../src/modules/attendance/attendanceStatus.js';

const base={periodsCount:2,punches:2,excusedPeriods:1,missedPeriods:0,missingPunches:0,shortageMinutes:6,partialThreshold:60,approvedPermissionMinutes:300};
assert.equal(resolveAttendanceDayStatus(base),ATTENDANCE_WITH_PERMISSION,'فترة مستأذن عنها بالكامل لا تجعل اليوم حضورًا جزئيًا');
assert.equal(resolveAttendanceDayStatus({...base,shortageMinutes:1}),ATTENDANCE_WITH_PERMISSION,'النقص البسيط في الفترة الحاضرة لا يلغي الاستئذان المعتمد');
assert.equal(resolveAttendanceDayStatus({periodsCount:2,punches:0,excusedPeriods:2,approvedPermissionMinutes:480}),'استئذان','كل الفترات المستأذن عنها = استئذان');
assert.equal(resolveAttendanceDayStatus({periodsCount:2,punches:0,excusedPeriods:1}),'غياب','غياب بدون تغطية كل الفترات يبقى غيابًا');
assert.equal(resolveAttendanceDayStatus({...base,missedPeriods:1}),'حضور جزئي','فترة غير معذورة مفقودة = حضور جزئي');
assert.equal(resolveAttendanceDayStatus({...base,missingPunches:1}),'حضور جزئي','بصمة ناقصة = حضور جزئي');
assert.equal(resolveAttendanceDayStatus({...base,shortageMinutes:60}),'حضور جزئي','بلوغ حد النقص = حضور جزئي');
assert.equal(resolveAttendanceDayStatus({periodsCount:2,punches:2,shortageMinutes:5,partialThreshold:60}),'حضور','الحضور الطبيعي يبقى حضورًا');
assert.equal(resolveAttendanceDayStatus({periodsCount:0,punches:2}),'حضور خارج الجدول','بصمات بلا جدول = حضور خارج الجدول');

console.log('attendance status regression checks passed');
