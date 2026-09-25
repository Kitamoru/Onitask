export function scrollFeedToLatest(
  element: Pick<HTMLElement, 'scrollHeight' | 'scrollTop'> | null | undefined,
): void {
  if (!element) return;
  element.scrollTop = element.scrollHeight;
}
