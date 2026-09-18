'use server';

/**
 * PERF-06 — ВРЕМЕННЫЙ приёмник клиентских замеров холодного старта.
 *
 * Ничего не пишет в БД и не хранит данные: только console.info в логи Vercel,
 * откуда цифры забираются вручную. Клиент вызывает его лишь при явном флаге
 * `?perf=1` / `startapp=perf` и не чаще одного раза за сессию.
 *
 * ️ После снятия метрик «до/после» — удалить вместе с src/lib/perf/timings.ts.
 */

import { NextRequest, NextResponse } from 'next/server';

const MAX_BODY_BYTES = 4096;

export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Простая защита от мусора: только короткий JSON-отчёт.
  if (raw.length > MAX_BODY_BYTES || !raw.startsWith('{')) {
    return new NextResponse(null, { status: 413 });
  }

  console.info('[PERF] client boot', raw);
  return new NextResponse(null, { status: 204 });
}