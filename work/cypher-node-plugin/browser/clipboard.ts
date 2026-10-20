let attempt = 0;

/** Keep the fallback in this plugin; browser clipboard writes still require an explicit click. */
export async function copyToClipboard(text: string, current: () => boolean): Promise<boolean> {
  const id = ++attempt;
  if (!text || !current()) {
    return false;
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Plain HTTP and denied browser permissions retain the user-activated legacy path.
    }
  }
  if (id !== attempt || !current()) {
    return false;
  }
  const input = document.createElement("textarea");
  const previous = document.activeElement;
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    input.value = "";
    input.remove();
    if (previous instanceof HTMLElement && previous.isConnected) {
      previous.focus({ preventScroll: true });
    }
  }
}
