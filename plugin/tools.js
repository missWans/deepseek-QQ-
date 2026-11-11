/**
 * 工具层：让桌宠能真正操作电脑、查看 DSH、联网。
 * 所有工具都受设置里的权限开关约束，且只允许主人触发。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exec } = require('node:child_process');
const toolbox = require('./toolbox');
const brain = require('./brain');
const dshapi = require('./dshapi');


function readPetKey() {
  try {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const p = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'DeskLLMPet', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    return String((cfg.llm && cfg.llm.apiKey) || '').trim();
  } catch (e) {
    return '';
  }
}

const DANGEROUS = /(shutdown|restart-computer|format\s+[a-z]:|diskpart|bcdedit|net\s+user\s+\S+\s+\/delete|reg\s+delete\s+HKLM|rd\s+\/s\s+\/q\s+[a-z]:\\|del\s+\/s\s+\/q\s+[a-z]:\\|cipher\s+\/w|vssadmin\s+delete)/i;

function rootsOf(s) {
  const raw = String(s.toolRoots || '').trim();
  const list = (raw ? raw.split(/\r?\n/) : [])
    .map((x) => x.trim())
    .filter(Boolean);
  if (!list.length) list.push(os.homedir(), path.join(os.homedir(), '.dsh'));
  return list.map((p) => path.resolve(p));
}

function insideRoots(s, target) {
  const full = path.resolve(target);
  return rootsOf(s).some((root) => full === root || full.startsWith(root + path.sep));
}

function clip(text, n = 4000) {
  const str = String(text == null ? '' : text);
  return str.length > n ? `${str.slice(0, n)}\n…（已截断）` : str;
}

/** OpenAI function-calling 工具定义（按权限过滤） */
function definitionsFor(s) {
  const defs = [];
  if (s.dshEnabled) {
    defs.push({
      type: 'function',
      function: {
        name: 'dsh_tasks',
        description: '查看 DeepSeek Harness 任务板上的任务（标题、状态、负责人、更新时间）',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    });
    defs.push({
      type: 'function',
      function: {
        name: 'dsh_create_task',
        description: '在 DeepSeek Harness 任务板新建一条任务，QQ 里建完看板立刻能看到',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '任务标题' },
            description: { type: 'string', description: '补充说明（可选）' },
            prompt: { type: 'string', description: '交给执行会话的指令（可选，默认用标题）' }
          },
          required: ['title']
        }
      }
    });
    defs.push({
      type: 'function',
      function: {
        name: 'dsh_run_task',
        description: '让 DSH 开始执行任务板上的一条任务',
        parameters: {
          type: 'object',
          properties: { task_id: { type: 'string', description: '任务 id 或标题关键词' } },
          required: ['task_id']
        }
      }
    });
    defs.push({
      type: 'function',
      function: {
        name: 'dsh_run',
        description: '把一件复杂的工作交给 DeepSeek Harness 执行，返回执行结果文本',
        parameters: {
          type: 'object',
          properties: { goal: { type: 'string', description: '要 DSH 完成的目标，写清楚' } },
          required: ['goal']
        }
      }
    });
  }
  if (s.allowShell) {
    defs.push({
      type: 'function',
      function: {
        name: 'run_shell',
        description: '在电脑上执行一条 shell 命令，返回 stdout/stderr。适合查文件、跑脚本、看进程。',
        parameters: {
          type: 'object',
          properties: {
            cmd: { type: 'string', description: '要执行的命令' },
            cwd: { type: 'string', description: '工作目录（可选）' }
          },
          required: ['cmd']
        }
      }
    });
  }
  if (s.allowFileWrite) {
    defs.push({
      type: 'function',
      function: {
        name: 'list_dir',
        description: '列出目录内容',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
      }
    });
    defs.push({
      type: 'function',
      function: {
        name: 'read_file',
        description: '读取文本文件内容（最多 4000 字）',
        parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
      }
    });
    defs.push({
      type: 'function',
      function: {
        name: 'write_file',
        description: '写入文本文件（会覆盖原文件）',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content']
        }
      }
    });
  }
  defs.push({
    type: 'function',
    function: {
      name: 'api_balance',
      description: '查询 DeepSeek API 账户余额',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  });
  if (s.webSearch) {
    defs.push({
      type: 'function',
      function: {
        name: 'web_search',
        description: '联网搜索，返回标题和摘要',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' }, limit: { type: 'number' } },
          required: ['query']
        }
      }
    });
    defs.push({
      type: 'function',
      function: {
        name: 'fetch_url',
        description: '抓取网页正文摘要',
        parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
      }
    });
  }
  return defs;
}

function formatTasks(tasks) {
  if (!tasks.length) return 'DSH 任务板是空的。';
  return tasks.slice(0, 20).map((t, i) => {
    const status = toolbox.STATUS_LABEL[t.status] || t.status;
    return `${i + 1}. [${status}] ${String(t.title || t.id).slice(0, 50)}`;
  }).join('\n');
}

function runShell(cmd, cwd, timeoutMs) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr) return resolve(`执行失败：${err.message}`);
      const out = [stdout, stderr].filter(Boolean).join('\n').trim();
      resolve(clip(out || '（没有输出）'));
    });
  });
}

/**
 * 执行一个工具调用。
 * @param {string} name
 * @param {object} args
 * @param {object} s 设置
 */
async function execute(name, args, s) {
  const a = args && typeof args === 'object' ? args : {};
  const timeoutMs = Math.max(5, Math.min(120, Number(s.shellTimeout) || 30)) * 1000;

  if (name === 'dsh_tasks') {
    if (!s.dshEnabled) return 'DSH 接入未开启';
    try {
      const state = await dshapi.getState();
      if (state) return formatTasks((state.tasks || []).filter((x) => !x.archivedAt));
    } catch (e) { /* 退回读文件 */ }
    const fallback = toolbox.readBoardTasks(s.dshBoardPath);
    if (!fallback.length) return '没找到 DSH 服务（桌面端可能没运行），也没有本地任务快照。';
    return formatTasks(fallback);
  }

  if (name === 'dsh_create_task') {
    if (!s.dshEnabled) return 'DSH 接入未开启';
    const title = String(a.title || '').trim();
    if (!title) return '缺少 title';
    try {
      const dir = String(s.dshWorkspacePath || 'E:\\tools\\deepseek\\data').trim();
      const constraint = s.dshConstrain ? `【工作区约束】只允许在 ${dir} 内读写文件与执行操作；不要修改该目录以外的任何文件、配置或系统设置。` : '';
      const state = await dshapi.createTask({ title, description: String(a.description || ''), prompt: String(a.prompt || ''), workspaceId: s.dshWorkspaceId || await dshapi.defaultWorkspaceId(), constraint });
      return state ? `已加到 DSH 看板：${title}` : 'DSH 服务没找到，任务没建成';
    } catch (e) {
      return '建任务失败：' + e.message;
    }
  }

  if (name === 'dsh_run_task') {
    if (!s.dshEnabled) return 'DSH 接入未开启';
    const key = String(a.task_id || '').trim();
    if (!key) return '缺少 task_id';
    try {
      const state = await dshapi.getState();
      const task = (state && state.tasks || []).find((x) => x.id === key || String(x.title || '').includes(key));
      if (!task) return '没找到这条任务';
      await dshapi.runTask(task.id);
      return `已开始执行：${task.title}`;
    } catch (e) {
      return '启动失败：' + e.message;
    }
  }

  if (name === 'dsh_run') {
    if (!s.dshEnabled) return 'DSH 接入未开启';
    if (!s.allowDshRun) return '主人没有开启「交给 DSH 执行」权限';
    const goal = String(a.goal || '').trim();
    if (!goal) return '缺少 goal';
    const r = await toolbox.runDshTask(goal, {
      cli: s.dshCli, profile: s.dshProfile, workdir: s.dshWorkdir,
      timeoutSec: Math.max(30, Number(s.dshTimeout) || 300), apiKey: s.apiKey
    });
    return r.ok ? clip(r.output, 3000) : `DSH 执行失败：${r.error}`;
  }

  if (name === 'run_shell') {
    if (!s.allowShell) return '主人没有开启「执行命令」权限';
    const cmd = String(a.cmd || '').trim();
    if (!cmd) return '缺少 cmd';
    if (DANGEROUS.test(cmd)) return '这条命令看起来会破坏系统，我拒绝执行。';
    const cwd = a.cwd ? String(a.cwd) : os.homedir();
    if (!insideRoots(s, cwd)) return `工作目录不在允许范围内：${cwd}`;
    const out = await runShell(cmd, cwd, timeoutMs);
    return clip(`$ ${cmd}\n${out}`);
  }

  if (name === 'list_dir') {
    if (!s.allowFileWrite) return '主人没有开启「读写文件」权限';
    const p = String(a.path || os.homedir());
    if (!insideRoots(s, p)) return `路径不在允许范围内：${p}`;
    try {
      const items = fs.readdirSync(p, { withFileTypes: true }).slice(0, 100);
      return items.map((d) => `${d.isDirectory() ? '[dir]' : '     '} ${d.name}`).join('\n') || '（空目录）';
    } catch (e) {
      return `读取目录失败：${e.message}`;
    }
  }

  if (name === 'read_file') {
    if (!s.allowFileWrite) return '主人没有开启「读写文件」权限';
    const p = String(a.path || '');
    if (!insideRoots(s, p)) return `路径不在允许范围内：${p}`;
    try {
      return clip(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      return `读取失败：${e.message}`;
    }
  }

  if (name === 'write_file') {
    if (!s.allowFileWrite) return '主人没有开启「读写文件」权限';
    const p = String(a.path || '');
    if (!insideRoots(s, p)) return `路径不在允许范围内：${p}`;
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, String(a.content == null ? '' : a.content), 'utf8');
      return `已写入 ${p}`;
    } catch (e) {
      return `写入失败：${e.message}`;
    }
  }

  if (name === 'api_balance') {
    const key = String(s.apiKey || '').trim() || readPetKey();
    if (!key) return '没有可用的 API Key，查不了余额';
    try {
      const b = await brain.fetchBalance(key, s.apiEndpoint || 'https://api.deepseek.com');
      return b ? `余额 ${b.display}` : '余额接口没有返回数据';
    } catch (e) {
      return '查询余额失败：' + e.message;
    }
  }

  if (name === 'web_search') {
    if (!s.webSearch) return '联网未开启';
    const results = await brain.webSearch(String(a.query || ''), Number(a.limit) || 3);
    if (!results.length) return '没搜到结果（或网络不通）';
    return results.map((r, i) => `${i + 1}. ${r.title}：${r.snippet}`).join('\n');
  }

  if (name === 'fetch_url') {
    if (!s.webSearch) return '联网未开启';
    const page = await brain.fetchPage(String(a.url || ''));
    if (!page) return '抓取失败';
    return clip(`标题：${page.title}\n${page.text}`);
  }

  return `未知工具：${name}`;
}

module.exports = { definitionsFor, execute, rootsOf };
