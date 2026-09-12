'use strict';
const {STAFF,RULES,calc,r2,y,sig}=Payroll;
/* ===================== 界面 ===================== */
const FIELDS = {
  manager:  [["acd","A/C/D 类业绩",1],["b","B 类业绩",1],["adj","其他增减",1]],
  sales:    [["acd","A/C/D 类业绩",1],["b","B 类业绩",1],["adj","其他增减",1]],
  finance:  [["adj","其他增减",1]],
  delivery: [["trips","送货趟数",0],["adj","其他增减",1]]
};
const RULETEXT = {
  manager:  "底薪 8,000　总店满 60 万提千分之一　个人满 15 万起提（15 万档 1% / 0.5%，20 万档 2% / 1%）　每月 2 天正常休息，可累计；超过可休额度按 8,000 ÷ 当月天数扣",
  sales:    "底薪 4,500　个人满 15 万起提（15 万档 1% / 0.5%，20 万档 2% / 1%）　每月 2 天正常休息，可累计；超过可休额度先扣全勤 500，再按 4,000 ÷ 当月天数扣",
  finance:  "底薪 6,800　总店满 40 万每 10 万奖 100，满 60 万翻倍为 200（70 万 = 1,400）　每月 2 天正常休息，可累计；超过可休额度先扣全勤 100，再按 6,700 ÷ 当月天数扣",
  delivery: "底薪 5,800　每趟 15 元　总店满 40 万每 10 万奖 100，满 60 万翻倍为 200　每月 2 天正常休息，可累计；超过可休额度先扣全勤 100，再按 5,700 ÷ 当月天数扣"
};

const monthLabel = ym => `${ym.slice(0,4)} 年 ${+ym.slice(5)} 月`;
const fileMonth = ym => ym.replace('-', '');
const now = new Date();
const thisMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
let repo = null, loadError = null, pendingSave = false;
try { repo = new Ledger.Repository(localStorage); } catch(e) { loadError=e.message; }
let currentMonth = repo?.book.startMonth ? (Object.keys(repo.book.months).filter(m=>m>=repo.book.startMonth).sort().at(-1) || repo.book.startMonth) : (Object.keys(repo?.book.months||{}).sort().at(-1) || thisMonth);
document.getElementById('month').value=currentMonth;
const escapeHTML = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* ---- 建页 ---- */
const PAGES = [{ id:"store", label:"总店" }]
  .concat(STAFF.map(e => ({ id:e.id, label:e.name, emp:e })))
  .concat([{ id:"sum", label:"汇总" }]);

document.getElementById("tabs").innerHTML =
  PAGES.map((p,i) => `<button class="tab${i===0?" on":""}" data-i="${i}" type="button">${p.label}</button>`).join("");

document.getElementById("deck").innerHTML = PAGES.map(p => {
  if (p.id === "store") return `
    <section class="slide">
      <h2>本月总数</h2>
      <p class="rule">总店业绩决定：店长的总店提成（满 60 万）、财务与配送的业绩奖金（满 40 万）。<br>当月天数由上方月份自动带出，是请假扣款的分母。</p>
      <div class="fields">
        <div class="f" style="grid-column:1/-1">
          <label for="storePerf">本月总店业绩（元）</label>
          <input type="number" id="storePerf" min="0" step="0.01" placeholder="0"
                 inputmode="numeric" enterkeyhint="done">
        </div>
      </div>
      <div class="lines" id="storeLines"></div>
      <div class="total">
        <div class="lab">全店工资合计</div>
        <div class="amt" id="storeGrand">¥0</div>
      </div>
      <p class="hint">左右滑动查看每个人 →</p>
    </section>`;

  if (p.id === "sum") return `
    <section class="slide">
      <h2>本月汇总</h2>
      <p class="rule">扣减 = 请假扣款 + 其他增减。每个人的明细在各自那一页。</p>
      <div class="summary-table"><table>
        <thead><tr><th>姓名</th><th>底薪</th><th>提成/奖金</th><th>扣减</th><th>实发</th></tr></thead>
        <tbody id="sumBody"></tbody>
        <tfoot><tr><td>合计</td><td></td><td></td><td></td><td id="sumAll">¥0</td></tr></tfoot>
      </table></div>
      <div class="acts" style="margin-top:auto">
        <button class="b-ghost" onclick="copyAll()">复制全部</button>
        <button class="b-ghost" onclick="printAll()">打印</button>
        <button class="b-ghost" onclick="resetAll()">清空本月草稿</button>
      </div>
      <p class="hint" style="margin-top:14px">
        <a href="rent.html" style="color:var(--gold);text-decoration:none">房租看板 →</a>
      </p>
    </section>`;

  const e = p.emp;
  return `
    <section class="slide">
      <div class="role">${e.role}</div>
      <h2>${e.name}</h2>
      <p class="rule">${RULETEXT[e.type]}</p>
      <div class="fields">
        ${FIELDS[e.type].map(([k,l,money]) => `
          <div class="f">
            <label for="input-${e.id}-${k}">${l}${money?"（元）":""}</label>
            <!-- 其他增减要能填负数，故意不设 inputmode：
                 iOS 上一旦设成 numeric 就是纯数字小键盘，打不出减号 -->
            <input id="input-${e.id}-${k}" type="number" step="${money?0.01:1}" ${k==="leave"?'min="0"':""}
                   ${k==="adj" ? "" : 'inputmode="numeric" min="0"'}
                   data-emp="${e.id}" data-k="${k}" placeholder="0"
                   enterkeyhint="done">
          </div>`).join("")}
      </div>
      <div class="leave-panel">
        <h3>本月休息</h3>
        <div id="leave-${e.id}" class="leave-grid"></div>
        <div class="f leave-input"><label for="input-${e.id}-leave">本月实际休息（天）</label>
          <input id="input-${e.id}-leave" type="number" min="0" step="0.5" inputmode="decimal" data-emp="${e.id}" data-k="leave" placeholder="请填写，没有请填 0">
        </div>
        <div class="record-state" id="state-${e.id}" aria-live="polite"></div>
        <button class="history-button" type="button" onclick="showHistory('${e.id}')">查看确认记录</button>
      </div>
      <div class="lines" id="out-${e.id}"></div>
      <div class="total">
        <div class="lab">实发</div>
        <div class="amt" id="tot-${e.id}">¥0</div>
      </div>
      <div class="acts">
        <button class="b-gold" onclick="saveImage('${e.id}')">存为图片</button>
        <button class="b-pink" onclick="saveWord('${e.id}')">存为 Word</button>
      </div>
    </section>`;
}).join("");

/* ---- 滑动与导航联动 ---- */
const deck = document.getElementById("deck");
const tabEls = [...document.querySelectorAll(".tab")];
function goTo(i){
  const target = deck.clientWidth * i;
  deck.scrollTo({ left: target, behavior:"smooth" });
  // 有些设备/系统会忽略平滑滚动，兜底直接跳过去
  setTimeout(() => {
    if (Math.abs(deck.scrollLeft - target) > 4) deck.scrollTo({ left: target });
  }, 320);
}
tabEls.forEach(t => t.onclick = () => goTo(+t.dataset.i));
// 用 IntersectionObserver 跟踪当前页，比 scroll 事件可靠
const slideEls = [...deck.querySelectorAll(".slide")];
let currentPage = 0;
function markPage(i){
  if (i === currentPage) return;
  currentPage = i;
  tabEls.forEach((t,j) => t.classList.toggle("on", j === i));
  const on = tabEls[i];
  if (!on) return;
  const bar = on.parentElement.parentElement;                 // nav
  const want = bar.scrollLeft + on.getBoundingClientRect().left
             - bar.getBoundingClientRect().left - (bar.clientWidth - on.offsetWidth) / 2;
  bar.scrollTo({ left: want, behavior:"smooth" });
  setTimeout(() => {
    if (Math.abs(bar.scrollLeft - want) > 4) bar.scrollTo({ left: want });
  }, 320);
}
const io = new IntersectionObserver(entries => {
  entries.forEach(en => {
    if (en.isIntersecting && en.intersectionRatio > .55)
      markPage(slideEls.indexOf(en.target));
  });
}, { root: deck, threshold: [.56, .9] });
slideEls.forEach(s => io.observe(s));


let dialogAction = null, dialogContext = null;
const dialog = document.getElementById('actionDialog');
function notice(message,error=false){
  const n=document.getElementById('saveNotice'); n.hidden=!message; n.classList.toggle('error',error); n.textContent=message;
}
function showDialog(title,html,label,action){
  document.getElementById('dialogTitle').textContent=title;
  document.getElementById('dialogContent').innerHTML=html;
  document.getElementById('dialogError').textContent='';
  const confirm=document.getElementById('dialogConfirm'); confirm.textContent=label; confirm.hidden=!action; confirm.disabled=false;
  dialogAction=action; dialogContext=null;
  if(!dialog.open) dialog.showModal();
}
function closeDialog(){ dialog.close(); dialogAction=null; dialogContext=null; }
document.getElementById('dialogConfirm').onclick=async()=>{
  if(!dialogAction) return;
  const button=document.getElementById('dialogConfirm'); button.disabled=true;
  try { await dialogAction(); } catch(e){ document.getElementById('dialogError').textContent=e.message; }
  finally{ button.disabled=false; }
};
function requireRepo(){ if(!repo) throw new Error('账本读取失败，请先通过备份与恢复处理原数据'); }
function openSetup(){
  if(!repo){openBackup();return;}
  if(repo.book.startMonth){
    showDialog('休假账本',`<p>从 ${monthLabel(repo.book.startMonth)} 开始记账。所有员工每月 2 天正常休息，余额跨年保留。</p><p>初始余额：</p>${STAFF.map(e=>`<div class="ln"><span>${e.name}</span><strong>${repo.book.opening[e.id]} 天</strong></div>`).join('')}<p>按员工、按月份确认；如需修正，请打开对应月份核对。</p>`,'',null); return;
  }
  showDialog('启用休假账本',`<p>所有员工每月 2 天正常休息，没休完继续累计。填写启用月份之前已攒下的天数，没有请填 0。</p><label for="setupMonth">开始记账的月份</label><input type="month" id="setupMonth" value="${currentMonth}"><div class="fields">${STAFF.map(e=>`<div class="f"><label for="opening-${e.id}">${e.name} · 初始剩余（天）</label><input id="opening-${e.id}" type="number" min="0" step="0.5" inputmode="decimal" placeholder="没有请填 0"></div>`).join('')}</div><button class="history-button" type="button" onclick="document.querySelectorAll('[id^=opening-]').forEach(i=>i.value='0')">所有人均无结余，全部填 0</button><p>已有工资输入会保留为原月份草稿。启用后，店长也享有每月 2 天休息，请重新核对金额。</p>`,'启用并保存',()=>{
    const ym=document.getElementById('setupMonth').value;
    const balances=Object.fromEntries(STAFF.map(e=>[e.id,document.getElementById('opening-'+e.id).value]));
    repo.commit(b=>Ledger.setup(b,ym,balances));
    currentMonth=ym; document.getElementById('month').value=ym;
    closeDialog(); hydrate(); notice('休假账本已启用，初始余额已保存');
  });
}
function hydrate(){
  const m=repo?.book.months[currentMonth];
  document.getElementById('storePerf').value=m?.storePerf ?? '';
  document.querySelectorAll('input[data-emp]').forEach(i=>i.value=m?.employees[i.dataset.emp]?.input[i.dataset.k] ?? '');
  const disabled=!repo?.book.startMonth || currentMonth<repo.book.startMonth;
  document.querySelectorAll('#deck input').forEach(i=>i.disabled=disabled);
  document.getElementById('setupButton').textContent=repo?.book.startMonth?'休假账本 · 每月 2 天':'启用休假账本';
  render();
}
function persistForm(){
  requireRepo();
  if(!repo.book.startMonth || currentMonth<repo.book.startMonth) return;
  const changes=[];
  const current=repo.book.months[currentMonth];
  const perf=document.getElementById('storePerf').value;
  if(perf!==(current?.storePerf ?? '')) changes.push([null,'storePerf',perf]);
  document.querySelectorAll('input[data-emp]').forEach(i=>{
    if(i.value!==(current?.employees[i.dataset.emp]?.input[i.dataset.k] ?? '')) changes.push([i.dataset.emp,i.dataset.k,i.value]);
  });
  if(!changes.length){ pendingSave=false; return; }
  let affected=[];
  try {
    repo.commit(b=>{for(const c of changes) affected.push(...Ledger.edit(b,currentMonth,...c));});
    pendingSave=false;
    notice(affected.length ? `草稿已保存；${[...new Set(affected)].sort().join('、')} 的相关确认记录需重新核对，旧版本仍保留。` : '草稿已保存在本机');
  } catch(e){ pendingSave=true; document.querySelectorAll('.record-state').forEach(el=>el.textContent='输入尚未保存 · 请先备份并重试'); notice(e.message,true); throw e; }
}
function changeMonth(ym){
  if(!Ledger.ymOK(ym)){ document.getElementById('month').value=currentMonth; return; }
  try{ persistForm(); currentMonth=ym; document.getElementById('month').value=ym; hydrate(); }
  catch(e){document.getElementById('month').value=currentMonth;notice(e.message,true);}
}
const lineHTML=([text,value,cls])=>`<div class="ln ${value===null?'note':''} ${escapeHTML(cls||'')}"><span class="t">${escapeHTML(text)}</span><span class="v ${value<0?'neg':''}">${value===null?'':sig(value)}</span></div>`;
function render(){
  document.getElementById('daysTip').textContent='本月 '+Ledger.monthDays(currentMonth)+' 天';
  let grand=0,complete=true,rows='';
  for(const emp of STAFF){
    const d=repo?Ledger.derive(repo.book,emp.id,currentMonth):{issue:loadError,record:{status:'draft'}};
    const l=d.leave, day=n=>n===null || n===undefined?'—':n+' 天';
    document.getElementById('leave-'+emp.id).innerHTML=[['上月结余',l?.opening],['本月新增',l?.added],['本月合计可休',l?.available],['超出额度',l?.over],['结转下月',l?.closing]].map(([label,n],i)=>`<div class="${i===4?'closing':''}"><span>${label}</span><strong>${day(n)}</strong></div>`).join('');
    const state=d.record.status==='confirmed'?'已确认 · 可重复导出':d.record.status==='review'?'待核对 · 修改后需重新确认':'草稿 · 尚未确认';
    const problem=d.issue||d.blocked;
    const missing=problem?.match(/\d{4}-\d{2}/)?.[0];
    document.getElementById('state-'+emp.id).innerHTML=escapeHTML(state+(problem?' · '+problem:''))+(missing?` <button type="button" onclick="changeMonth('${missing}')">前往 ${missing}</button>`:'');
    const r=d.payroll;
    document.getElementById('out-'+emp.id).innerHTML=r?r.lines.map(lineHTML).join(''):'';
    document.getElementById('tot-'+emp.id).textContent=r?y(r.total):'—';
    const actual=document.getElementById('input-'+emp.id+'-leave'); actual.max=Ledger.monthDays(currentMonth);
    if(r) grand+=r.total; else complete=false;
    rows+=`<tr><td>${emp.name}<small class="summary-state">${d.record.status==='confirmed'?'已确认':d.record.status==='review'?'待核对':'草稿'}</small></td><td>${r?y(r.base):'—'}</td><td>${r?y(r.extra):'—'}</td><td>${r?sig(r.adj-r.deduct):'—'}</td><td>${r?y(r.total):'—'}</td></tr>`;
  }
  document.getElementById('storeGrand').textContent=complete?y(grand):'待完成录入';
  document.getElementById('storeGrand').classList.toggle('incomplete',!complete);
  document.getElementById('sumAll').textContent=complete?y(grand):'待完成录入';
  document.getElementById('sumBody').innerHTML=rows;
  document.getElementById('storeLines').innerHTML='<div class="ln note"><span class="t">总店业绩按月份保存。修改后，已确认的相关工资需重新核对。</span></div>';
}
function requestExport(id,type){
  try{
    if([...document.querySelectorAll(`input[data-emp="${id}"],#storePerf`)].some(i=>i.validity.badInput))throw new Error('请完成数值输入后再生成工资单');
    persistForm(); render();
    const d=Ledger.derive(repo.book,id,currentMonth);
    if(d.issue || d.blocked) throw new Error(d.issue||d.blocked);
    const run=()=>{if(type==='image')exportImage(id);else exportWord(id);};
    if(d.record.status==='confirmed'){ run(); return; }
    const emp=STAFF.find(e=>e.id===id),ym=currentMonth,l=d.leave;
    showDialog('核对本月工资',`<p>${emp.name} · ${monthLabel(ym)}</p><div class="ln"><span>实发工资</span><strong>${y(d.payroll.total)}</strong></div>${[['上月结余',l.opening],['本月正常休息',l.added],['本月实际休息',l.used],['超出额度',l.over],['结转下月',l.closing]].map(([k,v])=>`<div class="ln"><span>${k}</span><strong>${v} 天</strong></div>`).join('')}<p>确认后保存本月记录。之后可以补存图片或 Word，不会重复结转。此操作不代表工资已支付或工资单已发送。</p>`,'确认并生成',()=>{
      repo.commit(b=>Ledger.confirmRecord(b,id,ym)); closeDialog();render();notice('本月记录已确认，休假结余已保存');
      try{run();}catch(e){notice('导出失败，已确认记录仍保留，可重试：'+e.message,true);}
    });
  }catch(e){notice(e.message,true);}
}
function saveImage(id){requestExport(id,'image');}
function saveWord(id){requestExport(id,'word');}
function showHistory(id){
  if(!repo)return;
  const r=repo.book.months[currentMonth]?.employees[id];
  const snapshots=[...(r?.history||[]),...(r?.snapshot?[r.snapshot]:[])].reverse();
  showDialog('确认记录',snapshots.length?snapshots.map((s,i)=>`<div class="history-entry"><strong>第 ${s.revision} 版${i===0?' · 最近确认':''}</strong><p>${escapeHTML(new Date(s.confirmedAt).toLocaleString('zh-CN',{hour12:false}))}</p><p>实发 ${y(s.payroll.total)} · 实际休息 ${s.leave.used} 天 · 结转下月 ${s.leave.closing} 天</p></div>`).join(''):'<p>这个月还没有确认记录。</p>','',null);
}
function downloadText(text,name,type='application/json'){
  const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function exportBackup(){
  try{requireRepo(); if(pendingSave)notice('当前备份仅包含已成功保存的数据，屏幕上的未保存输入尚未包含。',true); downloadText(Ledger.backup(repo.book),'TSMP-工资账本备份-'+new Date().toISOString().slice(0,10)+'.json');}
  catch(e){notice(e.message,true);}
}
function exportRaw(){
  try{ downloadText(JSON.stringify({current:localStorage.getItem(Ledger.KEY),legacy:localStorage.getItem(Ledger.LEGACY)},null,2),'TSMP-原始数据留存.json'); }
  catch(e){document.getElementById('dialogError').textContent=e.message;}
}
function openBackup(){
  showDialog('备份与恢复',`<p>记录保存在这台设备。换手机前请导出备份；恢复会整体替换当前工资账本。</p><div class="backup-actions"><button class="b-pink" type="button" onclick="exportBackup()">导出当前账本</button><button class="b-ghost" type="button" onclick="exportPrevious()">导出恢复前备份</button><button class="b-ghost" type="button" onclick="exportRaw()">留存原始数据</button></div><label for="backupFile">选择备份文件</label><input id="backupFile" type="file" accept=".json,application/json"><label for="backupText">或粘贴备份内容</label><textarea id="backupText" placeholder="粘贴从 TSMP 工资账本导出的 JSON"></textarea><p id="backupSummary"></p>`,'检查备份',()=>{
    const checked=Ledger.parseBackup(document.getElementById('backupText').value);
    const months=Object.keys(checked.months);
    const count=months.reduce((sum,m)=>sum+STAFF.filter(e=>checked.months[m].employees[e.id].snapshot).length,0);
    document.getElementById('backupSummary').textContent=`检查通过：${months.length} 个月份，${STAFF.length} 位员工，${count} 份有确认快照的记录。将整体恢复，并先自动备份当前账本。`;
    document.getElementById('dialogConfirm').textContent='确认整体恢复';
    dialogAction=()=>{
      // Reparse the text to reject modifications after preview.
      const again=Ledger.parseBackup(document.getElementById('backupText').value);
      if(JSON.stringify(again)!==JSON.stringify(checked))throw new Error('备份内容已变化，请关闭后重新检查');
      if(repo)repo.restore(checked);
      else{
        const raw=localStorage.getItem(Ledger.KEY);
        localStorage.setItem(Ledger.KEY+'-unreadable-before-restore',raw??'');
        localStorage.setItem(Ledger.BEFORE_RESTORE,JSON.stringify({unreadableRaw:raw,legacy:localStorage.getItem(Ledger.LEGACY)}));
        localStorage.setItem(Ledger.KEY,JSON.stringify(checked));repo=new Ledger.Repository(localStorage);loadError=null;
      }
      currentMonth=Object.keys(repo.book.months).sort().at(-1)||repo.book.startMonth||thisMonth;
      pendingSave=false;document.getElementById('month').value=currentMonth;closeDialog();hydrate();notice('账本已恢复；恢复前的数据已自动备份');
    };
  });
  document.getElementById('backupFile').onchange=async e=>{
    try{const file=e.target.files[0];if(!file)return;if(file.size>10000000)throw new Error('备份文件超过 10 MB');document.getElementById('backupText').value=await file.text();}
    catch(err){document.getElementById('dialogError').textContent=err.message;}
  };
}
function exportPrevious(){
  const raw=localStorage.getItem(Ledger.BEFORE_RESTORE);
  if(!raw){document.getElementById('dialogError').textContent='还没有恢复前的自动备份';return;}
  downloadText(raw,'TSMP-恢复前备份.json');
}
function resetAll(){
  try{persistForm();requireRepo();if(!repo.book.startMonth || currentMonth<repo.book.startMonth)throw new Error('请先选择已启用的月份');}
  catch(e){notice(e.message,true);return;}
  showDialog('清空本月草稿',`<p>清空 ${monthLabel(currentMonth)} 尚未确认的输入。有确认快照的记录（包括待核对记录）、历史月份和初始余额会保留。</p>`,'清空草稿',()=>{repo.commit(b=>Ledger.clearDrafts(b,currentMonth));closeDialog();hydrate();notice('本月未确认草稿已清空');});
}
function allSnapshots(){
  persistForm();
  return STAFF.map(e=>({emp:e,snapshot:Ledger.getSnapshot(repo.book,e.id,currentMonth)}));
}
function copyAll(){
  try{
    const all=allSnapshots();
    const text=all.map(({emp,snapshot})=>`${emp.name} · ${monthLabel(snapshot.month)}\n`+buildSections(emp,snapshot).map(s=>s.title+'\n'+s.rows.map(([k,v])=>`${k}：${v}`).join('\n')).join('\n')+`\n实发合计：${y(snapshot.payroll.total)}`).join('\n\n');
    navigator.clipboard.writeText(text).then(()=>notice('已复制全部已确认工资明细'),()=>notice('复制失败，请使用图片或 Word 导出',true));
  }catch(e){notice(e.message+'；复制全部需要本月所有员工已确认',true);}
}
function preparePrint(){
  document.getElementById('printArea').innerHTML=allSnapshots().map(({emp,snapshot})=>`<article class="print-slip"><h2>TSMP 工资单 · ${emp.name}</h2><p>${monthLabel(snapshot.month)}</p>${buildSections(emp,snapshot).map(s=>`<h3>${s.title}</h3><table>${s.rows.map(([k,v])=>`<tr><td>${escapeHTML(k)}</td><td>${escapeHTML(v)}</td></tr>`).join('')}</table>`).join('')}<h2>实发合计 ${y(snapshot.payroll.total)}</h2></article>`).join('');
}
function printAll(){
  try{preparePrint();window.print();}
  catch(e){notice(e.message+'；打印需要本月所有员工已确认',true);}
}
window.addEventListener('beforeprint',()=>{
  try{preparePrint();}
  catch(e){document.getElementById('printArea').textContent='请先确认本月所有员工的工资记录，再打印。';notice(e.message,true);}
});
document.getElementById('month').addEventListener('change',e=>changeMonth(e.target.value));
document.getElementById('deck').addEventListener('input',e=>{
  if(!e.target.matches('input'))return;
  try{persistForm();render();}catch(e){notice(e.message,true);}
});
document.addEventListener('keydown',e=>{if(e.key==='Enter' && e.target.matches('input'))e.target.blur();});
window.addEventListener('beforeunload',e=>{if(pendingSave){e.preventDefault();e.returnValue='';}});
window.addEventListener('storage',e=>{if(e.key===Ledger.KEY){notice('另一窗口已更新账本，请刷新以读取最新记录；本窗口不能覆盖它。',true);if(dialog.open)closeDialog();}});
hydrate();
if(loadError)notice('账本读取失败，原数据已保留：'+loadError+'。请打开备份与恢复。',true);
else if(!repo.book.startMonth)notice('首次使用请点击“启用休假账本”，确认开始月份和每个人的初始余额。');
