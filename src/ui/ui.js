// The whole interface: a title veil, a dot, one line of prompt, one line of intent, a note card, a viewfinder.
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); Object.assign(e, attrs); e.innerHTML = html; return e; };

export function createUI(root) {
  const title = el('div', { className: 'veil solid' }, '<div class="load">潮 水 将 至</div>');
  const reticle = el('div', { id: 'reticle', className: 'hidden' });
  const prompt = el('div', { id: 'prompt', className: 'hidden' });
  const objective = el('div', { id: 'objective', className: 'hidden' });
  const toast = el('div', { id: 'toast', className: 'hidden' });
  const note = el('div', { id: 'note', className: 'hidden' }, '<div class="card"><h2></h2><p></p><div class="sign"></div><div class="hint">按 E 收起</div></div>');
  const photo = el('div', { id: 'photo', className: 'hidden' },
    '<div class="thirds"></div><div class="frame"><i></i><i></i><i></i><i></i></div><div class="mm"></div>'
    + '<div class="bar"><b>单击</b>拍摄<b>滚轮</b>变焦<b>F</b>收起</div>');
  const flash = el('div', { id: 'flash' });
  const ending = el('div', { id: 'ending', className: 'hidden' }, '<h3>灯亮了</h3><p>演示到此为止 · 你可以留下来，看一会儿海</p>');
  root.append(reticle, prompt, objective, toast, note, photo, flash, ending, title);

  let objTimer = 0, toastTimer = 0, promptText = '';
  const show = (e, on) => e.classList.toggle('hidden', !on);

  return {
    ready() {
      title.className = 'veil';
      title.innerHTML = '<h1>潮汐之间</h1><div class="en">Between Tides</div><div class="go">单击画面 · 开始行走</div>'
        + '<div class="keys"><b>W A S D</b>行走<b>Shift</b>快步<b>空格</b>跳跃<b>鼠标</b>环顾<b>E</b>互动<b>F</b>取景拍照<b>Esc</b>暂停</div>';
    },
    paused() {
      title.className = 'veil';
      title.innerHTML = '<h1 style="font-size:clamp(28px,3.6vw,52px)">暂停</h1><div class="en">Between Tides</div><div class="go">单击画面 · 继续</div>'
        + '<div class="keys"><b>W A S D</b>行走<b>Shift</b>快步<b>空格</b>跳跃<b>E</b>互动<b>F</b>取景拍照</div>';
    },
    veil(on) { show(title, on); },
    hud(on) { show(reticle, on); if (!on) { show(prompt, false); promptText = ''; } },
    focus(label) {
      reticle.classList.toggle('focus', !!label);
      if (label === promptText) return;
      promptText = label || '';
      if (label) prompt.innerHTML = `<b>E</b>${label}`;
      show(prompt, !!label);
    },
    objective(text, hold = 7) {
      objective.textContent = text; show(objective, true);
      clearTimeout(objTimer); objTimer = setTimeout(() => show(objective, false), hold * 1000);
    },
    toast(text, hold = 4) {
      toast.textContent = text; show(toast, true);
      clearTimeout(toastTimer); toastTimer = setTimeout(() => show(toast, false), hold * 1000);
    },
    note(n) {
      if (!n) { show(note, false); return; }
      const card = note.querySelector('.card');
      card.className = `card ${n.style || ''}`;
      card.querySelector('h2').textContent = n.title;
      card.querySelector('p').textContent = n.body;
      card.querySelector('.sign').textContent = n.sign || '';
      show(note, true);
    },
    photo(on, fov) {
      show(photo, on);
      if (on && fov) photo.querySelector('.mm').textContent = `${Math.round(18 / Math.tan((fov * Math.PI) / 360))} mm`;
    },
    flash() { flash.classList.remove('fire'); void flash.offsetWidth; flash.classList.add('fire'); },
    ending(on) { show(ending, on); },
    fail(message) { title.className = 'veil solid'; title.innerHTML = `<div class="load" style="animation:none;letter-spacing:.12em;line-height:2;text-align:center;padding:0 8vw">${message}</div>`; show(title, true); },
  };
}
