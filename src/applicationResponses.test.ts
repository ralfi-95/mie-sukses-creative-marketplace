import { describe, expect, it } from 'vitest';
import { parseAdminApplications, parseMyApplications } from './applicationResponses';

const adminApplication = {
  id: 'application-1',
  user_id: 'user-1',
  status: 'pending',
  application_type: 'seller',
  display_name: 'Ayu',
  email: 'ayu@example.test',
  reason: 'I would like to offer creative services.',
  portfolio_url: 'https://example.test/portfolio',
  supporting_file_path: null,
};

describe('application response validation', () => {
  it('accepts the admin applications envelope returned by the API', () => {
    expect(parseAdminApplications({ applications: [adminApplication] })).toEqual([adminApplication]);
  });

  it('accepts an empty admin applications result', () => {
    expect(parseAdminApplications({ applications: [] })).toEqual([]);
  });

  it.each([undefined, null, {}, { applications: null }, { applications: [{}] }])(
    'rejects missing or malformed admin application response data (%s)', response => {
      expect(() => parseAdminApplications(response)).toThrow(/Applications service returned|invalid/);
    },
  );

  it('accepts the applicant history envelope returned by the API', () => {
    const application = {
      id: 'application-1',
      application_type: 'seller',
      status: 'approved',
      reviewed_at: '2026-10-30T12:00:00.000Z',
      review_note: null,
      reviewer_name: 'Admin',
      reviewer_avatar: null,
    };
    expect(parseMyApplications({ applications: [application] })).toEqual([application]);
  });

  it('rejects an application envelope with an invalid status', () => {
    expect(() => parseAdminApplications({ applications: [{ ...adminApplication, status: 'unknown' }] }))
      .toThrow('Applications response has an invalid status field.');
  });
});
