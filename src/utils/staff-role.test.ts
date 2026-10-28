import { describe, expect, it } from 'vitest';
import { isStaffRole } from '@/utils/staff-role';

describe('isStaffRole', () => {
  it.each(['viewer', 'pharmacist', 'admin'])('accepts %s', (role) => {
    expect(isStaffRole(role)).toBe(true);
  });

  it.each(['pending', 'owner', null, undefined])('rejects %s', (role) => {
    expect(isStaffRole(role)).toBe(false);
  });
});
