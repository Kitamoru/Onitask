/**
 * Форматирование размера файла: 0 B / 512 B / 1.2 KB / 3.4 MB.
 *
 * Вынесено из `TaskViewEdit`, потому что список файлов теперь показывается ещё
 * и в шторке подзадачи (блок «Файлы» берётся из материнской задачи). Вторая
 * копия разъехалась бы при правке единиц — ровно то, из-за чего `formatDueShort`
 * тоже живёт в `lib/date`, а не продублирован в стриме.
 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}
