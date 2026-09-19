import { t, useLanguage, getLocale } from '../../i18n';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  elevated = false,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  elevated?: boolean;
  wide?: boolean;
}) {
  useLanguage();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={elevated ? 'dialog-overlay dialog-overlay-elevated' : 'dialog-overlay'}
        />
        <DialogPrimitive.Content
          className={[
            'dialog-content',
            elevated && 'dialog-content-elevated',
            wide && 'dialog-content-wide',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="muted">{description}</DialogPrimitive.Description>
          <DialogPrimitive.Close className="dialog-close" aria-label={t('Close dialog')}>
            <X size={20} />
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
