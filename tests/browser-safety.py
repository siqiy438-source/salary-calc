"""Additional UI checks for persistence errors, print/copy and migration."""
import os,json
from playwright.sync_api import sync_playwright,expect
URL=os.environ.get('TSMP_TEST_URL','http://127.0.0.1:8793')
with sync_playwright() as p:
 for engine in ['chromium','webkit']:
  browser=getattr(p,engine).launch(headless=True);context=browser.new_context(viewport={'width':320,'height':568},locale='zh-CN');page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script("if(!localStorage.getItem('tsmp-salary-v2'))localStorage.setItem('tsmp-salary-v1',JSON.stringify({month:'2026-05',storePerf:'620000',xiaoxue:{leave:'1',acd:'200000'}}));")
  page.goto(URL);page.wait_for_load_state('networkidle')
  expect(page.locator('#month')).to_have_value('2026-05');expect(page.locator('#input-xiaoxue-leave')).to_have_value('1')
  page.locator('#setupButton').click();page.locator('#dialogConfirm').click();expect(page.locator('#dialogError')).to_contain_text('初始余额')
  page.get_by_text('所有人均无结余，全部填 0',exact=True).click();page.locator('#dialogConfirm').click()
  page.locator('.tab[data-i="2"]').click()
  page.evaluate("window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===Ledger.KEY)throw Error('quota');return originalSet.call(this,k,v)};undefined")
  page.locator('#input-xiaoxue-leave').fill('2');expect(page.locator('#saveNotice')).to_contain_text('保存失败');expect(page.locator('#state-xiaoxue')).to_contain_text('尚未保存')
  page.locator('section').filter(has=page.locator('#input-xiaoxue-leave')).get_by_role('button',name='存为图片',exact=True).click()
  expect(page.locator('#actionDialog')).not_to_be_visible();assert page.evaluate("repo.book.months['2026-05'].employees.xiaoxue.status")=='draft'
  assert page.evaluate("repo.book.months['2026-05'].employees.xiaoxue.input.leave")=='1'
  page.evaluate('Storage.prototype.setItem=originalSet;undefined');page.locator('#input-xiaoxue-leave').fill('0.5');expect(page.locator('#state-xiaoxue')).to_contain_text('草稿')
  # Prepare complete monthly fixture, then exercise public copy/print controls.
  page.evaluate("repo.commit(b=>{for(const e of STAFF){Ledger.edit(b,'2026-05',e.id,'leave','2');Ledger.confirmRecord(b,e.id,'2026-05')}});hydrate();")
  page.evaluate("Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text}},configurable:true});window.print=()=>window.dispatchEvent(new Event('beforeprint'));undefined")
  page.locator('.tab[data-i="6"]').click();page.get_by_role('button',name='复制全部',exact=True).click();expect(page.locator('#saveNotice')).to_contain_text('已复制')
  assert page.evaluate("copied.includes('休息明细') && copied.includes('结转下月：0 天')")
  page.get_by_role('button',name='打印',exact=True).click();assert page.locator('#printArea article').count()==5
  page.locator('.tab[data-i="2"]').click();page.locator('#input-xiaoxue-leave').fill('1')
  page.evaluate("window.dispatchEvent(new Event('beforeprint'));undefined");expect(page.locator('#printArea')).to_have_text('请先确认本月所有员工的工资记录，再打印。')
  # Clear must keep review snapshots and confirmed records.
  before=page.evaluate('repo.book.months["2026-05"].employees.xiaoxue.snapshot')
  page.locator('.tab[data-i="6"]').click();page.get_by_role('button',name='清空本月草稿',exact=True).click();page.locator('#dialogConfirm').click();assert page.evaluate('repo.book.months["2026-05"].employees.xiaoxue.snapshot')==before
  assert page.evaluate("document.querySelector('.brand').getBoundingClientRect().right<=innerWidth")
  assert not errors,errors
  context.close();browser.close();print(engine+': migration, explicit opening, save failure, copy, print invalidation, protected clear PASS')
