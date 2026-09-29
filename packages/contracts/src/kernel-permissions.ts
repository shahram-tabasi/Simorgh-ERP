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
});

/** Every permission known to this build. Business modules append theirs here. */
export const ALL_PERMISSION_DEFS = [...CORE_PERMISSIONS.all];
