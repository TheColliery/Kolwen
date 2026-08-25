# Kolwen — brand assets & usage

> ทุกตัวเลขในเอกสารนี้ **วัดจริง** ไม่ใช่ค่าที่ตั้งขึ้น — เรขาคณิตกับขนาดต่ำสุดสร้างใหม่ได้ด้วย
> `node make-brand.mjs` · อัตราส่วน contrast คำนวณจากค่า hex ด้วยสูตร relative luminance ของ WCAG 2.x
> ปรับปรุง 2026-08-26

## 1. เครื่องหมายมีสองชิ้น และสถานะทางกฎหมายต่างกัน

| ชิ้น | คืออะไร | สถานะ |
|---|---|---|
| **Word mark** — `Kolwen` | ตัวอักษรโรมัน · อ่านว่า "โคลเวน" · คำประดิษฐ์ ไม่มีความหมาย | **ยื่น ก.01 แล้ว 2026-08-24** class 9 + 42 · อยู่ระหว่างตรวจสอบ ยังไม่ได้จดทะเบียน |
| **Device** — แถบเฉียงสามแถบ | สัญลักษณ์ภาพ | **ยังไม่ได้ยื่น** — ใช้ได้ตามกฎหมายลิขสิทธิ์ แต่ไม่มีสิทธิเครื่องหมายการค้า |

ผลจากข้อนี้: ข้อความที่อ้างสิทธิได้คือ **ชื่อ** ไม่ใช่รูป ถ้าจะบังคับสิทธิกับใคร อ้างจากชื่อ

## 2. สี

| ชื่อ | Hex | ใช้กับ | contrast |
|---|---|---|---|
| Amber | `#e8833a` | พื้นเข้ม | **6.84:1** บน `#15130f` |
| Amber deep | `#A65A19` | พื้นขาว/อ่อนมาก | **5.125:1** บนขาว |
| Charcoal | `#15130f` | พื้นหลัง / icon tile | — |

### เกณฑ์ที่ยึด — WCAG 2.2 (ดึงจาก w3.org 2026-08-25)

**กฎ contrast ทุกข้อในเอกสารนี้ติดป้ายว่ามาจากไหน** (ตัวเลขอื่น — เรขาคณิต ขนาด ระยะ — ไม่ใช้ป้ายนี้):
**[บังคับ]** = มาตรฐานกำหนดตัวเลขนี้ · **[บ้านเรา]** = มาตรฐานไม่เอื้อมถึงกรณีนี้ เราตั้งเกณฑ์เอง ·
**[แนะนำ]** = มาตรฐานเสนอ *วิธี* ทำให้ผ่าน ไม่ได้บังคับตัวเลข

- **SC 1.4.3 Contrast (Minimum) — ระดับ AA** ข้อความและภาพของข้อความต้องได้ **4.5:1**
  ยกเว้น *Large Text* ได้ **3:1** (18pt ขึ้นไป หรือ 14pt ตัวหนา) และยกเว้น *Logotypes*:
  "Text that is part of a logo or brand name has no contrast requirement."
  ขอบเขตของ SC นี้คือ "text and images of text" เท่านั้น — **อุปกรณ์สามแถบไม่ใช่ข้อความ 1.4.3 จึงไม่
  เอื้อมถึงมันตั้งแต่แรก (out of scope) ไม่ใช่ "ได้รับยกเว้น"** ส่วนคำว่า Kolwen ที่เป็นตัวอักษรอยู่ใน
  ขอบเขต แต่เข้าข้อยกเว้น *Logotypes* ตรงตัว
- **SC 1.4.11 Non-text Contrast — ระดับ AA** ต้องได้ **3:1** สำหรับสองอย่าง: (ก) ข้อมูลภาพที่จำเป็น
  ต่อการระบุ UI component และสถานะของมัน — มีข้อยกเว้นของตัวเองสำหรับ component ที่ inactive และ
  กรณีที่หน้าตาถูกกำหนดโดย user agent · (ข) "Parts of graphics required to understand the
  content" — ส่วนของกราฟิกที่จำเป็นต่อการเข้าใจเนื้อหา ยกเว้นเมื่อการนำเสนอแบบนั้นเป็นสาระสำคัญเสียเอง
  ตัวบทของ SC นี้ไม่มีข้อยกเว้นเรื่องโลโก้ และ **ตามปกติก็ไม่ต้องมี** — เครื่องหมายการค้าไม่ใช่กราฟิกที่
  จำเป็นต่อการเข้าใจเนื้อหา ข้อ (ข) จึงไม่เอื้อมถึง (กรณีที่ตัวเครื่องหมายเองคือเนื้อหา เช่น ตารางเทียบยี่ห้อ
  ต้องคิดใหม่เป็นราย ๆ)
- เอกสาร Understanding ของ 1.4.11 พูดถึงโลโก้ไว้ด้วย แต่มันระบุตัวเองว่า **informative ไม่ใช่
  normative** จึงใช้เป็นฐานของกฎไม่ได้ ที่อ้างได้คือตัวบทข้างบน — และตัวบทไม่เอื้อมถึงเครื่องหมายอยู่แล้ว
  ส่วนที่ Understanding มีประโยชน์จริงคือ *วิธี* จัดการกรณีเครื่องหมายเป็นตัวควบคุม (ดูข้อ 6)

### กฎการใช้สี

**ห้ามใช้ `#e8833a` บนพื้นขาว** — วัดได้ 2.714:1 ใช้ `#A65A19` แทน กฎข้อนี้มีสองที่มา แล้วแต่ใช้กับอะไร:

- **ข้อความ** สี `#e8833a` บนขาว **[บังคับ]** — ตก 1.4.3 ทั้ง 4.5:1 และ 3:1 ไม่ผ่านเกณฑ์ไหนเลย
- **ตัวเครื่องหมาย** สี `#e8833a` บนขาว **[บ้านเรา]** — 1.4.3 ไม่เอื้อมถึงอุปกรณ์ และ 1.4.11 ข้อ (ข)
  ก็ไม่เอื้อม (ตราบใดที่ไม่ได้เป็นลิงก์/ปุ่ม) ห้ามข้อนี้จึงเป็นเกณฑ์ของเราเอง เหตุผลเดียวกับพื้นภาพถ่าย

**`#A65A19` บนพื้นเข้ม `#15130f` วัดได้ 3.620:1** — ตกเกณฑ์ 1.4.3 สำหรับข้อความปกติ (4.5:1)
แต่ผ่าน 3:1 ของ 1.4.3 *Large Text* จึงแยกเป็นสองกรณี:

- **ข้อความ** ใช้ได้เฉพาะข้อความขนาดใหญ่ **[บังคับ]** ข้อความปกติบนพื้นเข้มใช้ `#e8833a`
- **ตัวเครื่องหมาย** ใช้ได้ **[บ้านเรา]** — ไม่มีเกณฑ์ของมาตรฐานมาบังคับ (1.4.3 ไม่เอื้อมถึง 1.4.11 ข้อ (ข)
  ก็ไม่เอื้อม) ที่ยอมให้ใช้เพราะ 3.620 ยังอ่านออกจริงบนพื้นนี้ ไม่ใช่เพราะผ่านเกณฑ์ไหน

**`#A65A19` ผ่าน 1.4.3 ข้อความปกติ (4.5:1) เฉพาะพื้น `#f1f1f1` หรืออ่อนกว่า** **[บังคับ]** —
วัดได้ 5.125:1 บนขาว แต่ร่วงเหลือ 4.067:1 บนครีมของโปรเจกต์เอง `#ece4d9` ซึ่งตกเกณฑ์ข้อความปกติ
พื้นอ่อนที่ไม่ใช่ขาวล้วนต้องวัดก่อนใช้

**สีเดียวล้วน (mono)** ใช้ `kolwen-mark-mono.svg` ซึ่งรับสีจาก `currentColor` — วางในบริบทไหนก็ได้สีนั้น

## 3. เรขาคณิต (ถ้าต้องวาดใหม่)

กล่อง 100×100 · สามสี่เหลี่ยม แกนตรง ไม่มีมุมโค้ง ไม่มีเงา:

| แถบ | x | y | กว้าง | สูง |
|---|---|---|---|---|
| บน | 8.5 | 9.1 | 64.3 | 25.0 |
| กลาง | 17.85 | 46.25 | 64.3 | 19.66 |
| ล่าง | 27.2 | 75.46 | 64.3 | 15.45 |

หมึกกิน **83.0 × 81.8** ของกล่อง (live area ~83% ตามกฎ Material 20-of-24dp)
ช่องว่างระหว่างแถบ **12.15** (บน-กลาง) และ **9.55** (กลาง-ล่าง) — ช่อง 9.55 คือตัวที่พังก่อนเสมอ

## 4. Clear space — วัดจากตัวเครื่องหมายเอง

**X = ความสูงแถบล่าง = 15.45 หน่วย (15.45% ของความสูงกล่อง)**

เว้นรอบเครื่องหมาย **อย่างน้อย X ทุกด้าน** ห้ามมีตัวอักษร รูป ขอบ หรือสีอื่นล้ำเข้ามา
ที่เลือก X เป็นหน่วยเพราะมันเป็นชิ้นส่วนของเครื่องหมายเอง — ย่อขยายไปพร้อมกันเสมอ ไม่ต้องคำนวณใหม่

ในทางปฏิบัติ: เครื่องหมายสูง 100px → เว้นขอบ 15px · สูง 40px → เว้น 6px

## 5. ขนาดต่ำสุด — วัดจริง ไม่ได้เดา

rasterise ที่ 4× supersampling แล้วนับว่ายังเห็นสามแถบแยกกันไหม:

| ขนาด | เห็นกี่แถบ | ช่องว่าง |
|---|---|---|
| 8px | 3 | 1px / 1px |
| **10px** | **1** ⛔ | หายหมด |
| 12–16px | 3 | 1px / 1px |
| 20px | 3 | 2px / 2px |
| 24px | 3 | 3px / 2px |

**10px ยุบเป็นก้อนเดียวจริง** — และ 8px ที่รอดคือความบังเอิญของ pixel grid ไม่ใช่ความเสถียร
บทเรียนคือ "เล็กกว่านี้แล้วพัง" ไม่ใช่เส้นตรง ๆ อย่าเชื่อว่าลดลงทีละนิดแล้วจะค่อย ๆ แย่

- **ขั้นต่ำเด็ดขาด 16px** — ใช้ได้เฉพาะ favicon ที่ไฟล์ถูก render ไว้ล่วงหน้าแล้ว (`kolwen-favicon-16.png`)
- **ขั้นต่ำที่แนะนำ 20px** สำหรับ UI ทุกกรณี (ช่องว่าง ≥2px รอดทุก scaling)
- **งานพิมพ์: กล่องสูงอย่างน้อย 6 มม.** (ช่อง 9.55% → 0.57 มม. พิมพ์ออฟเซ็ตติดแน่)

## 6. ทำได้ / จำกัด / ห้ามทำ

**ทำได้** — ย่อขยายตามสัดส่วน · เปลี่ยนเป็น mono สีเดียว · วางบนพื้นเข้มหรือพื้นอ่อนโดยเลือกสีให้ถูก

**ห้าม** — บิดสัดส่วน (ย่อด้านเดียว) · หมุนหรือเอียง · ใส่เงา ไล่เฉด ขอบเส้น หรือมุมโค้ง ·
เปลี่ยนสีเป็นสีอื่นนอกจากที่ระบุหรือ mono · ขยับ/เพิ่ม/ลดจำนวนแถบ ·
วาง `#e8833a` บนพื้นขาว (สองที่มา ดูข้อ 2) ·
ใส่เครื่องหมายไว้ในกล่องที่บีบจน clear space ไม่พอ ·
วางเครื่องหมายบนภาพถ่ายที่ contrast ต่ำกว่า 4.5:1 (เกณฑ์ของเราเอง ดูย่อหน้าถัดไป)

**เกณฑ์ของเราเอง [บ้านเรา]** — วางเครื่องหมายบนภาพถ่ายต้องได้ **อย่างน้อย 4.5:1**
มาตรฐานไม่ได้บังคับตัวเลขนี้ — 1.4.3 คุมเฉพาะข้อความ อุปกรณ์สามแถบอยู่นอกขอบเขต (คำว่า Kolwen ที่เป็น
ตัวอักษรเข้าข้อยกเว้น *Logotypes*) ส่วน 1.4.11 ข้อ (ข) คุมกราฟิกที่จำเป็นต่อการเข้าใจเนื้อหา ซึ่ง
เครื่องหมายการค้าไม่ใช่ **4.5 จึงเป็นเกณฑ์ของเราเอง** เหตุผล: ภาพถ่ายไม่ใช่พื้นสีเดียวสม่ำเสมอ
ค่า contrast ค่าเดียวจึงประเมินกรณีแย่สุดจริงต่ำเกินไป (ถ้าเครื่องหมายนั้นเป็นลิงก์ด้วย ดูข้อถัดไป —
กรณีนั้น 3:1 เป็นข้อบังคับซ้อนเข้ามา)

**ถ้าเครื่องหมายถูกใช้เป็นลิงก์หรือปุ่ม [บังคับ]** — ตอนนั้นมันเป็น UI component และ 1.4.11 ข้อ (ก)
เข้ามาเกี่ยว ข้อ (ก) บังคับ 3:1 กับ *ข้อมูลภาพที่จำเป็นต่อการระบุตัว component* ซึ่งอาจไม่ใช่ตัวเครื่องหมาย
เสมอไป (ถ้ามีข้อความกำกับ ขอบ หรือตำแหน่งเป็นตัวบอกอยู่แล้ว) **เราตัดสินให้ถือ 3:1 เป็นข้อบังคับไว้ก่อน**
เพราะเป็นการอ่านที่ปลอดภัยกว่า · **[แนะนำ]** คือ *วิธี* ทำให้ผ่าน ซึ่ง Understanding เสนอสองทาง —
เลือกแบบเครื่องหมายที่ contrast สูงพอ หรือมี UI อีกตัวที่ทำหน้าที่เดียวกันและผ่านเกณฑ์
วันนี้เครื่องหมายบนหน้าเว็บเป็น `role="img"` ไม่ได้อยู่ใน `<a>` ข้อนี้จึงยังไม่มีผล เขียนไว้เผื่อวันที่เปลี่ยน

**จำกัด (ไม่ใช่ห้าม) [บังคับ]** — `#A65A19` บนพื้นเข้ม ใช้ได้เฉพาะข้อความใหญ่/ตัวเครื่องหมาย ไม่ใช่ข้อความปกติ (3.620:1)

## 7. ไฟล์

| ไฟล์ | ใช้ตอนไหน |
|---|---|
| `kolwen-mark.svg` | เครื่องหมายบนพื้นเข้ม — ค่าเริ่มต้นสำหรับเว็บ |
| `kolwen-mark-onlight.svg` | เครื่องหมายบนพื้นขาว/อ่อน |
| `kolwen-mark-mono.svg` | สีเดียว รับจาก `currentColor` — เอกสาร งานพิมพ์ ที่ห้ามใช้สี |
| `kolwen-icon.svg` | เครื่องหมาย + พื้น charcoal เต็มกล่อง — app icon / favicon |
| `kolwen-icon-{128,256,512,1024}.png` | app icon · store listing · press kit — **กรอบสี่เหลี่ยม/มุมมนเท่านั้น** |
| `kolwen-avatar-512.png` | **avatar โซเชียล** — ตัวเดียวที่รอด circle crop |
| `kolwen-mark{,-onlight}-128.png` | ที่ที่ใช้ SVG ไม่ได้ |
| `kolwen-favicon-{16,32}.png` | favicon เท่านั้น |
| `kolwen-wordmark.png` | **ภาพเครื่องหมายตามที่ยื่น ก.01** — ใช้อ้างอิงทางกฎหมาย ห้ามแก้ |
| `make-brand.mjs` | ตัวสร้างทุกไฟล์ข้างบน แก้เรขาคณิตที่นี่ที่เดียว |

### กรอบกลม (social avatar)

โซเชียลส่วนใหญ่ crop avatar เป็น **วงกลมที่อยู่ในกรอบพอดี** ซึ่งไม่ใช่ safe zone เดียวกับสี่เหลี่ยม
มุมนอกสุดของแถบบนกับแถบล่างอยู่ห่างจุดกลาง **58.27** หน่วย แต่วงกลมให้ได้แค่ **50** — เกิน 16.5%
คิดเป็นมุมโดนเฉือนข้างละ ~4px ที่ avatar ขนาด 48px

`kolwen-icon-512.png` จึง **ห้ามใช้เป็น avatar โซเชียล** ใช้ `kolwen-avatar-512.png` แทน —
ไฟล์เดียวกันทุกอย่าง ต่างแค่ย่อเครื่องหมายเข้าหาจุดกลางจนเต็ม 83% ของ *วงกลม* แทนที่จะเต็ม 83%
ของ *สี่เหลี่ยม* (สัดส่วนเดิม กฎเดิม คนละ zone) เรขาคณิตคำนวณใน `make-brand.mjs` ไม่ได้ตั้งด้วยมือ

`kolwen-wordmark.png` ต่างจากไฟล์อื่น: มันคือ **หลักฐาน** ไม่ใช่ asset ถ้าจะเปลี่ยนโลโก้ในอนาคต
ไฟล์อื่นเปลี่ยนได้ ไฟล์นี้เปลี่ยนไม่ได้ เพราะมันคือรูปที่ยื่นไปพร้อมคำขอเมื่อ 2026-08-24

## 8. การเขียนชื่อ

- โรมัน: **Kolwen** — K ใหญ่ตัวเดียว ไม่ใช่ KOLWEN ไม่ใช่ kolwen (ยกเว้น package/handle ที่ระบบบังคับตัวเล็ก)
- ไทย: **โคลเวน** — รูปเดียวตายตัว ไม่ใช่ โคลเว่น / โคลเว็น / คโลเวน
- ห้ามแปลชื่อ ห้ามใส่ช่องว่างกลางคำ ห้ามใส่ยัติภังค์

---

## English summary

**Two marks, different legal standing.** The word mark `Kolwen` is filed with the Thai DIP
(filed 2026-08-24, classes 9 and 42, pending — not yet registered). The three-bar
device is **not filed** — copyright only, no trademark rights.

**Colours.** `#e8833a` on dark grounds (6.84:1 on `#15130f`); `#A65A19` on light grounds
(5.125:1 on white). Never put `#e8833a` on white — it measures 2.714:1.

**Every contrast rule states its source.** `[required]` = WCAG sets this number ·
`[ours]` = WCAG does not reach this case, so the number is the project's · `[advisory]` =
WCAG suggests a *method*, not a number. WCAG 2.2, fetched from w3.org 2026-08-25.

- `#A65A19` for normal text holds 1.4.3's 4.5:1 only at `#f1f1f1` or lighter — on the
  project's own cream `#ece4d9` it drops to 4.067:1 **[required]**.
- `#A65A19` on `#15130f` is 3.620:1: for text it is limited to large text, which clears
  1.4.3's 3:1 **[required]**; for the mark it is allowed **[ours]**, because it reads
  clearly there, not because it meets any criterion.
- `#e8833a` on white clears no bar of 1.4.3, so for text the prohibition is **[required]**;
  for the mark the same prohibition is **[ours]**.

**Which bars are the standard's, and which are ours.** SC 1.4.3 governs "text and images of
text", so the three-bar device is **out of its scope** rather than exempt — the *Logotypes*
exception is what covers the word mark. SC 1.4.11 requires 3:1 for information identifying
UI components and for "Parts of graphics required to understand the content"; a brand mark
is not ordinarily required to understand content, so that clause does not reach it either.

**So our 4.5:1 minimum for the mark over a photograph is OUR rule [ours]**, and the reason
is ours too: a photograph is not a flat ground, so a single contrast value understates the
real worst case. The text bars above are the standard's and are unchanged.

**One case flips it back.** A mark used as a link or control is a user interface component,
and 1.4.11 then applies to the visual information that identifies the control — which may or
may not be the mark itself. We treat 3:1 as required there **[required]**, as the safer
reading. Its Understanding offers methods, not permission to skip: a higher-contrast variant,
or a conforming control alongside **[advisory]**. The mark on our page is `role="img"` and is
not inside an `<a>`, so this does not yet apply here.

**Clear space.** X = the height of the bottom bar = 15.45% of the box height. Keep at least
X clear on all four sides. The unit is a part of the mark, so it scales with it.

**Minimum size — measured, not assumed.** At 10px the three bars collapse into one solid
block; 8px survives only by pixel-grid luck. Absolute floor is **16px** (pre-rendered favicon
only); **20px** is the recommended UI minimum (gaps ≥2px). In print, **6mm box height** minimum.

**Never** distort, rotate, add effects, recolour outside the palette, or alter the bars.

Regenerate every asset with `node make-brand.mjs`. Geometry lives in that one file.
