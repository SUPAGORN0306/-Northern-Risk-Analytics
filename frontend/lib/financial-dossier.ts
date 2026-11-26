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
  mode: "sme_scenario" | "responsible_lending" | "persistent_5y" | "step_up_illustration" | "debt_clinic" | "disaster_defer"
  policyTitleTh: string
  policyTitleEn: string
  ruleCaptionTh: string
  ruleCaptionEn: string
  principalUsed: number
  usesEstimatedPrincipal: boolean
  estimatedPrincipalMonths: number
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

export function formatRatePct(rate: number): string {
  const rounded2 = Math.round(rate * 100) / 100
  return Number.isInteger(rounded2 * 10) ? rounded2.toFixed(1) : rounded2.toFixed(2)
}

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

  const resolvedBaseRate = hasCustomRate ? Math.min(36.0, Math.max(0.01, Number(customAnnualRatePct.toFixed(2)))) : defaultRatePct
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
  const origRateLabel = formatRatePct(origRate)
  const pdCapRate = Math.min(15.0, origRate)
  const reducedRlRate = origRate > 3.0 ? Math.max(3.0, Number((origRate - 2.0).toFixed(2))) : origRate
  let policyRateLabel = ""
  let policyTitleTh = ""
  let policyTitleEn = ""
  let ruleCaptionTh = ""
  let ruleCaptionEn = ""

  const rateSrcTh = hasCustomRate
    ? `ตามอัตราดอกเบี้ยที่คุณกรอก ${origRateLabel}% ต่อปี`
    : `ภายใต้สมมติฐานดอกเบี้ยสัญญาเดิม ${origRateLabel}% ต่อปี (ยังไม่ได้กรอกดอกเบี้ยจริง)`
  const rateSrcEn = hasCustomRate
    ? `using your entered ${origRateLabel}% p.a. rate`
    : `under an assumed ${origRateLabel}% p.a. baseline rate (actual contract rate not entered)`

  if (status === "overdue_120_plus" && !isSme) {
    mode = "debt_clinic"
    horizonMonths = Math.max(12, Math.min(120, clinicMonths))
    const clinicRate = horizonMonths <= 48 ? 3 : horizonMonths <= 84 ? 4 : 5
    policyRateLabel = `${clinicRate}%`
    policyTitleTh = `ตัวอย่างแผนคลินิกแก้หนี้ (ดอกเบี้ย ${clinicRate}% · ผ่อน ${horizonMonths} งวด)`
    policyTitleEn = `Illustrative Debt Clinic Schedule (${clinicRate}% p.a. · ${horizonMonths} mos)`
    ruleCaptionTh = `ประมาณการเปรียบเทียบ ${rateSrcTh} กับเกณฑ์คลินิกแก้หนี้ 3 ถึง 5% ต่อปี (ต้องตรวจสอบคุณสมบัติจริงกับบริษัทบริหารสินทรัพย์สุขุมวิท)`
    ruleCaptionEn = `Illustrative comparison ${rateSrcEn} against Debt Clinic 3 to 5% p.a. schedule (actual eligibility verified by SAM).`
  } else if (status === "overdue_31_120") {
    mode = "step_up_illustration"
    horizonMonths = userMonths
    policyRateLabel = lang === "th" ? "ตัวอย่างขั้นบันได 3 ปี" : "Illustrative 3yr Step-Up"
    policyTitleTh = "ตัวอย่างสถานการณ์ปรับค่างวดขั้นบันไดเพื่อเจรจากับเจ้าหนี้ (จ่าย 50% / 70% / 90%)"
    policyTitleEn = "Illustrative Stepped Restructuring Scenario for Lender Negotiation (50% / 70% / 90%)"
    ruleCaptionTh = `เป็นเพียงตัวอย่างจำลองค่างวดขั้นบันได (${rateSrcTh}) เพื่อใช้คุยกับเจ้าหนี้ ไม่ใช่มาตรการหรือข้อเสนอที่เจ้าหนี้ต้องอนุมัติ เงื่อนไขจริงต้องตกลงกับเจ้าหนี้โดยตรง`
    ruleCaptionEn = `Illustrative stepped-payment simulation (${rateSrcEn}) for discussion with your lender; this is not a program or offer, and actual terms must be agreed with the lender.`
  } else if (status === "persistent" && !isSme) {
    mode = "persistent_5y"
    const pdMonths = Math.min(84, userMonths)
    horizonMonths = pdMonths
    policyRateLabel = lang === "th" ? `ตัวอย่าง ${pdCapRate}%/ปี (เพดานไม่เกิน 15% · สูงสุด 7 ปี)` : `Illustrative ${pdCapRate}% p.a. (15% cap · up to 7 yrs)`
    policyTitleTh = `ตัวอย่างแผนปิดจบหนี้เรื้อรังภายในสูงสุด ${Math.round(pdMonths / 12)} ปี (เกณฑ์ปรับปรุง 1 ม.ค. 2568 · ดอกเบี้ยไม่เกิน 15%)`
    policyTitleEn = `Illustrative Persistent Debt Exit up to ${Math.round(pdMonths / 12)} Years (2025 Rule · Max 15% p.a.)`
    ruleCaptionTh = `ตัวอย่างคำนวณที่ ${pdCapRate}% ต่อปี โดยอัตราจริงต้องไม่เกิน 15% และอาจต่ำกว่านี้ ผ่อน ${Math.round(pdMonths / 12)} ปี (สูงสุด 7 ปี) เฉพาะสินเชื่อบุคคลหมุนเวียนที่ยังไม่เป็นหนี้เสียและเข้าเกณฑ์รายได้ ไม่ใช่ข้อเสนออนุมัติจากเจ้าหนี้`
    ruleCaptionEn = `Illustration calculated at ${pdCapRate}% p.a.; the actual rate is capped at 15% and may be lower. ${Math.round(pdMonths / 12)}-year term (up to 7 years), only for eligible non-NPL personal revolving credit. Not a lender offer or approval.`
  } else if (status === "disaster") {
    mode = "disaster_defer"
    horizonMonths = userMonths
    policyRateLabel = lang === "th" ? `พักเงินต้น ${deferMonths} เดือน` : `${deferMonths}m Deferral`
    policyTitleTh = `ตัวอย่างจำลองพักเงินต้น ${deferMonths} เดือนเมื่อรายได้สะดุด`
    policyTitleEn = `Illustrative Principal Deferral During an Income Shock (${deferMonths} months)`
    ruleCaptionTh = `สมมติพักเงินต้น ${deferMonths} เดือนแรกและชำระดอกเบี้ยตามอัตราที่ระบุ (${rateSrcTh}) เพื่อเทียบตัวเลขเท่านั้น ไม่ใช่มาตรการหรือข้อเสนอจากเจ้าหนี้`
    ruleCaptionEn = `Comparison scenario assuming principal deferral for ${deferMonths} months with interest paid at the entered rate (${rateSrcEn}); this is not a program or lender offer.`
  } else if (isSme && status === "current") {
    mode = "sme_scenario"
    horizonMonths = userMonths
    policyRateLabel = lang === "th" ? "ไม่คิดดอกเบี้ย 24 เดือนแรก · หลังจากนั้น 6.5%/ปี" : "No interest first 24 months · 6.5% p.a. after"
    policyTitleTh = "ตัวอย่างจำลองลดค่างวดและไม่คิดดอกเบี้ยช่วงแรกสำหรับกิจการ"
    policyTitleEn = "Illustrative SME Payment Reduction and Initial Interest Waiver"
    ruleCaptionTh = `ตัวอย่างนี้สมมติลดค่างวด 15% ไม่คิดดอกเบี้ยใน 24 เดือนแรก (ไม่ได้ทบไปคิดย้อนหลัง) และคิด 6.5% ต่อปีตั้งแต่เดือนที่ 25 โดยใช้อัตราเดิม ${origRateLabel}% เป็นฐานเปรียบเทียบ ตัวเลขนี้ไม่ใช่มาตรการหรือข้อเสนอจากเจ้าหนี้`
    ruleCaptionEn = `This illustration assumes 15% lower payments, no interest charged in the first 24 months (not deferred for later collection), then 6.5% p.a. from month 25. The ${origRateLabel}% assumed/entered rate is the comparison baseline. These are not lender terms or an offer.`
  } else {
    mode = "responsible_lending"
    horizonMonths = userMonths
    const rateCutPct = Number((origRate - reducedRlRate).toFixed(2))
    policyRateLabel =
      rateCutPct > 0
        ? lang === "th"
          ? `ตัวอย่างลดดอกเบี้ย ${formatRatePct(rateCutPct)}%`
          : `Illustrative -${formatRatePct(rateCutPct)}% Rate`
        : lang === "th"
          ? "ตัวอย่างขยายงวดผ่อน (คงดอกเบี้ยเดิม)"
          : "Illustrative Term Extension (Same Rate)"
    policyTitleTh = "ตัวอย่างสถานการณ์ปรับโครงสร้างหนี้เชิงป้องกันก่อนเป็นหนี้เสีย (หลักเกณฑ์ปี 2568)"
    policyTitleEn = "Illustrative Pre Emptive Restructuring Scenario (Responsible Lending 2568)"
    ruleCaptionTh =
      rateCutPct > 0
        ? `ประมาณการปรับลดค่างวดและอัตราดอกเบี้ยเหลือ ${formatRatePct(reducedRlRate)}% ต่อปี (${rateSrcTh}) เพื่อใช้ประกอบการเจรจากับเจ้าหนี้ ไม่ใช่ข้อผูกพันอนุมัติ`
        : `ประมาณการปรับลดค่างวดจากการจัดตารางผ่อน ${Math.round(horizonMonths / 12)} ปี โดยคงอัตราดอกเบี้ยเดิม (${rateSrcTh}) เพื่อใช้ประกอบการเจรจากับเจ้าหนี้ ไม่ใช่ข้อผูกพันอนุมัติ`
    ruleCaptionEn =
      rateCutPct > 0
        ? `Illustrative payment and rate reduction to ${formatRatePct(reducedRlRate)}% p.a. (${rateSrcEn}) to support lender negotiation, not an approval guarantee.`
        : `Illustrative payment adjustment over ${Math.round(horizonMonths / 12)} years at your existing rate (${rateSrcEn}) to support lender negotiation, not an approval guarantee.`
  }

  const origMonthlyPay = monthlyDebt > 0 ? monthlyDebt : Math.round(calcAnnuityPayment(principal, origRate, horizonMonths))
  const origR = origRate / 100 / 12
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
  } else if (mode === "step_up_illustration") {
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
  } else if (mode === "sme_scenario") {
    const easedPay = Math.round(origMonthlyPay * 0.85)
    policyY1Pay = easedPay
    policyY2Pay = easedPay
    policyY3Pay = easedPay
  } else {
    const annuityPay = Math.round(calcAnnuityPayment(principal, reducedRlRate, horizonMonths))
    const pay = annuityPay > 0 ? Math.min(origMonthlyPay, annuityPay) : Math.round(origMonthlyPay * 0.8)
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
  const stepUpRates = [0.5, 0.7, 0.9, 1.0, 1.0]

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
    if (mode === "step_up_illustration") {
      const rate = stepUpRates[Math.min(yrIndex, 3)]
      scheduledYearPolPay = Math.round(origMonthlyPay * rate)
    } else if (mode === "disaster_defer") {
      scheduledYearPolPay = yrIndex === 0 ? policyY1Pay : origMonthlyPay
    } else if (mode === "sme_scenario") {
      scheduledYearPolPay = yrIndex < 2 ? policyY1Pay : Math.round(origMonthlyPay * 0.85)
    } else {
      scheduledYearPolPay = policyY1Pay
    }

    // Policy restructured month step
    let currentPolPay = scheduledYearPolPay
    if (balPol > 0) {
      if (mode === "sme_scenario") {
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
      } else if (mode === "step_up_illustration") {
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
    estimatedPrincipalMonths: estMonths,
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

export type ScenarioComparisonItem = {
  id: string
  matchesStatus: boolean
  principalBasisTh: string
  principalBasisEn: string
  titleTh: string
  titleEn: string
  estimatedMonthlyTh: string
  estimatedMonthlyEn: string
  prosTh: string
  prosEn: string
  tradeoffTh: string
  tradeoffEn: string
  creditImpactTh: string
  creditImpactEn: string
}

export type NegotiationGuide = {
  openingTh: string
  openingEn: string
  questionsTh: string[]
  questionsEn: string[]
}

export function buildScenarioComparison(params: {
  status: DebtStatusKey
  isSme: boolean
  monthlyDebt: number
  totalPrincipalInput: number
  customAnnualRatePct?: number
  horizonYears: number
  deferMonths: number
}): ScenarioComparisonItem[] {
  const { status, isSme, monthlyDebt, totalPrincipalInput, customAnnualRatePct, horizonYears, deferMonths } = params
  const hasCustomRate = typeof customAnnualRatePct === "number" && Number.isFinite(customAnnualRatePct) && customAnnualRatePct > 0
  const baseRate = hasCustomRate
    ? Math.min(36, Math.max(0.01, Number(customAnnualRatePct.toFixed(2))))
    : status === "persistent"
      ? 25
      : status === "overdue_120_plus"
        ? 18
        : isSme
          ? 9.5
          : 10.5

  const rEst = baseRate / 100 / 12
  const estPrincipal =
    rEst > 0
      ? Math.round(monthlyDebt * ((1 - Math.pow(1 + rEst, -48)) / rEst))
      : Math.round(monthlyDebt * 48)
  const principal = totalPrincipalInput > 0 ? totalPrincipalInput : estPrincipal
  if (principal <= 0) return []

  const extendMonths = Math.max(60, Math.min(120, Math.round(horizonYears * 12) + 24))
  const restructuredRate = baseRate > 3 ? Math.max(3, baseRate - 2) : baseRate
  const extendPay = Math.round(calcAnnuityPayment(principal, restructuredRate, extendMonths))
  const gracePay = Math.round(principal * (baseRate / 100 / 12))
  const persistMonths = Math.min(84, Math.max(36, Math.round(horizonYears * 12)))
  // Use the official 15% ceiling as the illustrative persistent-debt rate.
  // The borrower's assumed contract rate is not the rate promised by this option.
  const persistentRate = 15
  const persistPay = Math.round(calcAnnuityPayment(principal, persistentRate, persistMonths))
  const clinicPay = Math.round(calcAnnuityPayment(principal, 4, 84))
  const principalBasisTh = totalPrincipalInput > 0
    ? `ใช้ยอดเงินต้นที่กรอก ${principal.toLocaleString()} บาท; อัตราและเงื่อนไขแต่ละแผนเป็นสมมติฐานเพื่อเปรียบเทียบ ไม่ใช่ข้อเสนอจากเจ้าหนี้`
    : `ไม่ได้กรอกยอดเงินต้น จึงประเมิน ${principal.toLocaleString()} บาทจากค่างวด ${monthlyDebt.toLocaleString()} บาท โดยสมมติดอกเบี้ย ${baseRate}% ต่อปีและเหลือผ่อน 48 เดือน; ตัวเลขอาจคลาดเคลื่อนมาก`
  const principalBasisEn = totalPrincipalInput > 0
    ? `Uses the entered principal of ${principal.toLocaleString()} THB. Each plan's rate and terms are illustrative, not a lender offer.`
    : `No principal was entered. Estimated ${principal.toLocaleString()} THB from a ${monthlyDebt.toLocaleString()} THB payment, assuming ${baseRate}% p.a. and 48 months remaining; actual figures may differ substantially.`

  return [
    {
      id: "restructure_extend",
      matchesStatus: status === "current" || status === "overdue_31_120",
      principalBasisTh,
      principalBasisEn,
      titleTh: "ขอปรับลดค่างวดหรือขยายงวดกับเจ้าหนี้เดิม",
      titleEn: "Adjust Installment or Extend Term with Current Lender",
      estimatedMonthlyTh: `ราว ${extendPay.toLocaleString()} บาท/เดือน (สมมติดอกเบี้ย ${restructuredRate}% · ${Math.round(extendMonths / 12)} ปี)`,
      estimatedMonthlyEn: `~${extendPay.toLocaleString()} THB/mo (assumed ${restructuredRate}% · ${Math.round(extendMonths / 12)} yrs)`,
      prosTh: "อาจช่วยลดค่างวดได้ หากเจ้าหนี้อนุมัติเงื่อนไขที่เหมาะกับความสามารถจ่าย",
      prosEn: "May lower installments if the lender approves terms that fit your ability to pay.",
      tradeoffTh: "หากยืดระยะเวลาผ่อนนานขึ้น ยอดดอกเบี้ยสะสมตลอดสัญญาอาจสูงกว่าการผ่อนจบเร็ว",
      tradeoffEn: "Extending the term can increase total cumulative interest over the full loan life.",
      creditImpactTh: "ผลต่อข้อมูลเครดิตขึ้นกับสถานะและวิธีรายงานของเจ้าหนี้ ควรถามก่อนตกลง",
      creditImpactEn: "Credit reporting depends on your account status and lender reporting; ask before agreeing.",
    },
    {
      id: "disaster_defer",
      matchesStatus: status === "disaster",
      principalBasisTh,
      principalBasisEn,
      titleTh: `ขอพักชำระเงินต้นชั่วคราว (${deferMonths} เดือน)`,
      titleEn: `Temporary Principal Deferral (${deferMonths} Months)`,
      estimatedMonthlyTh: `ราว ${gracePay.toLocaleString()} บาท/เดือน (ดอกเบี้ยสมมติ ${baseRate}% · ${deferMonths} เดือน)`,
      estimatedMonthlyEn: `~${gracePay.toLocaleString()} THB/mo (assumed ${baseRate}% · ${deferMonths} mos)`,
      prosTh: "เก็บเงินสดไว้หมุนเวียนและฟื้นตัวได้ทันทีในช่วงรายได้สะดุดจากภัยพิบัติหรือช่วงเงียบ",
      prosEn: "Frees immediate cashflow during hazard disruption or seasonal slowdowns.",
      tradeoffTh: "สมมติว่าจ่ายดอกเบี้ยระหว่างพัก เงินต้นจึงยังไม่ลด และค่างวดหลังพักต้องตกลงกับเจ้าหนี้ อาจสูงขึ้นหรือยืดเวลา",
      tradeoffEn: "Assumes interest is paid during the pause, so principal does not fall. Agree on post-pause payments with the lender; they may rise or extend the term.",
      creditImpactTh: "ผลต่อข้อมูลเครดิตขึ้นกับข้อตกลงและการรายงานของเจ้าหนี้ ให้ตรวจสอบก่อนเข้าร่วม",
      creditImpactEn: "Credit reporting depends on the agreement and lender reporting; verify before joining.",
    },
    {
      id: "persistent_exit",
      matchesStatus: status === "persistent",
      principalBasisTh,
      principalBasisEn,
      titleTh: "เปลี่ยนหนี้หมุนเวียนเป็นผ่อนรายงวดปิดจบหนี้เรื้อรัง",
      titleEn: "Convert Revolving Debt to Fixed Payoff (Persistent Debt)",
      estimatedMonthlyTh: `ราว ${persistPay.toLocaleString()} บาท/เดือน (จำลองที่เพดาน 15% · ${Math.round(persistMonths / 12)} ปี)`,
      estimatedMonthlyEn: `~${persistPay.toLocaleString()} THB/mo (illustrated at 15% cap · ${Math.round(persistMonths / 12)} yrs)`,
      prosTh: "หากเข้าเกณฑ์ อาจเปลี่ยนหนี้หมุนเวียนเป็นผ่อนรายงวดและมีกรอบเวลาปิดหนี้",
      prosEn: "If eligible, revolving debt may be converted to installments with a defined payoff period.",
      tradeoffTh: "เฉพาะสินเชื่อส่วนบุคคลหมุนเวียนที่เข้าเกณฑ์และยังไม่เป็นหนี้เสีย; อัตราจริงไม่เกิน 15% และอาจต่ำกว่านี้ ไม่ใช่ทางเลือกสำหรับหนี้กิจการโดยตรง",
      tradeoffEn: "Only for eligible non-NPL personal revolving credit. The actual rate is at most 15% and may be lower; this is not a direct business-debt option.",
      creditImpactTh: "การปรับเงื่อนไขอาจปรากฏในข้อมูลเครดิต รายละเอียดขึ้นกับการรายงานของเจ้าหนี้ ควรถามก่อนเลือก",
      creditImpactEn: "The restructuring may appear in credit data; details depend on lender reporting. Ask before choosing.",
    },
    {
      id: "debt_clinic",
      matchesStatus: status === "overdue_120_plus",
      principalBasisTh,
      principalBasisEn,
      titleTh: "รวมหนี้เสียไม่มีหลักประกันผ่านคลินิกแก้หนี้",
      titleEn: "Consolidate Unsecured NPL via Debt Clinic",
      estimatedMonthlyTh: `ราว ${clinicPay.toLocaleString()} บาท/เดือน (ตัวอย่างดอกเบี้ย 4% · 7 ปี)`,
      estimatedMonthlyEn: `~${clinicPay.toLocaleString()} THB/mo (sample 4% · 7 yrs)`,
      prosTh: "รวมหนี้บัตรเครดิตและสินเชื่อบุคคลหลายแห่งมาจ่ายที่เดียว ดอกเบี้ยผ่อนปรน 3 ถึง 5% ต่อปี",
      prosEn: "Combines multiple unsecured cards/loans into one low rate plan (3 to 5% p.a.).",
      tradeoffTh: "สำหรับบุคคลธรรมดาที่มีหนี้ไม่มีหลักประกันและผ่านเกณฑ์โครงการเท่านั้น; ยอดจริงและเงื่อนไขให้ SAM ตรวจสอบ",
      tradeoffEn: "For individuals with eligible unsecured debt only; SAM must verify the actual balance and eligibility.",
      creditImpactTh: "เป็นการปรับโครงสร้างหนี้เสีย รายงานเครดิตเป็นไปตามสถานะบัญชีและเงื่อนไขโครงการ ควรถาม SAM ก่อนสมัคร",
      creditImpactEn: "This restructures NPL debt; credit reporting follows account status and program terms. Confirm with SAM before applying.",
    },
  ]
}

export function buildNegotiationGuide(params: {
  provinceName: string
  isSme: boolean
  status: DebtStatusKey
  diag: FinancialDiagnostic
  comparison: LoanComparisonResult | null
  primaryProgramTitleTh?: string
  primaryProgramTitleEn?: string
  safeSeasonalCap?: number | null
  provincialSeasonSummaryTh?: string | null
  provincialSeasonSummaryEn?: string | null
}): NegotiationGuide {
  const {
    provinceName,
    isSme,
    status,
    diag,
    comparison,
    primaryProgramTitleTh,
    primaryProgramTitleEn,
    safeSeasonalCap,
    provincialSeasonSummaryTh,
    provincialSeasonSummaryEn,
  } = params

  const currentPay = Math.round(diag.monthlyDebt)
  const operatingCf = Math.max(0, Math.round(diag.operatingCashflow))
  const isDisaster = comparison?.mode === "disaster_defer"
  const proposedPay =
    status === "overdue_120_plus"
      ? Math.max(0, Math.round(operatingCf * 0.65))
      : comparison
        ? Math.round(
            isDisaster
              ? (comparison.policyGracePayment ?? comparison.policyYear1Payment)
              : comparison.policyYear1Payment,
          )
        : Math.max(0, Math.round(operatingCf * 0.7))

  const targetCap =
    safeSeasonalCap != null && safeSeasonalCap > 0 && proposedPay > 0
      ? Math.min(proposedPay, safeSeasonalCap)
      : proposedPay

  const subjectTh = isSme ? `กิจการในจังหวัด${provinceName}` : `ผู้กู้ในจังหวัด${provinceName}`
  const subjectEn = isSme ? `a business in ${provinceName}` : `a borrower in ${provinceName}`

  const requestPhraseTh =
    status === "overdue_120_plus"
      ? "ต้องการตรวจสอบสิทธิ์การรวมหนี้และปรับโครงสร้างหนี้ผ่านคลินิกแก้หนี้หรือแนวทางปิดจบหนี้ของเจ้าหนี้"
      : status === "disaster"
        ? "ขอพิจารณาแนวทางพักชำระเงินต้นชั่วคราวหรือลดค่างวดสำหรับผู้ได้รับผลกระทบจากสถานการณ์ในพื้นที่"
        : status === "persistent"
          ? "ขอตรวจสอบสิทธิ์เปลี่ยนสินเชื่อหมุนเวียนเป็นสินเชื่อผ่อนรายงวดตามมาตรการปิดจบหนี้เรื้อรัง"
          : "ขอพิจารณาปรับโครงสร้างหนี้เชิงป้องกันตามหลักเกณฑ์การให้สินเชื่ออย่างรับผิดชอบ เพื่อลดค่างวดให้สอดคล้องกับรายรับจริง"

  const requestPhraseEn =
    status === "overdue_120_plus"
      ? "request eligibility screening for Debt Clinic consolidation or an official settlement plan"
      : status === "disaster"
        ? "request temporary principal deferral or hazard related installment relief"
        : status === "persistent"
          ? "check eligibility to convert my revolving credit into a capped rate fixed installment plan"
          : "request proactive pre delinquency restructuring under the Responsible Lending framework"

  const seasonalNoteTh = provincialSeasonSummaryTh ? ` และพื้นที่${provincialSeasonSummaryTh}` : ""
  const seasonalNoteEn = provincialSeasonSummaryEn ? ` Given ${provincialSeasonSummaryEn},` : ""

  const openingTh =
    `สวัสดีครับ/ค่ะ ปัจจุบันเป็น${subjectTh} มีความตั้งใจชำระหนี้อย่างต่อเนื่อง แต่หลังหักค่าใช้จ่ายจำเป็นแล้วเหลือเงินพร้อมชำระหนี้ราว ${operatingCf.toLocaleString()} บาทต่อเดือน ขณะที่ค่างวดเดิมอยู่ที่ ${currentPay.toLocaleString()} บาทต่อเดือน${seasonalNoteTh} จึงขอ${requestPhraseTh}${targetCap > 0 ? ` โดยตั้งเป้าค่างวดที่สามารถจ่ายได้จริงไม่เกินประมาณ ${targetCap.toLocaleString()} บาทต่อเดือน` : ""}${primaryProgramTitleTh ? ` (อ้างอิงแนวทาง: ${primaryProgramTitleTh})` : ""} ไม่ทราบว่าธนาคารมีทางเลือกใดที่ใกล้เคียงบ้างครับ/ค่ะ`

  const openingEn =
    `Hello, as ${subjectEn} committed to repaying my loan, my post-expense cashflow is currently about ${operatingCf.toLocaleString()} THB/month against my current payment of ${currentPay.toLocaleString()} THB/month.${seasonalNoteEn} I would like to ${requestPhraseEn}${targetCap > 0 ? ` with a sustainable target installment around ${targetCap.toLocaleString()} THB/month` : ""}${primaryProgramTitleEn ? ` (reference: ${primaryProgramTitleEn})` : ""}. What restructuring options can you offer?`

  return {
    openingTh,
    openingEn,
    questionsTh: [
      "ดอกเบี้ยในช่วงที่ลดค่างวดหรือพักชำระเงินต้นจะคำนวณอย่างไร และต้องชำระส่วนต่างในช่วงใด",
      "การปรับเงื่อนไขครั้งนี้จะบันทึกสถานะในประวัติข้อมูลเครดิตอย่างไร และส่งผลต่อการขอสินเชื่อในอนาคตหรือไม่",
      "มีค่าธรรมเนียมการปรับโครงสร้างหนี้หรือค่าใช้จ่ายแฝงอื่นเพิ่มเติมหรือไม่",
      "เมื่อครบช่วงผ่อนปรนแล้ว ค่างวดจะปรับกลับเป็นเดือนละเท่าไร และขอทบทวนเพิ่มได้หรือไม่หากรายได้ยังไม่ฟื้นตัว",
    ],
    questionsEn: [
      "How is interest calculated during the reduced payment or deferral period, and when is any deferred interest due?",
      "How will this restructuring be reported to the National Credit Bureau, and will it affect future credit applications?",
      "Are there any restructuring fees or hidden administrative charges?",
      "What will the monthly installment be after the relief period ends, and can it be reviewed if income has not recovered?",
    ],
  }
}

export function buildPlainTextNegotiationSummary(params: {
  lang: Lang
  provinceName: string
  businessLabel: string
  statusLabel: string
  diag: FinancialDiagnostic
  comparison: LoanComparisonResult | null
  guide: NegotiationGuide
  matchedPrograms: { title: string; benefit: string }[]
  provincialNote?: string | null
  safeSeasonalCap?: number | null
}): string {
  const {
    lang,
    provinceName,
    businessLabel,
    statusLabel,
    diag,
    comparison,
    guide,
    matchedPrograms,
    provincialNote,
    safeSeasonalCap,
  } = params
  const fmt = (n: number) => `${Math.round(n).toLocaleString()} ${lang === "th" ? "บาท" : "THB"}`

  if (lang === "th") {
    const lines = [
      `สรุปข้อมูลการเงินและแนวทางเจรจากับเจ้าหนี้ (จัดทำเพื่อเตรียมตัวพูดคุยเบื้องต้น)`,
      `จังหวัด: ${provinceName} | ประเภท: ${businessLabel}`,
      `สถานะการผ่อนปัจจุบัน: ${statusLabel}`,
      ``,
      `ตัวเลขการเงินปัจจุบัน`,
      `• รายได้ต่อเดือน: ${fmt(diag.monthlyRevenue)}`,
      `• ค่าใช้จ่ายจำเป็นต่อเดือน: ${fmt(diag.monthlyOpex)}`,
      `• เงินเหลือหลังหักค่าใช้จ่ายจำเป็น: ${fmt(diag.operatingCashflow)}`,
      `• ค่างวดหนี้เดิมต่อเดือน: ${fmt(diag.monthlyDebt)}`,
      `• เงินเก็บสำรองฉุกเฉิน: ${fmt(diag.cashReserve)}`,
    ]
    if (comparison) {
      const activePay =
        comparison.mode === "disaster_defer"
          ? (comparison.policyGracePayment ?? comparison.policyYear1Payment)
          : comparison.policyYear1Payment
      lines.push(`• ตัวอย่างค่างวดใหม่ที่ตั้งเป้าไว้: ${fmt(activePay)} / เดือน`)
    }
    if (provincialNote) {
      lines.push(``)
      lines.push(`บริบทพื้นที่จังหวัด${provinceName}`)
      lines.push(`• ${provincialNote}`)
      if (safeSeasonalCap != null && safeSeasonalCap > 0) {
        lines.push(`• เพดานค่างวดที่ปลอดภัยช่วงรายได้ชะลอตัว: ไม่เกินประมาณ ${fmt(safeSeasonalCap)} / เดือน`)
      }
    }
    if (matchedPrograms.length > 0) {
      lines.push(``)
      lines.push(`แนวทางที่ควรสอบถามเรียงตามลำดับ`)
      matchedPrograms.forEach((p, i) => {
        lines.push(`${i + 1}. ${p.title}`)
      })
    }
    lines.push(``)
    lines.push(`ตัวอย่างคำพูดเริ่มต้นคุยกับเจ้าหน้าที่`)
    lines.push(`"${guide.openingTh}"`)
    lines.push(``)
    lines.push(`คำถามสำคัญที่ควรถามก่อนตกลง`)
    guide.questionsTh.forEach((q, i) => {
      lines.push(`${i + 1}. ${q}`)
    })
    return lines.join("\n")
  }

  const lines = [
    `Personal Financial Summary & Lender Negotiation Notes`,
    `Province: ${provinceName} | Profile: ${businessLabel}`,
    `Current Status: ${statusLabel}`,
    ``,
    `Current Cashflow Snapshot`,
    `- Monthly Income: ${fmt(diag.monthlyRevenue)}`,
    `- Essential Monthly Expenses: ${fmt(diag.monthlyOpex)}`,
    `- Post-Expense Cashflow: ${fmt(diag.operatingCashflow)}`,
    `- Current Monthly Debt Payment: ${fmt(diag.monthlyDebt)}`,
    `- Emergency Cash Reserve: ${fmt(diag.cashReserve)}`,
  ]
  if (comparison) {
    const activePay =
      comparison.mode === "disaster_defer"
        ? (comparison.policyGracePayment ?? comparison.policyYear1Payment)
        : comparison.policyYear1Payment
    lines.push(`- Illustrative Target Payment: ${fmt(activePay)} / month`)
  }
  if (provincialNote) {
    lines.push(``)
    lines.push(`${provinceName} Local Risk Context`)
    lines.push(`- ${provincialNote}`)
    if (safeSeasonalCap != null && safeSeasonalCap > 0) {
      lines.push(`- Suggested Low-Season Safe Payment Cap: <= ${fmt(safeSeasonalCap)} / month`)
    }
  }
  if (matchedPrograms.length > 0) {
    lines.push(``)
    lines.push(`Priority Options to Discuss`)
    matchedPrograms.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.title}`)
    })
  }
  lines.push(``)
  lines.push(`Suggested Opening Statement`)
  lines.push(`"${guide.openingEn}"`)
  lines.push(``)
  lines.push(`Key Questions to Ask Before Agreeing`)
  guide.questionsEn.forEach((q, i) => {
    lines.push(`${i + 1}. ${q}`)
  })
  return lines.join("\n")
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
  negotiationGuide?: NegotiationGuide | null
  provincialNote?: string | null
  safeSeasonalCap?: number | null
}): string {
  const {
    lang,
    provinceName,
    businessLabel,
    statusLabel,
    diag,
    comparison,
    matchedPrograms,
    checklist,
    negotiationGuide,
    provincialNote,
    safeSeasonalCap,
  } = params
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
  const questions = negotiationGuide ? (lang === "th" ? negotiationGuide.questionsTh : negotiationGuide.questionsEn) : []

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<title>${lang === "th" ? "สรุปข้อมูลการเงินและแนวทางเจรจาเบื้องต้น" : "Personal Financial Summary & Negotiation Notes"}</title>
<style>
  @page { size: A4 portrait; margin: 13mm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'IBM Plex Sans Thai', 'Inter', 'Leelawadee UI', 'Tahoma', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #0f172a;
    background: #ffffff;
    margin: 0;
    padding: 6px;
    font-size: 10.5px;
    line-height: 1.48;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1.5px solid #0f172a;
    padding-bottom: 9px;
    margin-bottom: 10px;
  }
  .brand { font-size: 9.5px; font-weight: 600; letter-spacing: 0.04em; color: #64748b; }
  h1 { margin: 3px 0 0; font-size: 16px; font-weight: 700; color: #0f172a; letter-spacing: -0.01em; }
  .meta-right { text-align: right; font-size: 9.5px; color: #475569; line-height: 1.55; }
  .context-bar {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
    padding: 7px 11px;
    margin-bottom: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    font-size: 10px;
    color: #334155;
  }
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 10px;
  }
  .kpi {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
    padding: 7px 9px;
  }
  .kpi-label { font-size: 9px; color: #64748b; font-weight: 500; }
  .kpi-val { font-size: 13px; font-weight: 700; margin-top: 2px; color: #0f172a; }
  .kpi-sub { font-size: 8.8px; color: #64748b; margin-top: 2px; }
  h2 {
    font-size: 11px;
    font-weight: 700;
    color: #0f172a;
    margin: 10px 0 5px;
    padding-bottom: 3px;
    border-bottom: 1px solid #e2e8f0;
  }
  .stress-box {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 8px 11px;
    margin-bottom: 8px;
    font-size: 10px;
  }
  .province-box {
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    background: #f8fafc;
    padding: 8px 11px;
    margin-bottom: 8px;
    font-size: 10px;
    color: #334155;
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
  th { background: #f8fafc; font-weight: 600; color: #334155; }
  .proposal-card {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
    padding: 8px 11px;
    margin-top: 4px;
    font-size: 10px;
  }
  .two-col {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 10px;
    margin-top: 4px;
  }
  .notes-box {
    border: 1px dashed #cbd5e1;
    border-radius: 10px;
    padding: 8px 11px;
    margin-top: 8px;
    font-size: 9.8px;
    color: #334155;
  }
  .note-line {
    border-bottom: 1px dotted #cbd5e1;
    height: 16px;
    margin-top: 3px;
  }
  ul { margin: 4px 0 0 16px; padding: 0; font-size: 9.8px; color: #334155; }
  li { margin-bottom: 2.5px; }
  .footer {
    margin-top: 10px;
    padding-top: 6px;
    border-top: 1px solid #e2e8f0;
    font-size: 8.6px;
    color: #64748b;
  }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${lang === "th" ? "บันทึกช่วยจำส่วนตัวสำหรับเตรียมตัวพูดคุยกับเจ้าหนี้ (ไม่ใช่ใบคำร้องทางการของธนาคาร)" : "Personal Preparation Notes for Lender Discussion (Not an Official Bank Form)"}</div>
      <h1>${lang === "th" ? "สรุปข้อมูลการเงินและแนวทางเจรจาเบื้องต้น" : "Financial Summary & Debt Negotiation Notes"}</h1>
    </div>
    <div class="meta-right">
      <div><strong>${lang === "th" ? "วันที่จัดทำ:" : "Date:"}</strong> ${today}</div>
      <div><strong>${lang === "th" ? "จังหวัด:" : "Province:"}</strong> ${provinceName}</div>
    </div>
  </div>

  <div class="context-bar">
    <div><strong>${lang === "th" ? "กลุ่มผู้ใช้:" : "Profile:"}</strong> ${businessLabel}</div>
    <div><strong>${lang === "th" ? "สถานะการผ่อนชำระปัจจุบัน:" : "Current Status:"}</strong> ${statusLabel}</div>
  </div>

  <div class="kpi-grid">
    <div class="kpi">
      <div class="kpi-label">${lang === "th" ? "รายได้ต่อเดือน" : "Monthly Income"}</div>
      <div class="kpi-val">${fmt(diag.monthlyRevenue)}</div>
      <div class="kpi-sub">${diag.isSme ? `${lang === "th" ? "เงินเหลือหลังหักรายจ่ายกิจการ" : "Operating CF"} ${fmt(diag.operatingCashflow)}` : `${lang === "th" ? "ค่าใช้จ่ายจำเป็น" : "Living Cost"} ${fmt(diag.monthlyOpex)}`}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">${lang === "th" ? "ค่างวดหนี้เดิม/เดือน" : "Current Debt Service"}</div>
      <div class="kpi-val">${fmt(diag.monthlyDebt)}</div>
      <div class="kpi-sub">${diag.dsrPct != null ? (lang === "th" ? `ค่างวดคิดเป็น ${diag.dsrPct.toFixed(1)}% ของรายได้รวม` : `Gross-Income DSR ${diag.dsrPct.toFixed(1)}%`) : (lang === "th" ? "ไม่มีรายได้รองรับค่างวด (ต้องเร่งเจรจา)" : "Undefined (Zero Income · Critical)")}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">${lang === "th" ? "สถานะเงินเหลือหลังหักค่างวด" : "Net Monthly Cash Status"}</div>
      <div class="kpi-val" style="color:${diag.netMonthlyCashflow < 0 ? "#b91c1c" : "#0f766e"}">${diag.netMonthlyCashflow >= 0 ? (lang === "th" ? `พอจ่าย (+${Math.round(diag.netMonthlyCashflow).toLocaleString()} บาท)` : `Surplus (+${fmt(diag.netMonthlyCashflow)})`) : (lang === "th" ? `ขาดอีก ${Math.abs(Math.round(diag.netMonthlyCashflow)).toLocaleString()} บาท` : `Shortfall (-${fmt(Math.abs(diag.netMonthlyCashflow))})`)}</div>
      <div class="kpi-sub">${diag.runwayTotalMonths != null ? (lang === "th" ? `หากไม่มีรายรับ เงินเก็บอยู่ได้ ${diag.runwayTotalMonths.toFixed(1)} เดือน` : `Zero income runway ${diag.runwayTotalMonths.toFixed(1)} mos`) : ""}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">${lang === "th" ? "ค่างวดใหม่ที่ตั้งเป้าไว้ (ปีที่ 1)" : "Target Year 1 Payment"}</div>
      <div class="kpi-val" style="color:#0f766e">${comparison ? fmt(comparison.mode === "disaster_defer" ? (comparison.policyGracePayment ?? comparison.policyYear1Payment) : comparison.policyYear1Payment) : fmt(diag.monthlyDebt)}</div>
      <div class="kpi-sub">${comparison && comparison.monthlyLiquiditySaved > 0 ? (lang === "th" ? `ลดภาระลงราว ${fmt(comparison.monthlyLiquiditySaved)}/เดือน` : `Reduced by ~${fmt(comparison.monthlyLiquiditySaved)}/mo`) : (lang === "th" ? "อิงตามแผนจำลอง" : "Per proposed schedule")}</div>
    </div>
  </div>

  ${
    provincialNote
      ? `
  <div class="province-box">
    <strong>${lang === "th" ? `บริบทความเสี่ยงจังหวัด${provinceName}:` : `${provinceName} Local Risk Context:`}</strong> ${provincialNote}${safeSeasonalCap != null && safeSeasonalCap > 0 ? (lang === "th" ? ` · <strong>เพดานค่างวดที่ปลอดภัยช่วงรายได้ชะลอตัว: ไม่เกินประมาณ ${fmt(safeSeasonalCap)}/เดือน</strong>` : ` · <strong>Suggested low-season payment cap: <= ${fmt(safeSeasonalCap)}/mo</strong>`) : ""}
  </div>`
      : ""
  }

  <h2>${lang === "th" ? `1. การทดสอบความสามารถจ่ายหนี้เมื่อรายได้ลดลง (-${diag.stressDropPct || 30}%)` : `1. Sensitivity Analysis (-${diag.stressDropPct || 30}% Income Scenario)`}</h2>
  <div class="stress-box">
    <div><strong>${lang === "th" ? "รายได้เมื่อหดตัว:" : "Stressed Income:"}</strong><br/>${fmt(diag.stressedRevenue)} / ${lang === "th" ? "เดือน" : "mo"}</div>
    <div><strong>${lang === "th" ? "สถานะการจ่ายหนี้เมื่อรายได้ลด:" : "Stressed Payment Status:"}</strong><br/><span style="color:${diag.stressedNetMonthlyCashflow < 0 ? "#b91c1c" : "#0f766e"};font-weight:700">${diag.stressedNetMonthlyCashflow >= 0 ? (lang === "th" ? `ยังพอจ่าย (+${Math.round(diag.stressedNetMonthlyCashflow).toLocaleString()} บาท/เดือน)` : `Surplus (+${fmt(diag.stressedNetMonthlyCashflow)}/mo)`) : (lang === "th" ? `ขาดอีก ${Math.abs(Math.round(diag.stressedNetMonthlyCashflow)).toLocaleString()} บาท/เดือน` : `Shortfall (-${fmt(Math.abs(diag.stressedNetMonthlyCashflow))}/mo)`)}</span></div>
    <div><strong>${lang === "th" ? "เงินเก็บสำรองช่วยชดเชยได้:" : "Reserve Buffer:"}</strong><br/><span style="color:${diag.stressedNetMonthlyCashflow < 0 ? "#b91c1c" : "#0f766e"};font-weight:700">${diag.stressedNetMonthlyCashflow < 0 && diag.stressedRunwayMonths != null ? (lang === "th" ? `รองรับส่วนที่ขาดได้ ${diag.stressedRunwayMonths} เดือน` : `${diag.stressedRunwayMonths} mos`) : (lang === "th" ? "ไม่ต้องดึงเงินเก็บมาใช้" : "No reserve draw needed")}</span></div>
  </div>

  ${
    comparison
      ? `
  <h2>${lang === "th" ? `2. ตารางเปรียบเทียบค่างวดและยอดหนี้คงเหลือ (${comparison.policyTitleTh})` : `2. Proposed Repayment Schedule (${comparison.policyTitleEn})`}</h2>
  <div style="font-size:9.2px;color:#475569;margin-bottom:4px">${lang === "th" ? comparison.ruleCaptionTh : comparison.ruleCaptionEn} (${lang === "th" ? `ยอดหนี้ตั้งต้น ${fmt(comparison.principalUsed)}${comparison.usesEstimatedPrincipal ? ` (ประเมินจากค่างวดเดิมสมมติเหลือ ${comparison.estimatedPrincipalMonths} งวด)` : ""} · ประมาณการส่วนต่างดอกเบี้ย ${fmt(comparison.totalInterestSaved)}${comparison.usesAssumedRate ? ` (สมมติฐานดอกเบี้ยเดิม ${formatRatePct(comparison.originalRatePct)}%/ปี)` : ` (ดอกเบี้ยที่กรอก ${formatRatePct(comparison.originalRatePct)}%/ปี)`}` : `Principal ${fmt(comparison.principalUsed)}${comparison.usesEstimatedPrincipal ? ` (est. from payment assuming ${comparison.estimatedPrincipalMonths} remaining mos)` : ""} · Est. Interest Difference ${fmt(comparison.totalInterestSaved)} (${comparison.usesAssumedRate ? "assumed" : "entered"} ${formatRatePct(comparison.originalRatePct)}% p.a.)`})</div>
  <table>
    <thead>
      <tr>
        <th>${lang === "th" ? "งวด/ปีที่" : "Period"}</th>
        <th style="text-align:right">${lang === "th" ? "ยอดหนี้เดิมคงเหลือ (บาท)" : "Original Balance"}</th>
        <th style="text-align:right">${lang === "th" ? "ยอดหนี้ตามแผนใหม่ (บาท)" : "Proposed Balance"}</th>
        <th style="text-align:right">${lang === "th" ? "ค่างวดเดิม/เดือน" : "Original/mo"}</th>
        <th style="text-align:right">${lang === "th" ? "ค่างวดใหม่ที่ตั้งเป้า/เดือน" : "Target/mo"}</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>`
      : ""
  }

  <div class="two-col">
    <div>
      <h2>${lang === "th" ? "3. แนวทางหลักที่ควรสอบถามก่อนและตัวอย่างคำพูด" : "3. Priority Option & Opening Talking Points"}</h2>
      <div class="proposal-card">
        <strong>${primaryProgram ? primaryProgram.title : (lang === "th" ? "ขอปรับเงื่อนไขการผ่อนชำระให้สอดคล้องกับรายรับจริง" : "Payment Restructuring Request")}</strong>
        ${
          negotiationGuide
            ? `<div style="margin-top:5px;color:#334155;font-style:italic">"${lang === "th" ? negotiationGuide.openingTh : negotiationGuide.openingEn}"</div>`
            : `<div style="margin-top:4px;color:#334155">${primaryProgram ? primaryProgram.benefit : ""}</div>`
        }
      </div>
    </div>
    <div>
      <h2>${lang === "th" ? "4. เอกสารที่ควรเตรียมไว้แสดงต่อเจ้าหน้าที่" : "4. Supporting Documents to Prepare"}</h2>
      <ul>${checklist.map((item) => `<li>${item}</li>`).join("")}</ul>
    </div>
  </div>

  ${
    questions.length > 0
      ? `
  <h2>${lang === "th" ? "5. คำถามสำคัญที่ควรถามเจ้าหน้าที่และช่องจดข้อเสนอ" : "5. Key Questions to Ask & Officer Offer Notes"}</h2>
  <div class="notes-box">
    <ul>${questions.map((q) => `<li>${q}</li>`).join("")}</ul>
    <div style="margin-top:6px;font-weight:600;color:#0f172a">${lang === "th" ? "จดบันทึกข้อเสนอและชื่อเจ้าหน้าที่ที่ติดต่อ:" : "Notes on bank offer & officer contacted:"}</div>
    <div class="note-line"></div>
    <div class="note-line"></div>
  </div>`
      : ""
  }

  <div class="footer">
    ${lang === "th" ? "หมายเหตุ: เอกสารนี้จัดทำขึ้นเพื่อช่วยเตรียมข้อมูลและวางแผนก่อนพูดคุยกับเจ้าหนี้เท่านั้น ไม่ใช่เอกสารทางการของธนาคารหรือธนาคารแห่งประเทศไทย เงื่อนไขการอนุมัติจริงเป็นไปตามหลักเกณฑ์ของแต่ละสถาบันการเงิน" : "Note: Prepared solely as personal planning notes before contacting your lender. Not an official bank or Bank of Thailand form; final approval depends on lender credit policy."}
  </div>
</body>
</html>`
}
