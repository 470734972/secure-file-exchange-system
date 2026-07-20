let context;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const status = { pending_approval:'待安全审批', released:'已放行/已投递', rejected:'已拒绝' };
async function api(url, options) { const r = await fetch(url, options); const type = r.headers.get('content-type') || ''; const data = type.includes('application/json') ? await r.json() : null; if (!r.ok) throw new Error(data?.error || '请求失败'); return data; }
function fmt(bytes) { return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
async function refresh() {
  const [items, audit] = await Promise.all([api('/api/tasks'), api('/api/audit')]);
  const rows = items.tasks.map(t => `<div class="task"><div><b>${esc(t.originalName)}</b><p>${esc(t.id)} · ${esc(t.recipient)} · ${fmt(t.size)}</p><p class="hash">SHA-256 ${esc(t.sha256.slice(0,20))}…</p></div><div class="meta"><span class="pill ${t.status}">${status[t.status]}</span><small>${t.sourceZone === 'office' ? '办公网' : '研发网'} → ${t.targetZone === 'office' ? '办公网' : '研发网'}</small></div><div class="actions">${t.canApprove ? `<button data-id="${esc(t.id)}" data-action="approve">模拟批准并投递</button><button class="danger" data-id="${esc(t.id)}" data-action="reject">拒绝</button>` : ''}${t.canDownload ? `<a class="download" href="/api/tasks/${encodeURIComponent(t.id)}/download">下载文件</a>` : ''}</div></div>`).join('') || '<p class="muted empty">当前安全区还没有可见的交换任务。</p>';
  document.querySelector('#tasks').innerHTML = rows;
  document.querySelector('#audit').innerHTML = audit.events.map(e => `<p><time>${new Date(e.at).toLocaleString()}</time> <b>${esc(e.event)}</b> ${esc(e.id || '')} ${esc(e.originalName || '')}</p>`).join('') || '<p class="muted">暂无审计记录。</p>';
}
async function init() {
  context = await api('/api/context'); document.body.dataset.zone = context.zone;
  document.querySelector('#zoneBadge').textContent = `当前区域：${context.zoneLabel}`;
  document.querySelector('#source').textContent = context.zoneLabel;
  document.querySelector('#target').textContent = context.zone === 'office' ? '研发网收件箱' : '办公网收件箱';
  await refresh();
}
document.querySelector('#uploadForm').addEventListener('submit', async e => { e.preventDefault(); const output = document.querySelector('#formMessage'); output.textContent = '正在提交并执行模拟检测…'; try { const data = await api('/api/tasks', { method:'POST', body:new FormData(e.currentTarget) }); output.textContent = data.message; e.currentTarget.reset(); await refresh(); } catch (err) { output.textContent = `未受理：${err.message}`; } });
document.querySelector('#refresh').onclick = refresh;
document.querySelector('#tasks').addEventListener('click', async e => { const b = e.target.closest('button[data-id]'); if (!b) return; try { await api(`/api/tasks/${encodeURIComponent(b.dataset.id)}/${b.dataset.action}`, { method:'POST' }); await refresh(); } catch (err) { alert(err.message); } });
init().catch(err => { document.body.innerHTML = `<main><h1>启动失败</h1><p>${esc(err.message)}</p></main>`; });
