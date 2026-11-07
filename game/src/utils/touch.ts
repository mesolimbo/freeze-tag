/**
 * Phones and tablets steer by holding the left or right half of the screen. Desktop stays Shift-only (the Game Off
 * "Shift" theme), so only touch pointers ever steer: a mouse click never does.
 */
export const IS_TOUCH_DEVICE =
  typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;

/** The steering side a touch on screen asks for, or null for mouse and pen input and for taps on buttons. */
export function touchSide(e: PointerEvent): 'left' | 'right' | null {
  if (e.pointerType !== 'touch') return null;
  if (e.target instanceof Element && e.target.closest('button')) return null;
  return e.clientX < window.innerWidth / 2 ? 'left' : 'right';
}
