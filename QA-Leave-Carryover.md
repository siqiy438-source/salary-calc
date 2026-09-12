# 休假累计验收记录 · 2026-09-12

## 已通过

- 23 项 Node 测试：所有员工每月 2 天、半天录入、跨月跨年结转、超额扣薪、原提成和奖金门槛、重复确认、员工隔离、漏月阻断、历史修正及版本保留、总店业绩变更、旧数据迁移、草稿清空、存储失败、并发窗口更新检测、备份校验和恢复失败保护。
- Chromium / WebKit 两套完整页面流程：首次启用、5 月休 1 天、6 月休 3 天不扣款、连续生成图片、Word 实际下载、关闭重开、历史修正后重算、备份文件导入及粘贴恢复。
- Chromium / WebKit 两套异常流程：初始余额必须明确填写、保存失败不确认、不覆盖已存输入、复制和打印使用确认快照、修改后不再打印旧内容、清空草稿保护确认记录。
- 320 × 568 窄屏与 390 × 844 视口检查；员工内容可纵向滚动，图片包含完整休息明细。
- 独立 iPhone 17e / iOS 26.5 模拟器验收包：WKWebView 使用默认数据存储，并注入现有 App 的通用及 TSMP 适配脚本。验证 5 月、6 月结转和重复导出；图片、Word、JSON 通过 WKDownload 落地，系统分享面板正常展示工资单。
- WPS Office 实际打开从 iPhone WebView 下载的 `.doc`：休息明细和工资表正常渲染，样例结余 0 天、实发 4,500 元。

## 样例与运行方法

验收数据为专门创建的测试记录，没有读写用户正式工资存储。测试产物在 `.qa/`，被 Git 忽略，不发布到工资站。

```sh
node --test tests/ledger.test.cjs
python3 -m http.server 8793 --bind 127.0.0.1
# 另开终端：
TSMP_QA_DIR=.qa python3 tests/browser.py
python3 tests/browser-safety.py
```

`.qa/core-tests.txt`、`.qa/browser-tests.txt`、`.qa/browser-safety-tests.txt` 为运行结果；`.qa/ios-report.json` 为原生 WebView 场景结果。`.qa/` 还保留两种浏览器及 iOS 下载的示例工资单和备份。

## 发布边界

工资页更新通过现有 GitHub Pages 的 `main` 分支发布；沿用现有 App 的 TSMP 入口，不改动房租或 GC 工资。旧 `tsmp-salary-v1` 数据保留，新账本使用独立的 `tsmp-salary-v2`。

实际使用者的 iPhone 尚未参与验收。首次使用需本人选择启用月份、填写真实初始余额；实际设备上的相册保存、分享目标及换机恢复须单独确认。没有向任何员工发送工资单。

如需要回滚网页代码，应保留版本 2 数据及手动备份。旧版网页只读版本 1，不能把旧版显示误当作新账本数据已丢失。
