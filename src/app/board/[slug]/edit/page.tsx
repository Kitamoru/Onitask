'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

/**
 * Устаревший маршрут /board/[slug]/edit.
 *
 * Редактирование — это режим того же роута /board/[slug] (?edit=1).
 * Алиас нужен для обратной совместимости (Telegram-история, сохранённые
 * ссылки): редиректим на единую страницу без дублирования кода загрузки.
 */
export default function BoardEditRedirectPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params?.slug as string;

  useEffect(() => {
    if (!slug) return;
    void router.replace(`/board/${slug}?edit=1`);
  }, [slug, router]);

  return null;
}