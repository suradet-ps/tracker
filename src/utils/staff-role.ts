import type { StaffRole } from '@/types/database';

/** Thai labels for the role shown in the sidebar and access screen. */
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  pending: 'รออนุมัติ',
  viewer: 'ผู้ชม',
  pharmacist: 'เภสัชกร',
  admin: 'ผู้ดูแลระบบ',
};

/**
 * Whether a profile role may read Tracker data. A missing profile or the
 * `pending` role is signed in but has no access.
 */
export function isStaffRole(
  role: string | null | undefined,
): role is Exclude<StaffRole, 'pending'> {
  return role === 'viewer' || role === 'pharmacist' || role === 'admin';
}
