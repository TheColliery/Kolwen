// The text the legal pages ADD to what the three sources say (data only; scripts/lib/legal-render.mjs and scripts/legal-pages.mjs use it).
//
// Everything a page shows is one of three things: a source passage shown as written, a pending line standing in for a held passage, or
// a line below. Nothing below states a legal conclusion: each line is a status, a fact the repository backs, or a pending line.
// Every pending line begins with the counsel-pending marker of its language, and render() refuses a pending row that does not.

export const MARK_EN = '[pending legal review]';
export const MARK_TH = '[รอที่ปรึกษากฎหมาย]';

export const PAGES = {
  terms: {
    file: 'web/terms.html', path: '/terms',
    titleEn: 'Terms', titleTh: 'ข้อกำหนด',
    descEn: 'Kolwen terms: a draft, not in force. Nothing is for sale, and parts of it wait for review by counsel.',
  },
  privacy: {
    file: 'web/privacy.html', path: '/privacy',
    titleEn: 'Privacy', titleTh: 'ความเป็นส่วนตัว',
    descEn: 'Kolwen privacy notice: a draft. It states what this site does today, and parts of it wait for review by counsel.',
  },
  refund: {
    file: 'web/refund.html', path: '/refund',
    titleEn: 'Refunds', titleTh: 'การคืนเงิน',
    descEn: 'Kolwen refund terms: a draft. Nothing is for sale yet, and parts of it wait for review by counsel.',
  },
};

PAGES.changelog = {
  file: 'web/changelog.html', path: '/changelog',
  titleEn: 'Changelog', titleTh: 'บันทึกการเปลี่ยนแปลง',
  // The log is kept in English; the Thai view says so (a status statement, no obligation).
  noteTh: 'บันทึกการเปลี่ยนแปลงนี้เขียนเป็นภาษาอังกฤษ',
  descEn: "Kolwen's changelog, rendered from the repository's CHANGELOG.md. Nothing has been released yet.",
};

export const BANNER = {
  en: 'This page is a draft. It is not in force, nothing is for sale, and parts of it wait for review by counsel.',
  th: 'หน้านี้เป็นฉบับร่าง ยังไม่มีผลใช้บังคับ ยังไม่มีสินค้าให้ซื้อ และบางส่วนรอที่ปรึกษากฎหมายตรวจสอบ',
};

// Stands in for ONE held passage; the passage text itself is never shown.
export const PENDING = {
  en: MARK_EN + ' This part is waiting for legal review and is not shown yet.',
  th: MARK_TH + ' ส่วนนี้รอที่ปรึกษากฎหมายตรวจสอบ จึงยังไม่แสดง',
};

// Once at the foot of every legal page.
export const THAI_OWED = {
  en: MARK_EN + ' Full Thai versions of the Terms, the Refunds and the Privacy pages, equal in substance to the English, are still to come.',
  th: MARK_TH + ' ฉบับภาษาไทยเต็มของข้อกำหนด การคืนเงิน และความเป็นส่วนตัว ที่เนื้อหาเท่ากับฉบับภาษาอังกฤษ ยังจะตามมา',
};

// A TEXT passage whose Thai twin is supplied here. The English must equal the source passage (checked at render, so a source edit cannot drift from it).
export const TEXT_TWINS = [
  {
    anchor: 'Payment for a key, a subscription or credits',
    en: "Payment for a key, a subscription or credits is taken by Paddle as the merchant of record, under Paddle's own buyer terms. These Terms cover the licence to use Kolwen and Kolwen's own policies; the purchase contract itself sits with Paddle.",
    th: 'Paddle เป็นผู้รับชำระเงินสำหรับคีย์ การสมัครสมาชิก หรือเครดิต ในฐานะผู้ขายตามกฎหมาย (merchant of record) ตามข้อกำหนดผู้ซื้อของ Paddle เอง ข้อกำหนดนี้ครอบคลุมสิทธิใช้ Kolwen และนโยบายของ Kolwen เอง ส่วนสัญญาซื้อขายอยู่กับ Paddle',
  },
];

// A held passage that shows a specific pending line instead of the generic one. Each line states a status only.
export const PENDING_LINES = [
  {
    // The owner's own rule for the term, held as a pending line: only legal working days in Thailand count; counsel words the definition.
    file: 'TERMS.md', anchor: '**Business days.** In this section a business day',
    en: MARK_EN + ' In this section only legal working days in Thailand count as business days. The exact definition is waiting for review.',
    th: MARK_TH + ' ในหัวข้อนี้นับเฉพาะวันทำการตามกฎหมายของประเทศไทยเป็นวันทำการ คำจำกัดความที่แน่นอนรอการตรวจสอบ',
  },
];

// The refund page: rows in order. kind 'text' is a statement shown as written; kind 'pending' is a pending line whose content is a status.
// A row with `from` (the first eight words of a TERMS.md passage) IS that passage: its English is the passage's text and it follows the passage's hold,
// so the refund page cannot keep promising what the terms page no longer says. `en` then records the wording the Thai `th` was written against.
export const REFUND_ROWS = [
  {
    id: 'R1', kind: 'text', from: '**An unredeemed key is refunded in full within',
    en: 'An unredeemed key is refunded in full within 14 days of purchase. Nothing was used, so the key is simply voided.',
    th: 'คีย์ที่ยังไม่ได้ใช้ได้รับเงินคืนเต็มจำนวนภายใน 14 วันนับจากวันซื้อ เพราะยังไม่ได้ใช้อะไร คีย์จึงถูกยกเลิก',
  },
  {
    id: 'R2', kind: 'text', from: '**By Kolwen without cause.** Kolwen refunds the unused',
    en: "By Kolwen without cause. Kolwen refunds the unused part: a key's remaining days, a subscription's remaining current period, and unused credits at the price paid.",
    th: 'เมื่อ Kolwen เลิกสัญญาโดยไม่มีเหตุ Kolwen คืนเงินส่วนที่ยังไม่ได้ใช้ ได้แก่วันที่เหลือของคีย์ รอบปัจจุบันที่เหลือของการสมัครสมาชิก และเครดิตที่ยังไม่ได้ใช้ตามราคาที่จ่าย',
  },
  {
    id: 'R3', kind: 'text',
    en: "Payments are taken by Paddle as the merchant of record. Paddle's standard refund policy is at https://www.paddle.com/legal/refund-policy.",
    th: 'Paddle เป็นผู้รับชำระเงินในฐานะผู้ขายตามกฎหมาย (merchant of record) นโยบายคืนเงินมาตรฐานของ Paddle อยู่ที่ https://www.paddle.com/legal/refund-policy',
  },
  {
    id: 'R4', kind: 'pending',
    en: MARK_EN + ' To ask for a refund, you can use Paddle, the merchant of record, or write to Kolwen at support@kolwen.com.',
    th: MARK_TH + ' หากต้องการขอเงินคืน ใช้ Paddle ผู้ขายตามกฎหมาย (merchant of record) หรือเขียนถึง Kolwen ที่ support@kolwen.com ได้',
  },
  {
    id: 'R5', kind: 'pending',
    en: MARK_EN + " How Paddle's refund policy and the 14-day refund above fit together is waiting for review.",
    th: MARK_TH + ' วิธีที่นโยบายคืนเงินของ Paddle กับการคืนเงินภายใน 14 วันข้างต้นทำงานร่วมกันนั้น รอการตรวจสอบ',
  },
  {
    // Neutral by the head's ruling: the page promises neither a deduction nor no deduction.
    id: 'R6', kind: 'pending',
    en: MARK_EN + ' Whether a refund of a subscription requested within 7 days of purchase deducts the days you used is waiting for review.',
    th: MARK_TH + ' การขอเงินคืนค่าสมัครสมาชิกภายใน 7 วันนับจากวันซื้อ จะหักวันที่คุณใช้ไปแล้วหรือไม่ รอการตรวจสอบ',
  },
  {
    id: 'R7', kind: 'pending',
    en: MARK_EN + ' The refund rule for days used after the first 7 days, and the refund window for unused prepaid credits, are waiting for review.',
    th: MARK_TH + ' กฎการคืนเงินเกี่ยวกับวันที่ใช้ไปหลัง 7 วันแรก และช่วงเวลาขอคืนเงินสำหรับเครดิตที่ยังไม่ได้ใช้ รอการตรวจสอบ',
  },
  {
    // Shown while the legal-state record says the Thai 7-day clause is not in force; replaced by the dated clause when it is.
    id: 'R8', kind: 'pending',
    en: MARK_EN + ' A clause on the Thai 7-day cancellation right is drafted. It is not in force yet and will show here only when it is.',
    th: MARK_TH + ' ข้อกำหนดเรื่องสิทธิยกเลิกภายใน 7 วันตามกฎหมายไทยร่างไว้แล้ว ยังไม่มีผลใช้บังคับ และจะแสดงที่นี่เมื่อมีผลเท่านั้น',
  },
  {
    id: 'R9', kind: 'pending',
    en: MARK_EN + ' Refund terms on this page are a draft.',
    th: MARK_TH + ' ข้อกำหนดการคืนเงินในหน้านี้เป็นฉบับร่าง',
  },
];
