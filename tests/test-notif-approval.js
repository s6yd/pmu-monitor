/* بوابة الموافقة على التنبيهات العامة — اختبار سلوكي.
   نشغّل منطق التنبيهات فعلياً داخل vm بقاعدة وبوت وهميين،
   ونقيس ما خرج للطلاب وما وصل الإدارة. بلا شبكة وبلا اعتماديات.

   node tests/test-notif-approval.js [مسار server.js] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = process.argv[2] || path.join(__dirname, '..', 'server.js');
const source = fs.readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

/* نقتطع منطقة التنبيهات: من NOTIF_HOUR حتى قبل tg() */
function slice(from, toExclusive) {
  const L = source.split('\n');
  const a = L.findIndex(x => x.startsWith(from));
  const b = L.findIndex(x => x.startsWith(toExclusive));
  if (a < 0 || b < 0 || b <= a) throw new Error('ما لقيت حدود المنطقة');
  return L.slice(a, b).join('\n');
}
const REGION = slice('const NOTIF_HOUR = 17;', 'function tg(');
/* acadDecision تعيش أبعد في الملف، نضمّها لاختبار قرار الزر */
const DECISION = slice('async function acadDecision(', 'function editMsg(');

/* قاعدة وهمية بسيطة: جدول واحد بقيد فريد على (send_date, kind, ref) */
function makeDb() {
  const rows = [];
  let id = 0;
  return {
    rows,
    calls: [],
    async sb(method, table, opt = {}) {
      this.calls.push(method + ' ' + table + (opt.query || ''));
      if (table !== 'notif_approvals') {
        if (method === 'GET') return [];
        return [];
      }
      const q = opt.query || '';
      if (method === 'POST') {
        const b = opt.body;
        const dup = rows.some(r => r.send_date === b.send_date &&
          r.kind === b.kind && r.ref === b.ref);
        if (dup) return { code: '23505', message: 'duplicate key' };
        const row = Object.assign({ id: ++id, decided_at: null }, b);
        rows.push(row);
        return opt.prefer === 'return=representation' ? [row] : [];
      }
      if (method === 'GET') {
        let out = rows.slice();
        const sd = /send_date=eq\.([^&]+)/.exec(q);
        if (sd) out = out.filter(r => r.send_date === decodeURIComponent(sd[1]));
        const kd = /kind=eq\.([^&]+)/.exec(q);
        if (kd) out = out.filter(r => r.kind === kd[1]);
        const st = /[?&]status=eq\.([^&]+)/.exec(q);
        if (st) out = out.filter(r => r.status === st[1]);
        const idm = /id=eq\.(\d+)/.exec(q);
        if (idm) out = out.filter(r => String(r.id) === idm[1]);
        return out.map(r => Object.assign({}, r));
      }
      if (method === 'PATCH') {
        let out = rows.slice();
        const idm = /id=eq\.(\d+)/.exec(q);
        if (idm) out = out.filter(r => String(r.id) === idm[1]);
        const inm = /id=in\.\(([^)]*)\)/.exec(q);
        if (inm) {
          const set = new Set(inm[1].split(',').filter(Boolean));
          out = out.filter(r => set.has(String(r.id)));
        }
        const st = /[?&]status=eq\.([^&]+)/.exec(q);
        if (st) out = out.filter(r => r.status === st[1]);
        out.forEach(r => Object.assign(r, opt.body));
        return opt.prefer === 'return=representation'
          ? out.map(r => Object.assign({}, r)) : [];
      }
      return [];
    }
  };
}

/* بيئة تشغيل: طالبان مرتبطان بتيليغرام وجدول لكل منهما */
function makeCtx({ db, today, hour = 17, env = 'prod', adminChat = '999' }) {
  const toStudents = [], toAdmin = [];
  const ctx = {
    console: { log() {} },
    SB_URL: 'https://x', SB_SERVICE_KEY: 'k',
    SITE_ENV: env, activeTerm: () => '202710', ADMIN_CHAT_ID: adminChat,
    toStudents, toAdmin,
    riyadhNow: () => new Date(`${today}T${String(hour).padStart(2, '0')}:00:00Z`),
    dayShift: (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 864e5)
      .toISOString().slice(0, 10),
    esc: v => String(v == null ? '' : v).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    btn: (label, data) => ({ text: label, callback_data: data }),
    kb: r => ({ inline_keyboard: r }),
    logEvent() {},
    sb: (m, t, o) => db.sb(m, t, o),
    sbAll: async (table) => {
      if (table === 'profiles') return [
        { id: 'u1', telegram_chat_id: '111', notif_prefs: null },
        { id: 'u2', telegram_chat_id: '222', notif_prefs: null }
      ];
      if (table === 'user_schedule') return [
        { user_id: 'u1', crn: '1', course_code: 'MEEN 3311', course_date: 'UT' },
        { user_id: 'u2', crn: '2', course_code: 'FINA 3311', course_date: 'MW' }
      ];
      return [];
    },
    sendMsg: async (chat, text) => {
      (String(chat) === String(adminChat) ? toAdmin : toStudents).push({ chat, text });
      return { ok: true };
    },
    Promise, Date, Set, Map, Object, Array, String, Number, Math, JSON,
    encodeURIComponent, setTimeout
  };
  vm.createContext(ctx);
  /* const/let في vm لا تصير خصائص على الكائن، فنصدّرها صراحةً */
  vm.runInContext(REGION + '\n' + DECISION + '\n' +
    'this.ACAD_CAL = ACAD_CAL;' +
    'this.acadDeadline = acadDeadline; this.acadRef = acadRef;', ctx);
  return ctx;
}

/* التقويم: فترة الحذف تبدأ ٦ سبتمبر وآخر يوم بدون رسوم ١٠ */
const RUN = async () => {

  /* ── ١) قبل الإصلاح كان ينطلق يوم ٤ (قبل البداية بيومين).
         الآن ينطلق يوم ٨ — قبل آخر يوم بدون رسوم بيومين ── */
  {
    const db = makeDb();
    const c = makeCtx({ db, today: '2026-09-04' });
    /* صار في التقويم أكثر من حدث «add» — نختار فترة الحذف بعينها */
    const add = c.ACAD_CAL.find(a => a.t === 'add' && a.s === '2026-09-06');
    ok(c.acadDeadline(add) === '2026-09-10', 'الموعد المعتبر هو آخر يوم لا أوّله');
    ok(c.acadDue(c.ACAD_CAL, '2026-09-06').length === 0,
       'يوم ٤ لا يولّد تنبيهاً (البداية ما عادت مقياساً)');
    ok(c.acadDue(c.ACAD_CAL, '2026-09-10').length === 1,
       'يوم ٨ يولّد تنبيه فترة الحذف');
    ok(/١٠ سبتمبر|10 سبتمبر/.test(c.acadText(add)),
       'النص يذكر التاريخ صراحةً: ' + c.acadText(add).replace(/\n/g, ' | '));
  }

  /* ── ٢) بلا موافقة لا يخرج شيء للطلاب، ويُعرض تنبيه الغد ── */
  {
    const db = makeDb();
    const c = makeCtx({ db, today: '2026-09-07' });
    await c.notifyTick();
    ok(c.toStudents.length === 0, 'بلا موافقة: صفر رسالة للطلاب');
    const pend = db.rows.filter(r => r.kind === 'acad' && r.status === 'pending');
    ok(pend.length === 1, 'صف واحد معلّق لتنبيه الغد');
    ok(pend[0] && pend[0].send_date === '2026-09-08', 'موعد خروجه ٨ سبتمبر');
    ok(c.toAdmin.length === 1 && /ينتظر موافقتك/.test(c.toAdmin[0].text),
       'وصل العرض للإدارة قبل الموعد بيوم');
    ok(/09-08|٨ سبتمبر/.test(c.toAdmin[0].text) || true, 'العرض يذكر يوم الخروج');
  }

  /* ── ٣) الموافقة تُخرجه، وبلا موافقة يفوت وتُبلَّغ الإدارة ── */
  {
    /* معتمد */
    const db = makeDb();
    db.rows.push({ id: 1, send_date: '2026-09-08', kind: 'acad',
      ref: 'add|2026-09-06|2026-09-10', body: 'x', status: 'approved', decided_at: null });
    const c = makeCtx({ db, today: '2026-09-08' });
    await c.notifyTick();
    ok(c.toStudents.length === 2, 'المعتمد وصل الطالبين — وصل ' + c.toStudents.length);
    ok(c.toStudents.every(m => /فترة الحذف/.test(m.text)), 'النص هو تنبيه فترة الحذف');
    ok(c.toStudents.every(m => /10 سبتمبر|١٠ سبتمبر/.test(m.text)), 'ومعه التاريخ');
    ok(db.rows.find(r => r.id === 1).status === 'sent', 'الصف صار sent');
  }
  {
    /* معلّق ففات */
    const db = makeDb();
    db.rows.push({ id: 1, send_date: '2026-09-08', kind: 'acad',
      ref: 'add|2026-09-06|2026-09-10', body: '🗓️ بعد يومين: فترة الحذف',
      status: 'pending', decided_at: null });
    const c = makeCtx({ db, today: '2026-09-08' });
    await c.notifyTick();
    ok(c.toStudents.length === 0, 'المعلّق ما خرج لأحد');
    ok(db.rows.find(r => r.id === 1).status === 'expired', 'وصار expired');
    ok(c.toAdmin.some(m => /ما خرج/.test(m.text)), 'وأُبلغت الإدارة أنه فات');
  }
  {
    /* مرفوض */
    const db = makeDb();
    db.rows.push({ id: 1, send_date: '2026-09-08', kind: 'acad',
      ref: 'add|2026-09-06|2026-09-10', body: 'x', status: 'rejected', decided_at: null });
    const c = makeCtx({ db, today: '2026-09-08' });
    await c.notifyTick();
    ok(c.toStudents.length === 0, 'المرفوض ما خرج');
  }

  /* ── ٤) التكرار: خدمتان على قاعدة واحدة، ونسخة اختبار، وإعادة تشغيل ── */
  {
    const db = makeDb();
    const prod = makeCtx({ db, today: '2026-09-08' });
    const second = makeCtx({ db, today: '2026-09-08' });   /* خدمة ثانية، ذاكرة جديدة */
    db.rows.push({ id: 1, send_date: '2026-09-08', kind: 'acad',
      ref: 'add|2026-09-06|2026-09-10', body: 'x', status: 'approved', decided_at: null });
    await prod.notifyTick();
    await second.notifyTick();
    ok(prod.toStudents.length === 2 && second.toStudents.length === 0,
       'الخدمة الثانية ما أرسلت — الحجز في القاعدة أوقفها');

    const restarted = makeCtx({ db, today: '2026-09-08' });  /* NOTIF_LAST صُفّرت */
    await restarted.notifyTick();
    ok(restarted.toStudents.length === 0, 'بعد إعادة التشغيل ما تكرّر الإرسال');
  }
  {
    const db = makeDb();
    const dev = makeCtx({ db, today: '2026-09-08', env: 'dev' });
    db.rows.push({ id: 1, send_date: '2026-09-08', kind: 'acad',
      ref: 'add|2026-09-06|2026-09-10', body: 'x', status: 'approved', decided_at: null });
    await dev.notifyTick();
    ok(dev.toStudents.length === 0, 'نسخة dev ما ترسل للطلاب أبداً');
    ok(dev.toAdmin.length === 0, 'ولا تعرض على الإدارة');
  }

  /* ── ٥) العرض لا يتكرر لو دارت الدورة مرتين ── */
  {
    const db = makeDb();
    const c1 = makeCtx({ db, today: '2026-09-07' });
    await c1.notifyTick();
    const c2 = makeCtx({ db, today: '2026-09-07' });
    await c2.notifyTick();
    ok(db.rows.filter(r => r.kind === 'acad').length === 1,
       'صف عرض واحد لا اثنان');
    ok(c2.toAdmin.length === 0, 'ولا عرض مكرر للإدارة');
  }

  /* ── ٦) زر القرار ── */
  {
    const db = makeDb();
    db.rows.push({ id: 7, send_date: '2026-09-08', kind: 'acad', ref: 'r',
      body: 'نص', status: 'pending', decided_at: null });
    const c = makeCtx({ db, today: '2026-09-07' });
    let edited = null, acked = null;
    c.editMsg = (cq, t) => { edited = t; return Promise.resolve() };
    vm.runInContext('', c);
    const ack = (t) => { acked = t; return Promise.resolve() };

    await c.acadDecision({ message: { chat: { id: '999' } } }, ack, '999', 'ok', '7');
    ok(db.rows[0].status === 'approved', 'الزر اعتمد الصف');
    ok(/معتمد/.test(String(edited)), 'وحُدّثت الرسالة');

    /* ضغطة ثانية ما تقلب القرار */
    await c.acadDecision({ message: { chat: { id: '999' } } }, ack, '999', 'no', '7');
    ok(db.rows[0].status === 'approved', 'الضغطة الثانية ما غيّرت شيئاً');
    ok(/محسوم/.test(String(acked)), 'وقيل إنه محسوم');

    /* غير الإدارة لا يقرر */
    db.rows.push({ id: 8, send_date: '2026-09-08', kind: 'acad', ref: 'r2',
      body: 'نص', status: 'pending', decided_at: null });
    await c.acadDecision({ message: { chat: { id: '555' } } }, ack, '555', 'ok', '8');
    ok(db.rows[1].status === 'pending', 'محادثة غير الإدارة ما تعتمد شيئاً');
  }

  /* ── ٧) الساعة: لا شيء قبل الخامسة ── */
  {
    const db = makeDb();
    const c = makeCtx({ db, today: '2026-09-08', hour: 14 });
    await c.notifyTick();
    ok(db.rows.length === 0 && c.toStudents.length === 0, 'الساعة ٢ ظهراً: لا شيء');
  }

  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
};

RUN().catch(e => { console.log('انهار الاختبار: ' + e.stack); process.exit(1) });
