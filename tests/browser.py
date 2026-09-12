"""Run against a local server: TSMP_TEST_URL=http://127.0.0.1:8793 python3 tests/browser.py."""
import json, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
URL=os.environ.get('TSMP_TEST_URL','http://127.0.0.1:8793')
OUT=Path(os.environ.get('TSMP_QA_DIR','/tmp/tsmp-leave-qa'));OUT.mkdir(parents=True,exist_ok=True)
IDS=['wuxuan','xiaoxue','xiaotao','zhugk','qiujb']
def go(page, idx):
 page.locator(f'.tab[data-i="{idx}"]').click()
 expect(page.locator(f'.tab[data-i="{idx}"]')).to_have_class('tab on')
def switch(page, month):
 page.locator('#month').fill(month);page.locator('#month').dispatch_event('change')
def book(page): return page.evaluate('JSON.parse(localStorage.getItem(Ledger.KEY))')
def setup(page):
 page.locator('#setupButton').click();page.locator('#setupMonth').fill('2026-05')
 page.get_by_text('所有人均无结余，全部填 0',exact=True).click();page.locator('#dialogConfirm').click()
 expect(page.locator('#actionDialog')).not_to_be_visible()
def close_image(page): page.locator('#veil').get_by_role('button',name='关闭',exact=True).click()
def confirm_image(page,id,days):
 page.locator(f'#input-{id}-leave').fill(str(days))
 section=page.locator('section').filter(has=page.locator(f'#input-{id}-leave'))
 section.get_by_role('button',name='存为图片',exact=True).click()
 if page.locator('#actionDialog').is_visible(): page.locator('#dialogConfirm').click()
 expect(page.locator('#veil')).to_be_visible();expect(page.locator('#veilImg')).to_have_js_property('complete',True)
 close_image(page)
with sync_playwright() as p:
 for engine in ['chromium','webkit']:
  browser=getattr(p,engine).launch(headless=True)
  context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,accept_downloads=True)
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(URL);page.wait_for_load_state('networkidle');setup(page);go(page,2)
  # An empty leave input must never be confirmed as zero.
  page.locator('section').filter(has=page.locator('#input-xiaoxue-leave')).get_by_role('button',name='存为图片',exact=True).click()
  expect(page.locator('#saveNotice')).to_contain_text('请填写实际休息天数')
  confirm_image(page,'xiaoxue',1)
  assert book(page)['months']['2026-05']['employees']['xiaoxue']['snapshot']['leave']['closing']==1
  switch(page,'2026-06');expect(page.locator('#leave-xiaoxue')).to_contain_text('3 天')
  confirm_image(page,'xiaoxue',3)
  assert book(page)['months']['2026-06']['employees']['xiaoxue']['snapshot']['payroll']['total']==4500
  # The export file itself must contain the leave section and the confirmed amount.
  section=page.locator('section').filter(has=page.locator('#input-xiaoxue-leave'))
  with page.expect_download() as event: section.get_by_role('button',name='存为 Word',exact=True).click()
  download=event.value;word=OUT/f'{engine}-june.doc';download.save_as(word)
  text=word.read_text();assert '休息明细' in text and '结转下月' in text and '¥4,500' in text
  section.get_by_role('button',name='存为图片',exact=True).click()
  with page.expect_download() as event: page.locator('#veilDl').click()
  event.value.save_as(OUT/f'{engine}-june.png');close_image(page)
  assert book(page)['months']['2026-06']['employees']['xiaoxue']['snapshot']['revision']==1
  page.reload();page.wait_for_load_state('networkidle');go(page,2)
  expect(page.locator('#input-xiaoxue-leave')).to_have_value('3');expect(page.locator('#state-xiaoxue')).to_contain_text('已确认')
  # Historical correction changes later balances but retains the issued snapshot.
  switch(page,'2026-05');page.locator('#input-xiaoxue-leave').fill('2')
  assert book(page)['months']['2026-06']['employees']['xiaoxue']['status']=='review'
  switch(page,'2026-06');section.get_by_role('button',name='存为图片',exact=True).click()
  expect(page.locator('#saveNotice')).to_contain_text('2026-05')
  switch(page,'2026-05');confirm_image(page,'xiaoxue',2)
  switch(page,'2026-06');confirm_image(page,'xiaoxue',3)
  revised=book(page)['months']['2026-06']['employees']['xiaoxue']
  assert revised['snapshot']['payroll']['total']==3866.67 and revised['history'][0]['payroll']['total']==4500
  # Backup export and both file/paste restore paths.
  page.get_by_role('button',name='备份与恢复',exact=True).click()
  with page.expect_download() as event: page.get_by_role('button',name='导出当前账本',exact=True).click()
  backup_path=OUT/f'{engine}-backup.json';event.value.save_as(backup_path);original=book(page)
  page.locator('#backupText').fill('broken');page.locator('#dialogConfirm').click();expect(page.locator('#dialogError')).to_contain_text('JSON')
  page.locator('#backupFile').set_input_files(backup_path);expect(page.locator('#backupText')).to_have_value(re.compile('tsmp-payroll-backup'))
  page.locator('#dialogConfirm').click();expect(page.locator('#backupSummary')).to_contain_text('检查通过')
  page.locator('#dialogConfirm').click();assert book(page)==original
  page.get_by_role('button',name='备份与恢复',exact=True).click();page.locator('#backupText').fill(backup_path.read_text());page.locator('#dialogConfirm').click();page.locator('#dialogConfirm').click();assert book(page)==original
  # Narrow layout and touch-oriented controls.
  page.set_viewport_size({'width':320,'height':568});go(page,2);page.locator('#input-xiaoxue-leave').scroll_into_view_if_needed()
  page.screenshot(path=str(OUT/f'{engine}-small.png'))
  assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
  assert not errors,errors
  context.close();browser.close()
  print(engine+': monthly confirmation, repeat exports, actual Word/image, correction, reload, backup file/paste, narrow viewport PASS')
