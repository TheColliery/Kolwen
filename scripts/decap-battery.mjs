// Kolwen SELF-DECAP battery — LWK-132.
//
// Owner law: "Kolwen จะไม่เป็นร่างโคลนของใครทั้งนั้น." The decap ladder is a CLONE test, so we run
// it on ourselves: the chip the ladder MEASURES must equal the label the product SHOWS.
//
// Fixtures live in the zone warehouse (../warehouse/decap-battery/blocks/); the runner
// lives with the product. The socket is OpenAI-compatible by owner ruling, so two ICs stay
// qualified at any time. Zero dependencies, Node built-ins only.
//
//   node scripts/decap-battery.mjs --self-test           # fixture adapters; runs in CI today
//   node scripts/decap-battery.mjs --label               # print the label source of truth
//   KOLWEN_IC_ENDPOINT=... KOLWEN_IC_KEY=... node scripts/decap-battery.mjs   # a real IC
//
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';

export const LABEL_PATH = 'web/ic.json';
export const label = () => JSON.parse(readFileSync(LABEL_PATH, 'utf8'));

// The fixtures are the warehouse's, byte-verified there. Resolved relative to this repo so a
// clone without the warehouse fails LOUDLY rather than silently running an empty battery.
const BLOCKS_DIR = '../warehouse/decap-battery/blocks';
export function blocks() {
  if (!existsSync(BLOCKS_DIR)) throw new Error(`battery fixtures not found at ${BLOCKS_DIR} — a battery with no blocks is not a pass`);
  const names = readdirSync(BLOCKS_DIR).filter(f => f.endsWith('.txt')).sort();
  if (!names.length) throw new Error('battery fixtures directory is empty — refusing to report a pass');
  return names.map(n => ({ name: n.replace(/\.txt$/, ''), body: readFileSync(`${BLOCKS_DIR}/${n}`, 'utf8') }));
}

// B11-pin's contract: ONE item per FRESH session, and no unknown-escape — a forced best guess
// with (?). Every other block is one session for the whole block.
export const isPerItem = name => name === 'B11-pin';
export const items = body => body.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

// ── the socket: OpenAI-compatible, so a second IC qualifies without a rewrite ────────────────
async function askEndpoint(prompt) {
  const r = await fetch(process.env.KOLWEN_IC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.KOLWEN_IC_KEY}` },
    body: JSON.stringify({ model: label().model_id, messages: [{ role: 'user', content: prompt }], temperature: 0 }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} from the IC socket`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? JSON.stringify(j);
}

// ── the measurement ──────────────────────────────────────────────────────────
// A cutoff is measured by which DATED rungs the chip knows. The assert is not "is it clever" —
// an accuracy benchmark cannot expose a relabel. Only dated events can.
const RUNG_YEAR = /\b(20\d\d)\b/g;
export function measureCutoff(replies) {
  const known = [];
  for (const { reply } of replies) {
    if (/unknown/i.test(reply) && !/\d/.test(reply.replace(RUNG_YEAR, ''))) continue;
    for (const m of reply.match(RUNG_YEAR) || []) known.push(Number(m));
  }
  return known.length ? Math.max(...known) : null;
}

export async function runBattery(ask, outDir) {
  const replies = [];
  for (const b of blocks()) {
    if (isPerItem(b.name)) {
      for (const [i, item] of items(b.body).entries()) {
        replies.push({ block: `${b.name}#${i + 1}`, prompt: item, reply: await ask(item, true) });
      }
    } else {
      replies.push({ block: b.name, prompt: b.body, reply: await ask(b.body, false) });
    }
  }
  // A verdict with no raw answers saved is a claim. Save before asserting, always.
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    // The FILENAME is derived from our own tracked fixture names, never from the reply, and is
    // reduced to an allowlist so that stays true rather than merely being true today. The reply
    // is the FILE CONTENT by contract: a verdict with no raw answers is a claim.
    for (const r of replies) {
      const safe = r.block.replace(/[^A-Za-z0-9._-]/g, '-');
      writeFileSync(`${outDir}/${safe}.txt`, r.reply);
    }
    writeFileSync(`${outDir}/index.json`, JSON.stringify({ at: new Date().toISOString(), label: label(), blocks: replies.map(r => r.block) }, null, 2));
  }
  return replies;
}

// ── fixture adapters, so the runner is proven before an IC exists ─────────────
// WRONG CHIP: answers rungs no model with the labelled cutoff could know. This is the relabel the
// battery exists to catch, and the assert MUST fail on it.
export const wrongChipAdapter = () => 'Q1: Leo XIV. Q6: I am a 2026-cutoff model. The 2026 Super Bowl LX winner was decided in February 2026.';
// CONFORMING: knows nothing past the labelled cutoff and says so, in the block's own format.
export const conformingAdapter = () => 'Q1: unknown\nQ2: unknown\nQ3: unknown\nQ4: unknown\nQ5: unknown\nQ6: labelled model, cutoff 2024.';

export function assertChipMatchesLabel(replies, lbl) {
  const measured = measureCutoff(replies);
  const declared = lbl.cutoff ? Number(String(lbl.cutoff).slice(0, 4)) : null;
  if (declared === null) return { ok: null, measured, declared, why: 'no IC is labelled — nothing to compare' };
  if (measured === null) return { ok: true, measured, declared, why: 'the ladder found no dated knowledge past the label' };
  return { ok: measured <= declared, measured, declared,
    why: measured <= declared ? 'measured chip is within the label' : `measured ${measured} but the label says ${declared} — the chip is not what the label claims` };
}

if (import.meta.url.endsWith('decap-battery.mjs')) {
  const arg = process.argv[2];
  const fail = m => { console.error(m); process.exitCode = 1; };
  const lbl = label();

  if (arg === '--label') {
    console.log(JSON.stringify(lbl, null, 2));

  } else if (arg === '--self-test') {
    const bs = blocks();
    console.log(`self-test — ${bs.length} blocks from the warehouse: ${bs.map(b => b.name).join(' ')}`);
    console.log(`  B11-pin per-item sessions: ${items(bs.find(b => b.name === 'B11-pin').body).length}`);
    // RED FIRST: a mocked wrong chip must FAIL the assert, or the assert proves nothing.
    const red = assertChipMatchesLabel(await runBattery(wrongChipAdapter, null), { cutoff: '2024-06' });
    const green = assertChipMatchesLabel(await runBattery(conformingAdapter, null), { cutoff: '2024-06' });
    console.log(`  wrong-chip fixture  -> measured ${red.measured} vs label ${red.declared}: ${red.ok ? 'PASSED (wrong!)' : 'FAILED (correct)'}`);
    console.log(`  conforming fixture  -> measured ${green.measured} vs label ${green.declared}: ${green.ok ? 'PASSED (correct)' : 'FAILED (wrong!)'}`);
    if (red.ok !== false) fail('  the wrong-chip fixture must FAIL the assert. The battery cannot detect a relabel.');
    else if (green.ok !== true) fail('  the conforming fixture must PASS.');
    else console.log('  battery proven: detects a relabel, passes a chip that matches its label.');
    if (lbl.status === 'no-ic-running') console.log(`  live IC: none (${LABEL_PATH} says no-ic-running) — the battery binds the day one is labelled.`);

  } else {
    if (lbl.status === 'no-ic-running') { fail(`no IC is labelled in ${LABEL_PATH}; there is nothing to decap. Use --self-test.`); }
    else if (!process.env.KOLWEN_IC_ENDPOINT) { fail('KOLWEN_IC_ENDPOINT is not set — refusing to report a pass without measuring.'); }
    else {
      const out = `.decap-runs/${new Date().toISOString().replace(/[:.]/g, '-')}`;
      const v = assertChipMatchesLabel(await runBattery(askEndpoint, out), lbl);
      console.log(`raw replies saved to ${out}`);
      if (v.ok === false) fail(`SELF-DECAP FAILED: ${v.why}`); else console.log(`SELF-DECAP passed: ${v.why}`);
    }
  }
}
