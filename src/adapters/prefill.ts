/**
 * Shared chat-input prefill for site adapters. Read-only boundary: writes
 * draft text into the input, NEVER sends.
 *
 * Rich-text editors (ProseMirror on both claude.ai and chatgpt.com)
 * reconcile native editing commands through a DOM MutationObserver that
 * runs a tick AFTER the command — so a synthetic paste dispatched in the
 * same tick as a clear is applied against stale editor state and appends
 * instead of replacing. Hence: clear, wait a beat, then write.
 *
 * Success check is STRICT whole-content equality (whitespace-normalized,
 * since editors normalize line structure): a substring check would
 * false-positive when the old draft contains the new text.
 */

const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 80));
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DIV',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'HEADER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'UL',
]);

/** Plain form controls (legacy textareas): set value the React-safe way. */
interface PrefillOptions {
  isLayoutOk?: (input: HTMLElement) => boolean;
  preferLineBreakHtml?: boolean;
  preferInsertText?: boolean;
}

function setNativeValue(input: HTMLTextAreaElement | HTMLInputElement, text: string): void {
  const proto = Object.getPrototypeOf(input) as object;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc?.set) desc.set.call(input, text);
  else input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function nodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return node.textContent ?? '';
  if (node.tagName === 'BR') return '\n';
  let text = '';
  for (const child of Array.from(node.childNodes)) {
    text += nodeText(child);
  }
  return text;
}

function isEditorBlock(el: Element): boolean {
  return BLOCK_TAGS.has(el.tagName);
}

function readContentEditableText(input: HTMLElement): string {
  const blocks = Array.from(input.children).filter(isEditorBlock);
  if (blocks.length === 0) return input.innerText ?? input.textContent ?? '';

  return blocks
    .map((block) => nodeText(block).replace(/\n+$/g, ''))
    .join('\n')
    .replace(/\u00a0/g, ' ');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

function lineBreakHtml(text: string): string {
  const body = escapeHtml(text.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
  return `<p>${body || '<br>'}</p>`;
}

export function prefillChatInput(input: HTMLElement, text: string): Promise<boolean>;
export function prefillChatInput(
  input: HTMLElement,
  text: string,
  opts: PrefillOptions
): Promise<boolean>;
export async function prefillChatInput(
  input: HTMLElement,
  text: string,
  opts: PrefillOptions = {}
): Promise<boolean> {
  const want = normalize(text);

  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    try {
      input.focus();
      setNativeValue(input, text);
      return normalize(input.value) === want;
    } catch {
      return false;
    }
  }

  const applied = () =>
    normalize(readContentEditableText(input)) === want && (opts.isLayoutOk?.(input) ?? true);
  const clear = () => {
    try {
      document.execCommand('selectAll', false);
      document.execCommand('delete', false);
    } catch {
      // non-fatal; the strict check catches a failed replace
    }
  };
  const tryInsertText = async () => {
    try {
      clear();
      await tick();
      document.execCommand('insertText', false, text);
      if (applied()) return true;
      await tick();
      return applied();
    } catch {
      return false;
    }
  };
  const tryPaste = async () => {
    try {
      clear();
      await tick();
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      input.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      );
      if (applied()) return true;
      await tick();
      return applied();
    } catch {
      return false;
    }
  };
  const tryHtmlPaste = async () => {
    try {
      clear();
      await tick();
      const dt = new DataTransfer();
      dt.setData('text/html', lineBreakHtml(text));
      dt.setData('text/plain', text);
      input.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      );
      if (applied()) return true;
      await tick();
      return applied();
    } catch {
      return false;
    }
  };
  const tryLineBreakHtml = async () => {
    try {
      clear();
      await tick();
      document.execCommand('insertHTML', false, lineBreakHtml(text));
      if (applied()) return true;
      await tick();
      return applied();
    } catch {
      return false;
    }
  };

  try {
    input.focus();
    if (opts.preferLineBreakHtml) {
      if (await tryHtmlPaste()) return true;
      if (await tryLineBreakHtml()) return true;
      if (await tryInsertText()) return true;
      if (await tryPaste()) return true;
      input.innerHTML = lineBreakHtml(text);
      input.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertHTML', data: text })
      );
      if (applied()) return true;
    } else if (opts.preferInsertText) {
      if (await tryInsertText()) return true;
      if (await tryPaste()) return true;
    } else {
      if (await tryPaste()) return true;
      if (await tryInsertText()) return true;
    }
    input.textContent = text;
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
    );
    return applied();
  } catch {
    return false;
  }
}

/** Draft text of a chat input, '' if empty. */
export function readInputDraft(input: HTMLElement | null): string {
  try {
    if (!input) return '';
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      return input.value;
    }
    return readContentEditableText(input);
  } catch {
    return '';
  }
}
