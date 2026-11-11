/* QQ 接入向导 */
(function () {
  const api = window.qqWizard;
  const $ = (id) => document.getElementById(id);

  const FIELDS = [
    'enabled', 'initialized',
    'roleName', 'roleIdentity', 'personality', 'answerStyle', 'addressOwner', 'lifeSetting',
    'webhookPort', 'napcatHttp', 'accessToken', 'selfQq', 'ownerQq',
    'wakeMode', 'keywords', 'groupWhitelist', 'privateWhitelist',
    'personaPreset', 'persona', 'tone', 'catchphrase', 'maxLines', 'maxChars',
    'emojiStyle', 'fallbackReply',
    'sharedBrain', 'quoteMemory', 'tokenSaver', 'maxInputTokens',
    'budgetGuard', 'dailyBudgetTokens', 'antiRepeat', 'antiSpin', 'webSearch', 'webResults', 'webFetchLinks',
    'dshEnabled', 'dshCli', 'dshProfile', 'dshWorkdir', 'dshTimeout', 'dshWatch', 'dshNotify',
    'napcatWatch', 'napcatAutoStart', 'napcatRestartScript',
    'agentEnabled', 'allowShell', 'allowFileWrite', 'allowDshRun', 'toolMaxSteps', 'shellTimeout', 'toolRoots'
  ];
  const NUMBER_FIELDS = new Set(['webhookPort', 'maxLines', 'maxChars', 'maxInputTokens', 'dailyBudgetTokens', 'webResults', 'dshTimeout', 'toolMaxSteps', 'shellTimeout']);

  let current = 1;

  function readField(key) {
    const el = $(key);
    if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked;
    if (el.tagName === 'SELECT' && (el.value === 'true' || el.value === 'false')) return el.value === 'true';
    if (NUMBER_FIELDS.has(key)) return Number(el.value) || 0;
    return el.value;
  }

  function writeField(key, value) {
    const el = $(key);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else if (el.tagName === 'SELECT' && (el.value === 'true' || el.value === 'false')) el.value = value ? 'true' : 'false';
    else el.value = value == null ? '' : String(value);
  }

  function collect() {
    const patch = {};
    for (const key of FIELDS) patch[key] = readField(key);
    patch.initialized = true;
    return patch;
  }

  function setMsg(id, text, bad) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.style.color = bad ? '#f87171' : '#93a4bf';
  }

  function refreshHookUrl() {
    const port = Number($('webhookPort').value) || 6199;
    $('hookUrl').value = `http://127.0.0.1:${port}/onebot`;
  }

  async function load() {
    const data = await api.get();
    const s = data.settings || {};
    for (const key of FIELDS) if (s[key] !== undefined) writeField(key, s[key]);
    if (!s.personaPreset) writeField('personaPreset', 'dafeiyu');
    if (!s.answerStyle) writeField('answerStyle', 'normal');
    refreshHookUrl();
    renderEnv(data.status || {});
    updatePersonaState();
    updatePreview();
  }

  function renderEnv(st) {
    const run = $('env-run');
    if (!st.enabled) { run.textContent = '已停用'; run.className = 'bad'; }
    else if (st.running) { run.textContent = '运行中'; run.className = 'ok'; }
    else { run.textContent = st.error ? '监听失败：' + st.error : '未监听'; run.className = 'bad'; }
    $('env-url').textContent = `http://127.0.0.1:${st.port || 6199}/onebot`;
    $('env-napcat').textContent = st.napcatHttp || '—';
    $('env-model').textContent = st.model || '—';
    const ok = $('env-napcat-ok');
    ok.textContent = st.napcatOk === true ? '已连接' : '未检测';
    ok.className = st.napcatOk === true ? 'ok' : '';
  }

  function updatePersonaState() {
    const custom = $('personaPreset').value === 'custom';
    const box = $('persona');
    box.disabled = !custom;
    box.style.opacity = custom ? '1' : '.55';
  }

  let previewTimer = null;
  function updatePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      try {
        const r = await api.preview(collect());
        $('promptPreview').textContent = r.prompt || '';
      } catch (e) {
        $('promptPreview').textContent = '预览失败：' + e.message;
      }
    }, 250);
  }

  async function save() {
    const patch = collect();
    const r = await api.save(patch);
    if (r && r.settings) {
      for (const key of FIELDS) {
        if (key === 'persona' || key === 'initialized') continue;
        if (r.settings[key] !== undefined) writeField(key, r.settings[key]);
      }
    }
    refreshHookUrl();
    return r;
  }

  function show(step) {
    current = Math.max(1, Math.min(6, step));
    document.querySelectorAll('.step').forEach((el) => {
      el.classList.toggle('active', Number(el.dataset.step) === current);
    });
    document.querySelectorAll('#steps button').forEach((btn) => {
      const n = Number(btn.dataset.go);
      btn.classList.toggle('active', n === current);
      btn.classList.toggle('done', n < current);
    });
    $('stepinfo').textContent = `第 ${current} / 6 步`;
    $('btn-prev').disabled = current === 1;
    $('btn-next').style.display = current === 6 ? 'none' : '';
    $('btn-close').style.display = current === 6 ? '' : 'none';
  }

  // ---------- 事件 ----------
  $('btn-copy').addEventListener('click', async () => {
    const text = $('hookUrl').value;
    try {
      await navigator.clipboard.writeText(text);
      setMsg('msg2', '已复制：' + text);
    } catch (e) {
      $('hookUrl').select();
      document.execCommand('copy');
      setMsg('msg2', '已复制：' + text);
    }
  });

  $('btn-recheck').addEventListener('click', async () => {
    const data = await api.get();
    renderEnv(data.status || {});
    setMsg('msg', '已刷新');
  });

  $('btn-napcat-1').addEventListener('click', async () => {
    setMsg('msg', '正在连接 NapCat…');
    const r = await api.testNapcat();
    $('env-napcat-ok').textContent = r.success ? '已连接' : '连接失败';
    $('env-napcat-ok').className = r.success ? 'ok' : 'bad';
    setMsg('msg', r.success ? r.message : r.error, !r.success);
  });

  $('btn-restart-napcat').addEventListener('click', async () => {
    setMsg('msg', '正在重启 NapCat…（约 20 秒）');
    const r = await api.restartNapcat();
    if (!r.success) { setMsg('msg', '重启失败：' + r.error, true); return; }
    setMsg('msg', r.message || '已触发重启');
    for (let i = 0; i < 12; i += 1) {
      await new Promise((res) => setTimeout(res, 3000));
      const t = await api.testNapcat();
      if (t.success) {
        $('env-napcat-ok').textContent = '已连接';
        $('env-napcat-ok').className = 'ok';
        setMsg('msg', 'NapCat 已上线：' + t.message);
        return;
      }
    }
    setMsg('msg', '还没连上：可能需要扫码登录，二维码在 NapCat 的 cache\\qrcode.png', true);
  });

  $('btn-test-napcat').addEventListener('click', async () => {
    setMsg('msg5', '正在连接 NapCat…');
    const r = await api.testNapcat();
    setMsg('msg5', r.success ? r.message : r.error, !r.success);
  });

  $('btn-test-llm').addEventListener('click', async () => {
    setMsg('msg5', '正在调用 DeepSeek…');
    const r = await api.testLlm();
    setMsg('msg5', r.success ? r.message : r.error, !r.success);
  });

  $('btn-selftest').addEventListener('click', async () => {
    const text = $('selftestText').value.trim() || '在吗';
    $('selftestResult').textContent = '正在生成…';
    const r = await api.selfTest({ text, patch: collect() });
    if (!r.success) {
      $('selftestResult').textContent = '失败：' + r.error;
      return;
    }
    const lines = r.lines && r.lines.length ? r.lines : [r.answer];
    $('selftestResult').innerHTML = lines
      .map((line) => `<div class="bubble">${String(line).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</div>`)
      .join('');
  });

  $('btn-prev').addEventListener('click', async () => {
    await save();
    show(current - 1);
  });

  $('btn-next').addEventListener('click', async () => {
    await save();
    updatePreview();
    show(current + 1);
  });

  $('btn-close').addEventListener('click', async () => {
    await save();
    window.close();
  });

  document.querySelectorAll('#steps button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await save();
      show(Number(btn.dataset.go));
    });
  });

  ['personaPreset', 'persona', 'tone', 'catchphrase', 'maxLines', 'maxChars', 'emojiStyle', 'ownerQq', 'roleName', 'roleIdentity', 'personality', 'answerStyle', 'addressOwner', 'lifeSetting'].forEach((key) => {
    const el = $(key);
    if (!el) return;
    el.addEventListener('input', () => {
      if (key === 'personaPreset') updatePersonaState();
      updatePreview();
    });
    el.addEventListener('change', () => {
      if (key === 'personaPreset') updatePersonaState();
      updatePreview();
    });
  });

  $('webhookPort').addEventListener('input', refreshHookUrl);

  load().then(() => show(1)).catch((e) => setMsg('msg', '加载失败：' + e.message, true));
})();
