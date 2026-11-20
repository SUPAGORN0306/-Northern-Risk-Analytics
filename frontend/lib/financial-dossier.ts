import type { Lang, ProvinceOutlookItem } from "@/lib/api"

export type DebtStatusKey = "current" | "persistent" | "overdue_31_120" | "overdue_120_plus" | "disaster"

export type FinancialDiagnostic = {
  isSme: boolean
  monthlyRevenue: number
  monthlyOpex: number
  monthlyDebt: number
  cashReserve: number
  operatingCashflow: number
  netMonthlyCashflow: number
  dsrPct: number
  dscr: number | null
  dscrStatus: "safe" | "tight" | "critical" | "na"
  runwayOpexMonths: number | null
  runwayTotalMonths: number | null
  stressDropPct: number
  stressedRevenue: number
  stressedOperatingCashflow: number
  stressedDscr: number | null
  stressedDsrPct: number
  stressedNetMonthlyCashflow: number
  stressedRunwayMonths: number | null
}

export type LoanCurvePoint = {
  yearLabel: string
  yearNum: number
  originalBalance: number
  policyBalance: number
  originalPayment: number
  policyPayment: number
}

export type LoanComparisonResult = {
  mode: "sme_3reduce" | "responsible_lending" | "persistent_5y" | "khunsoo" | "debt_clinic" | "disaster_defer"
  policyTitleTh: string
  policyTitleEn: string
  ruleCaptionTh: string
  ruleCaptionEn: string
  principalUsed: number
  originalRatePct: number
  policyRateLabel: string
  originalMonthlyPayment: number
  policyYear1Payment: number
  policyYear2Payment: number
  policyYear3Payment: number
  monthlyLiquiditySaved: number
  year2BalanceReductionExtra: number
  totalInterestSaved: number
  horizonYears: number
  overLimit2M: boolean
  overAge70: boolean
  points: LoanCurvePoint[]
}

export type ParsedCsvSummary = {
  monthsDetected: number
  rowCount: number
  avgMonthlyRevenue: number
  avgMonthlyOpex: number
  avgMonthlyDebt: number
  estimatedCashReserve: number
}

export const SAMPLE_STATEMENT_CSV = `date,category,description,income,expense
2026-08-05,room_sales,ยอดขายห้องพักและคาเฟ่ สัปดาห์ที่ 1,42000,0
2026-08-12,room_sales,ยอดขายห้องพักและคาเฟ่ สัปดาห์ที่ 2,38000,0
2026-08-20,room_sales,ยอดขายห้องพักและคาเฟ่ สัปดาห์ที่ 3,45000,0
2026-08-28,room_sales,ยอดขายห้องพักและคาเฟ่ สัปดาห์ที่ 4,40000,0
2026-08-03,opex,ค่าเช่าและสาธารณูปโภค,0,34000
2026-08-15,opex,ค่าวัตถุดิบอาหารและเครื่องดื่ม,0,32000
2026-08-30,opex,ค่าจ้างพนักงานประจำ,0,46000
2026-08-28,debt,ค่างวดสินเชื่อธุรกิจ SME,0,42000
2026-09-06,room_sales,ยอดขายห้องพักและคาเฟ่ สัปดาห์ที่ 1,35000,0
2026-09-14,room_sales,ยอดขายห้องพักและคาเฟ่ สัปดาห์ที่ 2,34000,0
2026-09-22,room_sales,ยอดขายห้องพักและคาเฟ่ สัปดาห์ที่ 3,39000,0
2026-09-29,room_sales,ยอดขายห้องพักและคาเฟ่ สัปดาห์ที่ 4,37000,0
2026-09-03,opex,ค่าเช่าและสาธารณูปโภค,0,33000
2026-09-15,opex,ค่าวัตถุดิบอาหารและเครื่องดื่ม,0,29000
2026-09-30,opex,ค่าจ้างพนักงานประจำ,0,46000
2026-09-28,debt,ค่างวดสินเชื่อธุรกิจ SME,0,42000
2026-10-05,room_sales,ยอดขายห้องพักและคาเฟ่ สัปดาห์ที่ 1,41000,0
2026-10-13,room_sales,ยอดขายห้องพักและคาเฟ่ สัปดาห์ที่ 2,44000,0
2026-10-21,room_sales,ยอดขายห้องพักและคาเฟ่ สัปดาห์ที่ 3,42000,0
2026-10-29,room_sales,ยอดขายห้องพักและคาเฟ่ สัปดาห์ที่ 4,43000,0
2026-10-03,opex,ค่าเช่าและสาธารณูปโภค,0,34000
2026-10-15,opex,ค่าวัตถุดิบอาหารและเครื่องดื่ม,0,31000
2026-10-30,opex,ค่าจ้างพนักงานประจำ,0,46000
2026-10-28,debt,ค่างวดสินเชื่อธุรกิจ SME,0,42000
`

export function calcAnnuityPayment(principal: number, annualRatePct: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0
  const r = annualRatePct / 100 / 12
  if (r <= 0) return principal / months
  return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1)
}

export function computeFinancialDiagnostic(params: {
  isSme: boolean
  monthlyRevenue: number
  monthlyOpex: number
  monthlyDebt: number
  cashReserve: number
  stressDropPct: number
}): FinancialDiagnostic {
  const { isSme, monthlyRevenue, monthlyOpex, monthlyDebt, cashReserve, stressDropPct } = params
  const opex = isSme ? Math.max(0, monthlyOpex) : 0
  const rev = Math.max(0, monthlyRevenue)
  const debt = Math.max(0, monthlyDebt)
  const reserve = Math.max(0, cashReserve)

  const operatingCashflow = rev - opex
  const netMonthlyCashflow = operatingCashflow - debt
  const dsrPct = rev > 0 ? Number(((debt / rev) * 100).toFixed(1)) : 0
  const dscr = debt > 0 ? Number((operatingCashflow / debt).toFixed(2)) : null

  let dscrStatus: "safe" | "tight" | "critical" | "na" = "na"
  if (dscr != null) {
    if (dscr >= 1.25) dscrStatus = "safe"
    else if (dscr >= 1.0) dscrStatus = "tight"
    else dscrStatus = "critical"
  }

  const runwayOpexMonths = isSme && opex > 0 ? Number((reserve / opex).toFixed(1)) : null
  const totalFixedBurn = opex + debt
  const runwayTotalMonths = totalFixedBurn > 0 ? Number((reserve / totalFixedBurn).toFixed(1)) : null

  const stressedRevenue = Math.round(rev * (1 - stressDropPct / 100))
  const stressedOperatingCashflow = stressedRevenue - opex
  const stressedDscr = debt > 0 ? Number((stressedOperatingCashflow / debt).toFixed(2)) : null
  const stressedDsrPct = stressedRevenue > 0 ? Number(((debt / stressedRevenue) * 100).toFixed(1)) : 999
  const stressedNetMonthlyCashflow = stressedOperatingCashflow - debt
  const stressedRunwayMonths =
    stressedNetMonthlyCashflow < 0
      ? Number((reserve / Math.abs(stressedNetMonthlyCashflow)).toFixed(1))
      : null

  return {
    isSme,
    monthlyRevenue: rev,
    monthlyOpex: opex,
    monthlyDebt: debt,
    cashReserve: reserve,
    operatingCashflow,
    netMonthlyCashflow,
    dsrPct,
    dscr,
    dscrStatus,
    runwayOpexMonths,
    runwayTotalMonths,
    stressDropPct,
    stressedRevenue,
    stressedOperatingCashflow,
    stressedDscr,
    stressedDsrPct,
    stressedNetMonthlyCashflow,
    stressedRunwayMonths,
  }
}

export function buildLoanComparison(params: {
  status: DebtStatusKey
  isSme: boolean
  monthlyRevenue: number
  monthlyDebt: number
  totalPrincipalInput: number
  borrowerAge: number
  clinicMonths: number
  deferMonths: number
  lang: Lang
}): LoanComparisonResult | null {
  const { status, isSme, monthlyRevenue, monthlyDebt, totalPrincipalInput, borrowerAge, clinicMonths, deferMonths, lang } = params
  if (monthlyDebt <= 0 && totalPrincipalInput <= 0) return null

  const principal = totalPrincipalInput > 0 ? totalPrincipalInput : Math.round(monthlyDebt * 48)
  if (principal <= 0) return null

  let mode: LoanComparisonResult["mode"] = "responsible_lending"
  let horizonMonths = 60
  let origRate = 9.5
  let policyRateLabel = ""
  let policyTitleTh = ""
  let policyTitleEn = ""
  let ruleCaptionTh = ""
  let ruleCaptionEn = ""

  if (status === "overdue_120_plus") {
    mode = "debt_clinic"
    horizonMonths = Math.max(12, Math.min(120, clinicMonths))
    origRate = 18.0
    const clinicRate = horizonMonths <= 48 ? 3 : horizonMonths <= 84 ? 4 : 5
    policyRateLabel = `${clinicRate}%`
    policyTitleTh = `คลินิกแก้หนี้ (ดอกเบี้ย ${clinicRate}% · ผ่อน ${horizonMonths} งวด)`
    policyTitleEn = `Debt Clinic by SAM (${clinicRate}% p.a. · ${horizonMonths} mos)`
    ruleCaptionTh = "เปรียบเทียบสัญญาบัตรเครดิต/สินเชื่อเดิม (ดอกเบี้ย 18%) กับคลินิกแก้หนี้ ดอกเบี้ยผ่อนปรน 3 ถึง 5% ต่อปี"
    ruleCaptionEn = "Compares typical 18% unsecured loan against Debt Clinic by SAM 3 to 5% p.a. schedule."
  } else if (status === "overdue_31_120") {
    mode = "khunsoo"
    horizonMonths = 60
    origRate = 8.0
    policyRateLabel = lang === "th" ? "พักดอกเบี้ย 3 ปี" : "3yr Interest Suspended"
    policyTitleTh = "โครงการคุณสู้ เราช่วย (จ่ายค่างวด 50% / 70% / 90% · พักดอกเบี้ย 3 ปี)"
    policyTitleEn = "Khun Soo Rao Chuay (50% / 70% / 90% · 3yr Interest Freeze)"
    ruleCaptionTh = "ลดค่างวด 3 ปีแรกเพื่อให้ต่ำกว่ากำไรที่หาได้จริง พร้อมพักดอกเบี้ย 3 ปีโดยนำค่างวดทั้งหมดไปหักเงินต้น 100%"
    ruleCaptionEn = "Years 1 to 3 suspend interest so 100% of stepped payments directly cut principal."
  } else if (status === "persistent") {
    mode = "persistent_5y"
    horizonMonths = 60
    origRate = 25.0
    policyRateLabel = lang === "th" ? "ดอกเบี้ยไม่เกิน 15%" : "Max 15%"
    policyTitleTh = "มาตรการแก้หนี้เรื้อรังปิดจบใน 5 ปี (ลดเพดานดอกเบี้ยไม่เกิน 15% ต่อปี)"
    policyTitleEn = "Persistent Debt 5 Year Exit (Max 15% p.a.)"
    ruleCaptionTh = "เปลี่ยนหนี้หมุนเวียนดอกเบี้ย 25% ที่จ่ายแต่ดอกเบี้ยไม่จบ ให้เป็นค่างวดคงที่ปิดจบหนี้ได้จริงภายใน 5 ปี"
    ruleCaptionEn = "Compares 25% revolving minimum payments against 60 month payoff capped at 15% p.a."
  } else if (status === "disaster") {
    mode = "disaster_defer"
    horizonMonths = 60
    origRate = 8.5
    policyRateLabel = lang === "th" ? `พักเงินต้น ${deferMonths} เดือน` : `${deferMonths}m Deferral`
    policyTitleTh = `มาตรการผู้ประสบภัยพิบัติ ธปท.ว. 2302/2568 (พักชำระเงินต้น ${deferMonths} เดือน)`
    policyTitleEn = `2568 Disaster Relief Circular (${deferMonths}m Principal Deferral)`
    ruleCaptionTh = `พักชำระเงินต้น ${deferMonths} เดือนแรก (จ่ายเฉพาะดอกเบี้ย) เพื่อให้ธุรกิจมีเงินสดเหลือผ่านช่วงวิกฤตน้ำท่วม ฝุ่น หรือมลพิษทางน้ำ`
    ruleCaptionEn = `Interest only relief for first ${deferMonths} months to protect cashflow during recovery.`
  } else if (isSme) {
    mode = "sme_3reduce"
    horizonMonths = 60
    origRate = 9.5
    policyRateLabel = lang === "th" ? "หักเงินต้น 100% (2 ปีแรก)" : "100% Principal Cut (2 yrs)"
    policyTitleTh = "มาตรการ 3 ลด ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อม (หักเงินต้น 100% นาน 2 ปี)"
    policyTitleEn = "SME D Bank 3 Reduce Relief (100% Principal First for 2 Years)"
    ruleCaptionTh = "ลดค่างวดลง 15% เพื่อให้จ่ายไหวตามกำไรจริง และนำค่างวด 24 เดือนแรกไปหักเงินต้น 100% พร้อมลดดอกเบี้ยในปีที่ 3 ถึง 5"
    ruleCaptionEn = "Simulates 100% principal first allocation for 24 months plus 15% payment ease and 6.5% rate after."
  } else {
    mode = "responsible_lending"
    horizonMonths = 60
    origRate = 10.5
    policyRateLabel = lang === "th" ? "ลดดอกเบี้ย 2% + ขยายงวด" : "Rate Reduced 2%"
    policyTitleTh = "ปรับโครงสร้างหนี้เชิงป้องกันก่อนเป็นหนี้เสีย (ตามหลักเกณฑ์ปี 2568)"
    policyTitleEn = "Pre Emptive Restructuring (Responsible Lending 2568)"
    ruleCaptionTh = "ปรับลดค่างวดรายเดือนให้อยู่ในระดับไม่เกิน 38% ของรายได้ พร้อมลดอัตราดอกเบี้ยโดยไม่มีค่าธรรมเนียม"
    ruleCaptionEn = "Simulates payment alignment within a 38% DSR ceiling with lower interest and zero fee."
  }

  const origMonthlyPay = monthlyDebt > 0 ? monthlyDebt : Math.round(calcAnnuityPayment(principal, origRate, horizonMonths))
  const origR = origRate / 100 / 12

  let policyY1Pay = origMonthlyPay
  let policyY2Pay = origMonthlyPay
  let policyY3Pay = origMonthlyPay
  let clinicRatePct = 4

  if (mode === "debt_clinic") {
    clinicRatePct = horizonMonths <= 48 ? 3 : horizonMonths <= 84 ? 4 : 5
    const pay = Math.round(calcAnnuityPayment(principal, clinicRatePct, horizonMonths))
    policyY1Pay = pay
    policyY2Pay = pay
    policyY3Pay = pay
  } else if (mode === "khunsoo") {
    policyY1Pay = Math.round(origMonthlyPay * 0.5)
    policyY2Pay = Math.round(origMonthlyPay * 0.7)
    policyY3Pay = Math.round(origMonthlyPay * 0.9)
  } else if (mode === "persistent_5y") {
    const pay = Math.round(calcAnnuityPayment(principal, 15.0, 60))
    policyY1Pay = pay
    policyY2Pay = pay
    policyY3Pay = pay
  } else if (mode === "disaster_defer") {
    const interestOnly = Math.round(principal * (origRate / 100 / 12))
    policyY1Pay = interestOnly
    policyY2Pay = origMonthlyPay
    policyY3Pay = origMonthlyPay
  } else if (mode === "sme_3reduce") {
    const easedPay = Math.round(origMonthlyPay * 0.85)
    policyY1Pay = easedPay
    policyY2Pay = easedPay
    policyY3Pay = easedPay
  } else {
    const safeTarget = monthlyRevenue > 0 ? Math.round(monthlyRevenue * 0.38) : Math.round(origMonthlyPay * 0.8)
    const pay = Math.min(origMonthlyPay, Math.max(Math.round(calcAnnuityPayment(principal, 8.5, 72)), safeTarget))
    policyY1Pay = pay
    policyY2Pay = pay
    policyY3Pay = pay
  }

  // Month by month deterministic amortization simulation for both curves
  let balOrig = principal
  let balPol = principal
  let intOrigTotal = 0
  let intPolTotal = 0
  let y2OrigBal = principal
  let y2PolBal = principal

  const points: LoanCurvePoint[] = [
    {
      yearLabel: lang === "th" ? "เริ่มต้น" : "Start",
      yearNum: 0,
      originalBalance: Math.round(principal),
      policyBalance: Math.round(principal),
      originalPayment: Math.round(origMonthlyPay),
      policyPayment: Math.round(policyY1Pay),
    },
  ]

  const totalYears = Math.max(1, Math.ceil(horizonMonths / 12))

  for (let m = 1; m <= horizonMonths; m++) {
    // Original contract month step
    if (balOrig > 0) {
      const interestO = balOrig * origR
      intOrigTotal += interestO
      const payO =
        mode === "persistent_5y"
          ? Math.max(origMonthlyPay, interestO + balOrig * 0.004)
          : Math.max(origMonthlyPay, interestO + 1)
      const prinCutO = Math.max(0, payO - interestO)
      balOrig = Math.max(0, balOrig - prinCutO)
    }

    // Policy restructured month step
    let currentPolPay = policyY1Pay
    if (balPol > 0) {
      if (mode === "sme_3reduce") {
        if (m <= 24) {
          // 100% principal first allocation for 2 years
          currentPolPay = policyY1Pay
          balPol = Math.max(0, balPol - currentPolPay)
        } else {
          const rAfter = 6.5 / 100 / 12
          const interestP = balPol * rAfter
          intPolTotal += interestP
          currentPolPay = Math.round(calcAnnuityPayment(balPol, 6.5, Math.max(1, horizonMonths - m + 1)))
          balPol = Math.max(0, balPol - Math.max(0, currentPolPay - interestP))
        }
      } else if (mode === "khunsoo") {
        if (m <= 12) {
          currentPolPay = policyY1Pay
          balPol = Math.max(0, balPol - currentPolPay)
        } else if (m <= 24) {
          currentPolPay = policyY2Pay
          balPol = Math.max(0, balPol - currentPolPay)
        } else if (m <= 36) {
          currentPolPay = policyY3Pay
          balPol = Math.max(0, balPol - currentPolPay)
        } else {
          const rResume = origRate / 100 / 12
          const interestP = balPol * rResume
          intPolTotal += interestP
          currentPolPay = origMonthlyPay
          balPol = Math.max(0, balPol - Math.max(0, currentPolPay - interestP))
        }
      } else if (mode === "debt_clinic") {
        const rClinic = clinicRatePct / 100 / 12
        const interestP = balPol * rClinic
        intPolTotal += interestP
        currentPolPay = policyY1Pay
        balPol = Math.max(0, balPol - Math.max(0, currentPolPay - interestP))
      } else if (mode === "persistent_5y") {
        const r15 = 15.0 / 100 / 12
        const interestP = balPol * r15
        intPolTotal += interestP
        currentPolPay = policyY1Pay
        balPol = Math.max(0, balPol - Math.max(0, currentPolPay - interestP))
      } else if (mode === "disaster_defer") {
        if (m <= deferMonths) {
          const interestP = balPol * (origRate / 100 / 12)
          intPolTotal += interestP
          currentPolPay = Math.round(interestP)
        } else {
          const rAfter = Math.max(5.5, origRate - 1.5) / 100 / 12
          const interestP = balPol * rAfter
          intPolTotal += interestP
          currentPolPay = origMonthlyPay
          balPol = Math.max(0, balPol - Math.max(0, currentPolPay - interestP))
        }
      } else {
        const rRestr = 8.5 / 100 / 12
        const interestP = balPol * rRestr
        intPolTotal += interestP
        currentPolPay = policyY1Pay
        balPol = Math.max(0, balPol - Math.max(0, currentPolPay - interestP))
      }
    }

    if (m === 24) {
      y2OrigBal = balOrig
      y2PolBal = balPol
    }

    if (m % 12 === 0 || m === horizonMonths) {
      const yr = Math.ceil(m / 12)
      points.push({
        yearLabel: lang === "th" ? `ปีที่ ${yr}` : `Yr ${yr}`,
        yearNum: yr,
        originalBalance: Math.round(balOrig),
        policyBalance: Math.round(balPol),
        originalPayment: Math.round(origMonthlyPay),
        policyPayment: Math.round(currentPolPay),
      })
    }
  }

  const overLimit2M = mode === "debt_clinic" && principal > 2_000_000
  const overAge70 = mode === "debt_clinic" && borrowerAge > 0 && borrowerAge + horizonMonths / 12 > 70

  return {
    mode,
    policyTitleTh,
    policyTitleEn,
    ruleCaptionTh,
    ruleCaptionEn,
    principalUsed: Math.round(principal),
    originalRatePct: origRate,
    policyRateLabel,
    originalMonthlyPayment: Math.round(origMonthlyPay),
    policyYear1Payment: Math.round(policyY1Pay),
    policyYear2Payment: Math.round(policyY2Pay),
    policyYear3Payment: Math.round(policyY3Pay),
    monthlyLiquiditySaved: Math.round(origMonthlyPay - policyY1Pay),
    year2BalanceReductionExtra: Math.max(0, Math.round(y2OrigBal - y2PolBal)),
    totalInterestSaved: Math.max(0, Math.round(intOrigTotal - intPolTotal)),
    horizonYears: totalYears,
    overLimit2M,
    overAge70,
    points,
  }
}

export function parseStatementCsv(csvText: string): ParsedCsvSummary | null {
  const cleaned = csvText.replace(/^\uFEFF/, "").trim()
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return null

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase())
  const dateIdx = headers.findIndex((h) => ["date", "วันที่", "month", "เดือน"].some((k) => h.includes(k)))
  const catIdx = headers.findIndex((h) => ["category", "หมวด", "type", "ประเภท"].some((k) => h.includes(k)))
  const descIdx = headers.findIndex((h) => ["desc", "รายการ", "detail", "note"].some((k) => h.includes(k)))
  const incIdx = headers.findIndex((h) => ["income", "credit", "รายรับ", "เงินเข้า", "ยอดขาย"].some((k) => h.includes(k)))
  const expIdx = headers.findIndex((h) => ["expense", "debit", "รายจ่าย", "เงินออก"].some((k) => h.includes(k)))
  const amtIdx = headers.findIndex((h) => ["amount", "จำนวนเงิน", "ยอดเงิน"].some((k) => h.includes(k)))

  if (incIdx === -1 && expIdx === -1 && amtIdx === -1) return null

  const months = new Set<string>()
  let totalRev = 0
  let totalOpex = 0
  let totalDebt = 0
  let parsedRows = 0

  const debtKeywords = ["debt", "loan", "installment", "ค่างวด", "สินเชื่อ", "เงินกู้", "ผ่อน", "ธนาคาร"]

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
    if (cols.length < 2) continue

    const rawDate = dateIdx >= 0 ? cols[dateIdx] || "" : ""
    const ymMatch = rawDate.match(/(\d{4})[-/](\d{1,2})/)
    if (ymMatch) {
      months.add(`${ymMatch[1]}-${ymMatch[2].padStart(2, "0")}`)
    }

    const catText = `${catIdx >= 0 ? cols[catIdx] || "" : ""} ${descIdx >= 0 ? cols[descIdx] || "" : ""}`.toLowerCase()
    const isDebtRow = debtKeywords.some((kw) => catText.includes(kw))

    const parseNum = (v: string | undefined) => {
      if (!v) return 0
      const n = Number(v.replace(/,/g, ""))
      return Number.isFinite(n) ? n : 0
    }

    let incVal = incIdx >= 0 ? parseNum(cols[incIdx]) : 0
    let expVal = expIdx >= 0 ? parseNum(cols[expIdx]) : 0

    if (incIdx === -1 && expIdx === -1 && amtIdx >= 0) {
      const a = parseNum(cols[amtIdx])
      if (a >= 0) incVal = a
      else expVal = Math.abs(a)
    }

    if (incVal > 0 || expVal > 0) {
      parsedRows += 1
      totalRev += incVal
      if (isDebtRow) totalDebt += expVal
      else totalOpex += expVal
    }
  }

  if (parsedRows === 0) return null
  const monthDiv = Math.max(1, months.size)
  const avgRev = Math.round(totalRev / monthDiv)
  const avgOpex = Math.round(totalOpex / monthDiv)
  const avgDebt = Math.round(totalDebt / monthDiv)
  const estReserve = Math.max(0, Math.round((avgRev - avgOpex - avgDebt) * 6 + avgOpex * 1.5))

  return {
    monthsDetected: monthDiv,
    rowCount: parsedRows,
    avgMonthlyRevenue: avgRev,
    avgMonthlyOpex: avgOpex,
    avgMonthlyDebt: avgDebt,
    estimatedCashReserve: estReserve,
  }
}

export function buildFinancialDossierHtml(params: {
  lang: Lang
  provinceName: string
  provinceData: ProvinceOutlookItem | null
  businessLabel: string
  statusLabel: string
  diag: FinancialDiagnostic
  comparison: LoanComparisonResult | null
  matchedPrograms: { title: string; benefit: string; criteria: string; source: string }[]
  checklist: string[]
}): string {
  const { lang, provinceName, provinceData, businessLabel, statusLabel, diag, comparison, matchedPrograms, checklist } = params
  const today = new Date().toLocaleDateString(lang === "th" ? "th-TH" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  const fmt = (n: number) => `${Math.round(n).toLocaleString()} ${lang === "th" ? "บาท" : "THB"}`

  const rowsHtml = (comparison?.points ?? [])
    .map(
      (pt) => `
      <tr>
        <td>${pt.yearLabel}</td>
        <td style="text-align:right">${Math.round(pt.originalBalance).toLocaleString()}</td>
        <td style="text-align:right;font-weight:600;color:#0f766e">${Math.round(pt.policyBalance).toLocaleString()}</td>
        <td style="text-align:right">${Math.round(pt.originalPayment).toLocaleString()}</td>
        <td style="text-align:right;font-weight:600">${Math.round(pt.policyPayment).toLocaleString()}</td>
      </tr>`,
    )
    .join("")

  const progHtml = matchedPrograms
    .map(
      (p) => `
      <div class="prog-card">
        <div class="prog-title">${p.title}</div>
        <div class="prog-body">${p.benefit}</div>
        <div class="prog-meta">${p.criteria} | ${p.source}</div>
      </div>`,
    )
    .join("")

  const checkHtml = checklist.map((c) => `<li>${c}</li>`).join("")

  const tierLine = provinceData?.vulnerability_tier
    ? lang === "th"
      ? `${provinceData.tier_label_th} (คะแนน ${provinceData.vulnerability_score}/100)${provinceData.has_active_water_pollution ? " | มีการเฝ้าระวังสารพิษทางน้ำในพื้นที่" : ""}`
      : `${provinceData.tier_label_en} (Score ${provinceData.vulnerability_score}/100)`
    : ""

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<title>${lang === "th" ? "ใบสรุปความพร้อมทางการเงิน 1 หน้า" : "One Page Financial Readiness Dossier"}</title>
<style>
  @page { size: A4 portrait; margin: 13mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Segoe UI', Tahoma, sans-serif;
    color: #111827;
    margin: 0;
    padding: 8px;
    font-size: 11px;
    line-height: 1.45;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #111827;
    padding-bottom: 8px;
    margin-bottom: 12px;
  }
  .brand { font-size: 10px; color: #4B5563; }
  h1 { margin: 2px 0 0; font-size: 16.5px; font-weight: 700; color: #111827; }
  .meta-right { text-align: right; font-size: 10px; color: #4B5563; }
  .context-bar {
    border-left: 3px solid #111827;
    background: #F9FAFB;
    padding: 8px 12px;
    margin-bottom: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-size: 10.5px;
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 10px;
  }
  .kpi {
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 7px 9px;
  }
  .kpi-label { font-size: 9px; color: #64748b; }
  .kpi-val { font-size: 14px; font-weight: 700; margin-top: 2px; }
  .kpi-sub { font-size: 8.5px; color: #475569; margin-top: 2px; }
  h2 {
    font-size: 11.5px;
    font-weight: 700;
    margin: 10px 0 5px;
    padding-bottom: 3px;
    border-bottom: 1px solid #e2e8f0;
  }
  .stress-box {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    background: #fffbeb;
    border: 1px solid #fcd34d;
    border-radius: 6px;
    padding: 7px 10px;
    margin-bottom: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.8px;
    margin-top: 4px;
  }
  th, td {
    border-bottom: 1px solid #e2e8f0;
    padding: 4.5px 6px;
    text-align: left;
  }
  th { background: #f1f5f9; font-weight: 600; color: #334155; }
  .prog-card {
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 6px 9px;
    margin-bottom: 5px;
  }
  .prog-title { font-weight: 700; font-size: 10.5px; }
  .prog-body { color: #334155; margin-top: 2px; }
  .prog-meta { color: #64748b; font-size: 8.8px; margin-top: 2px; }
  .two-col {
    display: grid;
    grid-template-columns: 1.25fr 1fr;
    gap: 10px;
    margin-top: 6px;
  }
  ul { margin: 4px 0 0 15px; padding: 0; }
  li { margin-bottom: 2.5px; }
  .footer {
    margin-top: 10px;
    padding-top: 6px;
    border-top: 1px solid #cbd5e1;
    font-size: 8.5px;
    color: #64748b;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${lang === "th" ? "ระบบวิเคราะห์ความเสี่ยงเศรษฐกิจภาคเหนือ · เอกสารประกอบการเจรจาสินเชื่อ" : "NorthRisk Analytics · Financial Readiness Dossier"}</div>
      <h1>${lang === "th" ? "ใบสรุปความพร้อมทางการเงินและแผนปรับโครงสร้างหนี้ (1 หน้า)" : "One Page SME & Household Financial Readiness Dossier"}</h1>
    </div>
    <div class="meta-right">
      <div>${lang === "th" ? "วันที่จัดทำ:" : "Prepared:"} ${today}</div>
      <div>${lang === "th" ? "พื้นที่:" : "Province:"} ${provinceName}</div>
    </div>
  </div>

  <div class="context-bar">
    <div><strong>${lang === "th" ? "ประเภท:" : "Profile:"}</strong> ${businessLabel}</div>
    <div><strong>${lang === "th" ? "สถานะหนี้:" : "Status:"}</strong> ${statusLabel}</div>
    ${tierLine ? `<div><strong>${lang === "th" ? "บริบทพื้นที่:" : "Regional Context:"}</strong> ${tierLine}</div>` : ""}
  </div>

  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">${diag.isSme ? (lang === "th" ? "กำไรต่อค่างวดหนี้ (เกณฑ์ปลอดภัย > 1.25 เท่า)" : "DSCR (Safe > 1.25x)") : (lang === "th" ? "สัดส่วนค่างวดหนี้ต่อรายได้" : "Debt Service Ratio")}</div>
      <div class="kpi-val">${diag.isSme ? `${diag.dscr != null ? `${diag.dscr.toFixed(2)} เท่า` : "—"}` : `${diag.dsrPct.toFixed(1)}%`}</div>
      <div class="kpi-sub">${diag.isSme ? `${lang === "th" ? "หนี้ต่อรายได้" : "DSR"} ${diag.dsrPct.toFixed(1)}% | ${lang === "th" ? "กำไรก่อนหนี้" : "Operating CF"} ${fmt(diag.operatingCashflow)}` : (diag.dsrPct < 40 ? "อยู่ในเกณฑ์ปลอดภัย" : "ควรปรับลดค่างวด")}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">${lang === "th" ? "ระยะเวลาเงินสำรองอยู่รอดได้" : "Liquidity Runway"}</div>
      <div class="kpi-val">${diag.runwayTotalMonths != null ? `${diag.runwayTotalMonths.toFixed(1)} ${lang === "th" ? "เดือน" : "mos"}` : "—"}</div>
      <div class="kpi-sub">${lang === "th" ? `เงินสำรอง ${fmt(diag.cashReserve)}${diag.runwayOpexMonths != null ? ` (เฉพาะรายจ่ายคงที่ ${diag.runwayOpexMonths} ด.)` : ""}` : `Reserve ${fmt(diag.cashReserve)}`}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">${lang === "th" ? "กระแสเงินสดรายเดือนปัจจุบัน" : "Monthly Cashflow"}</div>
      <div class="kpi-val" style="color:${diag.netMonthlyCashflow < 0 ? "#b91c1c" : "#0f766e"}">${diag.netMonthlyCashflow >= 0 ? "+" : ""}${fmt(diag.netMonthlyCashflow)}</div>
      <div class="kpi-sub">${lang === "th" ? `รายได้ ${fmt(diag.monthlyRevenue)} | หนี้ ${fmt(diag.monthlyDebt)}` : `Rev ${fmt(diag.monthlyRevenue)} | Debt ${fmt(diag.monthlyDebt)}`}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">${lang === "th" ? "ค่างวดใหม่ที่เสนอ (ปีที่ 1)" : "Proposed Year 1 Payment"}</div>
      <div class="kpi-val" style="color:#0f766e">${comparison ? fmt(comparison.policyYear1Payment) : fmt(diag.monthlyDebt)}</div>
      <div class="kpi-sub">${comparison && comparison.monthlyLiquiditySaved > 0 ? (lang === "th" ? `เพิ่มสภาพคล่อง +${fmt(comparison.monthlyLiquiditySaved)}/เดือน` : `Saves +${fmt(comparison.monthlyLiquiditySaved)}/mo`) : (lang === "th" ? "อิงแผนปรับโครงสร้างด้านล่าง" : "Based on plan below")}</div>
    </div>
  </div>

  <h2>${lang === "th" ? `1. ผลจำลองกรณีรายได้หดตัว (หากรายได้ลดลง -${diag.stressDropPct || 30}% ในช่วงผู้เข้าพักน้อยหรือเกิดภัยพิบัติ)` : `1. Revenue Shock Stress Test (-${diag.stressDropPct || 30}% Revenue Drop)`}</h2>
  <div class="stress-box">
    <div><strong>${lang === "th" ? "รายได้ภายใต้สถานการณ์วิกฤต:" : "Stressed Revenue:"}</strong><br/>${fmt(diag.stressedRevenue)} / ${lang === "th" ? "เดือน" : "mo"}</div>
    <div><strong>${diag.isSme ? (lang === "th" ? "กำไรต่อค่างวดหนี้ภายใต้วิกฤต:" : "Stressed DSCR:") : (lang === "th" ? "สัดส่วนหนี้ต่อรายได้ภายใต้วิกฤต:" : "Stressed DSR:")}</strong><br/><span style="color:${(diag.isSme ? (diag.stressedDscr ?? 0) < 1 : diag.stressedDsrPct >= 60) ? "#b91c1c" : "#0f172a"};font-weight:700">${diag.isSme ? `${diag.stressedDscr?.toFixed(2) ?? "—"} เท่า` : `${diag.stressedDsrPct.toFixed(1)}%`}</span></div>
    <div><strong>${lang === "th" ? "ส่วนต่างกระแสเงินสด/เดือน:" : "Stressed Net Cashflow:"}</strong><br/><span style="color:${diag.stressedNetMonthlyCashflow < 0 ? "#b91c1c" : "#0f766e"};font-weight:700">${diag.stressedNetMonthlyCashflow >= 0 ? "+" : ""}${fmt(diag.stressedNetMonthlyCashflow)}</span></div>
  </div>

  ${
    comparison
      ? `
  <h2>${lang === "th" ? `2. ตารางเปรียบเทียบค่างวดและยอดหนี้: สัญญาเดิม เทียบกับ ${comparison.policyTitleTh}` : `2. Loan Comparison: Original vs ${comparison.policyTitleEn}`}</h2>
  <div style="font-size:9.3px;color:#475569;margin-bottom:3px">${lang === "th" ? comparison.ruleCaptionTh : comparison.ruleCaptionEn} (${lang === "th" ? `เงินต้นตั้งต้น ${fmt(comparison.principalUsed)} · ดอกเบี้ยประหยัดรวมประมาณ ${fmt(comparison.totalInterestSaved)}` : `Principal ${fmt(comparison.principalUsed)} · Est. Interest Saved ${fmt(comparison.totalInterestSaved)}`})</div>
  <table>
    <thead>
      <tr>
        <th>${lang === "th" ? "ช่วงเวลา" : "Year"}</th>
        <th style="text-align:right">${lang === "th" ? "ยอดหนี้สัญญาเดิม (บาท)" : "Original Balance"}</th>
        <th style="text-align:right">${lang === "th" ? "ยอดหนี้หลังปรับโครงสร้าง (บาท)" : "Restructured Balance"}</th>
        <th style="text-align:right">${lang === "th" ? "ค่างวดเดิม/เดือน" : "Original/mo"}</th>
        <th style="text-align:right">${lang === "th" ? "ค่างวดใหม่/เดือน" : "Proposed/mo"}</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>`
      : ""
  }

  <div class="two-col">
    <div>
      <h2>${lang === "th" ? "3. มาตรการทางการที่เข้าเกณฑ์เบื้องต้น" : "3. Matched Official Programs"}</h2>
      ${progHtml}
    </div>
    <div>
      <h2>${lang === "th" ? "4. เอกสารประกอบการยื่นเจรจา" : "4. Lender Preparation Checklist"}</h2>
      <ul>${checkHtml}</ul>
      <div style="margin-top:8px;padding:6px 8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:9px">
        <strong>${lang === "th" ? "ช่องทางติดต่อทางการ:" : "Official Hotlines:"}</strong><br/>
        • ศูนย์คุ้มครองผู้ใช้บริการทางการเงิน: โทร 1213<br/>
        • คลินิกแก้หนี้ by SAM: โทร 1443<br/>
        • SME D Bank (มาตรการ 3 ลด): โทร 1357<br/>
        • บสย. ค้ำประกันสินเชื่อ (PGS 11): โทร 02-890-9999
      </div>
    </div>
  </div>

  <div class="footer">
    <div>${lang === "th" ? "เอกสารนี้จัดทำขึ้นเพื่อประกอบการวางแผนและเจรจาเบื้องต้น ไม่ใช่การอนุมัติสินเชื่ออย่างเป็นทางการ และไม่มีการเก็บข้อมูลส่วนบุคคลในระบบ" : "Preliminary planning dossier generated locally. No personal financial identifiers are stored."}</div>
    <div>NorthRisk Analytics</div>
  </div>
</body>
</html>`
}
