import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Shift } from '@eliza/contracts';
import { api, queryClient } from './api';
import { Dialog } from './components/ui/dialog';
import { Button } from './components/ui/button';
import { ErrorMessage } from './forms';
import { ShiftCloseFields } from './shift-close-fields';
import { t, useLanguage } from './i18n';

export function ManagementShiftClose({
  shift,
  currency,
  onClose,
}: {
  shift: Shift;
  currency: string;
  onClose: () => void;
}) {
  useLanguage();
  const [requestId] = useState(() => crypto.randomUUID());
  const [counted, setCounted] = useState('');
  const current = useQuery({
    queryKey: ['shift-for-close', shift.id],
    queryFn: () => api<Shift>(`/reports/shifts/${shift.id}`),
    initialData: shift,
    refetchInterval: 5_000,
  });
  const close = useMutation({
    mutationFn: (notes: string) =>
      api<Shift>(`/reports/shifts/${shift.id}/close`, { requestId, countedCash: counted, notes }),
    onSuccess: async () => {
      await Promise.all(
        ['shifts', 'shift-cash', 'store-overview', 'owner-dashboard', 'pos-context'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
      onClose();
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    close.mutate(String(new FormData(event.currentTarget).get('notes') ?? ''));
  }
  const closed = current.data.status === 'closed';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !close.isPending) onClose();
      }}
      title={t('Close shift')}
      description={`${shift.employeeName} · ${shift.deviceName}`}
    >
      <form className="shift-close-form" onSubmit={submit}>
        <ShiftCloseFields
          expectedCash={current.data.expectedCash}
          currency={currency}
          counted={counted}
          onCounted={setCounted}
          management
        />
        {closed && (
          <p role="status" className="notice">
            {t('This shift is already closed.')}
          </p>
        )}
        <ErrorMessage error={current.error || close.error} />
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={close.isPending}>
            {t('Cancel')}
          </Button>
          <Button disabled={close.isPending || closed || !!current.error}>
            {t(close.isPending ? 'Saving…' : 'Close shift')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
