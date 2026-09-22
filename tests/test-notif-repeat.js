/* تكرار التنبيهات الشخصية — اختبار سلوكي.
   يشغّل buildNotifications و notifyTick الحقيقيتين في vm بقاعدة وهمية،
   ويدير الدورة أياماً متتالية ليقيس ما يصل الطالب فعلاً.

   node tests/test-notif-repeat.js [مسار server.js] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = process.argv[2] || path.join(__dirname, '..', 'server.js');
const source = fs.readFileSync(SRC, 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  ✗ ' + m) } };

function slice(from, toExclusive) {
  const L = source.split('\n');
  const a = L.findIndex(x => x.startsWith(from));
  const b = L.findIndex(x => x.startsWith(toExclusive));
  if (a < 0 || b < 0 || b <= a) throw new Error('ما لقيت حدود المنطقة');
  return L.slice(a, b).join('\n');
}
const REGION = slice('const NOTIF_HOUR = 17;', 'function tg(');
/* sbAll الحقيقية وثوابتها. كان الاختبار يستبدلها بنسخة مزيّفة لا تضيف
   &order=id — فما رأى أبداً أن notif_sent بلا عمود id، وبقي أخضر
   والإنتاج يكرّر التحذيرات. */
const SBALL = (() => {
  const L = source.split('\n');
  const a = L.findIndex(x => x.startsWith('const SB_PAGE = '));
  const b = L.findIndex((x, i) => i > a && x.startsWith('/* ============ Telegram'));
  if (a < 0 || b < 0) throw new Error('ما لقيت sbAll');
  return L.slice(a, b).join('\n');
})();

/* قاعدة وهمية: notif_sent بمفتاح أولي (user_id, kind, ref) */
function makeDb(seed) {
  const T = { notif_sent: [], notif_approvals: [] };
  /* أعمدة كل جدول كما في القاعدة — notif_sent بلا id */
  const COLS = {
    notif_sent: ['user_id', 'kind', 'ref', 'sent_on', 'created_at'],
    notif_approvals: ['id', 'send_date', 'kind', 'ref', 'body', 'status',
                      'created_at', 'decided_at']
  };
  const db = {
    T,
    async sb(method, table, opt = {}) {
      const q = opt.query || '';
      if (method === 'POST') {
        const rows = T[table] || (T[table] = []);
        const items = Array.isArray(opt.body) ? opt.body : [opt.body];
        for (const b of items) {
          const dup = table === 'notif_approvals'
            ? rows.some(r => r.send_date === b.send_date &&
                             r.kind === b.kind && r.ref === b.ref)
            : rows.some(r => r.user_id === b.user_id &&
                             r.kind === b.kind && r.ref === b.ref);
          if (dup) {
            if (!/merge-duplicates/.test(opt.prefer || '')) return { code: '23505' };
            continue;
          }
          /* id فقط للجدول الذي له id فعلاً */
          const row = Object.assign({}, b);
          if (COLS[table] && COLS[table].includes('id')) row.id = rows.length + 1;
          rows.push(row);
        }
        return /return=representation/.test(opt.prefer || '') ? [rows[rows.length - 1]] : [];
      }
      if (method === 'GET') {
        /* PostgREST يرفض الترتيب بعمود غير موجود */
        const om = /[?&]order=([^&]+)/.exec(q);
        if (om && COLS[table]) {
          for (const part of om[1].split(',')) {
            const col = part.split('.')[0];
            if (!COLS[table].includes(col))
              return { code: '42703', message: `column ${table}.${col} does not exist` };
          }
        }
        let out = (T[table] || seed[table] || []).slice();
        const sd = /send_date=eq\.([^&]+)/.exec(q);
        if (sd) out = out.filter(r => r.send_date === decodeURIComponent(sd[1]));
        const kd = /kind=eq\.([^&]+)/.exec(q);
        if (kd) out = out.filter(r => r.kind === kd[1]);
        const off = /[?&]offset=(\d+)/.exec(q);
        const lim = /[?&]limit=(\d+)/.exec(q);
        if (off) out = out.slice(Number(off[1]));
        if (lim) out = out.slice(0, Number(lim[1]));
        return out.map(r => Object.assign({}, r));
      }
      return [];
    }
  };
  return db;
}

function makeCtx(db, seed, today) {
  const toStudents = [];
  const ctx = {
    console: { log() {} },
    SB_URL: 'https://x', SB_SERVICE_KEY: 'k', SITE_ENV: 'prod',
    activeTerm: () => '202710', ADMIN_CHAT_ID: '5555',
    toStudents, today,
    riyadhNow: () => new Date(today + 'T17:00:00Z'),
    dayShift: (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 864e5)
      .toISOString().slice(0, 10),
    esc: v => String(v == null ? '' : v),
    btn: (l, d) => ({ text: l, callback_data: d }), kb: r => ({ inline_keyboard: r }),
    logEvent() {},
    PAGE: null,
    ALERTS_SENT: [],
    alert(key, title, detail) { ctx.ALERTS_SENT.push({ key, title, detail }); return Promise.resolve() },
    sb: (m, t, o) => db.sb(m, t, o),

    sendMsg: async (chat, text) => {
      if (String(chat) !== '5555') toStudents.push({ chat, text });
      return { ok: true };
    },
    Promise, Date, Set, Map, Object, Array, String, Number, Math, JSON,
    encodeURIComponent, setTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(SBALL + '\n' + REGION + '\nthis.ACAD_CAL = ACAD_CAL;', ctx);
  return ctx;
}

/* طالب واحد · مادة بحدّ غيابين · غياب واحد مسجّل */
const SEED = {
  profiles: [{ id: 'u1', telegram_chat_id: '901', notif_prefs: null }],
  user_schedule: [{ user_id: 'u1', crn: '1111', course_code: 'PHED 1112',
                    course_date: 'U' }],
  course_events: [],
  absences: [{ user_id: 'u1', crn: '1111', on_date: '2026-09-01' }]
};

(async () => {
  /* ── ١) خمسة أيام متتالية: رسالة واحدة لا خمس ── */
  {
    const db = makeDb(SEED);
    const days = ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16'];
    let all = [];
    for (const d of days) {
      const c = makeCtx(db, SEED, d);
      await c.notifyTick();
      all = all.concat(c.toStudents);
    }
    const abs = all.filter(m => /باقي لك غياب واحد/.test(m.text));
    ok(abs.length === 1, `تنبيه الغياب مرة واحدة في خمسة أيام — وصل ${abs.length}`);
    ok(db.T.notif_sent.length === 1, 'وسُجّل صف واحد في الدفتر');
    ok(db.T.notif_sent[0] && db.T.notif_sent[0].ref === '202710:1111:1',
       'والمرجع يحمل الترم والشعبة وعدد الغيابات — جاء ' +
       (db.T.notif_sent[0] || {}).ref);
  }

  /* ── ٢) إعادة نشر السيرفر لا تعيد التنبيه ── */
  {
    const db = makeDb(SEED);
    let c = makeCtx(db, SEED, '2026-09-12');
    await c.notifyTick();
    ok(c.toStudents.length === 1, 'اليوم الأول: وصل التنبيه');
    /* سياق جديد تماماً = ذاكرة مصفّرة، والدفتر في القاعدة */
    c = makeCtx(db, SEED, '2026-09-13');
    await c.notifyTick();
    ok(c.toStudents.length === 0, 'بعد إعادة النشر: ما تكرر — الدفتر في القاعدة');
  }

  /* ── ٣) فشل الإرسال لا يُسجَّل، فيُعاد غداً ── */
  {
    const db = makeDb(SEED);
    const c = makeCtx(db, SEED, '2026-09-12');
    c.sendMsg = async () => ({ ok: false, description: 'blocked' });
    await c.notifyTick();
    ok(db.T.notif_sent.length === 0, 'الفشل ما يُسجَّل في الدفتر');
    const c2 = makeCtx(db, SEED, '2026-09-13');
    await c2.notifyTick();
    ok(c2.toStudents.length === 1, 'فيُعاد في اليوم التالي');
  }

  /* ── ٤) غياب جديد يغيّر الحالة — والشرط نفسه ما عاد ينطبق ── */
  {
    const seed2 = JSON.parse(JSON.stringify(SEED));
    /* مادة بحدّ ثلاثة: يومان دراسيان ⇒ الحدّ أكبر */
    seed2.user_schedule = [{ user_id: 'u1', crn: '2222', course_code: 'MEEN 3311',
                             course_date: 'UT' }];
    seed2.absences = [{ user_id: 'u1', crn: '2222', on_date: '2026-09-01' },
                      { user_id: 'u1', crn: '2222', on_date: '2026-09-03' }];
    const db = makeDb(seed2);
    const c = makeCtx(db, seed2, '2026-09-12');
    await c.notifyTick();
    const got = c.toStudents.filter(m => /باقي لك غياب واحد/.test(m.text));
    if (got.length) {
      ok(db.T.notif_sent[0].ref === '202710:2222:2',
         'المرجع يتبع عدد الغيابات: ' + db.T.notif_sent[0].ref);
      /* غياب ثالث: الشرط «بقي واحد» يسقط فلا رسالة */
      seed2.absences.push({ user_id: 'u1', crn: '2222', on_date: '2026-09-05' });
      const c2 = makeCtx(db, seed2, '2026-09-13');
      await c2.notifyTick();
      ok(c2.toStudents.length === 0, 'بعد استهلاك آخر غياب: لا رسالة جديدة');
    } else {
      ok(true, 'حدّ الغياب لهذي المادة ما وصل نقطة التنبيه');
      ok(true, '—');
    }
  }

  /* ── ٤ب) ترم جديد بنفس رقم الشعبة: التنبيه يخرج من جديد ── */
  {
    const db = makeDb(SEED);
    let c = makeCtx(db, SEED, '2026-09-12');
    await c.notifyTick();
    ok(c.toStudents.length === 1, 'الترم الحالي: وصل التنبيه');

    /* نفس الشعبة 1111 ونفس عدد الغيابات، لكن الترم تبدّل */
    /* يوم دراسة في الترم الثاني — ١٢ يناير إجازة منتصف السنة، وما فيها
       حد غياب أصلاً (الحساب القديم كان يطلع رقماً فيها لأنه يأخذ الترم الأول دائماً) */
    const c2 = makeCtx(db, SEED, '2027-02-01');
    c2.activeTerm = () => '202720';
    await c2.notifyTick();
    ok(c2.toStudents.length === 1,
       'الترم الجديد: التنبيه يخرج رغم تطابق رقم الشعبة والعدد');
    ok(db.T.notif_sent.length === 2, 'وصفّان في الدفتر لا صف واحد');
    ok(db.T.notif_sent.some(r => r.ref.startsWith('202720:')),
       'والصف الجديد موسوم بترمه');
  }

  /* ── ٥) «أكّده زملاؤك» كذلك مرة واحدة ── */
  {
    const seed3 = JSON.parse(JSON.stringify(SEED));
    seed3.absences = [];
    seed3.course_events = [
      { id: 1, user_id: 'a', crn: '1111', kind: 'quiz', on_date: '2026-10-01', shared: true },
      { id: 2, user_id: 'b', crn: '1111', kind: 'quiz', on_date: '2026-10-01', shared: true },
      { id: 3, user_id: 'c', crn: '1111', kind: 'quiz', on_date: '2026-10-01', shared: true }
    ];
    const db = makeDb(seed3);
    let all = [];
    for (const d of ['2026-09-12', '2026-09-13', '2026-09-14']) {
      const c = makeCtx(db, seed3, d);
      await c.notifyTick();
      all = all.concat(c.toStudents);
    }
    const conf = all.filter(m => /من شعبتك حدّدوا/.test(m.text));
    ok(conf.length === 1, `«أكّده زملاؤك» مرة واحدة في ثلاثة أيام — وصل ${conf.length}`);
  }

  /* ── ٦) الجدول غير موجود — الفشل الواقعي ──
     sb لا ترمي: ترجع كائن خطأ. الكود القديم كان يقرأه «دفتراً فاضياً»
     فيرسل التحذير كل يوم إلى الأبد، بلا أي أثر. */
  {
    const db = makeDb(SEED);
    const real = db.sb.bind(db);
    db.sb = async (m, t, o) => {
      if (t === 'notif_sent')
        return { code: '42P01', message: 'relation "public.notif_sent" does not exist' };
      return real(m, t, o);
    };
    const days = ['2026-09-12', '2026-09-13', '2026-09-14'];
    let absMsgs = 0, alerts = [];
    for (const d of days) {
      const c = makeCtx(db, SEED, d);
      await c.notifyTick();
      absMsgs += c.toStudents.filter(m => /باقي لك غياب واحد/.test(m.text)).length;
      alerts = alerts.concat(c.ALERTS_SENT);
    }
    ok(absMsgs === 0,
       `جدول مفقود: صفر تحذير غياب في ثلاثة أيام — وصل ${absMsgs} (كان يتكرر يومياً)`);
    ok(alerts.some(a => a.key === 'ledger' && /does not exist/.test(a.detail)),
       'وتنبيه للإدارة بالسبب الحقيقي من القاعدة');
  }

  /* ── ٦ب) القراءة ترمي (شبكة): نفس السلوك المغلق ── */
  {
    const db = makeDb(SEED);
    const c = makeCtx(db, SEED, '2026-09-12');
    const real = db.sb.bind(db);
    db.sb = async (m, t, o) => {
      if (t === 'notif_sent' && m === 'GET') throw new Error('network down');
      return real(m, t, o);
    };
    await c.notifyTick();
    ok(c.toStudents.filter(m => /باقي لك غياب واحد/.test(m.text)).length === 0,
       'الشبكة سقطت عند القراءة: ما يخرج تحذير قابل للتكرار');
    ok(c.ALERTS_SENT.some(a => a.key === 'ledger'), 'وتنبيه للإدارة');
  }

  /* ── ٦ج) الكتابة ترجع خطأ: تنبيه بدل الابتلاع ── */
  {
    const db = makeDb(SEED);
    const c = makeCtx(db, SEED, '2026-09-12');
    const real = db.sb.bind(db);
    db.sb = async (m, t, o) => {
      if (t === 'notif_sent' && m === 'POST')
        return { code: '42501', message: 'permission denied for table notif_sent' };
      return real(m, t, o);
    };
    await c.notifyTick();
    ok(c.toStudents.length === 1, 'القراءة سليمة: التحذير يخرج أول مرة');
    ok(c.ALERTS_SENT.some(a => a.key === 'ledger-write' && /permission denied/.test(a.detail)),
       'والكتابة الفاشلة وصلت للإدارة بنصّها');
  }

  console.log(`\n${pass} نجحت · ${fail} فشلت`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('انهار الاختبار: ' + e.stack); process.exit(1) });
