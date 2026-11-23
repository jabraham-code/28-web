// Chat: one message store rendered into any number of mounted chat boxes.
import { h, esc, teamOf } from './util.js';

const messages = [];
const boxes = new Set();
let unread = 0;
let onUnread = () => {};
let sender = async () => ({ ok: true });

export function initChat({ send, onUnreadChange }) {
  sender = send;
  onUnread = onUnreadChange || onUnread;
}

/** Mount a chat UI into `container`. isVisible() says whether new messages count as read. */
export function mountChat(container, { isVisible = () => true, compact = false } = {}) {
  const list = h('ol', { class: 'chat-list', 'aria-live': 'polite', 'aria-label': 'Chat messages' });
  const input = h('input', { class: 'input chat-input', type: 'text', maxlength: '200', placeholder: 'Say something…', 'aria-label': 'Chat message', autocomplete: 'off' });
  const form = h('form', { class: 'chat-form' }, input, h('button', { class: 'btn btn-gold btn-sm', type: 'submit' }, 'Send'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const res = await sender(text.slice(0, 200));
    if (res && res.ok === false) input.value = text;
  });
  container.classList.add('chat', compact ? 'chat-compact' : 'chat-full');
  container.append(list, form);
  const box = { list, isVisible, input };
  boxes.add(box);
  renderBox(box);
  return box;
}

function msgEl(m) {
  const t = m.seat != null ? `t${teamOf(m.seat)}-text` : 'spec-text';
  const time = new Date(m.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return h('li', { class: `chat-msg${m.bot ? ' from-bot' : ''}`, html: `<span class="chat-name ${t}">${esc(m.name)}${m.bot ? ' <span class="tag tag-claude">AI</span>' : ''}</span><span class="chat-text">${esc(m.text)}</span><time>${time}</time>` });
}

function renderBox(box) {
  box.list.replaceChildren(...messages.map(msgEl));
  box.list.scrollTop = box.list.scrollHeight;
}

export function addMessage(m) {
  messages.push(m);
  if (messages.length > 200) messages.shift();
  let seen = false;
  for (const b of boxes) {
    const near = b.list.scrollHeight - b.list.scrollTop - b.list.clientHeight < 60;
    b.list.append(msgEl(m));
    if (b.list.children.length > 200) b.list.firstElementChild.remove();
    if (near) b.list.scrollTop = b.list.scrollHeight;
    if (b.isVisible()) seen = true;
  }
  if (!seen) { unread++; onUnread(unread); }
}

export function markRead() {
  unread = 0;
  onUnread(0);
  for (const b of boxes) b.list.scrollTop = b.list.scrollHeight;
}

export function clearChat() {
  messages.length = 0;
  for (const b of boxes) b.list.replaceChildren();
  markRead();
}
