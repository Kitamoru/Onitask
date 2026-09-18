'use client';

import { useEffect, type RefObject } from 'react';
import { computeKeyboardOffset } from './useKeyboardOffset';

/** Отступ между нижним краем инпута и верхом клавиатуры (ТЗ: 12–16px) */
const FOCUS_MARGIN_PX = 14;
/** Длительность ride-перехода, когда клиент отдаёт высоту клавиатуры скачком */
const RIDE_TRANSITION_MS = 280;
/** vv-события чаще этого порога считаются покадровым стримом (прямая запись) */
const STREAM_THRESHOLD_MS = 50;

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
 *  - `--kb-ride`: px подъёма панели (translate: 0 -kb-ride);
 *  - `--ride-dur`: длительность ride-перехода — 0ms при покадровом стриме
 *    vv-событий, 280ms при скачкообразном репорте (адаптивно, см. applyRide).
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
    /** Время предыдущего vv-события — для определения темпа обновлений */
    let lastEventAt = 0;

    /**
     * Адаптивный ride: панели нужен разный режим в зависимости от того, КАК
     * клиент репортит высоту клавиатуры.
     *  - Покадровый стрим (Δ < 50ms): пишем --kb-ride напрямую с --ride-dur: 0ms —
     *    панель повторяет каждый кадр клавиатуры идеально синхронно.
     *  - Скачок (Telegram iOS часто отдаёт одно событие в конце анимации):
     *    --ride-dur: 280ms ease-out — панель красиво выезжает вверх transition-ом,
     *    а не телепортируется («с рывка»).
     */
    const applyRide = () => {
      const now = performance.now();
      const delta = lastEventAt ? now - lastEventAt : Infinity;
      lastEventAt = now;
      const kb = computeKeyboardOffset();
      panel.style.setProperty('--kb-ride', `${kb}px`);
      panel.style.setProperty(
        '--ride-dur',
        delta < STREAM_THRESHOLD_MS ? '0ms' : `${RIDE_TRANSITION_MS}ms`,
      );
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
