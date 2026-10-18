import { describe, expect, it } from 'vitest';
import { employeeProfileSchema } from '../packages/contracts/src/index';
describe('employee personal information', () => {
  it('accepts optional fields for existing employees and allows clearing them', () => {
    expect(employeeProfileSchema.parse({})).toEqual({});
    expect(employeeProfileSchema.parse({ birthYear: '', gender: '', phone: '' }).birthYear).toBe(
      '',
    );
  });
  it('normalizes form data without losing international phone formatting', () => {
    expect(
      employeeProfileSchema.parse({
        firstName: ' Anna ',
        lastName: ' Olsen ',
        birthYear: '1995',
        phone: '+47 12345678',
      }),
    ).toEqual({ firstName: 'Anna', lastName: 'Olsen', birthYear: 1995, phone: '+47 12345678' });
  });
  it('rejects invalid years, phone numbers and unsupported genders', () => {
    for (const input of [
      { birthYear: '1899' },
      { birthYear: String(new Date().getUTCFullYear() + 1) },
      { birthYear: '1995.5' },
      { phone: 'not a phone' },
      { gender: 'invalid' },
    ])
      expect(employeeProfileSchema.safeParse(input).success).toBe(false);
  });
});
