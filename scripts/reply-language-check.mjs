// Kolwen reply-language conformance — LWK-131.
//
// The owner's standard: "ถาม English ตอบไทยกลับ ไม่ว่าด้วยวิธีใด นั่นคือความล้มเหลว
// เอาไปขายต่างชาติไม่ได้." The reply is in the language of the MESSAGE, on every path.
//
// This repo ships NO reply surface today, so the harness runs against a FIXTURE adapter and
// proves it can DETECT the failure. The day /chat exists it takes the real endpoint through
// KOLWEN_CHAT_ENDPOINT with no rewrite. Zero dependencies, Node built-ins only.
//
//   node scripts/reply-language-check.mjs --self-test   # fixture adapters, runs in CI today
//   node scripts/reply-language-check.mjs --scan        # tree scan, runs in CI today
//   KOLWEN_CHAT_ENDPOINT=https://... node scripts/reply-language-check.mjs
//
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// ── language of a REPLY, by script range ─────────────────────────────────────
// Deliberately script-based, not a model: a script range is deterministic, needs no network and
// cannot itself be wrong about Thai vs Latin. Its honest limit is that it cannot separate two
// languages sharing one script (English from German). That is enough for the failure this
// exists to catch, which is a reply in a DIFFERENT SCRIPT from the message.
const RANGES = [
  ['th', /[฀-๿]/],
  ['ja', /[぀-ヿ]/],          // kana; a kana-free Japanese reply reads as zh, named below
  ['zh', /[一-鿿]/],
  ['en', /[A-Za-z]/],
];
export function replyLanguage(text) {
  const counts = RANGES.map(([tag, re]) => [tag, (text.match(new RegExp(re, 'gu')) || []).length]);
  const [tag, n] = counts.sort((a, b) => b[1] - a[1])[0];
  return n === 0 ? 'unknown' : tag;
}

// ── the probe matrix: every language × every PATH that can emit a reply ──────
const LANGS = {
  en: 'Do you have an enterprise plan?',
  th: 'มีแพ็กเกจสำหรับองค์กรไหม',
  zh: '你们有企业版套餐吗',
  ja: '法人向けのプランはありますか',
};
// The row's own list. A path missing here is a path nobody tested.
export const PATHS = ['normal', 'refusal', 'error', 'timeout', 'proactive'];

// ── adapters ─────────────────────────────────────────────────────────────────
// The RED fixture is the Synantic shape: a Thai template returned whatever was asked.
export const synanticAdapter = () => 'ขออภัย ระบบไม่สามารถให้ข้อมูลนี้ได้ กรุณาติดต่อฝ่ายบริการลูกค้า';
// The GREEN fixture answers in the language it was asked in, on every path.
export const conformingAdapter = (lang, path) => ({
  en: { normal: 'Yes, an enterprise plan is available.', refusal: 'I cannot help with that.', error: 'Something went wrong on our side.', timeout: 'That took too long. Please try again.', proactive: 'One more thing you may want to know.' },
  th: { normal: 'มีแพ็กเกจสำหรับองค์กรครับ', refusal: 'เรื่องนี้ช่วยไม่ได้', error: 'ระบบขัดข้อง', timeout: 'ใช้เวลานานเกินไป ลองใหม่อีกครั้ง', proactive: 'มีอีกเรื่องที่อาจอยากทราบ' },
  zh: { normal: '有企业版套餐。', refusal: '这个我无法协助。', error: '系统出现问题。', timeout: '耗时过长，请重试。', proactive: '还有一件事您可能想知道。' },
  ja: { normal: '法人向けプランがあります。', refusal: 'それにはお答えできません。', error: 'エラーが発生しました。', timeout: '時間がかかりすぎました。', proactive: 'もう一つお知らせがあります。' },
}[lang][path]);

async function endpointAdapter(url, lang, path) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: LANGS[lang], path }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} on path=${path} lang=${lang}`);
  const j = await r.json();
  return j.reply ?? j.content ?? JSON.stringify(j);
}

// ── the assertion ────────────────────────────────────────────────────────────
export async function runMatrix(adapter) {
  const fails = [];
  for (const lang of Object.keys(LANGS)) {
    for (const path of PATHS) {
      const reply = await adapter(lang, path);
      const got = replyLanguage(reply);
      if (got !== lang) fails.push({ lang, path, got, reply: reply.slice(0, 60) });
    }
  }
  return fails;
}

// ── the tree scan: no hard-coded single-language REPLY template in shipped code ───────────────
//
// THE LINE, drawn explicitly because the inventory turns on it:
//   a REPLY is text the product emits BACK to a user in response to their message;
//   the static site's own bilingual copy is not a reply, it is the page, and its EN/TH toggle is
//   the design. So web/index.html is EXEMPT by kind, not by exception.
//   A Thai string inside a CHECKER (surface-check.mjs holds Thai trademark-claim patterns) is a
//   DETECTOR, not a reply. Also exempt by kind, and named here so nobody "fixes" it later.
const REPLY_EMITTING = f =>
  /\.(mjs|js|py|ts)$/.test(f) &&
  !f.startsWith('scripts/') &&        // repo tooling, not a product surface
  !f.startsWith('brand/');            // an asset generator, not a product surface
const NON_LATIN = /[฀-๿぀-ヿ一-鿿]/u;

export function scanTree() {
  const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
  const findings = [];
  for (const f of files.filter(REPLY_EMITTING)) {
    const s = readFileSync(f, 'utf8');
    if (NON_LATIN.test(s)) findings.push(`${f}: contains non-Latin text in a reply-emitting file`);
  }
  return { scanned: files.filter(REPLY_EMITTING).length, findings };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
if (import.meta.url.endsWith('reply-language-check.mjs')) {
  const arg = process.argv[2];
  const fail = m => { console.error(m); process.exitCode = 1; };

  if (arg === '--scan') {
    const { scanned, findings } = scanTree();
    if (findings.length) { fail('reply-language scan FAILED:\n  - ' + findings.join('\n  - ')); }
    else console.log(`reply-language scan passed — ${scanned} reply-emitting files, 0 hard-coded single-language templates`);

  } else if (arg === '--self-test') {
    // RED FIRST: the harness must FAIL on the Synantic shape, or it proves nothing.
    const red = await runMatrix(synanticAdapter);
    const green = await runMatrix(conformingAdapter);
    const total = Object.keys(LANGS).length * PATHS.length;
    console.log(`self-test — ${total} probes per adapter (4 languages × ${PATHS.length} paths)`);
    console.log(`  Synantic fixture (a Thai template on every message): ${red.length} failures detected`);
    console.log(`  conforming fixture: ${green.length} failures detected`);
    if (red.length !== total - PATHS.length) {
      fail(`  the red fixture should fail every NON-Thai probe (${total - PATHS.length}); it failed ${red.length}. The harness cannot detect the failure it exists for.`);
    } else if (green.length !== 0) {
      fail('  the conforming fixture must pass:\n    ' + green.map(f => `${f.lang}/${f.path} -> ${f.got}`).join('\n    '));
    } else {
      console.log('  harness proven: detects the Synantic shape, passes a conforming reply source.');
    }

  } else {
    const url = process.env.KOLWEN_CHAT_ENDPOINT;
    if (!url) { fail('no KOLWEN_CHAT_ENDPOINT set and no mode given. /chat does not exist yet; use --self-test or --scan.'); }
    else {
      const fails = await runMatrix((l, p) => endpointAdapter(url, l, p));
      if (fails.length) fail(`reply-language FAILED against ${url}:\n  - ` + fails.map(f => `${f.lang}/${f.path} answered in ${f.got}: ${f.reply}`).join('\n  - '));
      else console.log(`reply-language passed against ${url} — every path answers in the language of the message`);
    }
  }
}
