# Usability study protocol

## Goal

Check whether Northern Thailand residents and small-business operators understand the debt-planning purpose, can complete the calculator, and can distinguish a scenario estimate from an eligibility decision.

## Participants and safeguards

- Recruit 10–20 participants across individual households and micro/small businesses; include older adults and people who rarely use web forms.
- For the first formative round, prioritize 5–8 participants including at least 2 older adults (60+) and 2 people who prefer voice or assisted use. This small round finds usability barriers; it is not a representative survey. Continue with a broader round only after fixing critical issues.
- Use a staging environment and synthetic amounts. Do not ask for names, account numbers, identity numbers, or real loan statements.
- Obtain informed consent, explain any recording before starting, offer note-taking instead, allow withdrawal, and keep recordings separate from task results. Delete recordings after coded notes are reviewed. Do not collect health/disability details; ask only what accessibility support the participant wants.
- Do not present the tool as a bank, government service, or eligibility checker.
- Offer large text, high contrast, keyboard/touch access, and a facilitator who may read instructions aloud. The participant should control the device unless they request assistance. Record assistance and whether a task was completed independently.

## Tasks

1. Explain in your own words what the service is for and what it cannot decide.
2. Complete a household estimate using a supplied fictional case; change one value and explain the difference.
3. Complete a business estimate with multiple debt instalments and a revenue-drop scenario.
4. Find an official debt-relief channel and explain which conditions still need lender confirmation.
5. Use chat to ask about an official support measure and identify its source document.
6. On mobile, locate and use voice input if the participant chooses to.
7. With a fictional case, identify an incorrect province or amount, correct it, and continue without restarting the whole assessment.
8. Explain what happens when income is zero or an optional value is skipped; check that the participant does not interpret missing data as zero or a confirmed debt-free status.
9. Find the next step for contacting a creditor and state whether the tool guarantees eligibility or a particular outcome.

## Concrete Fictional Test Cards (Citizen & Older-Adult Debt Scenarios)

Use the three standardized synthetic cards below during moderated sessions so participants never enter personal financial data:

### Scenario Card A — Older Adult / Household Borrower (Input Error Recovery & Rate Disambiguation)
- **Persona:** Retired or salaried household resident in **Lampang (`ลำปาง`)**
- **Monthly Income (`รายรับต่อเดือน`):** `30,000 บาท`
- **Monthly Debt Payment (`จ่ายหนี้ต่อเดือน`):** `10,000 บาท`
- **Essential Expenses (`ค่าใช้จ่ายจำเป็น`):** `3,000 บาท`
- **Emergency Savings (`เงินสำรอง`):** Choose **Skip (`ข้าม`)**
- **Remaining Principal (`เงินต้นคงเหลือ`):** Choose **Skip (`ข้าม`)**
- **Contract Interest Rate (`ดอกเบี้ยสัญญาเดิม`):** Intentionally type **`0.15`** first to test whether the participant notices the `< 1%` confirmation prompt and can choose either **`ใช้ 15.0% ต่อปี`** or **`ยืนยัน 0.15% ต่อปี`** (or edit the interest rate from the confirmation screen without restarting).
- **Debt Status & Horizon:** `ยังชำระตรงเวลา` (`Current`) · `5 ปี` · `รายได้ลดลง`
- **What to Verify:**
  1. Participant sees monthly cash left after expenses and debt (**`+17,000 บาท/เดือน`**, and **`+8,000 บาท/เดือน`** under a `-30%` income drop) even though savings were skipped.
  2. Participant understands that the estimated principal assumes 48 remaining months and that the year-1 payment is an illustrative target, **not** an approved bank offer.
  3. On the confirmation screen (`ขอทวนข้อมูลก่อนคำนวณครับ`), participant can tap **`แก้ดอกเบี้ย`** or **`แก้ค่าใช้จ่าย/เงินสำรอง`** and return directly to confirmation without re-answering earlier steps.

### Scenario Card B — Micro-SME Operator (Seasonal Income Drop & Lender Script)
- **Persona:** Small food shop / guesthouse in **Chiang Rai (`เชียงราย`)**
- **Monthly Revenue:** `120,000 บาท` · **Operating Expenses:** `84,000 บาท` · **Monthly Debt Payment:** `44,000 บาท` · **Cash Reserve:** `150,000 บาท`
- **Debt Status:** `เริ่มค้างชำระ 1 ถึง 4 เดือน` (`Overdue 1–4 months`)
- **What to Verify:**
  1. Participant identifies that current monthly cash flow is negative (`-8,000 บาท/เดือน`) and locates the **recommended safe payment cap** for slow months.
  2. Participant copies the **bank negotiation script (`คัดลอกข้อความนี้`)** or opens the **1-page printable note (`ดูเอกสารพร้อมพิมพ์`)** and explains which 4 questions they should ask the bank officer.

### Scenario Card C — Overdue Unsecured Borrower (Official Hotline & Agency Handoff)
- **Persona:** Individual borrower in **Chiang Mai (`เชียงใหม่`)** with credit-card / personal-loan arrears **over 4 months (`ค้างชำระเกิน 4 เดือนขึ้นไป`)**
- **What to Verify:**
  1. Participant locates the direct referral to **คลินิกแก้หนี้ by SAM (โทร `1443`)** and **โครงการปิดหนี้ไว ไปต่อได้ (โทร `1213` หรือ `1443 กด 6`)**.
  2. Participant correctly states that **โครงการคุณสู้ เราช่วย** is closed to new applicants (`ปิดลงทะเบียนแล้วเมื่อ 30 ก.ย. 2568`) and that eligibility for SAM programs must be verified directly with the official agency.

## Measures

- Task completion rate and completion time per task.
- Critical errors: confusing estimate with eligibility, interpreting missing values as zero, or overlooking a required input.
- Help requests, backtracks, and abandonment.
- For each task, record independent completion, completion after a neutral prompt, or completion with hands-on assistance. Capture where the participant hesitates, misreads a label, or loses entered information.
- Treat any belief that a provincial average is the participant's personal debt result, that a simulation guarantees relief/eligibility, or that skipped/zero income proves no debt as a critical misunderstanding.
- Compare older and low-digital-confidence participants descriptively; do not infer population differences from these small groups.
- After tasks, administer the standard 10-item System Usability Scale (SUS) with the original wording/order and 1–5 response scale. Do not modify the items or interpret a tiny sample as population evidence.
- Report participant mix, sample size, medians/ranges, and qualitative themes. Keep SUS descriptive; do not claim statistical representativeness.

## Release criteria for the pilot

Agree thresholds before recruiting. Suggested initial targets: at least 80% complete each core task without facilitator help; zero critical misinterpretations in the final round; and every observed issue has an owner and disposition. Re-test after material changes.
