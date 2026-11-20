"use client"

import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Loader2, LockKeyhole, X } from "lucide-react"
import { StaffWorkspace } from "@/components/staff-workspace"
import { staffDemoAccess, staffLogin, type StaffAuthResponse } from "@/lib/api"
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

  async function enterDemo() {
    setLoading(true)
    setSignInMessage("")
    try {
      const auth = await staffDemoAccess()
      closeLogin()
      persistStaffSession(auth)
    } catch (err) {
      setSignInMessage(
        lang === "th"
          ? "ไม่สามารถเชื่อมต่อระบบเจ้าหน้าที่ได้ในขณะนี้"
          : `Unable to enter staff workspace (${err instanceof Error ? err.message : "Error"}).`,
      )
    } finally {
      setLoading(false)
    }
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
      setSignInMessage(
        lang === "th"
          ? "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง หรือกดปุ่มเข้าใช้งานระบบเจ้าหน้าที่ด้านล่าง"
          : `Authentication failed (${err instanceof Error ? err.message : "Unauthorized"}).`,
      )
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
              ? "เข้าใช้งานระบบติดตามภาวะเศรษฐกิจ จำลองความเสี่ยงกระแสเงินสด จัดกลุ่มความเปราะบางรายจังหวัด และออกรายงานสรุปผู้บริหาร"
              : "Access regional policy monitoring, Monte Carlo risk simulation, dynamic clustering, and executive reporting."}
          </p>

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

          <div className="my-4 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {lang === "th" ? "หรือ" : "or"}
            <span className="h-px flex-1 bg-border" />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void enterDemo()}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
          >
            {lang === "th" ? "เข้าใช้งานระบบเจ้าหน้าที่ทันที" : "Instant Staff Access"}
          </button>
        </div>
      </dialog>
    </StaffPortalContext.Provider>
  )
}
