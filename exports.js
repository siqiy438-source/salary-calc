'use strict';
/* ===================== 完整工资单分段（图片 / Word 共用） ===================== */
// 网页上那一列是精简版；导出的工资单要让本人能自己核对，所以业绩、出勤、
// 底薪构成全部摊开，并按「本月数据 / 固定工资 / 提成与奖金 / 扣款」四段列。
function buildSections(emp, snapshot){
  const v = snapshot.input, r = snapshot.payroll, R = RULES[emp.type];
  const sec = [];
  // 发给本人的单子上不写「未达 X 万档 / 差多少」这类解释，也不列 ¥0 的空行，
  // 只留真金白银的项。去掉的都是 0，不影响小计。（完整说明留在网页那一列）
  const pick = g => r.lines.filter(l => l[3] === g && l[1] !== null && l[1] !== 0);

  // 发出去的单子只报结果，不报算法。网页那一列保留完整算式，自己核账用。
  //   底薪（基本 2,500 + 社保 1,200 …）  → 底薪
  //   总店提成（¥620,000 × 千分之一）    → 总店提成
  //   请假扣款（4,000 ÷ 31 天 × 1 天）   → 请假扣款
  //   请假超过 2 天 — 扣全勤奖           → 全勤奖扣除
  const plain = t => t.includes("扣全勤奖") ? "全勤奖扣除"
                   : t.replace(/（[^（）]*）/g, "").replace(/\s*—.*$/, "").trim();

  // 一、本月数据
  const d1 = [["总店业绩", y(snapshot.storePerf), ""]];
  if (emp.type === "manager" || emp.type === "sales"){
    const acd = v.acd||0, b = v.b||0;
    d1.push(["个人 A/C/D 类业绩", y(acd), ""]);
    d1.push(["个人 B 类业绩", y(b), ""]);
    d1.push(["个人业绩合计", y(acd + b), ""]);
  }
  if (emp.type === "delivery") d1.push(["送货趟数", (v.trips||0) + " 趟", ""]);

  sec.push({ title:"本月数据", rows:d1 });
  const l = snapshot.leave;
  const rest = [["上月结余",l.opening+" 天",""],["本月正常休息",l.added+" 天",""],["本月实际休息",l.used+" 天",""],["结转下月",l.closing+" 天",""]];
  if(l.over>0) rest.push(["超过可休额度",l.over+" 天",""]);
  sec.push({title:"休息明细",rows:rest});

  // 二、固定工资
  const p = R.pay;
  const d2 = [["基本工资", y(p.basic), ""]];
  if (p.social) d2.push(["社保补贴", y(p.social), ""]);
  if (p.attend) d2.push(["全勤奖",   y(p.attend), ""]);
  if (p.meal)   d2.push(["中餐补助", y(p.meal), ""]);
  sec.push({ title:"固定工资", rows:d2, sub: d2.length > 1 ? r.base : null });

  // 三、提成与奖金
  const bon = pick("bonus");
  sec.push({
    title:"提成与奖金",
    rows: bon.length ? bon.map(l => [plain(l[0]), sig(l[1]), ""]) : [["本月无提成", "—", ""]],
    sub: bon.reduce((s,l) => s + l[1], 0)
  });

  // 四、扣款
  const ded = pick("deduct");
  sec.push({
    title:"扣款",
    rows: ded.length ? ded.map(l => [plain(l[0]), sig(l[1]), ""]) : [["本月无扣款", "—", ""]],
    sub: ded.length ? ded.reduce((s,l) => s + l[1], 0) : null
  });

  return sec;
}

/* ===================== 单人工资单：图片 ===================== */
// 纸张噪点：生成一张小噪点贴图，再平铺满整张画布（比逐像素快得多）
let _noise = null;
function noisePattern(ctx){
  if (!_noise){
    const N = 128, t = document.createElement("canvas");
    t.width = t.height = N;
    const tc = t.getContext("2d"), img = tc.createImageData(N, N);
    for (let i = 0; i < img.data.length; i += 4){
      const v = (Math.random() * 255) | 0;
      img.data[i] = img.data[i+1] = img.data[i+2] = v;
      img.data[i+3] = 12;                   // 很淡，只是让纸面不死板
    }
    tc.putImageData(img, 0, 0);
    _noise = t;
  }
  return ctx.createPattern(_noise, "repeat");
}

function drawSlip(emp, snapshot){
  const r = snapshot.payroll, ym = snapshot.month;
  const W = 1080, PAD = 92;
  const sections = buildSections(emp, snapshot);
  const ROW0 = 566, ROWH = 56, HEAD = 78, SUB = 62, GAP = 34;   // 行高 / 段标题 / 小计 / 段间距
  const blockH = s => HEAD + s.rows.length * ROWH + (s.sub != null ? SUB : 0) + GAP;
  const H = ROW0 + sections.reduce((h,s) => h + blockH(s), 0) + 300;

  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");

  // 单一纸色，不用渐变；层次交给线条
  x.fillStyle = "#FAF8F5"; x.fillRect(0, 0, W, H);
  x.fillStyle = noisePattern(x);            // 纸张噪点
  x.fillRect(0, 0, W, H);

  const INK = "#141210", INK2 = "#6B6259", INK3 = "#A79E95";
  const LINE = "#E6DFD6", LINE_SOFT = "#EFE9E1";
  const GOLD = "#A9873F", GOLD_LITE = "#C9B183", RED = "#AE6558";
  const F  = (w,s) => `${w} ${s}px -apple-system, "SF Pro Display", "PingFang SC", sans-serif`;
  const SERIF = s => `400 ${s}px Didot, "Bodoni 72", "Playfair Display", Georgia, "Times New Roman", serif`;
  const SONG  = s => `400 ${s}px "Songti SC", "STSong", serif`;
  const track = (text, px, py, sp, font, style) => {   // 手绘字距，兼容性最好
    x.font = font; x.fillStyle = style; x.textAlign = "left";
    let cx = px;
    for (const ch of text){ x.fillText(ch, cx, py); cx += x.measureText(ch).width + sp; }
    return cx - sp;
  };

  // 字标：Didone 衬线 + 金箔渐变 + 发丝线 + 宋体
  const foil = x.createLinearGradient(PAD, 96, PAD + 300, 156);
  foil.addColorStop(0, "#E7D2A0"); foil.addColorStop(.34, "#B2914F");
  foil.addColorStop(.52, "#8C6C2C"); foil.addColorStop(.74, "#D9BE7E");
  foil.addColorStop(1, "#A9873F");
  const wmEnd = track("TSMP", PAD, 146, 17, SERIF(56), foil);

  x.fillStyle = GOLD_LITE; x.fillRect(PAD, 168, wmEnd - PAD, 1);

  track("工资单", PAD, 200, 11, SONG(19), INK3);

  x.textAlign = "right"; x.font = F(400, 26); x.fillStyle = INK2;
  x.fillText(monthLabel(ym), W - PAD, 146);

  x.fillStyle = LINE; x.fillRect(0, 268, W, 1);          // 整幅通栏线

  x.textAlign = "left";
  track(emp.role, PAD, 336, 6, F(500, 22), GOLD);
  x.font = F(600, 84); x.fillStyle = INK;
  x.fillText(emp.name, PAD, 434);

  x.fillStyle = LINE; x.fillRect(0, 490, W, 1);

  let yy = ROW0;
  sections.forEach(s => {
    // 段标题 + 段首金线
    track(s.title, PAD, yy, 7, F(500, 22), GOLD);
    x.fillStyle = GOLD_LITE; x.fillRect(PAD, yy + 24, W - PAD*2, 1);
    yy += HEAD;

    s.rows.forEach(([t, val, cls], i) => {
      if (i) { x.fillStyle = LINE_SOFT; x.fillRect(PAD, yy - 38, W - PAD*2, 1); }  // 行间发丝线

      // 先量右边数值实际占多宽，剩下的才是标签的地方，避免一刀切截断
      x.font = F(500, 28);
      const valW = x.measureText(val).width;
      x.fillStyle = String(val).startsWith("-") || cls === "miss" ? RED : INK;
      x.textAlign = "right";
      x.fillText(val, W - PAD, yy);

      x.font = F(400, 26);
      x.fillStyle = cls === "miss" ? RED : INK2;
      x.textAlign = "left";
      const room = W - PAD*2 - valW - 36;
      let label = t;
      while (x.measureText(label).width > room && label.length > 6)
        label = label.slice(0, -2) + "…";
      x.fillText(label, PAD, yy);
      yy += ROWH;
    });

    if (s.sub != null){
      x.fillStyle = LINE; x.fillRect(PAD, yy - 32, W - PAD*2, 1);
      x.font = F(400, 24); x.fillStyle = INK3; x.textAlign = "left";
      x.fillText("小计", PAD, yy + 10);
      x.font = F(600, 28);
      x.fillStyle = s.sub < 0 ? RED : INK;
      x.textAlign = "right";
      x.fillText(sig(s.sub), W - PAD, yy + 10);
      yy += SUB;
    }
    yy += GAP;
  });

  yy -= GAP;
  yy += 26;
  x.fillStyle = GOLD; x.fillRect(0, yy, W, 1);           // 通栏金线，压住整张单子

  yy += 88;
  x.textAlign = "left";
  track("实发合计", PAD, yy, 5, F(400, 22), INK3);
  x.textAlign = "right"; x.font = F(300, 92); x.fillStyle = GOLD;
  x.fillText(y(r.total), W - PAD, yy + 26);

  x.fillStyle = LINE; x.fillRect(PAD, H - 148, W - PAD*2, 1);
  x.textAlign = "right";
  track("TSMP", W - PAD - 78, H - 100, 6, SERIF(22), GOLD_LITE);
  return c;
}

function exportImage(id){
  const snapshot = Ledger.getSnapshot(repo.book,id,currentMonth);
  const emp = STAFF.find(e => e.id === id);
  const c = drawSlip(emp, snapshot);
  const name = `${emp.name}-${fileMonth(snapshot.month)}-工资单.png`;
  // Keep image generation inside the export action. Repeated detached-canvas
  // toBlob callbacks were deferred in repeated browser export checks.
  const encoded = c.toDataURL('image/png').split(',')[1];
  if(!encoded) throw new Error('图片编码失败');
  const bytes = Uint8Array.from(atob(encoded), ch=>ch.charCodeAt(0));
  const blob = new Blob([bytes], {type:'image/png'});
  const link = document.getElementById('veilDl');
  if(link.href.startsWith('blob:')) URL.revokeObjectURL(link.href);
  const url = URL.createObjectURL(blob);
  document.getElementById('veilImg').src = url;
  link.href = url; link.download = name;
  document.getElementById('veil').classList.add('on');
}
function closeVeil(){ document.getElementById("veil").classList.remove("on"); }
document.getElementById("veil").addEventListener("click", e => {
  if (e.target.id === "veil") closeVeil();
});

/* ===================== 单人工资单：Word ===================== */
function exportWord(id){
  const snapshot = Ledger.getSnapshot(repo.book,id,currentMonth);
  const emp = STAFF.find(e => e.id === id);
  const r = snapshot.payroll;
  const rows = buildSections(emp, snapshot).map(s => `
      <tr><td colspan="2" style="padding:20px 0 6px;color:#B2914F;font-size:12px;letter-spacing:3px;border-bottom:1px solid #E4D3AE">${s.title}</td></tr>
      ${s.rows.map(([t,val,cls]) => `<tr>
        <td style="padding:8px 0;color:${cls==="miss"?"#B4746A":"#5b524b"};border-bottom:1px solid #f0e9e6">${t}</td>
        <td style="padding:8px 0;text-align:right;color:${String(val).startsWith("-")||cls==="miss"?"#B4746A":"#17130F"};border-bottom:1px solid #f0e9e6">${val}</td>
      </tr>`).join("")}
      ${s.sub != null ? `<tr>
        <td style="padding:8px 0;color:#8a8078">小计</td>
        <td style="padding:8px 0;text-align:right;font-weight:bold;color:${s.sub<0?"#B4746A":"#17130F"}">${sig(s.sub)}</td>
      </tr>` : ""}`).join("");

  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>${emp.name} ${monthLabel(snapshot.month)} 工资单</title></head>
    <body style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;color:#17130F">
      <div style="width:520px">
        <p style="margin:0;font-family:Didot,'Bodoni 72',Georgia,'Times New Roman',serif;font-size:27px;letter-spacing:9px;color:#A9873F">TSMP</p>
        <div style="height:1px;background:#C9A96A;margin:6px 0 5px;width:196px"></div>
        <p style="margin:0;font-family:'Songti SC',SimSun,serif;font-size:11px;letter-spacing:6px;color:#a79b92">工资单</p>
        <p style="margin:10px 0 22px;color:#8a8078;font-size:13px">${monthLabel(snapshot.month)}</p>
        <p style="margin:0;color:#B2914F;font-size:12px;letter-spacing:3px">${emp.role}</p>
        <p style="margin:2px 0 18px;font-size:30px;font-weight:bold">${emp.name}</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>
        <table style="width:100%;border-collapse:collapse;margin-top:18px">
          <tr>
            <td style="color:#8a8078;font-size:13px;letter-spacing:3px">实发合计</td>
            <td style="text-align:right;font-size:26px;color:#A9873F;font-weight:bold">${y(r.total)}</td>
          </tr>
        </table>
      </div>
    </body></html>`;

  const blob = new Blob(["﻿", html], { type:"application/msword" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${emp.name}-${fileMonth(snapshot.month)}-工资单.doc`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

