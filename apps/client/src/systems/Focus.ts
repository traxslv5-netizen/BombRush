export function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') || target.isContentEditable)
  );
}

export function gameplayFocused(): boolean {
  return (
    document.body.classList.contains('playing') &&
    !document.body.classList.contains('paused') &&
    !document.getElementById('settings-dialog') &&
    !isEditable(document.activeElement) &&
    !document.hidden
  );
}
