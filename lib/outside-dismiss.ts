// Safari can blur a button without focusing the tapped button. Do not dismiss on
// blur: removing the target before click would swallow the user's action.
export function listenForOutsideDismiss(root: HTMLElement, dismiss: () => void) {
  const document = root.ownerDocument;
  const outside = (event: Event) => {
    if (event.target instanceof document.defaultView!.Node && !root.contains(event.target)) dismiss();
  };
  const options = { capture: true };
  document.addEventListener('pointerdown', outside, options);
  document.addEventListener('focusin', outside, options);
  return () => {
    document.removeEventListener('pointerdown', outside, options);
    document.removeEventListener('focusin', outside, options);
  };
}
