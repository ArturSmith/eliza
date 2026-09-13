import { t, useLanguage } from './i18n';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Pencil, KeyRound, Users } from 'lucide-react';
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
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      api(employee ? `/team/${employee.id}` : '/team', body, employee ? 'PATCH' : 'POST'),
    onSuccess: () => {
      void refresh();
      setOpen(false);
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    mutation.mutate(employee ? { ...body, active: body.active === 'true' } : body);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t('YOUR PEOPLE')}</div>
          <h1>{t('Team')}</h1>
          <p className="muted">{t('Set up employee access and fast, six-digit register PINs.')}</p>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setEmployee(null);
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
          <strong>{t('PINs are for enrolled registers.')}</strong>
          <span>
            {t(
              'Back-office access requires an email and password. Set your own PIN here before using checkout. ',
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
                <th>{t('Role')}</th>
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
                  </td>
                  <td>{e.employeeCode}</td>
                  <td>
                    <span className="badge badge-gray">{t(e.role)}</span>
                  </td>
                  <td>{e.hasPin ? t('Set') : t('Not set')}</td>
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
                          mutation.reset();
                          setOpen(true);
                        }}
                        aria-label={t('Edit {value0}', { value0: e.name })}
                      >
                        <Pencil size={15} />
                        {t('Edit access ')}
                      </Button>
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
        title={employee ? t('Edit employee access') : t('Add an employee')}
        description={t(
          'Never share a PIN between employees. Changes are recorded in the activity log.',
        )}
      >
        <form onSubmit={submit} key={employee?.id ?? 'new'}>
          <Field label={t('Employee name')}>
            <input name="name" defaultValue={employee?.name} required maxLength={120} />
          </Field>
          <div className="form-grid">
            <Field label={t('Employee code')}>
              <input
                name="employeeCode"
                defaultValue={employee?.employeeCode}
                required
                maxLength={20}
                placeholder={t('e.g. ANNA')}
              />
            </Field>
            <Field label={t('Role')}>
              <select
                name="roleId"
                defaultValue={employee?.roleId ?? roles.data?.find((r) => r.name === 'Cashier')?.id}
                required
              >
                {roles.data?.map((r) => (
                  <option value={r.id} key={r.id}>
                    {t(r.name)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
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
    </>
  );
}
