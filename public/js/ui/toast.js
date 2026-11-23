import { h } from './util.js';

let root;
export function toast(message, kind = 'error', ms = 3600) {
  root ||= document.getElementById('toasts');
  if (!root || !message) return;
  // de-duplicate identical toasts that are still visible
  for (const t of root.children) if (t.dataset.msg === message) { t.remove(); }
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status', dataset: { msg: message } },
    h('span', { class: 'toast-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'toast-text', text: message }),
    h('button', { class: 'toast-x', type: 'button', 'aria-label': 'Dismiss', onclick: () => close() }, '×'),
  );
  root.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const timer = setTimeout(close, ms);
  function close() {
    clearTimeout(timer);
    el.classList.remove('in');
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }
}
