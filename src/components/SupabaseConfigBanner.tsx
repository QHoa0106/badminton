import { Database, ExternalLink, FileCode2, ShieldAlert } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function SupabaseConfigBanner() {
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <Card className="border-amber-300 bg-amber-50/70">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-500 p-2.5 text-white">
              <Database className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-lg text-amber-950">
                Chưa kết nối Supabase Project của bạn
              </CardTitle>
              <p className="text-sm text-amber-800">
                Hệ thống yêu cầu kết nối trực tiếp tới Supabase PostgreSQL & Auth (không dùng dữ liệu giả lập hay LocalStorage).
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-800">
          <div className="rounded-xl border border-amber-200 bg-white p-4 space-y-2.5">
            <p className="font-bold text-navy-900">Các bước thiết lập nhanh:</p>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                Tạo một project mới tại{' '}
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-navy-700 underline"
                >
                  Supabase Dashboard <ExternalLink className="h-3.5 w-3.5" />
                </a>
                .
              </li>
              <li>
                Mở <strong>SQL Editor</strong> trên Supabase và chạy lần lượt 3 file migration trong thư mục{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                  supabase/migrations/
                </code>
                : <code className="font-mono text-xs">001_schema.sql</code>,{' '}
                <code className="font-mono text-xs">002_rls.sql</code>,{' '}
                <code className="font-mono text-xs">003_rpc_functions.sql</code>.
              </li>
              <li>
                Vào <strong>Authentication → Users</strong> tạo tài khoản Admin đầu tiên (tắt đăng ký công khai trong Providers → Email).
              </li>
              <li>
                Tạo file <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">.env</code> ở thư mục gốc dự án từ <code className="font-mono text-xs">.env.example</code> với <code className="font-mono text-xs">VITE_SUPABASE_URL</code> và <code className="font-mono text-xs">VITE_SUPABASE_ANON_KEY</code>, sau đó khởi động lại Vite.
              </li>
            </ol>
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              <strong>Bảo mật:</strong> Chỉ sử dụng <code>anon public key</code> ở frontend. Tuyệt đối không đưa <code>service_role key</code> vào mã nguồn hoặc file <code>.env</code> của frontend.
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <FileCode2 className="h-4 w-4" />
            <span>Xem hướng dẫn đầy đủ trong file <code>SUPABASE_SETUP.md</code> ở thư mục gốc dự án.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
