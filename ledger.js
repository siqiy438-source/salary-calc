/* Employee/month ledger. Mutations are committed only after durable storage succeeds. */
(function(root){
"use strict";
const P = typeof module !== "undefined" && module.exports ? require('./payroll-core.js') : root.Payroll;
const KEY = 'tsmp-salary-v2', LEGACY = 'tsmp-salary-v1';
const BEFORE_RESTORE = KEY + '-before-restore', LEGACY_BACKUP = KEY + '-legacy-backup';
const ids = P.STAFF.map(e => e.id), keys = ['acd','b','trips','leave','adj'];
const clone = v => JSON.parse(JSON.stringify(v));
const fail = message => { throw new Error(message); };
const ymOK = v => typeof v === 'string' && /^(19|[2-9]\d)\d{2}-(0[1-9]|1[0-2])$/.test(v);
const index = ym => +ym.slice(0,4)*12 + +ym.slice(5)-1;
const monthAt = i => String(Math.floor(i/12)).padStart(4,'0')+'-'+String(i%12+1).padStart(2,'0');
const monthDays = ym => new Date(+ym.slice(0,4), +ym.slice(5), 0).getDate();
const emptyInput = () => Object.fromEntries(keys.map(k => [k,'']));
const emptyRecord = () => ({ input:emptyInput(), status:'draft', snapshot:null, history:[] });
const number = (v,label,{required=false,half=false,max=1e12,negative=false}={}) => {
  if (typeof v !== 'string' && typeof v !== 'number') fail(label+'格式不正确');
  if (String(v).trim()==='') { if (required) fail('请填写'+label+'，没有请填 0'); return 0; }
  const n = Number(v);
  if (!Number.isFinite(n) || (!negative && n<0) || Math.abs(n)>max || (half && !Number.isInteger(n*2))) fail(label+(half?'须为非负数，以 0.5 天为单位':'数值不正确'));
  return n;
};
function inputNumbers(input,ym){
  const result = {};
  for (const k of keys) result[k] = number(input[k], {acd:'A/C/D 类业绩',b:'B 类业绩',trips:'送货趟数',leave:'实际休息天数',adj:'其他增减'}[k], k==='leave'?{required:true,half:true,max:monthDays(ym)}:{negative:k==='adj'});
  if (!Number.isInteger(result.trips)) fail('送货趟数须为整数');
  return result;
}
function fresh(legacy){
  const book = { version:2, startMonth:null, opening:{}, months:{} };
  if (legacy && ymOK(legacy.month)){
    const m = ensureMonth(book,legacy.month);
    m.storePerf = typeof legacy.storePerf === 'string' || typeof legacy.storePerf === 'number' ? String(legacy.storePerf) : '';
    for (const id of ids) for (const k of keys){
      const value = legacy[id]?.[k];
      if (typeof value === 'string' || typeof value === 'number') m.employees[id].input[k] = String(value);
    }
  }
  return book;
}
function ensureMonth(book,ym){
  if (!ymOK(ym)) fail('请选择有效月份');
  if (!book.months[ym]) book.months[ym] = { storePerf:'', employees:Object.fromEntries(ids.map(id=>[id,emptyRecord()])) };
  return book.months[ym];
}
function setup(book,ym,opening){
  if (book.startMonth) fail('账本已启用，起始余额不能直接改写；可通过历史记录核对修正');
  if (!ymOK(ym)) fail('请选择启用月份');
  const checked = {};
  for (const id of ids) checked[id] = number(opening[id], P.STAFF.find(e=>e.id===id).name+'的初始余额',{required:true,half:true});
  book.startMonth = ym; book.opening = checked; ensureMonth(book,ym);
}
function invalidate(book,id,from){
  const affected = [];
  for (const ym of Object.keys(book.months).sort()){
    const r = book.months[ym].employees[id];
    if (ym>=from && r.snapshot){ r.status='review'; affected.push(ym); }
  }
  return affected;
}
function edit(book,ym,id,key,value){
  if (book.startMonth && ym<book.startMonth) fail('启用前的旧数据仅供查看，不参与累计');
  const m = ensureMonth(book,ym);
  if (id===null){
    if (key!=='storePerf') fail('未知字段');
    if (m.storePerf===String(value)) return [];
    m.storePerf = String(value);
    return [...new Set(ids.flatMap(e=>invalidate(book,e,ym)))];
  }
  if (!ids.includes(id) || !keys.includes(key)) fail('未知员工或字段');
  if (m.employees[id].input[key]===String(value)) return [];
  m.employees[id].input[key] = String(value);
  return invalidate(book,id,ym);
}
function derive(book,id,ym){
  const r = book.months[ym]?.employees[id] || emptyRecord();
  const result = { record:r, leave:null, payroll:null, blocked:null, issue:null };
  if (!book.startMonth){ result.issue='请先启用休假账本'; return result; }
  if (!ymOK(ym) || ym<book.startMonth){ result.issue='启用前的旧数据仅供查看，不参与累计'; return result; }
  let carry = book.opening[id];
  for (let i=index(book.startMonth); i<index(ym); i++){
    const prevYM = monthAt(i), prev = book.months[prevYM]?.employees[id];
    if (!prev || prev.status!=='confirmed') result.blocked ||= '请先核对并确认 '+prevYM+' 的记录';
    try { carry = Math.max(0, carry+2-inputNumbers(prev?.input || emptyInput(),prevYM).leave); }
    catch { result.issue='缺少 '+prevYM+' 的实际休息记录，请先补录'; return result; }
  }
  result.leave = { opening:carry, added:2, available:carry+2, used:null, over:null, closing:null };
  try {
    const input = inputNumbers(r.input,ym);
    const perf = number(book.months[ym]?.storePerf ?? '', '总店业绩');
    Object.assign(result.leave,{used:input.leave,over:Math.max(0,input.leave-carry-2),closing:Math.max(0,carry+2-input.leave)});
    result.payroll = P.calc(P.STAFF.find(e=>e.id===id),input,perf,monthDays(ym),carry+2);
  } catch(e){ result.issue=e.message; }
  return result;
}
function confirmRecord(book,id,ym,at=new Date().toISOString()){
  const d = derive(book,id,ym);
  if (d.issue || d.blocked) fail(d.issue || d.blocked);
  const m = ensureMonth(book,ym), r = m.employees[id];
  if (r.status==='confirmed') return r.snapshot;
  const snap = { employeeId:id, month:ym, revision:(r.snapshot?.revision||0)+1, confirmedAt:at,
    input:inputNumbers(r.input,ym), storePerf:number(m.storePerf,'总店业绩'), leave:clone(d.leave), payroll:clone(d.payroll) };
  if (r.snapshot) r.history.push(clone(r.snapshot));
  r.snapshot = snap; r.status='confirmed';
  return snap;
}
function clearDrafts(book,ym){
  const m = ensureMonth(book,ym);
  for (const id of ids) if (!m.employees[id].snapshot) m.employees[id] = emptyRecord();
  if (!ids.some(id=>m.employees[id].snapshot)) m.storePerf='';
}
function getSnapshot(book,id,ym){
  const d = derive(book,id,ym);
  if (d.issue || d.blocked || d.record.status!=='confirmed') fail('请先确认 '+ym+' 的工资记录');
  return clone(d.record.snapshot);
}
function validateSnapshot(s,id,ym){
  if (!s || s.employeeId!==id || s.month!==ym || !Number.isInteger(s.revision) || s.revision<1 || typeof s.confirmedAt!=='string' || !Number.isFinite(Date.parse(s.confirmedAt))) fail('备份的工资快照格式不正确');
  const input = inputNumbers(s.input||{},ym), storePerf = number(s.storePerf,'总店业绩');
  if (!s.leave) fail('备份缺少休假快照');
  const opening = number(s.leave.opening,'上月结余',{required:true,half:true});
  const leave = {opening,added:2,available:opening+2,used:input.leave,over:Math.max(0,input.leave-opening-2),closing:Math.max(0,opening+2-input.leave)};
  if (Object.keys(leave).some(k=>s.leave[k]!==leave[k])) fail('备份的休假快照不一致');
  const payroll = P.calc(P.STAFF.find(e=>e.id===id),input,storePerf,monthDays(ym),leave.available);
  if (!s.payroll || s.payroll.total!==payroll.total) fail('备份的工资金额不一致');
  return {employeeId:id,month:ym,revision:s.revision,confirmedAt:s.confirmedAt,input,storePerf,leave,payroll};
}
function validateBook(raw){
  if (!raw || raw.version!==2 || !raw.months || typeof raw.months!=='object' || Array.isArray(raw.months)) fail('不是支持的 TSMP 工资备份（版本 2）');
  const book = fresh();
  if (raw.startMonth!==null){
    if (!ymOK(raw.startMonth)) fail('备份的启用月份无效');
    book.startMonth=raw.startMonth;
    for(const id of ids) book.opening[id]=number(raw.opening?.[id],'初始余额',{required:true,half:true});
  }
  for(const ym of Object.keys(raw.months).sort()){
    if (!ymOK(ym)) fail('备份包含无效月份');
    const source=raw.months[ym];
    if (!source || !source.employees || ids.some(id=>!source.employees[id]) || Object.keys(source.employees).some(id=>!ids.includes(id))) fail('备份员工记录不完整');
    const m=ensureMonth(book,ym);
    if (typeof source.storePerf!=='string') fail('备份的业绩输入格式无效');
    m.storePerf=source.storePerf;
    for(const id of ids){
      const s=source.employees[id], r=m.employees[id];
      if (!s.input || !['draft','confirmed','review'].includes(s.status) || !Array.isArray(s.history)) fail('备份的记录状态无效');
      for(const k of keys){ if(typeof s.input[k]!=='string') fail('备份的输入格式无效'); r.input[k]=s.input[k]; }
      r.status=s.status;
      r.history=s.history.map(h=>validateSnapshot(h,id,ym));
      r.snapshot=s.snapshot===null?null:validateSnapshot(s.snapshot,id,ym);
      if ((r.status==='draft' && (r.snapshot || r.history.length)) || (r.status!=='draft' && !r.snapshot)) fail('备份的确认状态不一致');
      if (r.snapshot && (!book.startMonth || ym<book.startMonth)) fail('备份在启用前含有已确认记录');
      if (r.status==='confirmed'){
        const d=derive(book,id,ym);
        if(d.issue || d.blocked || JSON.stringify(d.leave)!==JSON.stringify(r.snapshot.leave) || JSON.stringify(inputNumbers(r.input,ym))!==JSON.stringify(r.snapshot.input) || number(m.storePerf,'总店业绩')!==r.snapshot.storePerf) fail('备份的确认记录与月份余额不一致');
      }
    }
  }
  return book;
}
function parseBackup(text){
  if (typeof text!=='string' || text.length>10000000) fail('备份文件过大或格式无效');
  let raw; try { raw=JSON.parse(text); } catch { fail('备份不是有效的 JSON 文件'); }
  if (raw.format!=='tsmp-payroll-backup' || raw.version!==2) fail('请选择 TSMP 工资账本导出的备份文件');
  return validateBook(raw.book);
}
function backup(book){ return JSON.stringify({format:'tsmp-payroll-backup',version:2,exportedAt:new Date().toISOString(),book},null,2); }
class Repository {
  constructor(storage){
    this.storage=storage; this.raw=storage.getItem(KEY);
    if(this.raw!==null){ this.book=validateBook(JSON.parse(this.raw)); return; }
    const old=storage.getItem(LEGACY);
    let legacy=null;
    if(old!==null){
      try { legacy=JSON.parse(old); } catch { fail('旧工资数据无法读取，请先备份原数据再恢复'); }
      if(storage.getItem(LEGACY_BACKUP)===null) storage.setItem(LEGACY_BACKUP,old);
    }
    this.book=fresh(legacy);
  }
  commit(change){
    if(this.storage.getItem(KEY)!==this.raw) fail('另一窗口已更新账本，请刷新后再操作');
    const next=clone(this.book), result=change(next), raw=JSON.stringify(next);
    try { this.storage.setItem(KEY,raw); } catch { fail('本机保存失败，本次操作尚未保存。请先导出备份，释放空间后重试'); }
    this.book=next; this.raw=raw; return result;
  }
  restore(book){
    const checked=validateBook(book);
    // A separate backup must succeed before replacing the live key.
    try { this.storage.setItem(BEFORE_RESTORE,backup(this.book)); }
    catch { fail('恢复前的自动备份失败，原账本未改动'); }
    this.commit(next=>{Object.keys(next).forEach(k=>delete next[k]);Object.assign(next,checked);});
  }
}
const api={KEY,LEGACY,BEFORE_RESTORE,LEGACY_BACKUP,Repository,fresh,setup,edit,derive,confirmRecord,clearDrafts,getSnapshot,validateBook,parseBackup,backup,ensureMonth,emptyInput,monthDays,ymOK,clone};
if (typeof module!=='undefined' && module.exports) module.exports=api; else root.Ledger=api;
})(typeof globalThis!=='undefined'?globalThis:this);
