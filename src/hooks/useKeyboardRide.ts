'use client';

import { useEffect, type RefObject } from 'react';
import { computeKeyboardOffset } from './useKeyboardOffset';

/** Отступ между нижним краем инпута и верхом клавиатуры (ТЗ: 12–16px) */
const FOCUS_MARGIN_PX = 14;

/**
 * useKeyboardRide — модель «клавиатура выдавливает шторку» (iPhone-first).
 *
 * Проблема (почему прежний deferred-focus дёргал):
 *  1. Двухфазная хореография — своя анимация подъёма (280ms) → focus() →
 *     клавиатура — даёт ДВА движения подряд вместо одного.
 *  2. Padding/max-height панели менялись на каждый кадр visualViewport →
 *     layout-пересчёт всего дерева панели в кадре → просадка FPS на iPhone.
 *
 * Решение — НЕЛИНЕЙНАЯ хореография не нужна вовсе:
 *  - focus() нативный и мгновенный (никакого preventDefault): клавиатура
 *    стартует сразу по тапу;
 *  - iOS-WebKit стримит анимацию клавиатуры покадрово через
 *    `visualViewport.resize` → хук пишет `--kb-ride` на панель каждый кадр,
 *    а панель едет чистым transform (translateY) — композитор, ноль layout.
 *    Визуально это ровно то, о чём просит UX: «клавиатура выталкивает блок»,
 *    одно непрерывное движение вверх (и вниз при blur — kb → 0 покадрово).
 *  - Параллельно держим инпут видимым: панель уже поднята transform-ом,
 *    поэтому в типичном случае (инпут у низа компактной шторки) коррекция
 *    не нужна вовсе; при глубоко проскролленном контенте — один тихий
 *    сдвиг scrollTop в момент старта анимации.
 *
 * Переменные на панели:
 *  - `--kb-ride`: px подъёма панели (translateY(-kb-ride));
 *  - `--ride-dur`: '0ms' пока клавиатура анимируется (kb > 0), снимается при
 *    kb == 0 → возвращается штатный 300ms transition для open/close/drag.
 */
export function useKeyboardRide(
  /** Панель шторки (она же скроллящийся контейнер, overflow-y: auto) */
  panelRef: RefObject<HTMLElement | null>,
  { enabled = true, marginPx = FOCUS_MARGIN_PX }: { enabled?: boolean; marginPx?: number } = {},
): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const panel = panelRef.current;
    if (!panel) return;

    /** Инпут в фокусе — пока клавиатура едет, следим за его видимостью */
    let activeTarget: HTMLElement | null = null;

    const applyRide = () => {
      const kb = computeKeyboardOffset();
      panel.style.setProperty('--kb-ride', `${kb}px`);
      panel.style.setProperty('--ride-dur', kb > 0 ? '0ms' : '');
    };

    /**
     * Держим инпут полностью видимым над клавиатурой + marginPx.
     * Только чтения (getBoundingClientRect) — layout мы не пишем, поэтому
     * нет write/read-thrash. Панель к моменту вызова уже поднята на kb
     * (--kb-ride), cRect.bottom — её реальный визуальный низ.
     */
    const ensureVisible = () => {
      const el = activeTarget;
      if (!el || !el.isConnected) return;
      const winH = window.visualViewport?.height ?? window.innerHeight;
      const cRect = panel.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const limit = Math.min(cRect.bottom, winH) - marginPx;
      const maxScroll = panel.scrollHeight - panel.clientHeight;
      if (eRect.bottom - limit > 1) {
        panel.scrollTop = Math.min(maxScroll, panel.scrollTop + (eRect.bottom - limit));
      } else if (eRect.top < cRect.top) {
        panel.scrollTop = Math.max(0, panel.scrollTop - (cRect.top - eRect.top));
      }
    };

    const onViewportChange = () => {
      applyRide();
      if (activeTarget) ensureVisible();
    };

    const isEditable = (el: Element | null): el is HTMLElement =>
      !!el &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);

    const onFocusIn = (e: FocusEvent) => {
      if (!isEditable(e.target as Element | null)) return;
      activeTarget = e.target as HTMLElement;
      // Safety: при фокусе WebKit может визуально сдвинуть layout viewport —
      // возвращаем его в ноль, панель фиксирована и позиционируется сама.
      window.scrollTo(0, 0);
    };

    const onFocusOut = (e: FocusEvent) => {
      // Blur → клавиатура уходит, kb → 0 покадрово → панель опускается
      // вместе с ней (исходный фикс «зависания» с вспышкой CTA сохранён).
      if (e.target === activeTarget) activeTarget = null;
    };

    const vv = window.visualViewport;
    vv?.addEventListener('resize', onViewportChange);
    vv?.addEventListener('scroll', onViewportChange);
    const tg = (
      window as unknown as {
        Telegram?: { WebApp?: { onEvent?: (n: string, cb: () => void) => void; offEvent?: (n: string, cb: () => void) => void } };
      }
    )?.Telegram?.WebApp;
    tg?.onEvent?.('viewportChanged', onViewportChange);
    window.addEventListener('resize', onViewportChange);
    panel.addEventListener('focusin', onFocusIn);
    panel.addEventListener('focusout', onFocusOut, true);

    // Начальная синхронизация (открытие шторки с уже поднятой клавиатурой,
    // либо stale-переменные с прошлого открытия)
    applyRide();

    return () => {
      vv?.removeEventListener('resize', onViewportChange);
      vv?.removeEventListener('scroll', onViewportChange);
      tg?.offEvent?.('viewportChanged', onViewportChange);
      window.removeEventListener('resize', onViewportChange);
      panel.removeEventListener('focusin', onFocusIn);
      panel.removeEventListener('focusout', onFocusOut, true);
      activeTarget = null;
      // Переменные намеренно НЕ сбрасываем: при закрытии с открытой
      // клавиатурой панель должна доехать вниз; при следующем открытии
      // applyRide() выше мгновенно скорректирует значения по факту.
    };
  }, [panelRef, enabled, marginPx]);
}
