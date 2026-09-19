'use client';

import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useKeyboardRide } from '@/hooks/useKeyboardRide';

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
 * Высота «хрома» панели над контентом: drag handle = pt-2 + h-1 + pb-2 = 20px.
 * Единственный источник правды для «закреплённой» зоны поверх контента:
 * от неё считается потолок контентной высоты (SHEET_CONTENT_MAX_HEIGHT) и
 * верхний офсет sticky-шапок внутри панели (`top: SHEET_CHROME_HEIGHT_PX`) —
 * так шапка липнет на своём стартовом месте, а не к самой кромке шторки.
 */
export const SHEET_CHROME_HEIGHT_PX = 20;

/**
 * Потолок высоты контентной зоны шторки: потолок панели (`--sheet-max-h`)
 * минус chrome (drag handle). Нужен контенту, который должен занять ровно
 * доступную высоту — например, вкладка «Комментарии» в TaskViewEdit
 * (фиксированная высота → composer прижат к нижней кромке шторки).
 * Панель отдаёт сам потолок как `--sheet-max-h`, поэтому формула не дублируется.
 */
export const SHEET_CONTENT_MAX_HEIGHT = `calc(var(--sheet-max-h, 100dvh) - ${SHEET_CHROME_HEIGHT_PX}px)`;

/** Ref-count открытых BottomSheet для блокировки скролла body (см. useEffect ниже) */
let bodyScrollLockCount = 0;

/**
 * Синхронно убирает клавиатуру ДО закрытия шторки. iOS-особенность: когда
 * фокусированный элемент удаляется из DOM / уходит с экрана, WKWebView НЕ
 * закрывает клавиатуру — поэтому снимаем фокус и дёргаем официальный
 * Telegram.WebApp.hideKeyboard() (надёжно независимо от состояния фокуса).
 */
const dismissKeyboard = () => {
  const ae = document.activeElement as HTMLElement | null;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) ae.blur();
  (
    window as unknown as { Telegram?: { WebApp?: { hideKeyboard?: () => void } } }
  ).Telegram?.WebApp?.hideKeyboard?.();
};

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
 *   Telegram's top controls via `--tg-content-safe-top` (stable-height based,
 *   так что при открытии клавиатуры панель не рефлоушится).
 *
 * @param overlay - Optional React node rendered inside the sheet panel,
 *                  centered absolutely over the content (e.g. a loading spinner).
 *                  When provided, the sheet panel gains `position: relative`
 *                  so the overlay is positioned relative to the panel bounds.
 * @param keepMounted - When false, unmounts children while closed.
 *                      Default true — content stays mounted (cache/state survive).
 */
export function BottomSheet({
  open,
  onClose,
  children,
  stacked = false,
  preventSwipe = false,
    overlay,
  keepMounted = true,
  respectKeyboard = false,
  keyboardRide = false,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  stacked?: boolean;
  /** When true, disables swipe-to-close gesture */
  preventSwipe?: boolean;
    /** Optional overlay rendered absolutely centered over the sheet content */
  overlay?: ReactNode;
  keepMounted?: boolean;
  /**
   * When true, the sheet panel keeps clear of the on-screen keyboard. Needed
   * for bottom-anchored sheets whose content sits near the keyboard (e.g. the
   * AI task creator CTA). Вместе с keyboardRide панель покадрово опускается
   * вместе с клавиатурой при blur (фикс «зависания» с вспышкой CTA).
   */
  respectKeyboard?: boolean;
  /**
   * Keyboard ride (iPhone): focus нативный и мгновенный; анимация клавиатуры
   * стримится через visualViewport → панель ПОКАДРОВО выталкивается вверх
   * чистым transform (translateY), без layout-пересчётов и без двухфазной
   * хореографии. Требует respectKeyboard. См. hooks/useKeyboardRide.ts.
   */
  keyboardRide?: boolean;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // Мгновенный scroll инпута в видимую зону при focus + контроль видимости
  // покадрово во время анимации клавиатуры (см. проп keyboardRide).
  useKeyboardRide(sheetRef, {
    enabled: open && keyboardRide && respectKeyboard,
  });
  const dragStartX = useRef<number | null>(null);
  const dragStartY = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef(0);
  const lastYRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const startedInHandleZone = useRef(false);
  // Только для переключения CSS-transition (один ре-рендер на начало/конец жеста)
  const [isDragging, setIsDragging] = useState(false);

  // Единая точка закрытия: сначала клавиатура (синхронно, до DOM-мутаций),
  // затем колбэк родителя. Покрывает все внутренние пути: backdrop, drag, Escape.
  const requestClose = useCallback(() => {
    dismissKeyboard();
    onClose();
  }, [onClose]);

  // Apply the drag offset to the `--sheet-y` CSS variable directly on the DOM
  // inside rAF — no React re-render per touchmove, keeps the sheet smooth even
  // on low-end devices. React's inline `--sheet-y` (open/closed) is the resting
  // position; this temporarily overrides it during the drag gesture.
  const applyDrag = useCallback((offset: number) => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = sheetRef.current;
      if (!el) return;
      el.style.setProperty('--sheet-y', offset > 0 ? `${offset}px` : '0px');
    });
  }, []);

  // Swipe-down-to-close — native (non-passive) listeners so we can
  // preventDefault and stop the list from scrolling while dragging.
  useEffect(() => {
    if (!open || preventSwipe) return;
    const el = sheetRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      const startX = e.touches[0].clientX;
      const startY = e.touches[0].clientY;
      const rect = el.getBoundingClientRect();
      const inHandleZone = startY - rect.top <= HANDLE_ZONE_HEIGHT;

      startedInHandleZone.current = inHandleZone;
      dragStartX.current = startX;
      dragStartY.current = startY;
      lastYRef.current = startY;
      lastTimeRef.current = performance.now();
      velocityRef.current = 0;
      draggingRef.current = inHandleZone && el.scrollTop <= 0;
    };

    const onTouchMove = (e: TouchEvent) => {
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
        // Only claim the gesture if it started in the handle zone. Without this
        // guard, a short (non-scrollable) content — e.g. the «Комментарии» tab
        // where scrollTop is always 0 — would let any downward swipe anywhere on
        // the sheet close it, making the active close zone far too large.
        if (!startedInHandleZone.current) return;
        // Small dead zone before claiming the gesture
        if (deltaY <= 8) return;
        draggingRef.current = true;
        setIsDragging(true); // один ре-рендер на весь жест
      }

      if (deltaY <= 0) return;

      // Claim the gesture: stop the browser from scrolling/overscrolling.
      // Вертикальный жест валиден только в handle-зоне (touch-action: none),
      // поэтому preventDefault здесь работает и не конфликтует с пан-скроллом
      // контента (touch-action: pan-y на панели).
      e.preventDefault();
      dragOffsetRef.current = Math.min(deltaY, el.offsetHeight * MAX_DRAG_RATIO);
      applyDrag(dragOffsetRef.current);
    };

    const resetDrag = () => {
      dragStartX.current = null;
      dragStartY.current = null;
      draggingRef.current = false;
      dragOffsetRef.current = 0;
      velocityRef.current = 0;
      setIsDragging(false);
      applyDrag(0);
    };

    const onTouchEnd = () => {
      if (dragStartY.current === null) return;
      const offset = dragOffsetRef.current;
      const velocity = velocityRef.current;
      const wasDragging = draggingRef.current;
      resetDrag();

      const threshold = Math.min(CLOSE_SWIPE_THRESHOLD, el.offsetHeight * 0.15);
      if (wasDragging && (offset >= threshold || velocity > FLING_VELOCITY)) {
        requestClose();
      }
    };

    const onTouchCancel = () => {
      // System cancelled the gesture — just reset, do NOT close
      resetDrag();
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
  }, [open, requestClose, preventSwipe, applyDrag]);

  // Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, requestClose]);

  // Prevent body scroll when sheet is open.
  // Ref-count: вложенные (stacked) шторки не снимают лок с body, пока открыт
  // родитель — иначе закрытие дочерней даёт «дыхание» фона (страница снова
  // скроллится под ещё открытой шторкой).
  useEffect(() => {
    if (!open) return;
    bodyScrollLockCount += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      bodyScrollLockCount = Math.max(bodyScrollLockCount - 1, 0);
      if (bodyScrollLockCount === 0) {
        document.body.style.overflow = '';
      }
    };
  }, [open]);

  // Страховка для внешних закрытий (родитель сам флипает open): убираем
  // клавиатуру, если внутренние пути (requestClose) не отработали.
  // Только на переходе open→closed: на маунте закрытой шторки (например,
  // stacked-календарь при открытом родителе) клавиатуру трогать НЕЛЬЗЯ —
  // иначе hideKeyboard закроет её у соседней открытой шторки.
  const wasOpenRef = useRef(open);
  useEffect(() => {
    if (!open && wasOpenRef.current) dismissKeyboard();
    wasOpenRef.current = open;
  }, [open]);

  if (typeof window === 'undefined') return null;

  // При keepMounted=false полностью размонтируем, когда закрыто
  if (!open && !keepMounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 flex items-end transition-opacity duration-300 ${
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      style={{
        // 60 > BottomMenu (z-50): любая открытая шторка обязана перекрывать меню.
        // Иначе на Android WebView меню «всплывает» над клавиатурой (resize-режим
        // сжимает layout viewport, fixed bottom-0 прилипает к её верхнему краю)
        // и висит поверх backdrop/панели шторки.
        zIndex: stacked ? 9999 : 60,
        // Ride панели над клавиатурой — ЧИСТЫЙ transform на самой панели
        // (translateY + --kb-offset, см. стиль панели ниже). Никаких
        // padding/max-height: они форсили layout на каждый кадр анимации
        // клавиатуры (просадка FPS на iPhone) и рвали непрерывность езды.
      }}
      aria-hidden={!open}
    >
                        {/* Backdrop (Frosted Glass) */}
      {/*
        Плавный fade blur — backdrop-filter анимируется через CSS keyframes
        (backdrop-fade-in: 0px → 12px за 300ms ease-out), синхронно с opacity
        контейнера. Это устраняет проблему, когда blur "встает" резко после
        закрытия анимации скольжения панели.
      */}
      <div
        className={
          'absolute inset-0 ' +
          'bg-black/40 ' +
          'saturate-150 ' +
          'supports-[backdrop-filter]:bg-black/30 ' +
          'motion-safe:animate-backdrop-fade-in will-change-[backdrop-filter]'
        }
        onClick={preventSwipe ? undefined : requestClose}
        aria-hidden="true"
      />

      {/* Sheet panel */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal={open}
        className={`relative w-full overflow-y-auto overscroll-contain ${
          isDragging ? '' : 'transition-transform duration-300'
        }`}
      style={
        {
            // Добавляем position: relative только если есть overlay,
            // чтобы не влиять на другие компоненты, использующие BottomSheet без overlay.
            position: overlay ? 'relative' : undefined,
            zIndex: stacked ? 10000 : 10,
            backgroundColor: 'var(--color-surface)',
            // Потолок высоты шторки: резерв сверху 142px (временно, для проверки
            // раскладки), минус высота клавиатуры: панель едет вверх на --kb-ride,
            // потолок опускается на столько же → верх шторки никогда не
            // пересекает шапку. Контент компенсируется внутренним скроллом.
            // Без клавиатуры --kb-ride = 0px.
            // --sheet-max-h — тот же потолок, опубликованный для контента
            // (см. SHEET_CONTENT_MAX_HEIGHT): вложенные зоны считают от него
            // свою высоту/потолок, не дублируя формулу и не «отставая» от
            // клавиатуры (--kb-ride меняется покадрово).
            '--sheet-max-h': 'calc(var(--tg-viewport-stable-height, 100dvh) - max(142px, var(--tg-content-safe-top, 0px)) - var(--kb-ride, 0px))',
            maxHeight: 'var(--sheet-max-h)',
            clipPath: 'polygon(16px 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%, 0 16px)',
            willChange: 'transform',
            // Композитный контекст уровня панели: анимации (drag + клавиатура)
            // не промотируются под соседние слои WebView (стабильные 60fps).
            isolation: 'isolate',
            // Нативный инерционный скролл контента внутри шторки, в т.ч.
            // при открытой клавиатуре (legacy iOS WebKit).
            WebkitOverflowScrolling: 'touch',
            // Два НЕЗАВИСИМЫХ канала вертикального движения:
            // - transform: translateY(--sheet-y) — open/close/drag, transition 300ms;
            // - translate: --kb-ride — ride клавиатуры, свой transition (--ride-dur).
            // Разделение обязательно: ride клавиатуры не должен обрывать
            // анимацию открытия/закрытия (иначе — «проявление с рывком»).
            // Индивиду transform-свойства поддерживаются iOS 14.5+.
            transform: 'translateY(var(--sheet-y, 0px))',
            translate: '0px calc(-1 * var(--kb-ride, 0px))',
            transitionProperty: 'transform, translate',
            transitionDuration: isDragging ? '0ms, var(--ride-dur, 280ms)' : '300ms, var(--ride-dur, 280ms)',
            transitionTimingFunction: SETTLE_EASING,
            // Resting position driven by React state (low frequency)
            '--sheet-y': open ? '0px' : '100%',
            // Вертикальный пан отдан браузеру нативно (без JS-гонки с WebKit);
            // drag-to-close работает только в handle-зоне (у неё touch-action: none).
            touchAction: 'pan-y',
          } as React.CSSProperties
        }
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-2" style={{ touchAction: 'none' }}>
          <div className="w-10 h-1 rounded-full bg-text-muted/40" />
        </div>

        {/* Children (content) */}
        {children}

        {/* Overlay — центрируется относительно панели, если передан */}
        {overlay && (
          <div
            className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[var(--color-bg-surface)]/40 backdrop-blur-sm"
            style={{ zIndex: 10001 }} // выше панели (у панели z-index 10 или 10000)
          >
            {overlay}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
