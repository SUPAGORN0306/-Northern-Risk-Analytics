"use client"

import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Loader2, LockKeyhole, X } from "lucide-react"
import { StaffWorkspace } from "@/components/staff-workspace"
import { formatFetchError, isUnauthorizedError, staffLogin, type StaffAuthResponse } from "@/lib/api"
import { useAppState } from "@/lib/i18n"

const STAFF_SESSION_KEY = "northrisk_staff_auth_v1"

type StaffPortalContextValue = {
  openLogin: () => void
}

const StaffPortalContext = createContext<StaffPortalContextValue | null>(null)

export function useStaffPortal() {
  const context = useContext(StaffPortalContext)
  if (!context) throw new Error("useStaffPortal must be used inside StaffPortalProvider")
  return context
}

export function StaffPortalProvider({ children }: { children: ReactNode }) {
  const { lang } = useAppState()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [staffAuth, setStaffAuth] = useState<StaffAuthResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [signInMessage, setSignInMessage] = useState("")

  // Restore staff session across page refreshes and support browser Back navigation
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STAFF_SESSION_KEY)
      if (saved && window.location.hash === "#staff") {
        const parsed = JSON.parse(saved) as StaffAuthResponse
        if (parsed?.access_token) setStaffAuth(parsed)
      }
    } catch {
      // Ignore unavailable storage
    }

    const onHashChange = () => {
      if (window.location.hash !== "#staff") {
        setStaffAuth(null)
      } else {
        try {
          const saved = sessionStorage.getItem(STAFF_SESSION_KEY)
          if (saved) {
            const parsed = JSON.parse(saved) as StaffAuthResponse
            if (parsed?.access_token) setStaffAuth(parsed)
          }
        } catch {
          // Ignore unavailable storage
        }
      }
    }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  function persistStaffSession(auth: StaffAuthResponse) {
    try {
      sessionStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(auth))
    } catch {
      // Ignore storage quota errors
    }
    if (window.location.hash !== "#staff") {
      window.history.pushState(null, "", "#staff")
    }
    setStaffAuth(auth)
  }

  function exitStaffSession() {
    try {
      sessionStorage.removeItem(STAFF_SESSION_KEY)
    } catch {
      // Ignore unavailable storage
    }
    if (window.location.hash === "#staff") {
      window.history.pushState(null, "", window.location.pathname)
    }
    setStaffAuth(null)
  }

  function openLogin() {
    setSignInMessage("")
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal()
  }

  function closeLogin() {
    dialogRef.current?.close()
    formRef.current?.reset()
    setSignInMessage("")
  }

  const demoUserEnv = process.env.NEXT_PUBLIC_DEMO_STAFF_USER || ""
  const demoPassEnv = process.env.NEXT_PUBLIC_DEMO_STAFF_PASSWORD || ""
  const demoStewardUserEnv = process.env.NEXT_PUBLIC_DEMO_STEWARD_USER || ""
  const demoStewardPassEnv = process.env.NEXT_PUBLIC_DEMO_STEWARD_PASSWORD || ""
  const hasDemoAnalystConfig = Boolean(demoUserEnv && demoPassEnv)
  const hasDemoStewardConfig = Boolean(demoStewardUserEnv && demoStewardPassEnv)
  const hasDemoFillConfig = hasDemoAnalystConfig || hasDemoStewardConfig

  function handleFillDemo(targetRole: "policy_analyst" | "data_steward") {
    const userVal = targetRole === "data_steward" ? demoStewardUserEnv : demoUserEnv
    const passVal = targetRole === "data_steward" ? demoStewardPassEnv : demoPassEnv
    if (!userVal || !passVal) return
    const form = formRef.current
    if (!form) return
    const usernameInput = form.elements.namedItem("username") as HTMLInputElement | null
    const passwordInput = form.elements.namedItem("password") as HTMLInputElement | null
    if (usernameInput) {
      usernameInput.value = userVal
    }
    if (passwordInput) {
      passwordInput.value = passVal
    }
    setSignInMessage("")
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fd = new FormData(event.currentTarget)
    const username = String(fd.get("username") || "").trim()
    const password = String(fd.get("password") || "")
    setLoading(true)
    setSignInMessage("")
    try {
      const auth = await staffLogin(username, password)
      closeLogin()
      persistStaffSession(auth)
    } catch (err) {
      if (isUnauthorizedError(err)) {
        setSignInMessage(
          lang === "th"
            ? "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบข้อมูลอีกครั้ง"
            : "Invalid username or password. Please check your credentials.",
        )
      } else {
        setSignInMessage(formatFetchError(err, lang))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <StaffPortalContext.Provider value={{ openLogin }}>
      {staffAuth ? (
        <StaffWorkspace auth={staffAuth} onExit={exitStaffSession} />
      ) : (
        children
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby="staff-login-title"
        onClick={(event) => {
          if (event.target === dialogRef.current) closeLogin()
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-[440px] rounded-[1.75rem] border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-sm"
      >
        <div className="p-6 sm:p-8">
          <div className="mb-6 flex items-start justify-between">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-secondary">
              <LockKeyhole aria-hidden="true" className="size-5" />
            </span>
            <button
              type="button"
              onClick={closeLogin}
              aria-label="Close staff login"
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          <h2 id="staff-login-title" className="font-display text-2xl font-semibold tracking-tight">
            {lang === "th" ? "เข้าสู่ระบบสำหรับเจ้าหน้าที่" : "Staff Analytics Sign In"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {lang === "th"
              ? "ระบบแบ่งสิทธิ์การทำงานชัดเจนตามบทบาท เพื่อแยกการวิเคราะห์นโยบายออกจากการดูแลคุณภาพและท่อข้อมูล"
              : "Role-based access separates policy analysis from data quality governance and live pipeline operations."}
          </p>
          <div className="mt-3 grid gap-2 rounded-2xl border border-border bg-secondary/40 p-3 text-xs">
            <div>
              <span className="font-semibold text-foreground">
                {lang === "th" ? "1) นักวิเคราะห์ข้อมูลและนโยบาย: " : "1) Policy & Data Analyst: "}
              </span>
              <span className="text-muted-foreground">
                {lang === "th"
                  ? "ติดตาม 17 จังหวัด จำลองความเสี่ยง และออกรายงานนโยบาย"
                  : "Monitor 17 provinces, run simulations, and export briefs"}
              </span>
            </div>
            <div>
              <span className="font-semibold text-foreground">
                {lang === "th" ? "2) ผู้ดูแลคุณภาพข้อมูล: " : "2) Data Quality Steward: "}
              </span>
              <span className="text-muted-foreground">
                {lang === "th"
                  ? "ตรวจคุณภาพ Medallion/Quarantine ซิงก์ข้อมูลสด และอนุมัติเผยแพร่กลุ่มหลัก"
                  : "Inspect Medallion/Quarantine health, trigger syncs, and publish primary clusters"}
              </span>
            </div>
          </div>

          <form ref={formRef} onSubmit={handleSignIn} className="mt-6 flex flex-col gap-4">
            <div>
              <label htmlFor="staff-username" className="mb-2 block text-xs font-medium text-foreground">
                {lang === "th" ? "ชื่อผู้ใช้งาน" : "Username"}
              </label>
              <input
                id="staff-username"
                name="username"
                autoComplete="username"
                placeholder={lang === "th" ? "กรอกชื่อผู้ใช้งาน" : "Enter username"}
                required
                className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
              />
            </div>
            <div>
              <label htmlFor="staff-password" className="mb-2 block text-xs font-medium text-foreground">
                {lang === "th" ? "รหัสผ่าน" : "Password"}
              </label>
              <input
                id="staff-password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder={lang === "th" ? "กรอกรหัสผ่าน" : "Enter password"}
                required
                className="h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-60"
            >
              {loading && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              {lang === "th" ? "เข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่" : "Sign In"}
            </button>
            {signInMessage && (
              <p role="status" className="rounded-xl border border-border bg-secondary/70 px-3.5 py-3 text-xs leading-5 text-muted-foreground">
                {signInMessage}
              </p>
            )}
          </form>

          {hasDemoFillConfig && (
            <>
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">{lang === "th" ? "หรือ" : "or"}</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div className="flex flex-col gap-2">
                {hasDemoAnalystConfig && (
                  <button
                    type="button"
                    onClick={() => handleFillDemo("policy_analyst")}
                    disabled={loading}
                    className="inline-flex h-11 w-full items-center justify-center rounded-full border border-border bg-background px-5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
                  >
                    {lang === "th" ? "กรอกบัญชีทดสอบ: นักวิเคราะห์ข้อมูลและนโยบาย" : "Fill Demo: Policy & Data Analyst"}
                  </button>
                )}
                {hasDemoStewardConfig && (
                  <button
                    type="button"
                    onClick={() => handleFillDemo("data_steward")}
                    disabled={loading}
                    className="inline-flex h-11 w-full items-center justify-center rounded-full border border-border bg-background px-5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
                  >
                    {lang === "th" ? "กรอกบัญชีทดสอบ: ผู้ดูแลคุณภาพข้อมูล" : "Fill Demo: Data Quality Steward"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </dialog>
    </StaffPortalContext.Provider>
  )
}
