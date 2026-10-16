'use client';

import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function EditorPopover({ title, children, className = '' }: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return <div className={className}>
    <button type="button" className="button subtle" popoverTarget={id}>{title}</button>
    <div id={id} popover="auto" role="dialog" aria-labelledby={`${id}-title`} className="scoring-help editor-popover">
      <div className="scoring-help-heading">
        <strong id={`${id}-title`}>{title}</strong>
        <button type="button" className="icon-button" aria-label={`關閉${title}`} popoverTarget={id} popoverTargetAction="hide"><X size={18} /></button>
      </div>
      {children}
    </div>
  </div>;
}
