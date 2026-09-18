'use client';

import { useEffect, type RefObject } from 'react';
import { computeKeyboardOffset } from './useKeyboardOffset';

/** Отступ между нижним краем инпута и клавиатурой (ТЗ: 12–16px) */
const FOCUS_MARGIN_PX = 14;
/** Длительность корректирующей анимации (ТЗ: 250–300ms) */
const ADJUST_MS = 280;
/** Тишина visualViewport 100ms → клавиатура считается устаканившейся */
const SETTLE_MS = 100;
/** Сдвиг пальца больше этого радиуса → это скролл-жест, а не тап по инпуту */
const GESTURE_CANCEL_PX = 10;

/**
 * Высота клавиатуры на устройстве практически постоянна. Запоминаем последний
 * увиденный keyboard-offset на уровне модуля (переживает ре-монты шторок),
 * чтобы при следующем тапе по инпуту ЗАРАНЕЕ — ещё до появления клавиатуры —
 * отложить контент на финальную высоту. Именно поэтому корректирующая анимация
 * и анимация клавиатуры не конфликтуют: клавиатура «въезжает» в готовый layout.
 */
let lastKnownKeyboardHeight = 0;

/**
 * useDeferredInputFocus — «Keyboard-aware Compact Bottom Sheet», фаза фокуса.
 *
 * Проблема: тап по <input> внутри шторки → нативный фокус → клавиатура →
 * layout viewport резко сжимается → браузер рывком скроллит сфокусированный
 * элемент → шторка прыгает, инпут на кадр уезжает под клавиатуру.
 *
 * Решение — контролируем весь путь от тапа до фокуса:
 *
 *  1. pointerdown/mousedown (capture) по инпуту → preventDefault: нативный
 *     фокус заблокирован, клавиатура НЕ появляется, скролл layout viewport
 *     не запускается. Скролл контента при этом работает (touch-action
 *     управляет панами независимо от отмены default-action pointerdown).
 *  2. Плавно (rAF, ease-out cubic, ~280ms) поднимаем scroll контейнера шторки
 *     так, чтобы низ инпута + margin оказался над ПРЕДСКАЗАННОЙ клавиатурой
 *     (последняя известная высота; 0 при первом открытии за сессию).
 *  3. Только после завершения корректирующей анимации →
 *     el.focus({ preventScroll: true }) — клавиатура начинает анимацию
 *     появления уже в готовом layout.
 *  4. Пока клавиатура едет, `visualViewport.resize` стримит кадры:
 *     `--kb-offset` (useKeyboardOffset) поднимает панель покадрово через CSS,
 *     а мы покадрово подтягиваем scrollTop — инпут висит над клавиатурой
 *     без единого рывка. 100ms тишины → клавиатура устаканилась.
 *  5. focusout → активный таргет сброшен; при blur клавиатура уходит,
 *     `--kb-offset` → 0, панель плавно возвращается в компактное состояние
 *     (обрабатывается существующим CSS respectKeyboard).
 *
 * Никакого `expand()` и разворота на fullscreen — шторка сохраняет компактную
 * высоту, корректируется только scroll + max-height через --kb-offset.
 */
export function useDeferredInputFocus(
  /** Скроллящийся контейнер шторки (панель с overflow-y: auto) */
  containerRef: RefObject<HTMLElement | null>,
  {
    enabled = true,
    marginPx = FOCUS_MARGIN_PX,
    adjustMs = ADJUST_MS,
    /** Панель поднимается над клавиатурой через --kb-offset (respectKeyboard) */
    lifted = false,
  }: {
    enabled?: boolean;
    marginPx?: number;
    adjustMs?: number;
    lifted?: boolean;
  } = {},
): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const container = containerRef.current;
    if (!container) return;

    /** Тап уже перехвачен, ждёт корректирующей анимации и focus() */
    let pendingTarget: HTMLElement | null = null;
    /** Уже в фокусе; пока клавиатура анимируется — удерживаем над ней */
    let activeTarget: HTMLElement | null = null;
    let animRaf: number | null = null;
    let adjustTimer: number | null = null;
    let settleTimer: number | null = null;
    let downX = 0;
    let downY = 0;

    const cancelPendingAnimation = () => {
      if (animRaf !== null) {
        cancelAnimationFrame(animRaf);
        animRaf = null;
      }
      if (adjustTimer !== null) {
        window.clearTimeout(adjustTimer);
        adjustTimer = null;
      }
    };

    /**
     * Держим инпут полностью видимым над клавиатурой + marginPx.
     * Читаем живые getBoundingClientRect — вызывается покадрово во время
     * анимации клавиатуры, поэтому позиция всегда актуальна.
     */
    const ensureVisible = (el: HTMLElement, kb: number, winH: number) => {
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const panelBottom = Math.min(cRect.bottom, winH);
      // lifted: cRect.bottom уже поднят на kb (--kb-offset) — не вычитаем
      // второй раз; не lifted: панель осталась на месте, клавиатуру вычитаем.
      const limit = lifted ? panelBottom - marginPx : panelBottom - kb - marginPx;
      const maxScroll = container.scrollHeight - container.clientHeight;
      if (eRect.bottom - limit > 1) {
        container.scrollTop = Math.min(maxScroll, container.scrollTop + (eRect.bottom - limit));
      } else if (eRect.top < cRect.top) {
        container.scrollTop = Math.max(0, container.scrollTop - (cRect.top - eRect.top));
      }
    };

    const focusNow = () => {
      cancelPendingAnimation();
      const el = pendingTarget;
      pendingTarget = null;
      if (!el || !el.isConnected) return;
      // preventScroll: вертикальную позицию контролируем сами — иначе браузер
      // скроллит по СТАРОМУ (до-клавиатурному) layout viewport и дёргает шторку.
      el.focus({ preventScroll: true });
      activeTarget = el;
    };

    const bumpSettle = (onSettled: () => void) => {
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(onSettled, SETTLE_MS);
    };

    const onVisualViewportChange = () => {
      const kb = computeKeyboardOffset();
      const winH = window.visualViewport?.height ?? window.innerHeight;
      if (kb > lastKnownKeyboardHeight) lastKnownKeyboardHeight = kb;

      if (pendingTarget) {
        // Клавиатура поехала ещё до focus() (неожиданный сценарий, напр.
        // системный автокаст) — корректируем по живому offset и фокусируемся
        // как только она устаканится.
        ensureVisible(pendingTarget, kb, winH);
        bumpSettle(focusNow);
        return;
      }
      if (activeTarget) {
        // Фаза 4: клавиатура анимируется — панель едет через --kb-offset
        // покадрово, мы покадрово подтягиваем scroll. 100ms тишины = готово.
        ensureVisible(activeTarget, kb, winH);
        bumpSettle(() => {
          activeTarget = null;
        });
      }
    };

    /** ease-out cubic ≈ по духу cubic-bezier(0.25, 1, 0.5, 1) из ТЗ */
    const animateScrollTo = (to: number, durationMs: number, onDone: () => void) => {
      const from = container.scrollTop;
      const maxScroll = container.scrollHeight - container.clientHeight;
      const target = Math.max(0, Math.min(maxScroll, to));
      const delta = target - from;
      if (Math.abs(delta) < 1) {
        onDone();
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        container.scrollTop = from + delta * (1 - Math.pow(1 - t, 3));
        if (t < 1) {
          animRaf = requestAnimationFrame(tick);
        } else {
          animRaf = null;
          onDone();
        }
      };
      animRaf = requestAnimationFrame(tick);
    };

    const EDITABLE = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';

    const onPointerDown = (e: Event) => {
      const me = e as PointerEvent & { button?: number };
      // mousedown — fallback для WebView без PointerEvents; при живых
      // PointerEvents pointerdown уже перехватил тап (compat-события отменены).
      if (me.type === 'mousedown' && 'PointerEvent' in window) return;
      // Мышь (Telegram Desktop, обычный браузер) — нативный фокус и drag-select
      // текста: там нет экранной клавиатуры, паттерн не нужен. Касания и pen —
      // перехватываем; пустой pointerType (старые Android WebView) считаем тачем.
      if (me.type === 'pointerdown' && me.pointerType === 'mouse') return;
      if (typeof me.button === 'number' && me.button !== 0) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Селектор покрывает и <input>/<textarea> (disabled/readOnly), и
      // contenteditable — поэтому union-тип вместо HTMLElement напрямую.
      const el = target.closest<HTMLElement & { disabled?: boolean; readOnly?: boolean }>(EDITABLE);
      if (!el || el.disabled || el.readOnly) return;

      // ШАГ 1: блокируем нативный фокус → клавиатура и рывок скролла не
      // стартуют без нашего разрешения. Дальше всё под нашим контролем.
      e.preventDefault();

      // Предыдущий незавершённый сценарий отменяем — тап уже новый
      cancelPendingAnimation();
      downX = me.clientX;
      downY = me.clientY;
      pendingTarget = el;

      const kb = computeKeyboardOffset();
      if (kb > 0) {
        // Клавиатура УЖЕ открыта (тап по второму полю): позиция панели
        // финальная — корректируем мгновенно и фокусируемся синхронно,
        // клавиатура при смене фокуса не мигает.
        ensureVisible(el, kb, window.visualViewport?.height ?? window.innerHeight);
        focusNow();
        return;
      }

      // ШАГ 2: корректирующая анимация ПОД предсказанную клавиатуру, фокус —
      // только по её завершении (ШАГ 3).
      const predictedKb = lastKnownKeyboardHeight;
      const winH = window.visualViewport?.height ?? window.innerHeight;
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      // Предел для низа инпута ПОСЛЕ появления клавиатуры
      const futureLimit = Math.min(cRect.bottom, winH) - predictedKb - marginPx;
      const needed = eRect.bottom - futureLimit;
      if (needed > 1) {
        animateScrollTo(container.scrollTop + needed, adjustMs, focusNow);
      }
      // Страховка (ТЗ: transitionend или setTimeout 250–300ms): rAF мог не
      // стартовать (WebView в фоне), инпут уже виден или анимация не нужна.
      adjustTimer = window.setTimeout(focusNow, adjustMs + 150);
    };

    const onPointerMove = (e: Event) => {
      if (!pendingTarget) return;
      const me = e as PointerEvent;
      const dx = me.clientX - downX;
      const dy = me.clientY - downY;
      if (dx * dx + dy * dy > GESTURE_CANCEL_PX * GESTURE_CANCEL_PX) {
        // Палец уехал — это скролл-жест, а не тап: не фокусируемся.
        pendingTarget = null;
        cancelPendingAnimation();
      }
    };

    const onGestureCancel = () => {
      pendingTarget = null;
      activeTarget = null;
      cancelPendingAnimation();
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
    };

    const onFocusOut = () => {
      // Blur инпута → клавиатура закрывается, панель возвращается в
      // компактное состояние через существующий CSS (--kb-offset → 0).
      activeTarget = null;
    };

    const vv = window.visualViewport;
    vv?.addEventListener('resize', onVisualViewportChange);
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('mousedown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointercancel', onGestureCancel);
    container.addEventListener('focusout', onFocusOut, true);

    return () => {
      vv?.removeEventListener('resize', onVisualViewportChange);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('mousedown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointercancel', onGestureCancel);
      container.removeEventListener('focusout', onFocusOut, true);
      cancelPendingAnimation();
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      pendingTarget = null;
      activeTarget = null;
    };
  }, [containerRef, enabled, marginPx, adjustMs, lifted]);
}
