#!/usr/bin/env bash
# يشغّل كل الاختبارات على ملفات المستودع ويطبع ملخصاً.
#   bash tests/run-all.sh
# يحتاج Node 18+، وPlaywright للاختبارات اللي تفتح متصفحاً:
#   npm i --no-save playwright@1.56.0
#
# النسخة محددة عمداً: البيئة فيها Chromium مثبّت مسبقاً في /opt/pw-browsers
# (نسخة ١٤١ · بناء 1194)، و cdn.playwright.dev محجوب فما نقدر نحمّل متصفحاً
# جديداً. النسخة 1.56.0 تطابق البناء الموجود فتشتغل بلا تحميل. أي نسخة ثانية
# تطلب بناءً مختلفاً وتنهار بـ "Executable doesn't exist at …".
# لو تغيّر المتصفح في البيئة، طريقة إيجاد النسخة المطابقة في CLAUDE.md §٥.
set -u
cd "$(dirname "$0")/.."
S=server.js; F=pmu-schedule.html; A=admin.html
failed=()

echo "— فحص الصياغة —"
node tests/check-js.js "$S" "$F" "$A" || failed+=("check-js")

run() {
  local name=$1; shift
  local out last
  out=$(timeout 300 node "tests/$name.js" "$@" 2>&1)
  last=$(printf '%s\n' "$out" | tail -1)
  printf '  %-22s %s\n' "$name" "$last"
  if ! printf '%s' "$last" | grep -q ' 0 فشلت'; then
    failed+=("$name")
    printf '%s\n' "$out" | grep -E '✗|انهار|Error' | head -15 | sed 's/^/      /'
  fi
}

echo "— السيرفر —"
for t in test-notif-repeat test-notif-approval test-cycle-recovery test-gender-split \
         test-term-guard test-season-end test-state-isolation; do run "$t" "$S"; done

echo "— الصفحة —"
for t in test-plan-regress test-guest-theme test-build-reload test-term-ui \
         test-pushover-gate test-watch-gate; do run "$t" "$F"; done

echo "— اللوحة —"
run test-admin-season "$A"
run test-admin-ai     "$A"

echo "— عبر الملفات —"
run test-calendar       "$S" "$F"
run test-sub-cleanup    "$S" "$F" "$A"
run test-sub-core       "$S" "$A"
run test-free-tier      "$S" "$F"
run test-referral       "$S" "$F"
run test-review-credit  "$S" "$F" "$A"
run test-pushover-addon "$S" "$F" "$A"
run test-static-pages   "$S"
run test-plans          "$S" "$F"
run test-plan-logic     "$S" "$F"
run test-ai-tools       "$S"
run test-ai-chat        "$S"
run test-reminders      "$S"
run test-tg-ai          "$S"
run test-prep-sync      "$F"
run test-ai-page        "$F"

echo
if [ ${#failed[@]} -eq 0 ]; then
  echo "✅ كل الاختبارات نجحت"
else
  echo "❌ فشل: ${failed[*]}"
  exit 1
fi
