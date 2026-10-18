import './team-roles.css';
import { t, useLanguage } from './i18n';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Pencil, KeyRound, Users, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { Employee, Role } from '@eliza/contracts';
import { api, refresh, useEmployees, useSession } from './api';
import { Field, ErrorMessage } from './forms';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
export function TeamManagementPage() {
  useLanguage();
  const session = useSession().data!;
  const canManage = session.user.permissions.includes('team.manage');
  const query = useEmployees();
  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api<Role[]>('/team/roles'),
    enabled: canManage,
  });
  const [open, setOpen] = useState(false);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [employeeCode, setEmployeeCode] = useState('');
  const [issuedQr, setIssuedQr] = useState<{ name: string; credential: string } | null>(null);
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      api<{ id?: string; qrCredential?: string }>(
        employee ? `/team/${employee.id}` : '/team',
        body,
        employee ? 'PATCH' : 'POST',
      ),
    onSuccess: (result, body) => {
      void refresh();
      setOpen(false);
      if (result.qrCredential)
        setIssuedQr({
          name: String((body as { name: string }).name),
          credential: result.qrCredential,
        });
    },
  });
  const issueQr = useMutation({
    mutationFn: (person: Employee) => api<{ qrCredential: string }>(`/team/${person.id}/qr`, {}),
    onSuccess: (result, person) => {
      void refresh();
      setIssuedQr({ name: person.name, credential: result.qrCredential });
    },
  });
  function generateEmployeeCode() {
    let next = '';
    do {
      const bytes = crypto.getRandomValues(new Uint8Array(5));
      next =
        'EMP-' +
        [...bytes]
          .map((byte) => (byte % 36).toString(36))
          .join('')
          .toUpperCase();
    } while (query.data?.some((person) => person.employeeCode === next));
    setEmployeeCode(next);
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const body = Object.fromEntries(formData);
    body.name = [body.firstName, body.lastName].filter(Boolean).join(' ') || employee?.name || '';
    const roleIds = formData.getAll('roleIds').map(String);
    const roleId =
      roleIds.find((id) => id === employee?.roleId) ??
      roleIds.find(
        (id) => roles.data?.find((role) => role.id === id)?.name !== 'General employee',
      ) ??
      roleIds[0];
    if (!roleIds.length) return;
    mutation.mutate(
      employee
        ? {
            ...body,
            active: body.active === 'true',
            roleId,
            roleIds,
          }
        : { ...body, roleId, roleIds },
    );
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('YOUR PEOPLE')}</div>
          <h1>{t('Team')}</h1>
          <p className="muted">{t('Set up employee roles, PINs, and printable QR access.')}</p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setEmployee(null);
              setEmployeeCode('');
              mutation.reset();
              setOpen(true);
            }}
          >
            <Plus size={17} />
            {t('Add employee ')}
          </Button>
        )}
      </div>
      <div className="notice inventory-notice">
        <KeyRound size={20} />
        <div>
          <strong>{t('PINs and QR codes are for assigned devices.')}</strong>
          <span>
            {t(
              'Back-office access requires an email and password. Device access uses a PIN or employee QR code.',
            )}
          </span>
        </div>
      </div>
      <ErrorMessage error={query.error ?? roles.error} />
      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('Employee')}</th>
                <th>{t('Employee code')}</th>
                <th>{t('Roles')}</th>
                <th>{t('Register PIN')}</th>
                <th>{t('Status')}</th>
                {canManage && <th>{t('Actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {query.data?.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.name}</strong>
                    <small>{e.email || t('PIN-only account')}</small>
                    {canManage && e.phone && <small>{e.phone}</small>}
                  </td>
                  <td>{e.employeeCode}</td>
                  <td>
                    <div className="team-role-list">
                      {(e.roles?.length ? e.roles : [e.role]).map((role) => (
                        <span className="badge badge-gray" key={role}>
                          {t(role)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {e.hasPin ? t('Set') : t('Not set')}
                    <small>{e.hasQr ? t('QR issued') : t('No QR')}</small>
                  </td>
                  <td>
                    <span className={`badge badge-${e.active ? 'green' : 'gray'}`}>
                      {e.active ? t('Active') : t('Inactive')}
                    </span>
                  </td>
                  {canManage && (
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setEmployee(e);
                          setEmployeeCode(e.employeeCode);
                          mutation.reset();
                          setOpen(true);
                        }}
                        aria-label={t('Edit {value0}', { value0: e.name })}
                      >
                        <Pencil size={15} />
                        {t('Edit employee')}
                      </Button>
                      {!e.hasQr && (
                        <Button
                          variant="ghost"
                          onClick={() => issueQr.mutate(e)}
                          disabled={issueQr.isPending}
                        >
                          {t('Issue QR')}
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {query.isPending && <p className="panel-padding muted">{t('Loading team…')}</p>}
      </section>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={employee ? t('Edit employee') : t('Add an employee')}
        description={t(
          'Never share a PIN between employees. Changes are recorded in the activity log.',
        )}
      >
        <form onSubmit={submit} key={employee?.id ?? 'new'}>
          <section className="employee-profile-section">
            <h3>{t('Personal information')}</h3>
            <div className="form-grid">
              <Field label={t('First name')}>
                <input
                  name="firstName"
                  defaultValue={employee?.firstName ?? employee?.name}
                  required
                  maxLength={60}
                  autoComplete="given-name"
                />
              </Field>
              <Field label={t('Last name')}>
                <input
                  name="lastName"
                  defaultValue={employee?.lastName ?? ''}
                  maxLength={60}
                  autoComplete="family-name"
                />
              </Field>
              <Field label={t('Birth year')}>
                <input
                  name="birthYear"
                  type="number"
                  min={1900}
                  max={new Date().getFullYear()}
                  defaultValue={employee?.birthYear ?? ''}
                />
              </Field>
              <Field label={t('Gender')}>
                <select name="gender" defaultValue={employee?.gender ?? ''}>
                  <option value="">{t('Not specified')}</option>
                  <option value="female">{t('Female')}</option>
                  <option value="male">{t('Male')}</option>
                  <option value="other">{t('Other')}</option>
                  <option value="undisclosed">{t('Prefer not to say')}</option>
                </select>
              </Field>
            </div>
            <Field label={t('Contact phone')}>
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                maxLength={40}
                defaultValue={employee?.phone ?? ''}
              />
            </Field>
          </section>
          <section className="employee-profile-section">
            <h3>{t('Access and roles')}</h3>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="team-employee-code">{t('Employee code')}</label>
                <span className="employee-code-control">
                  <input
                    id="team-employee-code"
                    name="employeeCode"
                    value={employeeCode}
                    onChange={(event) => setEmployeeCode(event.target.value)}
                    required
                    maxLength={20}
                    placeholder={t('e.g. ANNA')}
                  />
                  {!employee && (
                    <button
                      type="button"
                      className="button button-outline button-icon"
                      aria-label={t('Generate employee code')}
                      title={t('Generate employee code')}
                      onClick={generateEmployeeCode}
                    >
                      <RefreshCw size={17} />
                    </button>
                  )}
                </span>
              </div>
            </div>
            <fieldset className="field">
              <legend>{t('Roles')}</legend>
              <div className="role-options">
                {roles.data?.map((role) => (
                  <label key={role.id} className="role-option">
                    <input
                      type="checkbox"
                      name="roleIds"
                      value={role.id}
                      defaultChecked={
                        employee
                          ? (employee.roleIds ?? [employee.roleId]).includes(role.id)
                          : role.name === 'Cashier'
                      }
                    />
                    <span>{t(role.name)}</span>
                  </label>
                ))}
              </div>
              <small>
                {t(
                  'Employees can have several roles. General employee can use Price Tags devices.',
                )}
              </small>
            </fieldset>
            <Field
              label={employee ? t('New PIN (optional)') : t('Register PIN')}
              hint={
                employee
                  ? t(
                      'Leave blank to keep the existing PIN. Changing it locks their register session.',
                    )
                  : t('Exactly six digits.')
              }
            >
              <input
                name="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                minLength={6}
                required={!employee}
                autoComplete="new-password"
              />
            </Field>
            {employee ? (
              <Field label={t('Status')}>
                <select name="active" defaultValue={String(employee.active)}>
                  <option value="true">{t('Active')}</option>
                  <option value="false">{t('Inactive')}</option>
                </select>
              </Field>
            ) : (
              <>
                <Field label={t('Management email (optional)')}>
                  <input name="email" type="email" autoComplete="off" />
                </Field>
                <Field
                  label={t('Management password (optional)')}
                  hint={t(
                    'Provide both email and a password to allow back-office login. At least 12 characters.',
                  )}
                >
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </Field>
              </>
            )}
          </section>
          <ErrorMessage error={mutation.error} />
          <div className="form-actions">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('Cancel ')}
            </Button>
            <Button disabled={mutation.isPending || roles.isPending}>
              {mutation.isPending ? t('Saving…') : t('Save employee')}
            </Button>
          </div>
        </form>
      </Dialog>
      <ErrorMessage error={issueQr.error} />
      <Dialog
        open={!!issuedQr}
        onOpenChange={(value) => !value && setIssuedQr(null)}
        title={t('Employee QR credential')}
        description={t('Print this private code now. It cannot be viewed again.')}
      >
        {issuedQr && (
          <div className="employee-qr-print">
            <strong>{issuedQr.name}</strong>
            <QRCodeSVG value={issuedQr.credential} size={220} includeMargin />
            <p>{t('Keep this QR private. Anyone holding it can sign in as this employee.')}</p>
          </div>
        )}
        <Button onClick={() => window.print()}>{t('Print employee QR')}</Button>
      </Dialog>
    </>
  );
}
