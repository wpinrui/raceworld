'use client'

import Link from 'next/link'

const LINK = 'hover:text-[#00D9FF] transition-colors'

export function DriverLink({ id, children, className = '' }: { id: string; children: React.ReactNode; className?: string }) {
  if (!id) return <>{children}</>
  return <Link href={`/world/driver/${id}`} className={`${LINK} ${className}`}>{children}</Link>
}

export function TeamLink({ id, children, className = '' }: { id: string; children: React.ReactNode; className?: string }) {
  if (!id) return <>{children}</>
  return <Link href={`/world/team/${id}`} className={`${LINK} ${className}`}>{children}</Link>
}
