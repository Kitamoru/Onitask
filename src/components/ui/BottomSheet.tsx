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
/** iOS-like easing for the settle/return animation */
const SETTLE_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

/**
 * BottomSheet — slide-up panel with backdrop overlay.
 * Uses a portal to render at the document body level.
 * Animates in/out with CSS transitions.
 *
 * - Swipe down on the drag handle / top zone (or from scroll-top) to dismiss,
 *   even when the backdrop isn't reachable (e.g. a long task list).
 * - The drag transform is applied directly to the DOM inside requestAnimationFrame
 *   (no React re-render per frame) for smooth 60fps tracking.
 * - A fast fling dismisses the sheet; a slow pull dismisses past the threshold.
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
  const lastYRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Apply the drag offset directly to the DOM inside rAF — no React re-render
  // per touchmove, which keeps the sheet smooth even on low-end devices.
  const applyDrag = (offset: number) => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = sheetRef.current;
      if (!el) return;
      el.style.transform = offset > 0 ? `translateY(${offset}px)` : 'translateY(0)';
    });
  };

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
      lastYRef.current = startY;
      lastTimeRef.current = performance.now();
      velocityRef.current = 0;
      draggingRef.current = inHandleZone && el.scrollTop <= 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (dragStartY.current === null) return;
      const y = e.touches[0].clientY;
      const deltaY = y - dragStartY.current;
      const now = performance.now();
      const dt = now - lastTimeRef.current;
      if (dt > 0) {
        velocityRef.current = (y - lastYRef.current) / dt;
      }
      lastYRef.current = y;
      lastTimeRef.current = now;

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
      if (dragStartY.current === null) return;
      const offset = dragOffsetRef.current;
      const velocity = velocityRef.current;
      const wasDragging = draggingRef.current;
      dragStartY.current = null;
      draggingRef.current = false;
      dragOffsetRef.current = 0;
      velocityRef.current = 0;
      setIsDragging(false);
      // Reset transform so the CSS transition animates the settle/return
      applyDrag(0);

      const threshold = Math.min(CLOSE_SWIPE_THRESHOLD, el.offsetHeight * 0.15);
      if (wasDragging && (offset >= threshold || velocity > FLING_VELOCITY)) {
        onClose();
      }
    };

    const onTouchCancel = () => {
      // System cancelled the gesture — just reset, do NOT close
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

  // Reset any inline transform left over from a drag gesture whenever the
  // open state changes. The drag handlers write `el.style.transform` directly
  // to the DOM (inside rAF), and that inline style would otherwise override
  // the CSS `translate-y-full` class on the next open/close cycle — leaving
  // the sheet stuck and preventing other columns from opening.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transform = '';
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
        } ${open ? '' : 'translate-y-full'}`}
        style={{
          backgroundColor: 'var(--color-surface)',
          borderTopLeftRadius: '16px',
          borderTopRightRadius: '16px',
          overscrollBehavior: 'contain',
          willChange: 'transform',
          transitionProperty: 'transform',
          transitionDuration: isDragging ? '0ms' : '300ms',
          transitionTimingFunction: SETTLE_EASING,
          // Guarantee a ~40px gap between content and Telegram's home-bar controls
          paddingBottom: 'calc(40px + env(safe-area-inset-bottom))',
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