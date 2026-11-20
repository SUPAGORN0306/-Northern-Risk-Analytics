"use client"

import { useStaffPortal } from "@/components/staff-portal"

type StaffLoginButtonProps = {
  label: string
  className: string
}

export function StaffLoginButton({ label, className }: StaffLoginButtonProps) {
  const { openLogin } = useStaffPortal()

  return (
    <button type="button" onClick={openLogin} className={className}>
      {label}
    </button>
  )
}
