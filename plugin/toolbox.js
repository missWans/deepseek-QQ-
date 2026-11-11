/**
 * 工作助手：DSH 任务板读取、DSH headless 执行、命令解析。
 * 只依赖 node 内置模块。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DESKTOP_DSH = 'E:\\tools\\deepseek\\resources\\runtime\\cli\\bin\\dsh.cmd';

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function boardPath(override) {
  const custom = String(override || '').trim();
  return custom || path.join(dshHome(), 'task-board', 'ledger-v2.json');
}

/** 读取 DSH 任务板（只读）。读不到就返回空数组。 */
function readBoardTasks(override) {
  try {
    const raw = fs.readFileSync(boardPath(override), 'utf8');
    const data = JSON.parse(raw);
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    // 归档任务不算在看板里
    return tasks.filter((t) => !t.archivedAt);
  } catch (e) {
    return [];
  }
}

function resolveCli(custom) {
  const c = String(custom || '').trim();
  if (c && fs.existsSync(c)) return c;
  if (fs.existsSync(DESKTOP_DSH)) return DESKTOP_DSH;
  return 'dsh';
}

/**
 * 把一段目标交给 DSH headless 执行，返回文本结果。
 * @param {string} goal 任务描述
 * @param {object} opts { cli, profile, workdir, timeoutSec, apiKey }
 */
function runDshTask(goal, opts = {}) {
  const cli = resolveCli(opts.cli);
  const profile = String(opts.profile || 'headless').trim() || 'headless';
  const cwd = String(opts.workdir || '').trim() || os.homedir();
  const timeoutMs = Math.max(30, Number(opts.timeoutSec) || 300) * 1000;
  const env = Object.assign({}, process.env);
  if (opts.apiKey) env.DEEPSEEK_API_KEY = String(opts.apiKey);

  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const child = spawn(cli, ['--profile', profile, 'headless', goal], {
      cwd,
      env,
      windowsHide: true,
      shell: process.platform === 'win32'
    });

    const finish = (result) => {
      if (done) return;
      done = true;
      try { child.kill(); } catch (e) { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: `执行超时（${Math.round(timeoutMs / 1000)} 秒）`, output: out.trim() });
    }, timeoutMs);

    child.stdout.on('data', (c) => { out += c.toString('utf8'); });
    child.stderr.on('data', (c) => { err += c.toString('utf8'); });
    child.on('error', (e) => {
      clearTimeout(timer);
      finish({ ok: false, error: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = out.trim();
      if (code === 0 && text) finish({ ok: true, output: text });
      else if (code === 0) finish({ ok: false, error: 'DSH 没有返回内容', output: '' });
      else finish({ ok: false, error: (err || `退出码 ${code}`).trim().slice(0, 300), output: text });
    });
  });
}

/**
 * 解析 QQ 消息里的指令。
 * 支持 /任务、/任务 新增 X、/任务 完成 X、/dsh X、/状态
 * 以及「新建任务 X」这类自然说法。
 */
function parseCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const slash = raw.match(/^[\/／]([a-zA-Z\u4e00-\u9fa5]+)\s*([\s\S]*)$/);
  if (slash) {
    const cmd = slash[1].toLowerCase();
    const arg = slash[2].trim();
    if (['任务', 'task', 'tasks', '任务板'].includes(cmd)) {
      const sub = arg.match(/^(新增|添加|add)\s*([\s\S]*)$/i);
      if (sub) return { kind: 'add', arg: sub[2].trim() };
      const fin = arg.match(/^(完成|done|finish)\s*([\s\S]*)$/i);
      if (fin) return { kind: 'done', arg: fin[2].trim() };
      const run = arg.match(/^(跑|运行|执行|run|start)\s*([\s\S]*)$/i);
      if (run) return { kind: 'run', arg: run[2].trim() };
      return { kind: 'tasks', arg };
    }
    if (['dsh', '交给dsh', '交给DSH'.toLowerCase()].includes(cmd)) return { kind: 'dsh', arg };
    if (['状态', 'status'].includes(cmd)) return { kind: 'status', arg };
    if (['余额', 'balance', 'api'].includes(cmd)) return { kind: 'balance', arg };
    if (['新建', '新增', 'add'].includes(cmd)) return { kind: 'add', arg };
    if (['完成', 'done', 'finish'].includes(cmd)) return { kind: 'done', arg };
    if (['帮助', 'help', '?'].includes(cmd)) return { kind: 'help', arg };
    return { kind: 'unknown', arg: cmd };
  }

  const natural = raw.match(/^(新建|添加|记下|记一个|帮我记)\s*(一个)?任务[:：\s]+([\s\S]+)$/);
  if (natural) return { kind: 'add', arg: natural[3].trim() };

  const dsh = raw.match(/^交给\s*DSH[:：\s]+([\s\S]+)$/i);
  if (dsh) return { kind: 'dsh', arg: dsh[1].trim() };

  return null;
}

const STATUS_LABEL = {
  backlog: '待办箱', todo: '待办', running: '进行中', done: '已完成', failed: '失败', archived: '已归档'
};

function taskLine(t, index) {
  const status = STATUS_LABEL[t.status] || t.status;
  const title = String(t.title || t.id || '(无标题)').slice(0, 40);
  return `${index + 1}. [${status}] ${title}`;
}

module.exports = { readBoardTasks, runDshTask, parseCommand, resolveCli, boardPath, STATUS_LABEL, taskLine };
