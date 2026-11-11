/**
 * DSH 任务板 HTTP 客户端：直连运行中的 DSH Web 服务，读写活的任务板。
 * 鉴权靠回环地址 + 同源标记（Origin），不需要 token。
 */
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const API = '/api/task-board';
let cached = null;

function httpJson(urlStr, { method = 'GET', body, origin, timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch (e) { reject(e); return; }
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const headers = {
      Accept: 'application/json',
      Origin: origin || `http://${url.host}`
    };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = data.length;
    }
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c.toString('utf8'); });
      res.on('end', () => {
        if (res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('返回不是 JSON')); }
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error('超时')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function dshPids() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)","(\d+)"/);
      if (m) pids.add(m[2]);
    }
    return pids;
  } catch (e) {
    return new Set();
  }
}

function loopbackPorts(pids) {
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
    const ports = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
      if (!m) continue;
      if (!pids.has(m[3])) continue;
      if (/^(127\.|\[::1\])/.test(m[1])) ports.add(Number(m[2]));
    }
    return [...ports];
  } catch (e) {
    return [];
  }
}

/** 找出正在运行的 DSH Web 服务地址，缓存 5 分钟 */
async function discover(force = false) {
  if (process.env.QQBRIDGE_NO_DSHAPI === '1') return null;
  if (!force && cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.base;
  const ports = loopbackPorts(dshPids());
  for (const port of ports) {
    const base = `http://127.0.0.1:${port}`;
    try {
      const state = await httpJson(`${base}${API}/state`, { origin: base, timeout: 1500 });
      if (state && Array.isArray(state.tasks)) {
        cached = { base, at: Date.now() };
        return base;
      }
    } catch (e) { /* 不是任务板端口 */ }
  }
  return null;
}

async function getState() {
  const base = await discover();
  if (!base) return null;
  return httpJson(`${base}${API}/state`, { origin: base });
}

async function act(action) {
  const base = await discover();
  if (!base) return null;
  const requestId = `qq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return httpJson(`${base}${API}/action`, {
    method: 'POST',
    origin: base,
    body: { requestId, action }
  });
}

async function createTask({ title, description = '', prompt = '', workspaceId = '', constraint = '' }) {
  const id = `qq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const basePrompt = String(prompt || title || '');
  const finalPrompt = constraint ? `${constraint}\n\n${basePrompt}` : basePrompt;
  const finalDesc = constraint ? `${description}${description ? '\n' : ''}（限定工作区）` : description;
  const input = { title: String(title || '未命名任务'), description: finalDesc, prompt: finalPrompt };
  if (workspaceId) input.workspaceId = String(workspaceId);
  return act({ kind: 'create', id, input });
}

/** 取最近任务所在的工作区，用作新建任务的默认工作区 */
async function defaultWorkspaceId() {
  try {
    const state = await getState();
    const tasks = (state && state.tasks) || [];
    for (let i = tasks.length - 1; i >= 0; i -= 1) {
      if (tasks[i].workspaceId) return String(tasks[i].workspaceId);
    }
  } catch (e) { /* 忽略 */ }
  return '';
}

async function runTask(taskId) {
  return act({ kind: 'run', taskId });
}

async function moveTask(taskId, status) {
  return act({ kind: 'move', taskId, status });
}

async function archiveTask(taskId) {
  return act({ kind: 'archive', taskId });
}

module.exports = { discover, getState, createTask, defaultWorkspaceId, runTask, moveTask, archiveTask };
