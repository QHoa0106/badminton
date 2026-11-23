import React from 'react'
import { Loader2, WifiOff, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function LoadingState({ message = 'Đang tải dữ liệu từ Supabase...' }: { message?: string }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-slate-500">
      <Loader2 className="h-8 w-8 animate-spin text-navy-800" />
      <p className="text-sm font-medium">{message}</p>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500">{icon}</div>}
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <AlertCircle className="mx-auto h-8 w-8 text-red-600" />
      <h3 className="mt-2 text-base font-bold text-red-900">Không thể tải dữ liệu</h3>
      <p className="mt-1 text-sm text-red-700">{message}</p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          Thử lại
        </Button>
      )}
    </div>
  )
}

export function OfflineBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-red-600 px-4 py-2 text-xs font-semibold text-white">
      <WifiOff className="h-4 w-4" />
      <span>Mất kết nối Internet — Dữ liệu không thể lưu lên Supabase cho đến khi có mạng trở lại.</span>
    </div>
  )
}
