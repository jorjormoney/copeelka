import { firebaseConfig } from "./firebase-config.js";
import { LocalStore, FirebaseStore } from "./store.js";

const $ = (id) => document.getElementById(id);
const DAY = 86400000;
const rub = (n) => Math.round(Number(n) || 0).toLocaleString("ru-RU") + " ₽";
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const todayStr = () => ymd(new Date());
const parse = (s) => { if (!s) return null; const [y, m, d] = String(s).split("-").map(Number); return y ? new Date(y, m - 1, d) : null; };
const today = () => parse(todayStr());
const daysBetween = (a, b) => Math.round((b - a) / DAY);
const ruDate = (s) => { const d = parse(s); return d ? d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : "—"; };
const addMonths = (s, m) => { const d = parse(s) || today(); d.setMonth(d.getMonth() + Number(m)); return ymd(d); };

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids) if (c != null && c !== false) e.append(c);
  return e;
}
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); }

// ---------- Стартовые предложения (проверено 26.11.2026) ----------
const SEED_OFFERS = [
  { bank: "ВТБ", product: "Накопительный счёт, акция для новичков", rate: 20, months: 2, rateAfter: 6, limitMax: 50000, limit: "до 50 000 ₽", term: "2 месяца", conditions: "Только для новых клиентов продукта: проверь в приложении, подходишь ли. Потом около 6%.", checked: "приложение ВТБ, 26.11.2026" },
  { bank: "Альфа-Банк", product: "Апельсиновая карта, процент на остаток", rate: 17, limitMax: 25000, limit: "на сумму 10 000–25 000 ₽", term: "пока действует тариф", conditions: "Держи на карте около 25 000 ₽: на остальное 17% не начисляют.", checked: "приложение Альфы, 26.11.2026" },
  { bank: "Альфа-Банк", product: "Альфа-Счёт", rate: 15, until: "2027-01-31", rateAfter: 7, limit: "без жёсткого лимита", term: "до 31.01.2027", conditions: "Процент на минимальный остаток. Повышенная ставка при покупках по картам Альфы, без покупок около 7%.", checked: "vbr.ru, 23.11.2026" },
  { bank: "ВТБ", product: "ВТБ-Счёт (накопительный)", rate: 14.7, months: 2, rateAfter: 6, limitMax: 1000000, limit: "до 1 000 000 ₽", term: "первые 2 месяца", conditions: "Приветственная ставка, потом около 6%.", checked: "vbr.ru, 30.10.2026" },
  { bank: "Любой крупный банк", product: "Вклад на 3–6 месяцев", rate: 13.7, months: 3, limit: "до 1,4 млн ₽ под АСВ", term: "3–6 месяцев", conditions: "Ставка зафиксирована, досрочное закрытие теряет проценты. Средняя по топ-20 банкам на 16.11.2026.", checked: "finance.mail.ru, 11.2026" },
  { bank: "ВТБ", product: "Инвесткопилка (фонд денежного рынка)", rate: 13.5, limit: "без лимита", term: "без срока, вывод 1–3 дня", conditions: "Около ключевой минус комиссия. Не застрахована АСВ, НДФЛ 13% с дохода. Запасной вариант.", checked: "оценка на 26.11.2026" },
];

// ---------- Расчёты ----------
function accrued(b) {
  const op = parse(b.opened), un = parse(b.until), t = today();
  if (!op || t <= op) return 0;
  const amt = Number(b.amount) || 0, r = (Number(b.rate) || 0) / 100, ra = (Number(b.rateAfter) || 0) / 100;
  if (!un || t <= un) return amt * r * daysBetween(op, t) / 365;
  return amt * r * daysBetween(op, un) / 365 + amt * ra * daysBetween(un, t) / 365;
}
function projected(b) {
  const op = parse(b.opened), un = parse(b.until);
  return op && un ? (Number(b.amount) || 0) * (Number(b.rate) || 0) / 100 * daysBetween(op, un) / 365 : null;
}
function stateOf(b) {
  const un = parse(b.until);
  if (!un) return { cls: "", pill: "без срока", pcls: "gray", left: null };
  const left = daysBetween(today(), un);
  if (left < 0) return { cls: "danger", pill: "ставка кончилась " + -left + " дн. назад", pcls: "danger", left };
  if (left <= 7) return { cls: "warn", pill: left === 0 ? "последний день" : "осталось " + left + " дн.", pcls: "warn", left };
  return { cls: "", pill: "ещё " + left + " дн.", pcls: "", left };
}
function derive(s) {
  const goal = Number(s.meta.goal) || 400000;
  const active = s.buckets.filter((b) => b.status !== "closed");
  const closed = s.buckets.filter((b) => b.status === "closed");
  const deposited = s.deposits.reduce((a, d) => a + (Number(d.amount) || 0), 0);
  const earned = closed.reduce((a, b) => a + (Number(b.earned) || 0), 0);
  const total = deposited + earned;
  const placed = active.reduce((a, b) => a + (Number(b.amount) || 0), 0);
  const free = total - placed;
  const accr = active.reduce((a, b) => a + accrued(b), 0);
  const level = Math.min(4, Math.floor(total / (goal / 4)));
  const months = new Set(s.deposits.map((d) => String(d.date || "").slice(0, 7)));
  const cur = todayStr().slice(0, 7);
  let streak = 0; const d = today(); d.setDate(1);
  if (!months.has(cur)) d.setMonth(d.getMonth() - 1);
  while (months.has(ymd(d).slice(0, 7))) { streak++; d.setMonth(d.getMonth() - 1); }
  return { goal, active, closed, deposited, earned, total, placed, free, accr, level, streak, depositedThisMonth: months.has(cur) };
}
const LEVELS = ["Старт", "Разгон", "Половина пути", "Финишная прямая", "Подушка готова"];

// ---------- Напоминания ----------
function remindDate(b) { const un = parse(b.until); if (!un) return null; return new Date(un.getTime() - 2 * DAY); }
function gcalLink(b) {
  const d = remindDate(b); if (!d) return null;
  const f = (x) => ymd(x).replaceAll("-", "");
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: "copeelka: перенести деньги из «" + (b.bank || "") + "»",
    dates: f(d) + "/" + f(new Date(d.getTime() + DAY)),
    details: "Повышенная ставка " + b.rate + "% по «" + (b.product || b.bank) + "» заканчивается " + ruDate(b.until) + ". Сумма " + rub(b.amount) + ".",
  });
  return "https://calendar.google.com/calendar/render?" + p.toString();
}
function icsFile(b) {
  const d = remindDate(b); if (!d) return null;
  const f = (x) => ymd(x).replaceAll("-", "");
  const esc = (s) => String(s).replace(/[\\,;]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  const uid = (b.id || Date.now()) + "@kopilka";
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//kopilka//RU", "BEGIN:VEVENT",
    "UID:" + uid, "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z",
    "DTSTART;VALUE=DATE:" + f(d), "DTEND;VALUE=DATE:" + f(new Date(d.getTime() + DAY)),
    "SUMMARY:" + esc("copeelka: перенести деньги из «" + (b.bank || "") + "»"),
    "DESCRIPTION:" + esc("Ставка " + b.rate + "% заканчивается " + ruDate(b.until) + ". Сумма " + rub(b.amount) + "."),
    "BEGIN:VALARM", "TRIGGER:PT10H", "ACTION:DISPLAY", "DESCRIPTION:" + esc("Пора переносить деньги"), "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}
function download(name, text, type) {
  const a = el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- Эффекты ----------
function confetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = $("fx"), ctx = c.getContext("2d");
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; ctx.scale(devicePixelRatio, devicePixelRatio);
  const css = getComputedStyle(document.documentElement);
  const colors = ["--accent", "--gold", "--warn"].map((v) => css.getPropertyValue(v).trim());
  const parts = Array.from({ length: 90 }, () => ({ x: innerWidth / 2, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 9 - 3, s: 4 + Math.random() * 5, c: colors[Math.floor(Math.random() * colors.length)], r: Math.random() * 6 }));
  let t = 0;
  (function frame() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.28; p.r += 0.2; ctx.fillStyle = p.c; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore(); }
    if (++t < 90) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
}

// ---------- Шторка с формой ----------
let sheetHandler = null, sheetDelete = null;
function openSheet({ title, fields, submit = "Сохранить", onSubmit, onDelete }) {
  $("sheet-title").textContent = title;
  $("sheet-ok").textContent = submit;
  const box = $("sheet-fields"); box.replaceChildren();
  for (const f of fields) {
    if (f.type === "note") { box.append(el("p", { class: "hint wide", text: f.text })); continue; }
    if (f.type === "checkbox") {
      box.append(el("label", { class: "check wide", for: "fld-" + f.id }, el("input", { type: "checkbox", id: "fld-" + f.id, checked: !!f.value }), f.label));
      continue;
    }
    const input = f.type === "textarea"
      ? el("textarea", { id: "fld-" + f.id, placeholder: f.placeholder || null })
      : el("input", { id: "fld-" + f.id, type: f.type || "text", inputmode: f.inputmode || null, step: f.step || null, min: f.min ?? null, placeholder: f.placeholder || null });
    input.value = f.value ?? "";
    box.append(el("label", { for: "fld-" + f.id, class: f.wide ? "wide" : null }, f.label, input, f.hint ? el("span", { class: "hint", text: f.hint }) : null));
  }
  sheetHandler = onSubmit; sheetDelete = onDelete || null;
  $("sheet-delete").hidden = !onDelete; $("sheet-delete").dataset.confirm = "";
  $("sheet-delete").textContent = "Удалить";
  $("sheet").showModal();
  const first = box.querySelector("input,textarea"); if (first) first.focus();
}
function val(id) { const e = $("fld-" + id); if (!e) return undefined; if (e.type === "checkbox") return e.checked; return e.value.trim(); }
function num(id) { const v = val(id); return v === "" || v == null ? null : Number(String(v).replace(",", ".")); }
$("sheet-cancel").addEventListener("click", () => $("sheet").close());
$("sheet-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!sheetHandler) return;
  $("sheet-ok").disabled = true;
  try { const ok = await sheetHandler(); if (ok !== false) $("sheet").close(); }
  catch (e) { toast("Не сохранилось: " + (e && (e.code || e.message) || "ошибка")); }
  $("sheet-ok").disabled = false;
});
$("sheet-delete").addEventListener("click", async () => {
  const b = $("sheet-delete");
  if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Точно удалить?"; return; }
  try { await sheetDelete(); $("sheet").close(); toast("Удалено"); } catch (e) { toast("Не удалилось"); }
});

// ---------- Действия ----------
let store, S = { meta: {}, buckets: [], deposits: [], offers: [] }, prevLevel = null;

function bucketForm(b, offer) {
  const src = b || {};
  const o = offer || {};
  const until = src.until || o.until || (o.months ? addMonths(todayStr(), o.months) : "");
  openSheet({
    title: b ? "Изменить корзину" : "Новая корзина",
    fields: [
      { id: "bank", label: "Банк", value: src.bank || o.bank || "", placeholder: "ВТБ" },
      { id: "product", label: "Продукт", value: src.product || o.product || "", placeholder: "Накопительный счёт" },
      { id: "amount", label: "Сумма, ₽", type: "number", inputmode: "numeric", min: 0, step: "100", value: src.amount ?? "", placeholder: "50000" },
      { id: "rate", label: "Ставка, % годовых", type: "number", inputmode: "decimal", min: 0, step: "0.1", value: src.rate ?? o.rate ?? "" },
      { id: "opened", label: "Открыл", type: "date", value: src.opened || todayStr() },
      { id: "until", label: "Повышенная ставка до", type: "date", value: until, hint: "пусто — бессрочно" },
      { id: "rateAfter", label: "Ставка после, %", type: "number", inputmode: "decimal", min: 0, step: "0.1", value: src.rateAfter ?? o.rateAfter ?? "" },
      { id: "limitMax", label: "Лимит суммы, ₽", type: "number", inputmode: "numeric", min: 0, step: "1000", value: src.limitMax ?? o.limitMax ?? "" },
      { id: "note", label: "Условия и заметки", type: "textarea", wide: true, value: src.note || o.conditions || "" },
    ],
    onSubmit: async () => {
      const data = { bank: val("bank"), product: val("product"), amount: num("amount"), rate: num("rate"), opened: val("opened"), until: val("until") || null, rateAfter: num("rateAfter"), limitMax: num("limitMax"), note: val("note") };
      if (!data.bank || !(data.amount > 0) || data.rate == null || !data.opened) { toast("Заполни банк, сумму, ставку и дату открытия"); return false; }
      const D = derive(S);
      if (!b && data.amount > D.free + 0.5) toast("Свободных денег меньше, чем сумма корзины. Добавь пополнение.");
      if (b) { await store.update("buckets", b.id, data); toast("Корзина обновлена"); }
      else { await store.add("buckets", { ...data, status: "active", createdAt: new Date().toISOString() }); toast("Корзина открыта. Поставь напоминание 🔔"); confetti(); }
    },
    onDelete: b ? () => store.remove("buckets", b.id) : null,
  });
}
function closeForm(b) {
  openSheet({
    title: "Забрать деньги: " + b.bank,
    submit: "Забрал",
    fields: [
      { type: "note", text: "Сумма " + rub(b.amount) + " и проценты вернутся в «Свободные», корзина уйдёт в историю." },
      { id: "earned", label: "Сколько пришло процентов, ₽", type: "number", inputmode: "numeric", min: 0, step: "1", value: Math.round(accrued(b)) },
      { id: "closedAt", label: "Дата", type: "date", value: todayStr() },
    ],
    onSubmit: async () => {
      const earned = Math.max(0, num("earned") || 0);
      await store.update("buckets", b.id, { status: "closed", earned, closedAt: val("closedAt") || todayStr() });
      toast("+" + rub(earned) + " процентами. Теперь найди новую корзину!"); confetti();
    },
  });
}
function depositForm(d) {
  openSheet({
    title: d ? "Изменить пополнение" : "Пополнить копилку",
    fields: [
      { id: "amount", label: "Сумма, ₽", type: "number", inputmode: "numeric", min: 0, step: "100", value: d ? d.amount : "", placeholder: "30000" },
      { id: "date", label: "Дата", type: "date", value: d ? d.date : todayStr() },
      { id: "note", label: "Комментарий", wide: true, value: d ? d.note || "" : "", placeholder: "Зарплата, премия…" },
    ],
    onSubmit: async () => {
      const data = { amount: num("amount"), date: val("date") || todayStr(), note: val("note") };
      if (!(data.amount > 0)) { toast("Впиши сумму"); return false; }
      if (d) await store.update("deposits", d.id, data);
      else { await store.add("deposits", { ...data, createdAt: new Date().toISOString() }); toast("+" + rub(data.amount) + " в копилку"); confetti(); }
    },
    onDelete: d ? () => store.remove("deposits", d.id) : null,
  });
}
function offerForm(o) {
  const src = o || {};
  openSheet({
    title: o ? "Изменить предложение" : "Новое предложение",
    fields: [
      { id: "bank", label: "Банк", value: src.bank || "" },
      { id: "product", label: "Продукт", value: src.product || "" },
      { id: "rate", label: "Ставка, %", type: "number", inputmode: "decimal", step: "0.1", value: src.rate ?? "" },
      { id: "months", label: "Сколько месяцев действует", type: "number", inputmode: "numeric", step: "1", value: src.months ?? "", hint: "или дата ниже" },
      { id: "until", label: "Действует до", type: "date", value: src.until || "" },
      { id: "rateAfter", label: "Ставка после, %", type: "number", inputmode: "decimal", step: "0.1", value: src.rateAfter ?? "" },
      { id: "limitMax", label: "Лимит, ₽", type: "number", inputmode: "numeric", step: "1000", value: src.limitMax ?? "" },
      { id: "conditions", label: "Условия", type: "textarea", wide: true, value: src.conditions || "" },
    ],
    onSubmit: async () => {
      const data = { bank: val("bank"), product: val("product"), rate: num("rate"), months: num("months"), until: val("until") || null, rateAfter: num("rateAfter"), limitMax: num("limitMax"), conditions: val("conditions"), limit: num("limitMax") ? "до " + rub(num("limitMax")) : (src.limit || ""), term: num("months") ? num("months") + " мес." : (val("until") ? "до " + ruDate(val("until")) : (src.term || "")), checked: "добавлено " + ruDate(todayStr()) };
      if (!data.bank || data.rate == null) { toast("Нужны банк и ставка"); return false; }
      if (o) await store.update("offers", o.id, data); else await store.add("offers", data);
    },
    onDelete: o ? () => store.remove("offers", o.id) : null,
  });
}

function goalForm(first) {
  openSheet({
    title: first ? "Добро пожаловать в copeelka!" : "Цель",
    submit: first ? "Поехали" : "Сохранить",
    fields: [
      first ? { type: "note", text: "Поставь цель: на что копишь и сколько нужно. Прогресс, уровни и достижения будут считаться от неё. Поменять можно потом во вкладке «Ещё»." } : null,
      { id: "goalName", label: "На что коплю", value: S.meta.goalName || "", placeholder: "Подушка безопасности" },
      { id: "goal", label: "Сколько нужно, ₽", type: "number", inputmode: "numeric", min: 1000, step: "1000", value: S.meta.goal || "", placeholder: "400000" },
    ].filter(Boolean),
    onSubmit: async () => {
      const goal = num("goal");
      if (!(goal > 0)) { toast("Впиши сумму цели"); return false; }
      await store.setMeta({ goal, goalName: val("goalName") || "Моя цель" });
      if (first) toast("Цель поставлена. Начни с «+ Пополнить»");
    },
  });
}

// ---------- Отрисовка ----------
function bucketCard(b) {
  const s = stateOf(b), proj = projected(b);
  const over = b.limitMax && Number(b.amount) > Number(b.limitMax);
  const link = gcalLink(b);
  return el("article", { class: "card " + s.cls },
    el("div", { class: "card-top" },
      el("div", null, el("div", { class: "card-title", text: b.bank }), el("div", { class: "card-sub", text: b.product || "" })),
      el("span", { class: "pill " + s.pcls, text: s.pill })),
    el("dl", { class: "kv" },
      el("dt", { text: "Сумма" }), el("dd", { text: rub(b.amount) }),
      el("dt", { text: "Ставка" }), el("dd", { text: b.rate + "%" + (b.until ? " до " + ruDate(b.until) : "") }),
      el("dt", { text: "Набежало" }), el("dd", { text: "≈ " + rub(accrued(b)) }),
      proj != null && el("dt", { text: "За срок акции" }), proj != null && el("dd", { text: "≈ " + rub(proj) }),
      b.rateAfter != null && el("dt", { text: "Потом" }), b.rateAfter != null && el("dd", { text: b.rateAfter + "%" }),
      b.limitMax && el("dt", { text: "Лимит" }), b.limitMax && el("dd", { text: rub(b.limitMax) })),
    over && el("span", { class: "pill warn", text: "Сумма больше лимита: на излишек ставка ниже" }),
    b.note && el("div", { class: "note", text: b.note }),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "small primary", text: "Забрать", onclick: () => closeForm(b) }),
      link && el("a", { class: "btn small", href: link, target: "_blank", rel: "noopener", text: "🔔 Google" }),
      link && el("button", { type: "button", class: "small", text: "📅 .ics", onclick: () => download("kopilka-" + (b.bank || "reminder") + ".ics", icsFile(b), "text/calendar") }),
      el("button", { type: "button", class: "small", text: "Изменить", onclick: () => bucketForm(b) })));
}

function render() {
  const D = derive(S);
  $("total").textContent = Math.round(D.total).toLocaleString("ru-RU");
  $("goalv").textContent = Math.round(D.goal).toLocaleString("ru-RU");
  $("goal-name").textContent = S.meta.goalName || "Моя цель";
  const pct = Math.max(0, Math.min(100, D.total / D.goal * 100));
  $("barfill").style.width = pct.toFixed(1) + "%";
  $("bar").setAttribute("aria-valuenow", pct.toFixed(0));
  const lvl = $("level");
  lvl.textContent = (D.level === 4 ? "🏆 " : "") + "Уровень " + (D.level + 1) + " · " + LEVELS[D.level];
  if (prevLevel != null && D.level > prevLevel) { lvl.classList.remove("pop"); void lvl.offsetWidth; lvl.classList.add("pop"); confetti(); toast("Новый уровень: " + LEVELS[D.level] + "!"); }
  prevLevel = D.level;
  $("s-placed").textContent = rub(D.placed);
  $("s-free").textContent = rub(D.free);
  $("s-accr").textContent = "≈ " + rub(D.accr);
  $("s-earned").textContent = rub(D.earned);

  const sorted = D.active.slice().sort((a, b) => (stateOf(a).left ?? 1e9) - (stateOf(b).left ?? 1e9));
  const attn = sorted.filter((b) => { const l = stateOf(b).left; return l != null && l <= 7; });
  $("attn-block").hidden = !attn.length;
  $("attn-count").textContent = attn.length ? attn.length + " шт." : "";
  $("attn").replaceChildren(...attn.map(bucketCard));
  const rest = sorted.filter((b) => !attn.includes(b));
  $("buckets").replaceChildren(...rest.map(bucketCard));
  $("buckets-empty").hidden = D.active.length > 0;
  $("buckets-count").textContent = D.active.length ? D.active.length + " шт." : "";

  const banks = new Set(D.active.map((b) => (b.bank || "").trim().toLowerCase()).filter(Boolean));
  const overdue = D.active.some((b) => { const l = stateOf(b).left; return l != null && l < 0; });
  const quests = [
    ["Пополнить копилку в этом месяце", D.depositedThisMonth],
    ["Ни одной корзины с закончившейся ставкой", D.active.length > 0 && !overdue],
    ["Деньги работают: свободных меньше 10%", D.total > 0 && D.free <= D.total * 0.1],
    ["Деньги разложены минимум в 2 банка", banks.size >= 2],
  ];
  $("quests").replaceChildren(...quests.map(([t, done]) => el("li", { class: done ? "done" : "" }, el("span", { class: "mark", text: done ? "✓" : "" }), el("span", { text: t }))));
  $("streak").textContent = D.streak ? "🔥 серия пополнений: " + D.streak + " мес." : "";

  const badges = [
    ["Первое пополнение", S.deposits.length > 0],
    ["Первая корзина", S.buckets.length > 0],
    ["Первый перенос", D.closed.length > 0],
    ["1 000 ₽ процентами", D.earned + D.accr >= 1000],
    ["10 000 ₽ процентами", D.earned + D.accr >= 10000],
    ["Три банка", banks.size >= 3],
    ["Серия 3 месяца", D.streak >= 3],
    ["Серия 6 месяцев", D.streak >= 6],
    ["Четверть цели", D.total >= D.goal / 4],
    ["Половина цели", D.total >= D.goal / 2],
    ["Подушка готова", D.total >= D.goal],
  ];
  $("badges").replaceChildren(...badges.map(([t, on]) => el("span", { class: "badge" + (on ? " on" : ""), text: (on ? "★ " : "") + t })));

  const offers = S.offers.slice().sort((a, b) => (Number(b.rate) || 0) - (Number(a.rate) || 0));
  $("offers").replaceChildren(...offers.map((o) => el("article", { class: "card" },
    el("div", { class: "card-top" },
      el("div", null, el("div", { class: "card-title", text: o.bank }), el("div", { class: "card-sub", text: o.product || "" })),
      el("span", { class: "rate-big", text: (o.rate ?? "—") + "%" })),
    el("div", { class: "card-sub", text: [o.limit, o.term].filter(Boolean).join(" · ") }),
    o.conditions && el("div", { class: "note", text: o.conditions }),
    o.checked && el("div", { class: "hint", text: "проверено: " + o.checked }),
    el("div", { class: "actions" },
      el("button", { type: "button", class: "small primary", text: "Открыть корзину", onclick: () => bucketForm(null, o) }),
      el("button", { type: "button", class: "small", text: "Изменить", onclick: () => offerForm(o) })))));
  $("offers-empty").hidden = offers.length > 0;

  const deps = S.deposits.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  $("deposits").replaceChildren(...deps.map((d) => el("div", { class: "row" },
    el("span", null, el("b", { text: ruDate(d.date) }), d.note ? el("span", { class: "muted", text: " · " + d.note }) : null),
    el("span", { class: "actions" }, el("span", { class: "num", text: "+" + rub(d.amount) }), el("button", { type: "button", class: "small", text: "✎", "aria-label": "Изменить пополнение", onclick: () => depositForm(d) })))));
  $("deposits-empty").hidden = deps.length > 0;
  $("deposits").hidden = !deps.length;

  const closed = D.closed.slice().sort((a, b) => String(b.closedAt || "").localeCompare(String(a.closedAt || "")));
  $("closed").replaceChildren(...closed.map((b) => el("div", { class: "row" },
    el("span", null, el("b", { text: b.bank + " " }), el("span", { class: "muted", text: (b.product || "") + " · " + ruDate(b.opened) + " → " + ruDate(b.closedAt) })),
    el("span", { class: "num", text: rub(b.amount) + " · +" + rub(b.earned) }))));
  $("closed-empty").hidden = closed.length > 0;
  $("closed").hidden = !closed.length;

  if (document.activeElement !== $("goal-input")) $("goal-input").value = D.goal;
  if (document.activeElement !== $("goal-name-input")) $("goal-name-input").value = S.meta.goalName || "";
}

// ---------- Вкладки ----------
function route() {
  const tab = (location.hash || "#home").slice(1);
  const known = ["home", "offers", "history", "more"];
  const t = known.includes(tab) ? tab : "home";
  for (const k of known) $("view-" + k).hidden = k !== t;
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === t));
}
addEventListener("hashchange", route);

document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-action]"); if (!a) return;
  ({ deposit: () => depositForm(), bucket: () => bucketForm(), offer: () => offerForm() })[a.dataset.action]?.();
});
$("goal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const g = Number($("goal-input").value);
  if (!(g > 0)) return toast("Впиши цель");
  await store.setMeta({ goal: g, goalName: $("goal-name-input").value.trim() }); toast("Цель сохранена");
});
$("btn-export").addEventListener("click", () => {
  const data = { app: "kopilka", version: 1, exportedAt: new Date().toISOString(), ...S };
  download("kopilka-backup-" + todayStr() + ".json", JSON.stringify(data, null, 2), "application/json");
});
$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== "kopilka") throw new Error("это не бэкап копилки");
    const strip = (arr) => (arr || []).map(({ id, ...rest }) => rest);
    for (const c of ["buckets", "deposits", "offers"]) if (data[c] && data[c].length) await store.addMany(c, strip(data[c]));
    if (data.meta && data.meta.goal) await store.setMeta({ goal: data.meta.goal });
    toast("Бэкап загружен");
  } catch (err) { toast("Не получилось загрузить: " + err.message); }
  e.target.value = "";
});
$("btn-signin").addEventListener("click", async () => {
  try { await store.signIn(); } catch (e) { $("gate-msg").textContent = "Вход не удался: " + (e.code || e.message); }
});
$("btn-signout").addEventListener("click", async () => { await store.signOut(); });

// ---------- Старт ----------
route();
render();
store = firebaseConfig && firebaseConfig.apiKey ? new FirebaseStore(firebaseConfig) : new LocalStore();
let seededCheck = false;
store.start(async (state) => {
  S = state; render();
  if (!seededCheck) {
    seededCheck = true;
    if (!S.meta.seeded) {
      if (!S.offers.length) await store.addMany("offers", SEED_OFFERS);
      await store.setMeta({ seeded: true });
    }
    if (!S.meta.goal) goalForm(true);
  }
}, (auth) => {
  $("gate").hidden = auth.signedIn;
  $("btn-signout").hidden = store.kind !== "firebase" || !auth.signedIn;
  $("account-line").textContent = auth.label || "";
  if (auth.error) { $("banner").textContent = auth.error; $("banner").hidden = false; $("gate-msg").textContent = auth.error; }
}).catch((e) => { $("banner").textContent = "Не удалось запустить хранилище: " + e.message; $("banner").hidden = false; });
setInterval(render, 60 * 60 * 1000);

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
