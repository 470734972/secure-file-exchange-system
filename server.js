const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT_OFFICE = Number(process.env.OFFICE_PORT || 8080);
const PORT_RD = Number(process.env.RD_PORT || 8081);
const APP_PORT = Number(process.env.PORT || 8080);
const OFFICE_IP = process.env.OFFICE_IP || '';
const RD_IP = process.env.RD_IP || '';
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const RELEASE_DIR = path.join(DATA_DIR, 'released');
const DB_PATH = path.join(DATA_DIR, 'tasks.json');
const AUDIT_PATH = path.join(DATA_DIR, 'audit.jsonl');
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.txt', '.pdf', '.csv', '.png', '.jpg', '.jpeg']);

for (const folder of [DATA_DIR, UPLOAD_DIR, RELEASE_DIR]) fs.mkdirSync(folder, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, '[]\n', 'utf8');

function readTasks() { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
function saveTasks(tasks) { fs.writeFileSync(DB_PATH, JSON.stringify(tasks, null, 2), 'utf8'); }
function audit(event, detail) {
  fs.appendFileSync(AUDIT_PATH, JSON.stringify({ at: new Date().toISOString(), event, ...detail }) + '\n', 'utf8');
}
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function zoneFor(req, fixedZone) {
  if (fixedZone) return fixedZone; // 本机演示由独立端口固定区域
  const localIp = String(req.socket.localAddress || '').replace('::ffff:', '');
  if (OFFICE_IP && localIp === OFFICE_IP) return 'office';
  if (RD_IP && localIp === RD_IP) return 'rd';
  return null;
}
function label(zone) { return zone === 'office' ? '办公网' : '研发网'; }
function cleanName(name) { return path.basename(String(name || 'file')).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 120); }
function requestBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0; const chunks = [];
    req.on('data', c => { total += c.length; if (total > MAX_BYTES + 1024 * 1024) { reject(new Error('文件超过 10 MB 限制')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function parseMultipart(body, contentType) {
  const hit = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '');
  if (!hit) throw new Error('请求格式错误');
  const boundary = Buffer.from(`--${hit[1] || hit[2]}`);
  const fields = {}; let file = null; let cursor = 0;
  while (true) {
    const begin = body.indexOf(boundary, cursor); if (begin < 0) break;
    const start = begin + boundary.length;
    if (body.subarray(start, start + 2).equals(Buffer.from('--'))) break;
    const headerStart = start + 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), headerStart); if (headerEnd < 0) break;
    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    const next = body.indexOf(boundary, headerEnd + 4); if (next < 0) break;
    const value = body.subarray(headerEnd + 4, next - 2);
    const name = /name="([^"]+)"/i.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
    if (filename !== undefined && name === 'file') file = { name: cleanName(filename), bytes: value };
    else if (name) fields[name] = value.toString('utf8').slice(0, 300);
    cursor = next;
  }
  return { fields, file };
}
function taskView(task, zone) {
  const outgoing = task.sourceZone === zone;
  return { ...task, direction: outgoing ? 'outgoing' : 'incoming', canApprove: outgoing && task.status === 'pending_approval', canDownload: task.targetZone === zone && task.status === 'released' };
}
function handleApi(req, res, zone, url) {
  if (req.method === 'GET' && url.pathname === '/api/context') return json(res, 200, { zone, zoneLabel: label(zone), entry: req.socket.localAddress, demo: true });
  if (req.method === 'GET' && url.pathname === '/api/tasks') {
    const tasks = readTasks().filter(t => t.sourceZone === zone || t.targetZone === zone).map(t => taskView(t, zone));
    return json(res, 200, { tasks: tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  }
  if (req.method === 'GET' && url.pathname === '/api/audit') {
    const lines = fs.existsSync(AUDIT_PATH) ? fs.readFileSync(AUDIT_PATH, 'utf8').trim().split('\n').filter(Boolean).slice(-80).map(JSON.parse) : [];
    return json(res, 200, { events: lines.filter(e => e.sourceZone === zone || e.targetZone === zone || !e.sourceZone).reverse() });
  }
  if (req.method === 'POST' && url.pathname === '/api/tasks') return requestBody(req).then(body => {
    const { fields, file } = parseMultipart(body, req.headers['content-type']);
    if (!file || !file.bytes.length) throw new Error('请选择一个文件');
    if (file.bytes.length > MAX_BYTES) throw new Error('文件超过 10 MB 限制');
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error(`不允许 ${ext || '无扩展名'} 文件；Demo 仅允许 ${[...ALLOWED_EXTENSIONS].join('、')}`);
    const targetZone = zone === 'office' ? 'rd' : 'office';
    const textSample = file.bytes.subarray(0, 1024 * 512).toString('utf8');
    if (/(SECRET|AKIA[0-9A-Z]{16}|BEGIN (RSA |OPENSSH )?PRIVATE KEY)/i.test(textSample)) throw new Error('模拟 DLP 已阻断：检测到敏感标识或密钥特征');
    const id = `FX-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const physical = `${crypto.randomUUID()}${ext}`;
    const sha256 = crypto.createHash('sha256').update(file.bytes).digest('hex');
    fs.writeFileSync(path.join(UPLOAD_DIR, physical), file.bytes, { mode: 0o600 });
    const task = { id, originalName: file.name, physical, size: file.bytes.length, sha256, sourceZone: zone, targetZone, recipient: cleanName(fields.recipient || '目标区接收人'), purpose: cleanName(fields.purpose || '未填写用途'), sensitivity: fields.sensitivity || '内部', status: 'pending_approval', createdAt: new Date().toISOString(), approvedAt: null, downloadedAt: null };
    const tasks = readTasks(); tasks.push(task); saveTasks(tasks);
    audit('submitted_and_scanned', task); json(res, 201, { task: taskView(task, zone), message: '文件已通过模拟基础检测，等待安全审批。' });
  }).catch(err => json(res, 400, { error: err.message }));
  const approval = /^\/api\/tasks\/([^/]+)\/(approve|reject)$/.exec(url.pathname);
  if (req.method === 'POST' && approval) {
    const [ , id, action ] = approval; const tasks = readTasks(); const task = tasks.find(t => t.id === id);
    if (!task || task.sourceZone !== zone || task.status !== 'pending_approval') return json(res, 404, { error: '未找到可处理的申请单' });
    task.status = action === 'approve' ? 'released' : 'rejected'; task.approvedAt = new Date().toISOString(); task.approvalBy = `${label(zone)}安全审批（演示）`;
    if (action === 'approve') fs.copyFileSync(path.join(UPLOAD_DIR, task.physical), path.join(RELEASE_DIR, task.physical));
    saveTasks(tasks); audit(action === 'approve' ? 'approved_and_released' : 'rejected', task); return json(res, 200, { task: taskView(task, zone) });
  }
  const download = /^\/api\/tasks\/([^/]+)\/download$/.exec(url.pathname);
  if (req.method === 'GET' && download) {
    const task = readTasks().find(t => t.id === download[1]);
    if (!task || task.targetZone !== zone || task.status !== 'released') return json(res, 403, { error: '此安全区无权下载该文件' });
    const filePath = path.join(RELEASE_DIR, task.physical); if (!fs.existsSync(filePath)) return json(res, 404, { error: '交付文件不存在' });
    task.downloadedAt = new Date().toISOString(); const tasks = readTasks().map(t => t.id === task.id ? task : t); saveTasks(tasks); audit('downloaded', task);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${encodeURIComponent(task.originalName)}"`, 'content-length': fs.statSync(filePath).size }); return fs.createReadStream(filePath).pipe(res);
  }
  return json(res, 404, { error: '接口不存在' });
}
function app(fixedZone) { return (req, res) => {
  const zone = zoneFor(req, fixedZone); if (!zone) return json(res, 403, { error: '未知入口 IP，拒绝访问。请配置 OFFICE_IP 与 RD_IP。' });
  const url = new URL(req.url, 'http://local');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, zone, url);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return fs.createReadStream(path.join(__dirname, 'public', 'index.html')).pipe(res); }
  if (req.method === 'GET' && url.pathname === '/app.js') { res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' }); return fs.createReadStream(path.join(__dirname, 'public', 'app.js')).pipe(res); }
  if (req.method === 'GET' && url.pathname === '/style.css') { res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' }); return fs.createReadStream(path.join(__dirname, 'public', 'style.css')).pipe(res); }
  json(res, 404, { error: '页面不存在' });
}; }

if (OFFICE_IP || RD_IP) http.createServer(app()).listen(APP_PORT, '0.0.0.0', () => console.log(`Production-style mode listening on 0.0.0.0:${APP_PORT}; OFFICE_IP=${OFFICE_IP}; RD_IP=${RD_IP}`));
else {
  http.createServer(app('office')).listen(PORT_OFFICE, '127.0.0.1', () => console.log(`办公网入口: http://127.0.0.1:${PORT_OFFICE}`));
  http.createServer(app('rd')).listen(PORT_RD, '127.0.0.1', () => console.log(`研发网入口: http://127.0.0.1:${PORT_RD}`));
}
