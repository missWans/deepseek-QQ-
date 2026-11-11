/* QQ 桥接状态窗口 */
(function () {
  const $ = (id) => document.getElementById(id);
  const api = window.qqBridge;
  let lastRecent = [];

  function setMsg(text, bad) {
    const el = $('msg');
    el.textContent = text || '';
    el.style.color = bad ? '#f87171' : '#93a4bf';
  }

  function renderRows(s) {
    const run = $('s-run');
    if (!s.enabled) {
      run.textContent = '已停用';
      run.className = 'bad';
    } else if (s.running) {
      run.textContent = '运行中';
      run.className = 'ok';
    } else {
      run.textContent = s.error ? '监听失败' : '未监听';
      run.className = 'bad';
    }
    $('s-port').textContent = String(s.port);
    $('s-napcat').textContent = s.napcatHttp || '—';
    $('s-model').textContent = s.model || '—';
    $('s-self').textContent = s.selfQq || '自动识别';
    $('s-owner').textContent = s.ownerQq || '未设置';
    $('st-rx').textContent = String(s.stats.received);
    $('st-tx').textContent = String(s.stats.replied);
    $('st-ig').textContent = String(s.stats.ignored);
    $('st-er').textContent = String(s.stats.errors);
  }

  function renderLog(items) {
    if (!items || !items.length) {
      $('log').innerHTML = '<div class="item"><span class="txt" style="color:#64748b">暂无消息</span></div>';
      return;
    }
    const rows = items.slice().reverse().map((it) => {
      const time = new Date(it.t).toLocaleTimeString('zh-CN', { hour12: false });
      const dir = it.dir === 'in' ? 'dir-in' : it.dir === 'out' ? 'dir-out' : 'dir-err';
      const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      return `<div class="item ${dir}"><span class="t">${time}</span><span class="who">${esc(it.who)}</span><span class="txt">${esc(it.text)}</span></div>`;
    });
    $('log').innerHTML = rows.join('');
  }

  async function refresh() {
    try {
      const s = await api.status();
      renderRows(s);
      if (s.error) setMsg('监听错误：' + s.error, true);
      lastRecent = s.recent || [];
      renderLog(lastRecent);
    } catch (e) {
      setMsg('读取状态失败：' + e.message, true);
    }
  }

  api.onActivity((item) => {
    lastRecent.push(item);
    if (lastRecent.length > 40) lastRecent = lastRecent.slice(-40);
    renderLog(lastRecent);
  });

  $('btn-wizard').addEventListener('click', () => { api.openWizard(); });

  $('btn-napcat').addEventListener('click', async () => {
    setMsg('正在连接 NapCat…');
    const r = await api.testNapcat();
    setMsg(r.success ? r.message : r.error, !r.success);
  });

  $('btn-llm').addEventListener('click', async () => {
    setMsg('正在调用 DeepSeek…');
    const r = await api.testLlm();
    setMsg(r.success ? r.message : r.error, !r.success);
  });

  $('btn-refresh').addEventListener('click', refresh);

  refresh();
  setInterval(refresh, 4000);
})();
