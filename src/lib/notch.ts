/**
 * The mockup uses a distinctive "chamfered panel" motif: two opposite
 * corners rounded (native border-radius), the other two corners cut at
 * 45° (clip-path). Which diagonal gets cut signals element type:
 *
 *  - "panel"  bottom-right cut only       → cards, outer containers,
 *             and top-level standalone inputs (Название доски, @desk,
 *             Краткое описание)
 *  - "action" top-left + bottom-right cut → buttons, steppers
 *  - "field"  bottom-right cut only       → inputs nested inside a card
 *             (SP-hour fields, Выберите файл, Название ресурса, Ссылка)
 *  - "none"   no cut, plain rounded rect   → toggle track, count badge
 */

export type CornerStyle = "panel" | "action" | "field" | "none";

export function clipPathFor(style: CornerStyle, notch: number): string | undefined {
  const n = `${notch}px`;
  switch (style) {
    case "panel":
      // Only bottom-right chamfer
      return `polygon(0 0, 100% 0, 100% calc(100% - ${n}), calc(100% - ${n}) 100%, 0 100%)`;
    case "action":
      // Top-left + bottom-right chamfer
      return `polygon(${n} 0, 100% 0, 100% calc(100% - ${n}), calc(100% - ${n}) 100%, 0 100%, 0 ${n})`;
    case "field":
      // Bottom-right chamfer only (smaller notch)
      return `polygon(0 0, 100% 0, 100% calc(100% - ${n}), calc(100% - ${n}) 100%, 0 100%)`;
    case "none":
    default:
      return undefined;
  }
}
