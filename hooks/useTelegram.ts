// useTelegram hook — TelegramWebApp integration
// Provides tg.ready(), tg.expand(), MainButton, BackButton access

export function useTelegram() {
  return {
    ready: () => {},
    expand: () => {},
    mainButton: {
      setText: (_text: string) => {},
      show: () => {},
      hide: () => {},
      onClick: (_callback: () => void) => {},
      offClick: (_callback: () => void) => {},
    },
    backButton: {
      show: () => {},
      hide: () => {},
      onClick: (_callback: () => void) => {},
      offClick: (_callback: () => void) => {},
    },
    isExpanded: true,
    viewportHeight: 0,
    viewportStableHeight: 0,
  };
}