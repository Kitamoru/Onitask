'use client';

import type React from 'react';

/**
 * Вешать на любую кнопку рядом с текстовым полем внутри шторки (иконки,
 * чипы, отправка, голосовой ввод и т.п.). preventDefault на pointerdown
 * отменяет перенос фокуса с инпута на кнопку, но НЕ отменяет сам click —
 * так тап по кнопке не гасит и не «дёргает» уже открытую клавиатуру.
 *
 * Использование:
 *   <button {...keepFocus} onClick={handleSend}>Отправить</button>
 */
export const keepFocus = {
  onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
};
