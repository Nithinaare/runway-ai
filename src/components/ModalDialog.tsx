import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  titleId: string;
  title: string;
  children: React.ReactNode;
}

/**
 * Native <dialog> modal adhering to modern top-layer semantics, light-dismiss via
 * closedby="any" (with pointer fallback), and overscroll containment.
 */
export const ModalDialog: React.FC<ModalDialogProps> = ({
  open,
  onClose,
  titleId,
  title,
  children,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      onClose();
    };

    dialog.addEventListener('close', handleClose);

    // Fallback light-dismiss for browsers without <dialog closedby="any">
    let removeFallback: (() => void) | undefined;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        );
      };
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e) && dialog.open) {
          dialog.close();
        }
      };
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('pointerup', onPointerUp);
      removeFallback = () => {
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('pointerup', onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      removeFallback?.();
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="w-full"
    >
      <div className="flex items-center justify-between border-b border-[#E2E6ED] px-5 py-3.5">
        <h2 id={titleId} className="text-[15px] font-semibold text-[#0F172A]">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close dialog"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#64748B] hover:bg-[#F1F3F7] hover:text-[#0F172A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1E40AF]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
};
