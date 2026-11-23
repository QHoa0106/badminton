import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { slugifyVietnamese } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function NewTournamentPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [eventDate, setEventDate] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [courtCount, setCourtCount] = useState(4)
  const [submitting, setSubmitting] = useState(false)

  const handleNameChange = (val: string) => {
    setName(val)
    if (!slugTouched) {
      setSlug(slugifyVietnamese(val))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !slug.trim()) {
      toast.error('Vui lòng nhập tên giải đấu và đường dẫn (slug)')
      return
    }
    setSubmitting(true)
    try {
      const { data, error } = await supabase.rpc('create_tournament_with_admin', {
        p_name: name.trim(),
        p_slug: slug.trim().toLowerCase(),
        p_event_date: eventDate || null,
        p_location: location.trim(),
        p_description: description.trim(),
        p_court_count: Number(courtCount) || 4,
      })
      if (error) throw error
      toast.success('Tạo giải đấu mới thành công!')
      navigate(`/tournament/${data}/dashboard`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Không thể tạo giải đấu')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="mx-auto max-w-2xl space-y-6">
        <Link
          to="/tournaments"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-800 hover:underline"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách giải đấu
        </Link>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-navy-900 p-2.5 text-white">
                <Trophy className="h-6 w-6" />
              </div>
              <div>
                <CardTitle className="text-xl">Tạo giải cầu lông mới</CardTitle>
                <CardDescription>
                  Hệ thống tự động gán bạn làm Admin và khởi tạo sân thi đấu mặc định.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Tên giải đấu *</label>
                <Input
                  placeholder="VD: Giải cầu lông nội bộ 2026"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Đường dẫn công khai (Slug) *
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 whitespace-nowrap">/public/</span>
                  <Input
                    placeholder="giai-cau-long-noi-bo-2026"
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true)
                      setSlug(slugifyVietnamese(e.target.value))
                    }}
                    required
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Ngày thi đấu</label>
                  <Input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Số sân mặc định</label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={courtCount}
                    onChange={(e) => setCourtCount(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Địa điểm tổ chức</label>
                <Input
                  placeholder="VD: Nhà thi đấu Cầu Lông Quận 7"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Mô tả / Thể lệ tóm tắt</label>
                <Textarea
                  placeholder="24 VĐV (6 TB-, 6 TBY, 12 TBY+) — 12 đôi — 4 bảng — 8 đôi vào Tứ kết..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <Button type="button" variant="outline" onClick={() => navigate('/tournaments')}>
                  Hủy
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? 'Đang tạo giải...' : 'Tạo giải đấu'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
