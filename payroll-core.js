/* Shared payroll formulas: browser and Node tests. */
(function(root){
"use strict";
/* ===================== 规则配置 ===================== */
const WAN = 10000;

const RULES = {
  store: { rate: 0.001, min: 600000 },   // 店长总店提成：千分之一，总店满 60 万才有

  tiers: [                               // 个人业绩提成，店长与销售共用
    { min: 200000, acd: 0.02, b: 0.01  },
    { min: 150000, acd: 0.01, b: 0.005 }
  ],
  floor: 150000,

  manager:  { pay:{ basic:8000, social:0,    attend:0,   meal:0   }, freeDays:2 },
  sales:    { pay:{ basic:2500, social:1200, attend:500, meal:300 }, freeDays:2 },
  finance:  { pay:{ basic:5200, social:1200, attend:100, meal:300 }, freeDays:2 },
  delivery: { pay:{ basic:4200, social:1200, attend:100, meal:300 }, freeDays:2, perTrip:15 },

  // 财务 / 配送 业绩奖金：每满 10 万一格，零头不算；满 60 万后全部格子按 200
  perfBonus: [
    { min: 600000, per100k: 200 },
    { min: 400000, per100k: 100 }
  ]
};

["manager","sales","finance","delivery"].forEach(t => {
  const p = RULES[t].pay, n = x => x.toLocaleString("zh-CN");
  RULES[t].base = p.basic + p.social + p.attend + p.meal;
  RULES[t].dailyBase = p.basic + p.social + p.meal;      // 日薪基数不含全勤奖
  RULES[t].baseNote = (p.social || p.attend || p.meal)
    ? `基本 ${n(p.basic)} + 社保 ${n(p.social)} + 全勤 ${n(p.attend)} + 中餐 ${n(p.meal)}`
    : `基本工资 ${n(p.basic)}`;
});

const STAFF = [
  { id:"wuxuan",  name:"吴璇",   role:"店长", type:"manager"  },
  { id:"xiaoxue", name:"小雪",   role:"销售", type:"sales"    },
  { id:"xiaotao", name:"小桃",   role:"销售", type:"sales"    },
  { id:"zhugk",   name:"朱国坤", role:"财务", type:"finance"  },
  { id:"qiujb",   name:"邱家斌", role:"配送", type:"delivery" }
];

/* ===================== 计算 ===================== */
const r2 = n => Math.round(n*100)/100;
const y  = n => "¥" + r2(n).toLocaleString("zh-CN",{minimumFractionDigits:0,maximumFractionDigits:2});
const sig = n => (n<0 ? "-" + y(-n) : y(n));

function perfBonus(p){
  for (const t of RULES.perfBonus){
    if (p < t.min) continue;
    const units = Math.floor(p/100000);
    return { amt: units * t.per100k, note: `业绩奖金（${units} 个 10 万 × ${t.per100k} 元）` };
  }
  const need = RULES.perfBonus[RULES.perfBonus.length-1].min;
  return { amt: 0, note: `业绩奖金 — 总店未达 ${need/WAN} 万，无奖金`, miss: true };
}

function personalCommission(acd, b, lines){
  const total = acd + b;
  const tier = RULES.tiers.find(t => total >= t.min);
  if (!tier){
    lines.push(["个人提成 — 未达 15 万门槛，差 " + y(RULES.floor - total), 0, "miss", "bonus"]);
    return 0;
  }
  const ca = r2(acd * tier.acd), cb = r2(b * tier.b);
  lines.push(["个人业绩合计 " + y(total) + " → 满 " + (tier.min/WAN) + " 万档", null, "", "bonus"]);
  lines.push(["A/C/D 类提成（" + (tier.acd*100) + "%）", ca, "", "bonus"]);
  lines.push(["B 类提成（" + (tier.b*100) + "%）", cb, "", "bonus"]);
  return ca + cb;
}

function leaveDeduct(R, days, monthDays, lines, available = R.freeDays){
  if (days <= 0) return 0;
  const n = x => x.toLocaleString("zh-CN");
  if (days <= available){
    lines.push([`请假 ${days} 天 — 在本月可休 ${available} 天正常休息内，不扣`, null, "", "deduct"]);
    return 0;
  }
  let sum = 0;
  if (R.pay.attend > 0){
    lines.push([`休息超过本月可休 ${available} 天 — 扣全勤奖`, -R.pay.attend, "", "deduct"]);
    sum += R.pay.attend;
  }
  const over = days - available;
  const amt = r2(R.dailyBase / monthDays * over);
  lines.push([`请假扣款（${n(R.dailyBase)} ÷ ${monthDays} 天 × ${over} 天）`, -amt, "", "deduct"]);
  return sum + amt;
}

function calc(emp, v, storePerf, monthDays, available = 2){
  const acd = v.acd||0, b = v.b||0, adj = v.adj||0, leave = v.leave||0;
  const R = RULES[emp.type];
  const lines = [];
  let extra = 0;
  const base = R.base;
  lines.push(["底薪（" + R.baseNote + "）", base, "", "base"]);

  if (emp.type === "manager"){
    let sc = 0;
    if (storePerf >= RULES.store.min){
      sc = r2(storePerf * RULES.store.rate);
      lines.push(["总店提成（" + y(storePerf) + " × 千分之一）", sc, "", "bonus"]);
    } else {
      lines.push(["总店提成 — 总店未达 " + (RULES.store.min/WAN) + " 万，无提成（差 " + y(RULES.store.min - storePerf) + "）", 0, "miss", "bonus"]);
    }
    extra = sc + personalCommission(acd, b, lines);
  }

  if (emp.type === "sales") extra = personalCommission(acd, b, lines);

  if (emp.type === "finance" || emp.type === "delivery"){
    if (emp.type === "delivery"){
      const trips = v.trips||0, tc = trips * R.perTrip;
      lines.push(["送货提成（" + trips + " 趟 × " + R.perTrip + " 元）", tc, "", "bonus"]);
      extra += tc;
    }
    const bonus = perfBonus(storePerf);
    lines.push([bonus.note, bonus.amt, bonus.miss ? "miss" : "", "bonus"]);
    extra += bonus.amt;
  }

  const deduct = leaveDeduct(R, leave, monthDays, lines, available);
  if (adj !== 0) lines.push([adj > 0 ? "其他补贴 / 奖励" : "其他扣款", adj, "", adj > 0 ? "bonus" : "deduct"]);
  return { base, extra, adj, deduct, total: r2(base + extra + adj - deduct), lines };
}


const api = { RULES, STAFF, calc, r2, y, sig };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.Payroll = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
