const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../ledger.js'), P=require('../payroll-core.js');
const STAFF=P.STAFF, id=STAFF[1].id;
const setup=(start='2026-05',initial=0)=>{const b=L.fresh();L.setup(b,start,Object.fromEntries(STAFF.map(e=>[e.id,initial])));return b;};
const fill=(b,ym,days,who=id)=>{L.edit(b,ym,who,'leave',String(days));return L.derive(b,who,ym);};
const confirm=(b,ym,days,who=id)=>{fill(b,ym,days,who);return L.confirmRecord(b,who,ym);};
class Memory {constructor(){this.map=new Map();this.fail=null;}getItem(k){return this.map.get(k)??null;}setItem(k,v){if(this.fail===k)throw Error('quota');this.map.set(k,String(v));}}
test('May one day leaves one; June three days consumes it without deductions',()=>{
 const b=setup();assert.equal(confirm(b,'2026-05',1).leave.closing,1);
 const s=confirm(b,'2026-06',3);assert.equal(s.leave.available,3);assert.equal(s.leave.closing,0);assert.equal(s.payroll.deduct,0);assert.equal(s.payroll.total,4500);
});
test('all roles, including manager, receive two days and preserve other formulas',()=>{
 const b=setup();for(const e of STAFF){const s=confirm(b,'2026-05',2,e.id);assert.equal(s.payroll.deduct,0);assert.equal(s.payroll.total,P.RULES[e.type].base);}
});
test('sales excess removes attendance and only bills days beyond current allowance',()=>{
 const b=setup('2026-06',1);const s=confirm(b,'2026-06',4);assert.equal(s.leave.over,1);assert.equal(s.payroll.total,3866.67);assert.equal(s.leave.closing,0);
});
test('manager excess bills one day without an attendance deduction',()=>{
 const b=setup('2026-06');const s=confirm(b,'2026-06',3,STAFF[0].id);assert.equal(s.payroll.deduct,266.67);assert.equal(s.payroll.total,7733.33);
});
test('half days and unlimited cross-year accumulation',()=>{
 const b=setup('2026-11');confirm(b,'2026-11',0);confirm(b,'2026-12',0.5);const s=confirm(b,'2027-01',0);assert.equal(s.leave.available,5.5);assert.equal(s.leave.closing,5.5);
});
test('blank, negative, non-finite, quarter days and too many days cannot confirm',()=>{
 for(const days of ['',-1,'Infinity',0.25,32]){const b=setup();fill(b,'2026-05',days);assert.throws(()=>L.confirmRecord(b,id,'2026-05'));}
 const b=setup('2028-02');assert.equal(confirm(b,'2028-02',29).leave.over,27);
});
test('a missing month is never treated as zero leave',()=>{
 const b=setup();fill(b,'2026-06',0);assert.throws(()=>L.confirmRecord(b,id,'2026-06'),/2026-05/);assert.equal(L.derive(b,id,'2026-06').leave,null);
});
test('unconfirmed prior draft permits estimate but blocks next month confirmation',()=>{
 const b=setup();fill(b,'2026-05',1);fill(b,'2026-06',2);assert.equal(L.derive(b,id,'2026-06').leave.closing,1);assert.throws(()=>L.confirmRecord(b,id,'2026-06'),/2026-05/);
});
test('confirm and export are idempotent; unrelated employees stay separate',()=>{
 const b=setup();const s=confirm(b,'2026-05',1);for(let i=0;i<5;i++){assert.deepEqual(L.confirmRecord(b,id,'2026-05'),s);assert.deepEqual(L.getSnapshot(b,id,'2026-05'),s);}
 assert.equal(b.months['2026-05'].employees[id].history.length,0);assert.equal(b.months['2026-05'].employees[STAFF[0].id].status,'draft');
});
test('historical edit invalidates forward, retains old snapshot, and requires chronological reconfirmation',()=>{
 const b=setup();confirm(b,'2026-05',1);confirm(b,'2026-06',3);const prior=L.clone(b.months['2026-06'].employees[id].snapshot);
 fill(b,'2026-05',2);assert.equal(b.months['2026-06'].employees[id].status,'review');assert.deepEqual(b.months['2026-06'].employees[id].snapshot,prior);
 assert.throws(()=>L.getSnapshot(b,id,'2026-06'));assert.throws(()=>L.confirmRecord(b,id,'2026-06'));
 L.confirmRecord(b,id,'2026-05');const newS=L.confirmRecord(b,id,'2026-06');assert.equal(newS.leave.over,1);assert.equal(newS.payroll.total,3866.67);assert.equal(b.months['2026-06'].employees[id].history[0].payroll.total,4500);
});
test('shared store performance invalidates all relevant snapshots, including future months',()=>{
 const b=setup();for(const e of STAFF){confirm(b,'2026-05',2,e.id);confirm(b,'2026-06',2,e.id);}L.edit(b,'2026-05',null,'storePerf','700000');
 for(const e of STAFF)for(const ym of ['2026-05','2026-06'])assert.equal(b.months[ym].employees[e.id].status,'review');
});
test('payroll commission and performance threshold results are retained',()=>{
 const b=setup();L.edit(b,'2026-05',null,'storePerf','700000');L.edit(b,'2026-05',id,'acd','150000');L.edit(b,'2026-05',id,'b','50000');assert.equal(confirm(b,'2026-05',2).payroll.total,8000);
 assert.equal(confirm(b,'2026-05',2,STAFF[3].id).payroll.total,8200);
 L.edit(b,'2026-05',STAFF[4].id,'trips','10');assert.equal(confirm(b,'2026-05',2,STAFF[4].id).payroll.total,7350);
});
test('legacy data stays in original month as unconfirmed draft and raw backup remains',()=>{
 const storage=new Memory();const old=JSON.stringify({month:'2026-05',storePerf:'620000',[id]:{leave:'1',acd:'12345'}});storage.setItem(L.LEGACY,old);const r=new L.Repository(storage);
 assert.equal(storage.getItem(L.LEGACY_BACKUP),old);assert.equal(storage.getItem(L.LEGACY),old);assert.equal(r.book.startMonth,null);assert.equal(r.book.months['2026-05'].employees[id].input.leave,'1');assert.equal(r.book.months['2026-05'].employees[id].snapshot,null);
});
test('initial opening balances require explicit valid values; start cannot be silently changed',()=>{
 const b=L.fresh();assert.throws(()=>L.setup(b,'2026-05',{}));const c=setup('2026-06',2.5);assert.equal(fill(c,'2026-06',0).leave.available,4.5);assert.throws(()=>L.setup(c,'2026-07',{}));assert.throws(()=>L.confirmRecord(c,id,'2026-05'));
});
test('draft clearing preserves all confirmed/review snapshots and other months',()=>{
 const b=setup();L.edit(b,'2026-05',null,'storePerf','700000');confirm(b,'2026-05',1);fill(b,'2026-05',2);fill(b,'2026-05',1,STAFF[0].id);const old=L.clone(b.months['2026-05'].employees[id]);L.clearDrafts(b,'2026-05');assert.deepEqual(b.months['2026-05'].employees[id],old);assert.equal(b.months['2026-05'].employees[STAFF[0].id].input.leave,'');assert.equal(b.months['2026-05'].storePerf,'700000');
});
test('durable failure does not confirm in memory or change persisted data',()=>{
 const storage=new Memory(),repo=new L.Repository(storage);repo.commit(b=>Object.assign(b,setup()));repo.commit(b=>fill(b,'2026-05',1));const old=storage.getItem(L.KEY);storage.fail=L.KEY;
 assert.throws(()=>repo.commit(b=>L.confirmRecord(b,id,'2026-05')),/保存失败/);assert.equal(repo.book.months['2026-05'].employees[id].status,'draft');assert.equal(storage.getItem(L.KEY),old);
});
test('multiple windows cannot overwrite each other',()=>{
 const storage=new Memory(),a=new L.Repository(storage),b=new L.Repository(storage);a.commit(x=>Object.assign(x,setup()));assert.throws(()=>b.commit(x=>Object.assign(x,setup())),/另一窗口/);
});
test('backup round trip restores history, draft inputs and confirmed records',()=>{
 const b=setup();confirm(b,'2026-05',1);confirm(b,'2026-06',3);fill(b,'2026-05',2);L.confirmRecord(b,id,'2026-05');L.confirmRecord(b,id,'2026-06');
 assert.deepEqual(L.parseBackup(L.backup(b)),b);const store=new Memory(),repo=new L.Repository(store);repo.commit(x=>Object.assign(x,setup('2026-01')));const old=L.clone(repo.book);repo.restore(b);assert.deepEqual(L.parseBackup(store.getItem(L.BEFORE_RESTORE)),old);assert.deepEqual(new L.Repository(store).book,b);
});
test('invalid backups are rejected without modifying current ledger',()=>{
 const b=setup();confirm(b,'2026-05',1);
 assert.throws(()=>L.parseBackup('not json'));assert.throws(()=>L.parseBackup('{}'));
 const bad=L.clone(b);bad.months['2026-05'].employees[id].snapshot.leave.closing=999;assert.throws(()=>L.validateBook(bad));
 const bad2=L.clone(b);bad2.months['2026-05'].employees[id].input.leave='0';assert.throws(()=>L.validateBook(bad2));
 const bad3=L.clone(b);bad3.months['2026-05'].employees[id].snapshot.payroll.total=1;assert.throws(()=>L.validateBook(bad3));
});
test('restore fails safely when automatic backup cannot be written',()=>{
 const store=new Memory(),repo=new L.Repository(store);repo.commit(x=>Object.assign(x,setup()));const old=store.getItem(L.KEY);store.fail=L.BEFORE_RESTORE;assert.throws(()=>repo.restore(setup('2026-06')),/自动备份失败/);assert.equal(store.getItem(L.KEY),old);
});
test('failed restoration of live key leaves original durable ledger and recovery backup intact',()=>{
 const store=new Memory(),repo=new L.Repository(store);repo.commit(x=>Object.assign(x,setup()));const old=store.getItem(L.KEY);store.fail=L.KEY;assert.throws(()=>repo.restore(setup('2026-06')),/保存失败/);assert.equal(store.getItem(L.KEY),old);assert.equal(repo.book.startMonth,'2026-05');assert.equal(L.parseBackup(store.getItem(L.BEFORE_RESTORE)).startMonth,'2026-05');
});
test('recovery reconstructs snapshot text from numeric inputs instead of accepting injected markup',()=>{
 const b=setup();confirm(b,'2026-05',1);b.months['2026-05'].employees[id].snapshot.payroll.lines=[['<img src=x onerror=alert(1)>',4500,'','base']];const checked=L.validateBook(b);assert.ok(!JSON.stringify(checked).includes('<img'));
});
test('manager combined commissions and finance bonus thresholds remain unchanged',()=>{
 const manager=P.STAFF[0],finance=P.STAFF[3];
 assert.equal(P.calc(manager,{acd:150000,b:50000,leave:2},700000,31,2).total,12200);
 for(const [perf,total] of [[399999,6800],[400000,7200],[599999,7300],[600000,8000],[700000,8200]])assert.equal(P.calc(finance,{leave:2},perf,31,2).total,total);
});
