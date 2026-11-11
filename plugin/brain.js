/**
 * qq-bridge 的能力层：预算、记忆、原话检索、去重、联网。
 * 只依赖 node 内置模块，随插件一起打包。
 */
const https = require('node:https');
const http = require('node:http');
const zlib = require('node:zlib');
const { URL } = require('node:url');

/** 粗略 token 估算：中文按 1 字 1 token，其它按 4 字符 1 token */
function estimateTokens(text) {
  const s = String(text || '');
  const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
  return Math.ceil(cjk + (s.length - cjk) / 4);
}

function normalize(text) {
  return String(text || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

function trigrams(text) {
  const set = new Set();
  const t = normalize(text);
  for (let i = 0; i + 3 <= t.length; i += 1) set.add(t.slice(i, i + 3));
  return set;
}

/** 0-1 的字符三元组相似度，用来发现复读 */
function similarity(a, b) {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function keywords(text) {
  const words = String(text || '').match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z]{2,}/g) || [];
  return Array.from(new Set(words)).slice(0, 12);
}

function bigrams(text) {
  const t = normalize(text);
  const set = new Set();
  for (let i = 0; i + 2 <= t.length; i += 1) set.add(t.slice(i, i + 2));
  return set;
}

/** 原话检索：关键词命中最重，再按字符二元组重叠补分 */
function retrieveQuotes(quotes, text, limit = 3) {
  const words = keywords(text);
  const grams = bigrams(text);
  if (!words.length && !grams.size) return [];
  const scored = [];
  for (const q of quotes || []) {
    const body = String(q.text || '');
    let score = 0;
    for (const w of words) if (body.includes(w)) score += w.length * 2;
    for (const g of grams) if (body.includes(g)) score += 1;
    if (score > 0) scored.push({ score, text: body });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.text);
}

// ============================================================================
// 联网查询（Bing 网页版，无需 Key）
// ============================================================================

function httpGet(urlStr, timeout = 8000, redirects = 3) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch (e) { reject(e); return; }
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.get({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: 'text/html,application/xhtml+xml'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        resolve(httpGet(next, timeout, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      const stream = enc.includes('gzip') ? res.pipe(zlib.createGunzip())
        : enc.includes('deflate') ? res.pipe(zlib.createInflate())
          : res;
      let data = '';
      stream.on('data', (c) => {
        data += c.toString('utf8');
        if (data.length > 600000) { req.destroy(); resolve(data); }
      });
      stream.on('end', () => resolve(data));
      stream.on('error', reject);
    });
    req.setTimeout(timeout, () => req.destroy(new Error('搜索超时')));
    req.on('error', reject);
  });
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x?[0-9a-f]+;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 联网搜索，返回 [{title, snippet}]；失败返回空数组 */
async function webSearch(query, max = 3) {
  const q = String(query || '').trim();
  if (!q) return [];
  let html = '';
  try {
    html = await httpGet(`https://cn.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-CN`, 8000);
  } catch (e) {
    return [];
  }
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) || [];
  const out = [];
  for (const block of blocks) {
    const t = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const title = t ? stripHtml(t[1]) : '';
    const snippet = p ? stripHtml(p[1]) : '';
    if (title || snippet) out.push({ title: title.slice(0, 80), snippet: snippet.slice(0, 240) });
    if (out.length >= Math.min(5, Math.max(1, Number(max) || 3))) break;
  }
  return out;
}

/** 这句话看起来需不需要查网 */
function needsWeb(text) {
  const s = String(text || '');
  if (!s) return false;
  if (/[?？]/.test(s)) return true;
  return /(查一下|搜一下|搜索|最新|新闻|今天|现在|价格|多少钱|是什么|为什么|怎么样|谁|哪|什么时候|天气)/.test(s);
}


/** 抓取网页正文摘要，用于「看看这个链接」 */
async function fetchPage(url) {
  try {
    const html = await httpGet(url, 8000);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]).slice(0, 80) : '';
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { title, text: stripHtml(body).slice(0, 600) };
  } catch (e) {
    return null;
  }
}


/** 查询 DeepSeek 余额 */
async function fetchBalance(apiKey, endpoint) {
  if (!apiKey) return null;
  let base = String(endpoint || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
  base = base.replace(/\/v1$/, '');
  const url = `${base}/user/balance`;
  const text = await new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c.toString('utf8'); });
      res.on('end', () => resolve(body));
    });
    req.setTimeout(8000, () => req.destroy(new Error('余额查询超时')));
    req.on('error', reject);
  });
  const data = JSON.parse(text);
  const info = (data.balance_infos || [])[0];
  if (!info) return null;
  const symbol = info.currency === 'CNY' ? '¥' : `${info.currency} `;
  return { amount: info.total_balance, currency: info.currency, display: `${symbol}${info.total_balance}` };
}

module.exports = {
  estimateTokens,
  similarity,
  keywords,
  retrieveQuotes,
  webSearch,
  needsWeb,
  fetchPage,
  fetchBalance,
  stripHtml
};
