'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Pull past this distance (or 15% of height, whichever is smaller) to dismiss */
const CLOSE_SWIPE_THRESHOLD = 120;
/** Gestures starting within this strip from the top always drag-to-close */
const HANDLE_ZONE_HEIGHT = 48;
/** Prevent pulling the sheet more than 60% of its height down */
const MAX_DRAG_RATIO = 0.6;
/** Fling velocity (px/ms) that dismisses the sheet regardless of distance */
const FLING_VELOCITY = 0.5;
/** Telegram-style easing for the settle/return animation (matches SwipeableTaskCard) */
const SETTLE_EASING = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

/**
 * BottomSheet — slide-up panel with backdrop overlay.
 * Uses a portal to render at the document body level.
 * Animates in/out with CSS transitions.
 *
 * - Swipe down on the drag handle / top zone (or from scroll-top) to dismiss,
 *   even when the backdrop isn't reachable (e.g. a long task list).
 * - The drag offset is written to the `--sheet-y` CSS variable directly on the
 *   DOM inside requestAnimationFrame (no React re-render per frame) for smooth
 *   60fps tracking. React state (`open`) is the single source of truth for the
 *   resting position: `--sheet-y: 0px` when open, `100%` when closed.
 * - A fast fling dismisses the sheet; a slow pull dismisses past the threshold.
 * - Reserves space at the top of the viewport so the sheet's content clears
 *   Telegram's top controls (e.g. the close button in the corner) via
 *   `calc(max(16px, var(--tg-content-safe-top, 0px)) + 40px)` on the container.
 */
export function BottomSheet({
  open,
  onClose,
  children,
  overlay,
  stacked = false,
  preventSwipe = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  overlay?: ReactNode;
  stacked?: boolean;
  /** When true, disables swipe-to-close gesture */
  preventSwipe?: boolean;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef<number | null>(null);
  const dragStartY = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef(0);
  const lastYRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Apply the drag offset to the `--sheet-y` CSS variable directly on the DOM
  // inside rAF — no React re-render per touchmove, keeps the sheet smooth even
  // on low-end devices. React's inline `--sheet-y` (open/closed) is the resting
  // position; this temporarily overrides it during the drag gesture.
  const applyDrag = (offset: number) => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = sheetRef.current;
      if (!el) return;
      el.style.setProperty('--sheet-y', offset > 0 ? `${offset}px` : '0px');
    });
  };

  // Swipe-down-to-close — native (non-passive) listeners so we can
  // preventDefault and stop the list from scrolling while dragging.
  useEffect(() => {
    if (!open) return;
    const el = sheetRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (preventSwipe) return;
      const startX = e.touches[0].clientX;
      const startY = e.touches[0].clientY;
      const inHandleZone = startY - el.getBoundingClientRect().top <= HANDLE_ZONE_HEIGHT;
      dragStartX.current = startX;
      dragStartY.current = startY;
      lastYRef.current = startY;
      lastTimeRef.current = performance.now();
      velocityRef.current = 0;
      draggingRef.current = inHandleZone && el.scrollTop <= 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (preventSwipe) return;
      if (dragStartY.current === null || dragStartX.current === null) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const deltaX = x - dragStartX.current;
      const deltaY = y - dragStartY.current;
      const now = performance.now();
      const dt = now - lastTimeRef.current;
      if (dt > 0) {
        velocityRef.current = (y - lastYRef.current) / dt;
      }
      lastYRef.current = y;
      lastTimeRef.current = now;

      // Axis lock: if the gesture is predominantly horizontal (a task-card
      // swipe), yield to the card and do NOT claim the gesture for closing the
      // sheet. This prevents accidental sheet dismissal while swiping a card.
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        draggingRef.current = false;
        return;
      }

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
      applyDrag(dragOffsetRef.current);
    };

    const onTouchEnd = () => {
      if (preventSwipe) {
        dragStartX.current = null;
        dragStartY.current = null;
        draggingRef.current = false;
        dragOffsetRef.current = 0;
        velocityRef.current = 0;
        setIsDragging(false);
        applyDrag(0);
        return;
      }
      if (dragStartY.current === null) return;
      const offset = dragOffsetRef.current;
      const velocity = velocityRef.current;
      const wasDragging = draggingRef.current;
      dragStartX.current = null;
      dragStartY.current = null;
      draggingRef.current = false;
      dragOffsetRef.current = 0;
      velocityRef.current = 0;
      setIsDragging(false);
      // Reset the drag offset so the CSS transition animates the settle/return
      applyDrag(0);

      const threshold = Math.min(CLOSE_SWIPE_THRESHOLD, el.offsetHeight * 0.15);
      if (wasDragging && (offset >= threshold || velocity > FLING_VELOCITY)) {
        onClose();
      }
    };

    const onTouchCancel = () => {
      if (preventSwipe) {
        dragStartX.current = null;
        dragStartY.current = null;
        draggingRef.current = false;
        dragOffsetRef.current = 0;
        velocityRef.current = 0;
        setIsDragging(false);
        applyDrag(0);
        return;
      }
      // System cancelled the gesture — just reset, do NOT close
      dragStartX.current = null;
      dragStartY.current = null;
      draggingRef.current = false;
      dragOffsetRef.current = 0;
      velocityRef.current = 0;
      setIsDragging(false);
      applyDrag(0);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchCancel);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
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
      className={`fixed inset-0 flex items-end transition-opacity duration-300 ${
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      style={{
        zIndex: stacked ? 9999 : 50,
      }}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80"
        onClick={preventSwipe ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Sheet panel — background matches RiskPulse cards (var(--color-surface)) */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal={open}
        className={`relative w-full max-h-[calc(90vh-40px)] overflow-y-auto ${
          isDragging ? '' : 'transition-transform duration-300'
        }`}
        style={
          {
            zIndex: stacked ? 10000 : 10,
            backgroundColor: 'var(--color-surface)',
            clipPath: 'polygon(16px 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%, 0 16px)',
            overscrollBehavior: 'contain',
            willChange: 'transform',
            // Single source of truth for vertical position:
            // - open → 0px (fully visible)
            // - closed → 100% (off-screen below)
            // - during drag → overridden by applyDrag() via the same variable
            transform: 'translateY(var(--sheet-y, 0px))',
            transitionProperty: 'transform',
            transitionDuration: isDragging ? '0ms' : '300ms',
            transitionTimingFunction: SETTLE_EASING,
            // Resting position driven by React state (low frequency)
            '--sheet-y': open ? '0px' : '100%',
            position: 'relative', 
          } as React.CSSProperties
        }
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-2">
          <div className="w-10 h-1 rounded-full bg-text-muted/40" />
        </div>

        {children}

        {overlay}
      </div>
    </div>,
    document.body,
  );
}
