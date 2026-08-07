'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Pull past this distance to dismiss the sheet */
const CLOSE_SWIPE_THRESHOLD = 120;
/** Gestures starting within this strip from the top always drag-to-close */
const HANDLE_ZONE_HEIGHT = 48;
/** Prevent pulling the sheet more than 60% of its height down */
const MAX_DRAG_RATIO = 0.6;

/**
 * BottomSheet — slide-up panel with backdrop overlay.
 * Uses a portal to render at the document body level.
 * Animates in/out with CSS transitions.
 *
 * - Swipe down on the drag handle / top zone (or from scroll-top) to dismiss,
 *   even when the backdrop isn't reachable (e.g. a long task list).
 * - Reserves a ~40px gap above Telegram's home-bar controls via
 *   `padding-bottom: calc(40px + env(safe-area-inset-bottom))`.
 */
export function BottomSheet({
  open,
  onClose,
  children,
  stacked,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  stacked?: boolean;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Swipe-down-to-close — native (non-passive) listeners so we can
  // preventDefault and stop the list from scrolling while dragging.
  useEffect(() => {
    if (!open) return;
    const el = sheetRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      const startY = e.touches[0].clientY;
      const inHandleZone = startY - el.getBoundingClientRect().top <= HANDLE_ZONE_HEIGHT;
      dragStartY.current = startY;
      draggingRef.current = inHandleZone && el.scrollTop <= 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (dragStartY.current === null) return;
      const deltaY = e.touches[0].clientY - dragStartY.current;

      // List isn't at the top — let it scroll instead of closing the sheet
      if (el.scrollTop > 0) {
        draggingRef.current = false;
        return;
      }
      if (!draggingRef.current) {
        // Small dead zone before claiming the gesture
        if (deltaY <= 8) return;
        draggingRef.current = true;
      }
      if (deltaY <= 0) return;

      // Claim the gesture: stop the browser from scrolling/overscrolling
      e.preventDefault();
      dragOffsetRef.current = Math.min(deltaY, el.offsetHeight * MAX_DRAG_RATIO);
      setIsDragging(true);
      setDragOffset(dragOffsetRef.current);
    };

    const onTouchEnd = () => {
      if (dragStartY.current === null) return;
      const offset = dragOffsetRef.current;
      const wasDragging = draggingRef.current;
      dragStartY.current = null;
      draggingRef.current = false;
      dragOffsetRef.current = 0;
      setIsDragging(false);
      setDragOffset(0);
      if (wasDragging && offset >= CLOSE_SWIPE_THRESHOLD) {
        onClose();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Prevent body scroll when sheet is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (typeof window === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-end transition-opacity duration-300 ${
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet panel — background matches RiskPulse cards (var(--color-surface)) */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal={open}
        className={`relative z-10 w-full max-h-[90vh] overflow-y-auto rounded-t-2xl ${
          isDragging ? '' : 'transition-transform duration-300'
        } ${open ? 'translate-y-0' : 'translate-y-full'} ${stacked ? 'mt-0' : ''}`}
        style={{
          backgroundColor: 'var(--color-surface)',
          borderTopLeftRadius: '16px',
          borderTopRightRadius: '16px',
          overscrollBehavior: 'contain',
          // Guarantee a ~40px gap between content and Telegram's home-bar controls
          paddingBottom: 'calc(40px + env(safe-area-inset-bottom))',
          transform: open && dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-2">
          <div className="w-10 h-1 rounded-full bg-text-muted/40" />
        </div>

        {children}
      </div>
    </div>,
    document.body,
  );
}