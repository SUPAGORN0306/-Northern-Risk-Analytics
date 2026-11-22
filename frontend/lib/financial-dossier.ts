import type { Lang } from "@/lib/api"

export type DebtStatusKey = "current" | "persistent" | "overdue_31_120" | "overdue_120_plus" | "disaster"

export type FinancialDiagnostic = {
  isSme: boolean
  monthlyRevenue: number
  monthlyOpex: number
  monthlyDebt: number
  cashReserve: number
  operatingCashflow: number
  netMonthlyCashflow: number
  dsrPct: number | null
  dsrZeroIncomeCritical: boolean
  dscr: number | null
  dscrStatus: "safe" | "tight" | "critical" | "na"
  runwayOpexMonths: number | null
  runwayTotalMonths: number | null
  stressDropPct: number
  stressedRevenue: number
  stressedOperatingCashflow: number
  stressedDscr: number | null
  stressedDsrPct: number | null
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
  usesEstimatedPrincipal: boolean
  originalRatePct: number
  usesAssumedRate: boolean
  policyRateLabel: string
  originalMonthlyPayment: number
  policyYear1Payment: number
  policyYear2Payment: number
  policyYear3Payment: number
  monthlyLiquiditySaved: number
  year2BalanceReductionExtra: number
  totalInterestSaved: number
  grossWaivedInterest?: number
  policyGracePayment?: number
  graceMonths?: number
  payoffMonthOrig?: number | null
  payoffMonthPol?: number | null
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
  const opex = Math.max(0, monthlyOpex)
  const rev = Math.max(0, monthlyRevenue)
  const debt = Math.max(0, monthlyDebt)
  const reserve = Math.max(0, cashReserve)

  const operatingCashflow = rev - opex
  const netMonthlyCashflow = operatingCashflow - debt
  const dsrZeroIncomeCritical = rev === 0 && debt > 0
  const dsrPct = rev > 0 ? Number(((debt / rev) * 100).toFixed(1)) : debt > 0 ? null : 0
  const dscr = debt > 0 ? Number((operatingCashflow / debt).toFixed(2)) : null

  let dscrStatus: "safe" | "tight" | "critical" | "na" = "na"
  if (dscr != null) {
    if (dscr >= 1.25) dscrStatus = "safe"
    else if (dscr >= 1.0) dscrStatus = "tight"
    else dscrStatus = "critical"
  }

  const runwayOpexMonths = opex > 0 ? Number((reserve / opex).toFixed(1)) : null
  const totalFixedBurn = opex + debt
  const runwayTotalMonths = totalFixedBurn > 0 ? Number((reserve / totalFixedBurn).toFixed(1)) : null

  const stressedRevenue = Math.round(rev * (1 - stressDropPct / 100))
  const stressedOperatingCashflow = stressedRevenue - opex
  const stressedDscr = debt > 0 ? Number((stressedOperatingCashflow / debt).toFixed(2)) : null
  const stressedDsrPct =
    stressedRevenue > 0 ? Number(((debt / stressedRevenue) * 100).toFixed(1)) : debt > 0 ? null : 0
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
    dsrZeroIncomeCritical,
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
  customAnnualRatePct?: number
  borrowerAge: number
  clinicMonths: number
  deferMonths: number
  customHorizonYears?: number
  lang: Lang
}): LoanComparisonResult | null {
  const {
    status,
    isSme,
    monthlyRevenue,
    monthlyDebt,
    totalPrincipalInput,
    customAnnualRatePct,
    borrowerAge,
    clinicMonths,
    deferMonths,
    customHorizonYears,
    lang,
  } = params
  if (monthlyDebt <= 0 && totalPrincipalInput <= 0) return null

  const hasCustomRate = typeof customAnnualRatePct === "number" && Number.isFinite(customAnnualRatePct) && customAnnualRatePct > 0
  const defaultRatePct =
    status === "overdue_120_plus" ? 18.0
    : status === "overdue_31_120" ? 8.0
    : status === "persistent" ? 25.0
    : status === "disaster" ? 8.5
    : isSme ? 9.5
    : 10.5

  const resolvedBaseRate = hasCustomRate ? Math.min(36.0, Math.max(0.5, customAnnualRatePct)) : defaultRatePct
  const rEst = resolvedBaseRate / 100 / 12
  const estMonths = 48
  const estimatedPrincipal =
    rEst > 0
      ? Math.round(monthlyDebt * ((1 - Math.pow(1 + rEst, -estMonths)) / rEst))
      : Math.round(monthlyDebt * estMonths)

  const usesEstimatedPrincipal = !(totalPrincipalInput > 0)
  const principal = totalPrincipalInput > 0 ? totalPrincipalInput : estimatedPrincipal
  if (principal <= 0) return null

  const userMonths =
    customHorizonYears && customHorizonYears > 0
      ? Math.max(12, Math.min(360, Math.round(customHorizonYears * 12)))
      : 60

  let mode: LoanComparisonResult["mode"] = "responsible_lending"
  let horizonMonths = userMonths
  const origRate = resolvedBaseRate
  let policyRateLabel = ""
  let policyTitleTh = ""
  let policyTitleEn = ""
  let ruleCaptionTh = ""
  let ruleCaptionEn = ""

  const rateSrcTh = hasCustomRate
    ? `ตามอัตราดอกเบี้ยที่คุณกรอก ${origRate.toFixed(1)}% ต่อปี`
    : `ภายใต้สมมติฐานดอกเบี้ยสัญญาเดิม ${origRate.toFixed(1)}% ต่อปี (ยังไม่ได้กรอกดอกเบี้ยจริง)`
  const rateSrcEn = hasCustomRate
    ? `using your entered ${origRate.toFixed(1)}% p.a. rate`
    : `under an assumed ${origRate.toFixed(1)}% p.a. baseline rate (actual contract rate not entered)`

  if (status === "overdue_120_plus") {
    mode = "debt_clinic"
    horizonMonths = Math.max(12, Math.min(120, clinicMonths))
    const clinicRate = horizonMonths <= 48 ? 3 : horizonMonths <= 84 ? 4 : 5
    policyRateLabel = `${clinicRate}%`
    policyTitleTh = `ตัวอย่างแผนคลินิกแก้หนี้ (ดอกเบี้ย ${clinicRate}% · ผ่อน ${horizonMonths} งวด)`
    policyTitleEn = `Illustrative Debt Clinic Schedule (${clinicRate}% p.a. · ${horizonMonths} mos)`
    ruleCaptionTh = `ประมาณการเปรียบเทียบ ${rateSrcTh} กับเกณฑ์คลินิกแก้หนี้ 3 ถึง 5% ต่อปี (ต้องตรวจสอบคุณสมบัติจริงกับ SAM)`
    ruleCaptionEn = `Illustrative comparison ${rateSrcEn} against Debt Clinic 3 to 5% p.a. schedule (actual eligibility verified by SAM).`
  } else if (status === "overdue_31_120") {
    mode = "khunsoo"
    horizonMonths = userMonths
    policyRateLabel = lang === "th" ? "ตัวอย่างขั้นบันได 3 ปี" : "Illustrative 3yr Step-Up"
    policyTitleTh = "ตัวอย่างสถานการณ์ปรับค่างวดขั้นบันไดเพื่อเจรจากับเจ้าหนี้ (จ่าย 50% / 70% / 90%)"
    policyTitleEn = "Illustrative Stepped Restructuring Scenario for Lender Negotiation (50% / 70% / 90%)"
    ruleCaptionTh = `เป็นตัวอย่างแนวทางเจรจาลดค่างวดขั้นบันได (${rateSrcTh}) ไม่ใช่เงื่อนไขโครงการที่ธนาคารต้องอนุมัติอัตโนมัติ ทั้งนี้โครงการคุณสู้ เราช่วย ปิดรับสมัครใหม่แล้วเมื่อ 30 ก.ย. 2568`
    ruleCaptionEn = `Illustrative 3 year negotiation scenario (${rateSrcEn}), not an automatic bank commitment. Khun Soo Rao Chuay closed new registration on 30 Sep 2025.`
  } else if (status === "persistent") {
    mode = "persistent_5y"
    const pdMonths = Math.min(84, userMonths)
    horizonMonths = pdMonths
    policyRateLabel = lang === "th" ? "ดอกเบี้ยไม่เกิน 15% (สูงสุด 7 ปี)" : "Max 15% (Up to 7 yrs)"
    policyTitleTh = `ตัวอย่างแผนปิดจบหนี้เรื้อรังภายในสูงสุด ${Math.round(pdMonths / 12)} ปี (เกณฑ์ปรับปรุง 1 ม.ค. 2568 · ดอกเบี้ยไม่เกิน 15%)`
    policyTitleEn = `Illustrative Persistent Debt Exit up to ${Math.round(pdMonths / 12)} Years (2025 Rule · Max 15% p.a.)`
    ruleCaptionTh = `ประมาณการเปรียบเทียบ ${rateSrcTh} กับสินเชื่อผ่อนงวดดอกเบี้ยไม่เกิน 15% ปิดจบภายใน ${Math.round(pdMonths / 12)} ปี (เฉพาะสินเชื่อหมุนเวียน Non-NPL ที่เข้าเกณฑ์รายได้ ธปท.)`
    ruleCaptionEn = `Illustrative comparison ${rateSrcEn} against ${pdMonths} month payoff capped at 15% p.a. (revolving Non-NPL borrowers meeting BOT income criteria).`
  } else if (status === "disaster") {
    mode = "disaster_defer"
    horizonMonths = userMonths
    policyRateLabel = lang === "th" ? `พักเงินต้น ${deferMonths} เดือน` : `${deferMonths}m Deferral`
    policyTitleTh = `ตัวอย่างแผนพักชำระเงินต้นผู้ประสบภัย (${deferMonths} เดือน · อ้างอิง ธปท.ว. 2302/2568)`
    policyTitleEn = `Illustrative Disaster Principal Deferral (${deferMonths}m · Ref. Circular 2302/2568)`
    ruleCaptionTh = `ประมาณการพักชำระเงินต้น ${deferMonths} เดือนแรก (${rateSrcTh}) เงื่อนไขจริงขึ้นอยู่กับการพิจารณาของเจ้าหนี้`
    ruleCaptionEn = `Illustrative ${deferMonths} month interest only relief (${rateSrcEn}); final terms subject to lender approval.`
  } else if (isSme) {
    mode = "sme_3reduce"
    horizonMonths = userMonths
    policyRateLabel = lang === "th" ? "หักเงินต้น 100% (2 ปีแรก)" : "100% Principal Cut (2 yrs)"
    policyTitleTh = "ตัวอย่างแผนหักเงินต้นก่อนสำหรับผู้ประกอบการ SME (อ้างอิงรูปแบบ 3 ลด)"
    policyTitleEn = "Illustrative SME Principal First Scenario (Ref. 3 Reduce Model)"
    ruleCaptionTh = `ประมาณการลดค่างวด 15% และนำค่างวด 24 เดือนแรกหักเงินต้นก่อน (${rateSrcTh}) โปรดตรวจสอบเงื่อนไขจริงกับธนาคารเจ้าของบัญชี`
    ruleCaptionEn = `Illustrative 24 month principal first schedule (${rateSrcEn}); verify actual terms with your lender.`
  } else {
    mode = "responsible_lending"
    horizonMonths = userMonths
    policyRateLabel = lang === "th" ? "ตัวอย่างลดดอกเบี้ย 2%" : "Illustrative -2% Rate"
    policyTitleTh = "ตัวอย่างสถานการณ์ปรับโครงสร้างหนี้เชิงป้องกันก่อนเป็นหนี้เสีย (Responsible Lending 2568)"
    policyTitleEn = "Illustrative Pre Emptive Restructuring Scenario (Responsible Lending 2568)"
    ruleCaptionTh = `ประมาณการปรับลดค่างวดและอัตราดอกเบี้ย (${rateSrcTh}) เพื่อใช้ประกอบการเจรจากับเจ้าหนี้ ไม่ใช่ข้อผูกพันอนุมัติ`
    ruleCaptionEn = `Illustrative payment and rate reduction (${rateSrcEn}) to support lender negotiation, not an approval guarantee.`
  }

  const origMonthlyPay = monthlyDebt > 0 ? monthlyDebt : Math.round(calcAnnuityPayment(principal, origRate, horizonMonths))
  const origR = origRate / 100 / 12
  const reducedRlRate = Math.max(3.0, Number((origRate - 2.0).toFixed(2)))
  const pdCapRate = Math.min(15.0, origRate)

  let policyY1Pay = origMonthlyPay
  let policyY2Pay = origMonthlyPay
  let policyY3Pay = origMonthlyPay
  let gracePay: number | undefined = undefined
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
    const pay = Math.round(calcAnnuityPayment(principal, pdCapRate, horizonMonths))
    policyY1Pay = pay
    policyY2Pay = pay
    policyY3Pay = pay
  } else if (mode === "disaster_defer") {
    const interestOnly = Math.round(principal * (origRate / 100 / 12))
    gracePay = interestOnly
    const clampedDefer = Math.min(12, Math.max(0, deferMonths))
    policyY1Pay = Math.round((interestOnly * clampedDefer + origMonthlyPay * (12 - clampedDefer)) / 12)
    policyY2Pay = origMonthlyPay
    policyY3Pay = origMonthlyPay
  } else if (mode === "sme_3reduce") {
    const easedPay = Math.round(origMonthlyPay * 0.85)
    policyY1Pay = easedPay
    policyY2Pay = easedPay
    policyY3Pay = easedPay
  } else {
    const safeTarget = monthlyRevenue > 0 ? Math.round(monthlyRevenue * 0.38) : Math.round(origMonthlyPay * 0.8)
    const pay = Math.min(origMonthlyPay, Math.max(Math.round(calcAnnuityPayment(principal, reducedRlRate, 72)), safeTarget))
    policyY1Pay = pay
    policyY2Pay = pay
    policyY3Pay = pay
  }

  // Month by month deterministic amortization simulation for both curves
  let balOrig = principal
  let balPol = principal
  let intOrigTotal = 0
  let intPolTotal = 0
  let grossWaivedInterest = 0
  let payoffMonthOrig: number | null = null
  let payoffMonthPol: number | null = null
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
  const khunsooRates = [0.5, 0.7, 0.9, 1.0, 1.0]

  let yrStartOrigBal = principal
  let yrStartPolBal = principal

  for (let m = 1; m <= horizonMonths; m++) {
    const yrIndex = Math.ceil(m / 12) - 1

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
      if (balOrig <= 0 && payoffMonthOrig === null) {
        payoffMonthOrig = m
      }
    }

    // Scheduled policy installment for this year
    let scheduledYearPolPay = policyY1Pay
    if (mode === "khunsoo") {
      const rate = khunsooRates[Math.min(yrIndex, 3)]
      scheduledYearPolPay = Math.round(origMonthlyPay * rate)
    } else if (mode === "disaster_defer") {
      scheduledYearPolPay = yrIndex === 0 ? policyY1Pay : origMonthlyPay
    } else if (mode === "sme_3reduce") {
      scheduledYearPolPay = yrIndex < 2 ? policyY1Pay : Math.round(origMonthlyPay * 0.85)
    } else {
      scheduledYearPolPay = policyY1Pay
    }

    // Policy restructured month step
    let currentPolPay = scheduledYearPolPay
    if (balPol > 0) {
      if (mode === "sme_3reduce") {
        if (m <= 24) {
          grossWaivedInterest += balPol * (origRate / 100 / 12)
          currentPolPay = policyY1Pay
          balPol = Math.max(0, balPol - currentPolPay)
        } else {
          const rAfter = 6.5 / 100 / 12
          const interestP = balPol * rAfter
          intPolTotal += interestP
          currentPolPay = scheduledYearPolPay
          balPol = Math.max(0, balPol - Math.max(0, currentPolPay - interestP))
        }
      } else if (mode === "khunsoo") {
        if (m <= 36) {
          grossWaivedInterest += balPol * origR
          currentPolPay = scheduledYearPolPay
          balPol = Math.max(0, balPol - currentPolPay)
        } else {
          const rResume = origRate / 100 / 12
          const interestP = balPol * rResume
          intPolTotal += interestP
          currentPolPay = scheduledYearPolPay
          balPol = Math.max(0, balPol - Math.max(0, currentPolPay - interestP))
        }
      } else if (mode === "debt_clinic") {
        const rClinic = clinicRatePct / 100 / 12
        const interestP = balPol * rClinic
        intPolTotal += interestP
        currentPolPay = policyY1Pay
        balPol = Math.max(0, balPol - Math.max(0, currentPolPay - interestP))
      } else if (mode === "persistent_5y") {
        const r15 = pdCapRate / 100 / 12
        const interestP = balPol * r15
        intPolTotal += interestP
        currentPolPay = policyY1Pay
        balPol = Math.max(0, balPol - Math.max(0, currentPolPay - interestP))
      } else if (mode === "disaster_defer") {
        if (m <= deferMonths) {
          const interestP = balPol * (origRate / 100 / 12)
          intPolTotal += interestP
          currentPolPay = gracePay ?? policyY1Pay
        } else {
          const rAfter = origRate / 100 / 12
          const interestP = balPol * rAfter
          intPolTotal += interestP
          currentPolPay = origMonthlyPay
          balPol = Math.max(0, balPol - Math.max(0, currentPolPay - interestP))
        }
      } else {
        const rRestr = reducedRlRate / 100 / 12
        const interestP = balPol * rRestr
        intPolTotal += interestP
        currentPolPay = policyY1Pay
        balPol = Math.max(0, balPol - Math.max(0, currentPolPay - interestP))
      }
      if (balPol <= 0 && payoffMonthPol === null) {
        payoffMonthPol = m
      }
    }

    if (m === 24) {
      y2OrigBal = balOrig
      y2PolBal = balPol
    }

    if (m % 12 === 0 || m === horizonMonths) {
      const yr = Math.ceil(m / 12)
      const curOrigPay = yrStartOrigBal > 0 ? Math.round(origMonthlyPay) : 0
      const curPolPay = yrStartPolBal > 0 ? Math.round(scheduledYearPolPay) : 0
      points.push({
        yearLabel: lang === "th" ? `ปีที่ ${yr}` : `Yr ${yr}`,
        yearNum: yr,
        originalBalance: Math.round(balOrig),
        policyBalance: Math.round(balPol),
        originalPayment: curOrigPay,
        policyPayment: curPolPay,
      })
      yrStartOrigBal = balOrig
      yrStartPolBal = balPol
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
    usesEstimatedPrincipal,
    originalRatePct: origRate,
    usesAssumedRate: !hasCustomRate,
    policyRateLabel,
    originalMonthlyPayment: Math.round(origMonthlyPay),
    policyYear1Payment: Math.round(policyY1Pay),
    policyYear2Payment: Math.round(policyY2Pay),
    policyYear3Payment: Math.round(policyY3Pay),
    monthlyLiquiditySaved: Math.round(origMonthlyPay - policyY1Pay),
    year2BalanceReductionExtra: Math.max(0, Math.round(y2OrigBal - y2PolBal)),
    totalInterestSaved: Math.max(0, Math.round(intOrigTotal - intPolTotal)),
    grossWaivedInterest: Math.round(grossWaivedInterest),
    policyGracePayment: gracePay,
    graceMonths: mode === "disaster_defer" ? deferMonths : undefined,  
    payoffMonthOrig,
    payoffMonthPol,
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
  businessLabel: string
  statusLabel: string
  diag: FinancialDiagnostic
  comparison: LoanComparisonResult | null
  matchedPrograms: { title: string; benefit: string; criteria: string; source: string }[]
  checklist: string[]
}): string {
  const { lang, provinceName, businessLabel, statusLabel, diag, comparison, matchedPrograms, checklist } = params
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

  const primaryProgram = matchedPrograms[0]

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<title>${lang === "th" ? "เอกสารสรุปข้อมูลทางการเงินและแผนการชำระหนี้" : "Financial Summary & Debt Restructuring Proposal"}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'IBM Plex Sans Thai', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #0f172a;
    background: #ffffff;
    margin: 0;
    padding: 8px;
    font-size: 11px;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1.5px solid #0f172a;
    padding-bottom: 10px;
    margin-bottom: 12px;
  }
  .brand { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; color: #64748b; text-transform: uppercase; }
  h1 { margin: 3px 0 0; font-size: 17px; font-weight: 700; color: #0f172a; letter-spacing: -0.01em; }
  .meta-right { text-align: right; font-size: 10px; color: #475569; line-height: 1.6; }
  .context-bar {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
    padding: 8px 12px;
    margin-bottom: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    font-size: 10.5px;
    color: #334155;
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 12px;
  }
  .kpi {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
    padding: 8px 10px;
  }
  .kpi-label { font-size: 9.5px; color: #64748b; font-weight: 500; }
  .kpi-val { font-size: 14px; font-weight: 700; margin-top: 3px; color: #0f172a; }
  .kpi-sub { font-size: 9px; color: #64748b; margin-top: 2px; }
  h2 {
    font-size: 11.5px;
    font-weight: 700;
    color: #0f172a;
    margin: 12px 0 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid #e2e8f0;
  }
  .stress-box {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 9px 12px;
    margin-bottom: 10px;
    font-size: 10.5px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
    margin-top: 4px;
  }
  th, td {
    border-bottom: 1px solid #e2e8f0;
    padding: 5px 7px;
    text-align: left;
  }
  th { background: #f8fafc; font-weight: 600; color: #334155; }
  .proposal-card {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
    padding: 9px 12px;
    margin-top: 4px;
    font-size: 10.5px;
  }
  .two-col {
    display: grid;
    grid-template-columns: 1.25fr 1fr;
    gap: 12px;
    margin-top: 6px;
  }
  ul { margin: 4px 0 0 16px; padding: 0; font-size: 10px; color: #334155; }
  li { margin-bottom: 3px; }
  .sign-row {
    margin-top: 18px;
    display: flex;
    justify-content: flex-end;
    font-size: 10px;
    color: #334155;
    text-align: center;
  }
  .footer {
    margin-top: 12px;
    padding-top: 6px;
    border-top: 1px solid #e2e8f0;
    font-size: 8.8px;
    color: #64748b;
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${lang === "th" ? "เอกสารประกอบคำขอปรับปรุงโครงสร้างหนี้และพิจารณาสินเชื่อ" : "Debt Restructuring & Credit Assessment Summary"}</div>
      <h1>${lang === "th" ? "เอกสารสรุปข้อมูลทางการเงินและแผนการชำระหนี้" : "Financial Summary & Proposed Repayment Schedule"}</h1>
    </div>
    <div class="meta-right">
      <div><strong>${lang === "th" ? "วันที่จัดทำ:" : "Date:"}</strong> ${today}</div>
      <div><strong>${lang === "th" ? "จังหวัด:" : "Province:"}</strong> ${provinceName}</div>
    </div>
  </div>

  <div class="context-bar">
    <div><strong>${lang === "th" ? "ประเภทผู้ยื่นคำขอ:" : "Applicant Profile:"}</strong> ${businessLabel}</div>
    <div><strong>${lang === "th" ? "สถานะการชำระหนี้ปัจจุบัน:" : "Current Status:"}</strong> ${statusLabel}</div>
  </div>

  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">${lang === "th" ? "รายได้ต่อเดือน" : "Monthly Income"}</div>
      <div class="kpi-val">${fmt(diag.monthlyRevenue)}</div>
      <div class="kpi-sub">${diag.isSme ? `${lang === "th" ? "กำไรก่อนหนี้" : "Operating CF"} ${fmt(diag.operatingCashflow)}` : `${lang === "th" ? "ค่าใช้จ่ายจำเป็น" : "Living Cost"} ${fmt(diag.monthlyOpex)}`}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">${lang === "th" ? "ค่างวดหนี้เดิม/เดือน" : "Current Debt Service"}</div>
      <div class="kpi-val">${fmt(diag.monthlyDebt)}</div>
      <div class="kpi-sub">${diag.dsrPct != null ? (lang === "th" ? `สัดส่วนค่างวดต่อรายได้รวม (Gross DSR) ${diag.dsrPct.toFixed(1)}%` : `Gross-Income DSR ${diag.dsrPct.toFixed(1)}%`) : (lang === "th" ? "สัดส่วนค่างวดต่อรายได้รวม คำนวณไม่ได้ (รายได้เป็น 0 · วิกฤต)" : "Gross-Income DSR Undefined (Zero Income · Critical)")}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">${lang === "th" ? "สถานะเงินเหลือหลังหักค่างวด" : "Net Monthly Cash Status"}</div>
      <div class="kpi-val" style="color:${diag.netMonthlyCashflow < 0 ? "#b91c1c" : "#0f766e"}">${diag.netMonthlyCashflow >= 0 ? (lang === "th" ? `เงินเหลือพอจ่าย (+${Math.round(diag.netMonthlyCashflow).toLocaleString()} บาท/เดือน)` : `Surplus (+${fmt(diag.netMonthlyCashflow)}/mo)`) : (lang === "th" ? `เงินเหลือไม่พอจ่าย (ขาดอีก ${Math.abs(Math.round(diag.netMonthlyCashflow)).toLocaleString()} บาท/เดือน)` : `Shortfall (-${fmt(Math.abs(diag.netMonthlyCashflow))}/mo)`)}</div>
      <div class="kpi-sub">${diag.runwayTotalMonths != null ? (lang === "th" ? `หากไม่มีรายรับเข้ามาเลย (0 บาท) เงินเก็บช่วยจ่ายได้ ${diag.runwayTotalMonths.toFixed(1)} เดือน` : `Zero income runway ${diag.runwayTotalMonths.toFixed(1)} mos`) : ""}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">${lang === "th" ? "ค่างวดใหม่ที่เสนอ (ปีที่ 1)" : "Proposed Year 1 Payment"}</div>
      <div class="kpi-val" style="color:#0f766e">${comparison ? fmt(comparison.policyYear1Payment) : fmt(diag.monthlyDebt)}</div>
      <div class="kpi-sub">${comparison && comparison.monthlyLiquiditySaved > 0 ? (lang === "th" ? `ลดภาระลง ${fmt(comparison.monthlyLiquiditySaved)}/เดือน` : `Reduced by ${fmt(comparison.monthlyLiquiditySaved)}/mo`) : (lang === "th" ? "อิงตามแผนการชำระหนี้" : "Per proposed schedule")}</div>
    </div>
  </div>

  <h2>${lang === "th" ? `1. การวิเคราะห์ความสามารถในการชำระหนี้กรณีรายได้ลดลง (-${diag.stressDropPct || 30}%)` : `1. Sensitivity Analysis (-${diag.stressDropPct || 30}% Income Scenario)`}</h2>
  <div class="stress-box">
    <div><strong>${lang === "th" ? "รายได้ภายใต้สถานการณ์รายได้ลด:" : "Stressed Income:"}</strong><br/>${fmt(diag.stressedRevenue)} / ${lang === "th" ? "เดือน" : "mo"}</div>
    <div><strong>${lang === "th" ? "สถานะการชำระหนี้เมื่อรายได้ลด:" : "Stressed Payment Status:"}</strong><br/><span style="color:${diag.stressedNetMonthlyCashflow < 0 ? "#b91c1c" : "#0f766e"};font-weight:700">${diag.stressedNetMonthlyCashflow >= 0 ? (lang === "th" ? `เงินเหลือพอจ่าย (+${Math.round(diag.stressedNetMonthlyCashflow).toLocaleString()} บาท/เดือน)` : `Surplus (+${fmt(diag.stressedNetMonthlyCashflow)}/mo)`) : (lang === "th" ? `เงินเหลือไม่พอจ่าย (ขาดอีก ${Math.abs(Math.round(diag.stressedNetMonthlyCashflow)).toLocaleString()} บาท/เดือน)` : `Shortfall (-${fmt(Math.abs(diag.stressedNetMonthlyCashflow))}/mo)`)}</span></div>
    <div><strong>${lang === "th" ? "เงินเก็บสำรองช่วยโปะส่วนที่ขาดได้:" : "Reserve Buffer:"}</strong><br/><span style="color:${diag.stressedNetMonthlyCashflow < 0 ? "#b91c1c" : "#0f766e"};font-weight:700">${diag.stressedNetMonthlyCashflow < 0 && diag.stressedRunwayMonths != null ? (lang === "th" ? `รองรับได้ ${diag.stressedRunwayMonths} เดือน` : `${diag.stressedRunwayMonths} mos`) : (lang === "th" ? "ไม่ต้องดึงเงินเก็บมาใช้" : "No reserve draw needed")}</span></div>
  </div>

  ${
    comparison
      ? `
  <h2>${lang === "th" ? `2. ตารางเปรียบเทียบค่างวดและยอดหนี้คงเหลือ (${comparison.policyTitleTh})` : `2. Proposed Repayment Schedule (${comparison.policyTitleEn})`}</h2>
  <div style="font-size:9.5px;color:#475569;margin-bottom:4px">${lang === "th" ? comparison.ruleCaptionTh : comparison.ruleCaptionEn} (${lang === "th" ? `ยอดหนี้ตั้งต้น ${fmt(comparison.principalUsed)}${comparison.usesEstimatedPrincipal ? " (ประมาณการ)" : ""} · ประมาณการส่วนต่างดอกเบี้ย ${fmt(comparison.totalInterestSaved)}${comparison.usesAssumedRate ? ` (สมมติฐานดอกเบี้ยเดิม ${comparison.originalRatePct.toFixed(1)}%/ปี)` : ` (ดอกเบี้ยที่กรอก ${comparison.originalRatePct.toFixed(1)}%/ปี)`}${comparison.grossWaivedInterest ? ` · มูลค่าดอกเบี้ยยกเว้นตามตัวอย่าง ${fmt(comparison.grossWaivedInterest)}` : ""}${comparison.payoffMonthPol ? ` · คาดปิดจบใน ${Math.ceil(comparison.payoffMonthPol / 12)} ปี` : ""}` : `Principal ${fmt(comparison.principalUsed)}${comparison.usesEstimatedPrincipal ? " (est.)" : ""} · Est. Interest Difference ${fmt(comparison.totalInterestSaved)} (${comparison.usesAssumedRate ? "assumed" : "entered"} ${comparison.originalRatePct.toFixed(1)}% p.a.)`})</div>
  <table>
    <thead>
      <tr>
        <th>${lang === "th" ? "งวด/ปีที่" : "Period"}</th>
        <th style="text-align:right">${lang === "th" ? "ยอดหนี้เดิมคงเหลือ (บาท)" : "Original Balance"}</th>
        <th style="text-align:right">${lang === "th" ? "ยอดหนี้ตามแผนใหม่ (บาท)" : "Proposed Balance"}</th>
        <th style="text-align:right">${lang === "th" ? "ค่างวดเดิม/เดือน" : "Original/mo"}</th>
        <th style="text-align:right">${lang === "th" ? "ค่างวดใหม่ที่เสนอ/เดือน" : "Proposed/mo"}</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>`
      : ""
  }

  <div class="two-col">
    <div>
      <h2>${lang === "th" ? "3. ข้อเสนอขอปรับปรุงโครงสร้างหนี้" : "3. Restructuring Request"}</h2>
      <div class="proposal-card">
        <strong>${primaryProgram ? primaryProgram.title : (lang === "th" ? "ขอปรับปรุงเงื่อนไขการผ่อนชำระให้สอดคล้องกับรายได้จริง" : "Payment Restructuring Request")}</strong>
        <div style="margin-top:4px;color:#334155">
          ${primaryProgram ? primaryProgram.benefit : (lang === "th" ? "ขอความอนุเคราะห์ปรับลดค่างวดหรือขยายระยะเวลาผ่อนชำระเพื่อให้สามารถชำระหนี้ได้อย่างต่อเนื่อง" : "Request installment alignment with actual net cashflow.")}
        </div>
      </div>
    </div>
    <div>
      <h2>${lang === "th" ? "4. เอกสารประกอบการยื่นคำขอ (แนบมาพร้อมนี้)" : "4. Attached Supporting Documents"}</h2>
      <ul>${checklist.map((item) => `<li>${item}</li>`).join("")}</ul>
    </div>
  </div>

  <div class="sign-row">
    <div>
      <div>${lang === "th" ? "ลงชื่อ .................................................................... ผู้ยื่นคำขอ" : "Signed .................................................................... Applicant"}</div>
      <div style="margin-top:6px">${lang === "th" ? "วันที่ ............ / ............................ / ...................." : "Date ............ / ............................ / ...................."}</div>
    </div>
  </div>

  <div class="footer">
    ${lang === "th" ? "หมายเหตุ: เอกสารฉบับนี้จัดทำขึ้นเพื่อสรุปข้อมูลทางการเงินเบื้องต้นประกอบการพิจารณาของสถาบันการเงิน เงื่อนไขการอนุมัติเป็นไปตามหลักเกณฑ์ของธนาคาร" : "Note: Preliminary financial summary prepared for lender review. Final terms are subject to bank credit policy."}
  </div>
</body>
</html>`
}
