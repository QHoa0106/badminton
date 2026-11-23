import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Trophy, Lock, Mail, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { isSupabaseConfigured } from '@/lib/supabase'
import { SupabaseConfigBanner } from '@/components/SupabaseConfigBanner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function LoginPage() {
  const navigate = useNavigate()
  const { signIn, user } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <SupabaseConfigBanner />
      </div>
    )
  }

  if (user) {
    navigate('/tournaments', { replace: true })
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      toast.error('Vui lòng nhập đầy đủ email và mật khẩu')
      return
    }
    setSubmitting(true)
    const { error } = await signIn(email.trim(), password)
    setSubmitting(false)
    if (error) {
      toast.error(`Đăng nhập thất bại: ${error}`)
      return
    }
    toast.success('Đăng nhập thành công!')
    navigate('/tournaments')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy-950 via-navy-900 to-navy-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center text-white space-y-2">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg">
            <Trophy className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">
            Quản Lý Giải Cầu Lông Nội Bộ
          </h1>
          <p className="text-sm text-slate-300">
            Cổng đăng nhập dành cho Ban tổ chức (Admin) và Trọng tài
          </p>
        </div>

        <Card className="border-0 shadow-2xl">
          <CardHeader>
            <CardTitle>Đăng nhập hệ thống</CardTitle>
            <CardDescription>
              Hệ thống không mở đăng ký công khai. Vui lòng sử dụng tài khoản do Ban tổ chức cấp.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    type="email"
                    placeholder="admin@congty.vn"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9"
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Mật khẩu</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9"
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                {submitting ? 'Đang xác thực...' : 'Đăng nhập'}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <div className="mt-5 pt-4 border-t border-slate-100 text-center">
              <Link
                to="/tournaments"
                className="text-xs font-semibold text-navy-700 hover:underline"
              >
                Xem các giải đấu đang công khai (không cần đăng nhập) →
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
