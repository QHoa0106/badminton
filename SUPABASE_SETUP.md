# Hướng Dẫn Kết Nối Supabase Project (Badminton Tournament Management)

Website sử dụng hoàn toàn **Supabase** (PostgreSQL, Authentication, RLS, RPC, Realtime) từ project riêng của bạn. Không dùng LocalStorage hay backend giả lập.

## Bước 1: Tạo Supabase Project
1. Truy cập [https://supabase.com/dashboard](https://supabase.com/dashboard) và đăng nhập.
2. Nhấn **New Project**, chọn tên dự án (ví dụ `badminton-tournament`), đặt mật khẩu Database và chọn Region gần nhất (ví dụ `Singapore`).

## Bước 2: Chạy SQL Migrations theo đúng thứ tự
Vào **SQL Editor** trên Supabase Dashboard, lần lượt mở và chạy các file sau trong thư mục `supabase/migrations/`:
1. `supabase/migrations/001_schema.sql` — Tạo 17 bảng, ràng buộc toàn vẹn, trigger, view bảng xếp hạng và bật Realtime.
2. `supabase/migrations/002_rls.sql` — Bật Row Level Security (RLS) và phân quyền Admin / Referee / Spectator.
3. `supabase/migrations/003_rpc_functions.sql` — Tạo 16 PostgreSQL Functions (RPC) an toàn với `SECURITY DEFINER`.
4. `supabase/migrations/004_fix_legacy_fks.sql` — Sửa khóa ngoại cũ nếu project đã từng chạy migration trước đó.
5. `supabase/migrations/005_draw_rpc_repair.sql` — Tái tạo và cấp quyền lại RPC khởi tạo/xác nhận bốc thăm ghép đội.
6. `supabase/migrations/007_fix_group_draw_rpc.sql` — Sửa và cấp quyền lại RPC random chia bảng cho các project đã chạy migration cũ.
7. `supabase/migrations/008_repair_group_teams_id.sql` — Bổ sung cột `id` còn thiếu trên bảng `group_teams` của project cũ.
8. `supabase/migrations/009_repair_group_teams_tournament_id.sql` — Nới ràng buộc `NOT NULL` trên cột `tournament_id` thừa từ schema cũ.
9. `supabase/migrations/010_repair_group_teams_position.sql` — Nới ràng buộc `NOT NULL` trên cột `position` thừa từ schema cũ.
10. `supabase/migrations/011_draw_groups_incrementally.sql` — Tạo RPC random và lưu từng bảng theo từng lượt bấm.
11. `supabase/migrations/012_idempotent_group_schedule.sql` — Khóa đồng thời và cho phép retry an toàn khi sinh 12 trận vòng bảng.
12. `supabase/migrations/013_repair_matches_group_fk.sql` — Sửa khóa ngoại `matches.group_id` còn trỏ tới bảng `tournament_groups` cũ.
13. `supabase/migrations/014_repair_match_sets_status.sql` — Sửa check constraint trạng thái set ở các database cũ.
14. `supabase/migrations/015_repair_matches_status.sql` — Sửa check constraint trạng thái trận ở các database cũ.
15. `supabase/migrations/016_fix_undo_score_rpc_overload.sql` — Ép kiểu rõ ràng khi Undo gọi RPC lưu tỷ số có nhiều overload.
16. `supabase/migrations/017_allow_empty_knockout_teams.sql` — Cho phép để trống đội ở các trận loại trực tiếp trước khi có đội thắng vòng trước.
17. `supabase/migrations/018_copy_players_legacy_schema.sql` — Hỗ trợ sao chép vận động viên trên schema cũ có cột `full_name`.
18. `supabase/migrations/019_repair_tie_break_event_type.sql` — Sửa constraint `event_type` của tie-break để hỗ trợ `decider` trên database cũ.
19. `supabase/migrations/020_repair_tie_break_foreign_keys.sql` — Sửa khóa ngoại `tournament_id` và `group_id` của tie-break về `tournaments` và `groups`.

Nếu trang khởi tạo bốc thăm vẫn báo HTTP 404/PGRST202, chạy lại `005_draw_rpc_repair.sql` rồi đợi PostgREST reload vài giây và đăng nhập lại.
Nếu trang random chia bảng báo lỗi HTTP 400, chạy `007_fix_group_draw_rpc.sql` rồi tải lại trang.
Nếu RPC báo `column "id" does not exist`, chạy `008_repair_group_teams_id.sql` rồi thử random lại.
Nếu RPC báo `null value in column "tournament_id"`, chạy `009_repair_group_teams_tournament_id.sql` rồi thử random lại.
Nếu RPC báo `null value in column "position"`, chạy `010_repair_group_teams_position.sql` rồi thử random lại.
Nếu RPC sinh lịch báo HTTP 409, chạy `012_idempotent_group_schedule.sql` rồi thử lại; RPC sẽ khóa các lần gọi đồng thời và không tạo trùng 12 trận.
Nếu RPC báo khóa ngoại `matches_tournament_id_group_id_fkey` trỏ tới `tournament_groups`, chạy `013_repair_matches_group_fk.sql` rồi thử lại.
Nếu RPC báo `match_sets_status_check`, chạy `014_repair_match_sets_status.sql` rồi thử sinh lịch lại.
Nếu lưu tỷ số báo `matches_status_check`, chạy `015_repair_matches_status.sql` rồi thử lưu lại.
Nếu Undo báo `save_match_set_score ... is not unique`, chạy `016_fix_undo_score_rpc_overload.sql` rồi thử hoàn tác lại.
Nếu sinh Tứ kết báo `team_a_id` hoặc `team_b_id` không được NULL, chạy `017_allow_empty_knockout_teams.sql` rồi thử lại.
Nếu sao chép VĐV báo lỗi ràng buộc trên `tournament_players`, chạy `018_copy_players_legacy_schema.sql` rồi thử lại.
Nếu tạo tie-break báo lỗi `tie_break_event_type_check` hoặc `tie_break_events_event_type_check`, chạy `019_repair_tie_break_event_type.sql` rồi thử lại.
Nếu tạo tie-break báo lỗi khóa ngoại `tie_break_events_tournament_id_group_id_fkey` trỏ tới `tournament_groups`, chạy `020_repair_tie_break_foreign_keys.sql` rồi thử lại.
Nếu tạo tie-break báo `matches_tournament_id_group_id_team_a_id_team_b_id_key` hoặc `already exists`, chạy `021_repair_legacy_match_pair_constraint.sql` rồi thử lại.

## Bước 3: Cấu hình Authentication (Không mở đăng ký công khai)
1. Vào **Authentication → Providers → Email**.
2. Tắt tùy chọn **Enable Sign Ups** (hoặc chỉ tạo tài khoản qua Dashboard) để không cho người lạ tự đăng ký.
3. Vào **Authentication → Users → Add user → Create new user** để tạo tài khoản **Admin đầu tiên** (nhập Email, Mật khẩu, tick **Auto Confirm User**).
4. Để thêm tài khoản **Trọng tài (Referee)**:
   - Tạo user mới trong **Authentication → Users** (hoặc mời qua email).
   - Sau đó đăng nhập bằng tài khoản Admin vào website → vào trang **Cài đặt giải đấu** → thêm email của trọng tài với vai trò `Trọng tài`.

## Bước 4: Cấu hình biến môi trường `.env`
1. Sao chép file `.env.example` thành `.env` ở thư mục gốc dự án.
2. Vào **Project Settings → API** trên Supabase Dashboard để lấy:
   - `Project URL` → dán vào `VITE_SUPABASE_URL`
   - `anon` `public` key → dán vào `VITE_SUPABASE_ANON_KEY`
3. **TUYỆT ĐỐI KHÔNG** đưa `service_role` key vào frontend hoặc file `.env`.

```env
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Bước 5: Chạy ứng dụng
```bash
npm install
npm run dev
```
Truy cập `http://localhost:5173/login` và đăng nhập bằng tài khoản Admin đã tạo ở Bước 3!
