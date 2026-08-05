import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A dialog over the page, for detail the dashboard should be able to answer but
 * should not have to carry.
 *
 * Deliberately unstyled inside: it contributes a backdrop, a close affordance,
 * and the two behaviours a dialog is expected to have — Escape closes it, and a
 * click on the backdrop closes it — and leaves the content to bring its own
 * panel. That is what lets an existing panel move into a dialog unchanged
 * instead of being split into a "panel version" and a "dialog version".
 *
 * The accessible name comes from `label` rather than a rendered title, because
 * the content that moves in here already has a heading and a second one would
 * only repeat it.
 */
export function Modal({
  label,
  onClose,
  children,
}: {
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Focus moves into the dialog on open so that Tab and Escape act on it rather
  // than on the page it covers.
  useEffect(() => {
    surface.current?.focus();
  }, []);

  return (
    <div
      className="modal-backdrop"
      // Only a click that both starts and ends on the backdrop dismisses; a drag
      // that began inside the dialog must not close it on release.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={surface}
        className="modal-surface"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
        {children}
      </div>
    </div>
  );
}
