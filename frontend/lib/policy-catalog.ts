import rawCatalog from "../../shared/policy_catalog.json"

export type PolicyCatalogProgram = {
  id: string
  status: "ongoing_framework" | "ongoing_conditional" | "lender_dependent" | "event_dependent" | "closed_to_new_applicants"
  application_status: string
  audiences: Array<"individual" | "sme">
  debt_statuses: string[]
  title_th: string
  title_en: string
  summary_th: string
  summary_en: string
  source_doc_ids: string[]
  source_url: string
  closed_on?: string
  keywords?: string[]
}

export const POLICY_CATALOG = rawCatalog as {
  catalog_version: string
  verified_on: string
  max_age_days: number
  programs: PolicyCatalogProgram[]
}

export const CURRENT_POLICY_PROGRAMS = POLICY_CATALOG.programs.filter(
  (program) => program.status !== "closed_to_new_applicants",
)

export function policyProgramsFor(debtStatus: string, audience: "individual" | "sme") {
  return CURRENT_POLICY_PROGRAMS.filter(
    (program) => program.debt_statuses.includes(debtStatus) && program.audiences.includes(audience),
  )
}
