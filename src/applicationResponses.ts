type ApplicationStatus = 'pending' | 'approved' | 'rejected';
type ApplicationType = 'seller' | 'admin';

export type AdminRoleApplication = {
  id: string;
  user_id: string;
  status: ApplicationStatus;
  application_type: ApplicationType;
  display_name: string;
  email: string;
  reason: string;
  portfolio_url: string | null;
  supporting_file_path: string | null;
};

export type MyRoleApplication = {
  id: string;
  application_type: ApplicationType;
  status: ApplicationStatus;
  reviewed_at: string | null;
  review_note: string | null;
  reviewer_name: string | null;
  reviewer_avatar: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') throw new Error(`Applications response has an invalid ${field} field.`);
  return value;
}

function nullableStringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value !== null && typeof value !== 'string') throw new Error(`Applications response has an invalid ${field} field.`);
  return value;
}

function applicationTypeField(record: Record<string, unknown>): ApplicationType {
  const value = stringField(record, 'application_type');
  if (value !== 'seller' && value !== 'admin') throw new Error('Applications response has an invalid application_type field.');
  return value;
}

function applicationStatusField(record: Record<string, unknown>): ApplicationStatus {
  const value = stringField(record, 'status');
  if (value !== 'pending' && value !== 'approved' && value !== 'rejected') {
    throw new Error('Applications response has an invalid status field.');
  }
  return value;
}

function applicationRows(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value) || !Array.isArray(value.applications) || !value.applications.every(isRecord)) {
    throw new Error('Applications service returned an invalid response.');
  }
  return value.applications;
}

export function parseAdminApplications(value: unknown): AdminRoleApplication[] {
  return applicationRows(value).map(application => ({
    id: stringField(application, 'id'),
    user_id: stringField(application, 'user_id'),
    status: applicationStatusField(application),
    application_type: applicationTypeField(application),
    display_name: stringField(application, 'display_name'),
    email: stringField(application, 'email'),
    reason: stringField(application, 'reason'),
    portfolio_url: nullableStringField(application, 'portfolio_url'),
    supporting_file_path: nullableStringField(application, 'supporting_file_path'),
  }));
}

export function parseMyApplications(value: unknown): MyRoleApplication[] {
  return applicationRows(value).map(application => ({
    id: stringField(application, 'id'),
    application_type: applicationTypeField(application),
    status: applicationStatusField(application),
    reviewed_at: nullableStringField(application, 'reviewed_at'),
    review_note: nullableStringField(application, 'review_note'),
    reviewer_name: nullableStringField(application, 'reviewer_name'),
    reviewer_avatar: nullableStringField(application, 'reviewer_avatar'),
  }));
}
