import { ipcRenderer } from 'electron';
import { PageChannel } from '../shared/types.js';
import { autofillField, autofillValues, type AutofillAvailability, type AutofillData } from '../shared/autofill.js';

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
function control(value: unknown): value is Control {
  return (
    value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement || value instanceof HTMLSelectElement
  );
}
function editable(input: Control): boolean {
  return (
    input.isConnected &&
    !input.disabled &&
    !('readOnly' in input && input.readOnly) &&
    (!(input instanceof HTMLInputElement) ||
      ['text', 'email', 'tel', 'number', 'month', 'search'].includes(input.type)) &&
    input.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  );
}
function fields(target: Control): Control[] {
  const description = autofillField(target.autocomplete);
  if (!description || !editable(target)) return [];
  const all = target.form
    ? Array.from(target.form.elements).filter(control)
    : Array.from(document.querySelectorAll('input,textarea,select'))
        .filter(control)
        .filter((input) => !input.form);
  return all
    .filter((input) => {
      const field = autofillField(input.autocomplete);
      return field && field.kind === description.kind && field.section === description.section && editable(input);
    })
    .slice(0, 100);
}
function valueFor(input: Control, field: string, values: Record<string, string>): string | null {
  let value = values[field] ?? '';
  if (!value) return null;
  if (field === 'cc-exp' && input instanceof HTMLInputElement && input.type === 'month')
    value = `${values['cc-exp-year']}-${values['cc-exp-month']}`;
  if (field === 'cc-exp-year' && input instanceof HTMLInputElement && input.maxLength === 2) value = value.slice(-2);
  if (input instanceof HTMLSelectElement) {
    const match = Array.from(input.options).find(
      (option) =>
        !option.disabled &&
        (option.value.toLowerCase() === value.toLowerCase() ||
          option.textContent?.trim().toLowerCase() === value.toLowerCase() ||
          (field === 'country' && option.textContent?.trim().toLowerCase() === values['country-name']?.toLowerCase()) ||
          (field === 'cc-exp-month' && /^\d{1,2}$/.test(option.value) && +option.value === +value)),
    );
    return match?.value ?? null;
  }
  if (input.maxLength >= 0 && value.length > input.maxLength) return null;
  if (input instanceof HTMLInputElement && ['email', 'number'].includes(input.type) && /\n/.test(value)) return null;
  return value;
}
function setValue(input: Control, value: string): void {
  const prototype =
    input instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLSelectElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function setupAutofill(): void {
  if (window !== window.top || !['https:', 'http:'].includes(location.protocol)) return;
  let host: HTMLDivElement | null = null,
    button: HTMLButtonElement | null = null,
    target: Control | null = null;
  let generation = 0,
    picking = false;
  const hide = () => {
    if (host) host.style.setProperty('display', 'none', 'important');
  };
  const position = () => {
    if (!host || !target || !editable(target)) {
      hide();
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) {
      hide();
      return;
    }
    host.style.setProperty('display', 'block', 'important');
    host.style.setProperty('left', `${Math.max(0, Math.min(rect.right + 6, innerWidth - 32))}px`, 'important');
    host.style.setProperty(
      'top',
      `${Math.max(0, Math.min(rect.top + (rect.height - 28) / 2, innerHeight - 28))}px`,
      'important',
    );
  };
  const show = (input: Control, label: string) => {
    target = input;
    if (!host) {
      host = document.createElement('div');
      host.dataset.yalqenAutofill = '';
      host.style.cssText =
        'all: initial !important; position: fixed !important; z-index: 2147483647 !important; width: 28px !important; height: 28px !important;';
      const shadow = host.attachShadow({ mode: 'closed' });
      button = document.createElement('button');
      button.type = 'button';
      button.textContent = '⌄';
      button.style.cssText =
        'all: initial; box-sizing: border-box; width: 28px; height: 28px; border: 1px solid GrayText; border-radius: 6px; background: Canvas; color: CanvasText; font: 16px system-ui; text-align: center; cursor: pointer; outline: revert;';
      button.addEventListener('click', async (event) => {
        if (!event.isTrusted || picking || !target) return;
        const input = target,
          description = autofillField(input.autocomplete),
          run = generation,
          url = location.href;
        const entries = fields(input).map((input) => ({
          input,
          value: input.value,
          autocomplete: input.autocomplete,
          form: input.form,
        }));
        if (!description || !entries.length) return;
        picking = true;
        button!.disabled = true;
        try {
          const record = (await ipcRenderer.invoke(
            PageChannel.chooseAutofill,
            description.kind,
          )) as AutofillData | null;
          const current = fields(input);
          if (
            !record ||
            record.kind !== description.kind ||
            generation !== run ||
            location.href !== url ||
            current.length !== entries.length ||
            entries.some(
              (entry, index) =>
                entry.input !== current[index] ||
                entry.input.value !== entry.value ||
                entry.input.autocomplete !== entry.autocomplete ||
                entry.input.form !== entry.form,
            )
          )
            return;
          const values = autofillValues(record, document.documentElement.lang || navigator.language);
          for (const entry of entries) {
            if (
              generation !== run ||
              location.href !== url ||
              entry.input.autocomplete !== entry.autocomplete ||
              entry.input.form !== entry.form
            )
              break;
            if (entry.value || !editable(entry.input) || entry.input.value !== entry.value) continue;
            const field = autofillField(entry.autocomplete)!;
            const value = valueFor(entry.input, field.field, values);
            if (value !== null) setValue(entry.input, value);
          }
        } catch {
          /* A dismissed picker or navigation keeps the form intact. */
        } finally {
          picking = false;
          if (button) button.disabled = false;
          position();
        }
      });
      shadow.append(button);
      document.documentElement.append(host);
      document.addEventListener('scroll', position, { capture: true, passive: true });
      window.addEventListener('resize', position, { passive: true });
    }
    button!.ariaLabel = label;
    button!.title = label;
    position();
  };
  document.addEventListener(
    'focusin',
    async (event) => {
      if (host && event.target === host) return;
      const run = ++generation;
      const input = event.target;
      if (!control(input) || !editable(input) || !autofillField(input.autocomplete)) {
        target = null;
        hide();
        return;
      }
      const description = autofillField(input.autocomplete)!;
      try {
        const available = (await ipcRenderer.invoke(PageChannel.autofillAvailable)) as AutofillAvailability;
        if (run !== generation || !editable(input) || !available[description.kind]) {
          if (run === generation) hide();
          return;
        }
        show(input, description.kind === 'card' ? available.cardLabel : available.addressLabel);
      } catch {
        hide();
      }
    },
    { capture: true },
  );
  document.addEventListener(
    'focusout',
    () => {
      window.setTimeout(() => {
        if (document.activeElement !== target && document.activeElement !== host) hide();
      }, 0);
    },
    { capture: true },
  );
}
