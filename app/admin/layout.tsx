import type { ReactNode } from 'react'
import Link from 'next/link'

export const metadata = { title: 'Admin — Catch Comics' }

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100 font-mono text-sm">
      {/* ── Top nav ── */}
      <nav className="bg-gray-900 text-gray-300 px-4 py-2 flex items-center gap-6 text-xs">
        <span className="font-bold text-white tracking-widest uppercase">
          CatchComics Admin
        </span>
        <Link href="/admin/retailers"
          className="hover:text-white transition-colors">
          Retailers
        </Link>
        <div className="ml-auto">
          <a href="/api/admin/auth?action=logout"
            className="hover:text-red-400 transition-colors">
            Log out
          </a>
        </div>
      </nav>

      {/* ── Content ── */}
      <main className="p-6">{children}</main>
    </div>
  )
}
