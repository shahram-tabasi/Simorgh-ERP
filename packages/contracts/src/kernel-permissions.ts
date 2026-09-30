import { HCM_PERMISSIONS } from './hcm.js';
import { definePermissions } from './permissions.js';

/** Permissions owned by the platform kernel (module `core`). */
export const CORE_PERMISSIONS = definePermissions('core', {
  'member.view': { fa: 'مشاهده اعضا', en: 'View members' },
  'member.manage': { fa: 'مدیریت اعضا و نقش‌های آنان', en: 'Manage members and their roles' },
  'role.view': { fa: 'مشاهده نقش‌ها', en: 'View roles' },
  'role.manage': { fa: 'مدیریت نقش‌ها و سطوح دسترسی', en: 'Manage roles and permissions' },
  'legal_entity.view': { fa: 'مشاهده شرکت‌ها', en: 'View legal entities' },
  'legal_entity.manage': { fa: 'مدیریت شرکت‌ها', en: 'Manage legal entities' },
  'audit.view': { fa: 'مشاهده رویدادنگاری (Audit)', en: 'View audit log' },
  'number_series.manage': { fa: 'مدیریت سری‌های شماره‌گذاری اسناد', en: 'Manage document number series' },
  'attachment.view': { fa: 'مشاهده و دریافت پیوست‌ها', en: 'View and download attachments' },
  'attachment.upload': { fa: 'بارگذاری پیوست', en: 'Upload attachments' },
  'org_unit.view': { fa: 'مشاهده ساختار سازمانی', en: 'View the organisation chart' },
  'org_unit.manage': { fa: 'مدیریت واحدهای سازمانی، مدیران و اعضا', en: 'Manage org units, managers and members' },
  'calendar.manage': { fa: 'مدیریت تقویم کاری، تعطیلات و برنامهٔ کاری', en: 'Manage the work calendar, holidays and schedules' },
  'inbox.assign': {
    fa: 'ارجاع کار و ارسال پیام به کارتابل دیگران',
    en: "Put items and messages in other people's kartabl",
    scopes: ['org_unit', 'legal_entity', 'tenant'],
  },
  'inbox.manage': {
    fa: 'مدیریت کارتابل دیگران',
    en: "Manage other people's kartabl",
    scopes: ['org_unit', 'legal_entity', 'tenant'],
  },
  'task.assign': {
    fa: 'ارسال وظیفه (میز کار) به دیگران',
    en: 'Assign work tasks to others',
    scopes: ['org_unit', 'legal_entity', 'tenant'],
  },
  'workflow.view': {
    fa: 'مشاهده گردش‌کارهای دیگران',
    en: "View other people's workflows",
    scopes: ['org_unit', 'legal_entity', 'tenant'],
  },
});

/** Every permission known to this build. Business modules append theirs here. */
export const ALL_PERMISSION_DEFS = [...CORE_PERMISSIONS.all, ...HCM_PERMISSIONS.all];
