/**
 * The HCM module's public API — the only thing other modules may import from
 * it (architecture §9.3). Attendance and payroll will read approved leave
 * through this, never through HCM's tables.
 */
export { HcmPublicApi, type ApprovedLeave } from './hcm-public-api.js';
