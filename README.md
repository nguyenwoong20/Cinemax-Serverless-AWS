# 🎬 Cinemax Serverless AWS

Backend serverless trên AWS cho ứng dụng xem phim **Cinemax** (Flutter). Dự án tái kiến trúc backend Node.js/Express + MongoDB truyền thống thành kiến trúc **100% serverless** — không server nào phải chạy 24/7, tự động scale, chi phí vận hành ≈ $0 với AWS Free Tier.

> 📱 **Tải app dùng thử:** [apk/Cinemax.apk](apk/Cinemax.apk) (Android, 55 MB) — mở app là xem phim ngay, dữ liệu phục vụ trực tiếp từ AWS.

## Kiến trúc

![Architecture](docs/architecture-aws.svg)

```
Flutter App ──HTTPS──► API Gateway (REST)      ──► Lambda: movies / auth / social / watchrooms
            ──wss────► API Gateway (WebSocket) ──► Lambda: watchroom-ws (xem chung realtime)

EventBridge (cron 2h sáng) ──► Lambda: sync ──► kkphim API (phim mới mỗi đêm)

DynamoDB ×7 bảng: movies · users · bookmarks · saved-movies · comments · rooms · connections
Amazon S3 ── poster, thumbnail, avatar người dùng
CloudWatch ── logs của 6 Lambda + alarm lỗi 5XX
External: kkphim API · TMDB (ảnh diễn viên, điểm) · Gmail SMTP (OTP)
```

**7 dịch vụ AWS:** API Gateway (REST + WebSocket) · Lambda ×6 (Node.js 22, arm64) · DynamoDB (7 bảng, on-demand) · S3 · EventBridge · CloudWatch · CloudFormation/SAM
**Infrastructure-as-Code:** toàn bộ hạ tầng định nghĩa trong một file [`template.yaml`](template.yaml) (AWS SAM) — deploy hoặc xóa sạch chỉ với 1 lệnh.

## Tính năng

### 🎥 Movie API (`/api/movies`) — tương thích drop-in với backend cũ
App Flutter không phải sửa logic nào, chỉ đổi base URL:

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/movies?search=&page=&limit=` | Tìm kiếm — kho không có thì **tự fallback sang kkphim** |
| GET | `/api/movies/limit/{n}` | N phim mới nhất |
| GET | `/api/movies/hot` | Phim hot theo điểm TMDB, **tự xoay vòng bộ mới mỗi ngày** |
| GET | `/api/movies/filter?...` | Lọc đa tiêu chí: thể loại + quốc gia + loại + năm/khoảng năm + sub + sắp xếp |
| GET | `/api/movies/category/{slug}` | Lọc theo thể loại |
| GET | `/api/movies/country/{slug}` | Lọc theo quốc gia |
| GET | `/api/movies/type/{type}` | Phim lẻ / phim bộ / hoạt hình |
| GET | `/api/movies/year/{year}` | Lọc theo năm |
| GET | `/api/movies/{slug}` | Chi tiết phim (kèm tập, link m3u8) — **chưa có trong kho thì tự nhập từ kkphim** (kho tự lớn) |
| GET | `/api/movies/{slug}/cast` | Diễn viên với **ảnh thật + tên vai** từ TMDB |

### 🔐 Auth API (`/api/auth`) — đăng nhập serverless hoàn chỉnh
| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/auth/register` | Đăng ký + gửi OTP qua email thật (nodemailer/Gmail từ Lambda) |
| POST | `/api/auth/verify-email` | Xác minh OTP (hết hạn 5 phút) |
| POST | `/api/auth/login` | Đăng nhập, trả JWT |
| POST | `/api/auth/google-login` | Đăng nhập Google (verify idToken bằng google-auth-library) |
| POST | `/api/auth/resend-verify-otp` | Gửi lại OTP (rate-limit 60s, tối đa 3 lần) |
| POST | `/api/auth/forgot-password` | OTP đặt lại mật khẩu |
| POST | `/api/auth/reset-password` | Đặt lại mật khẩu |
| PUT | `/api/user/{userId}` | Cập nhật hồ sơ: tên, **avatar (base64 → S3)**, đổi mật khẩu (chặn với tài khoản Google) |

Mật khẩu băm **bcrypt**, JWT ký bằng secret truyền qua biến môi trường — **không có credential nào hard-code trong code**.

### 📌 Social API — bookmarks · saved movies · comments
| Method | Endpoint | Mô tả |
|---|---|---|
| GET/POST | `/api/bookmarks` · DELETE `/{movieId}` · GET `/check/{movieId}` | Phim yêu thích (yêu cầu JWT) |
| GET/POST | `/api/saved-movies` · DELETE `/{slug}` | Phim đã lưu — GET **tự join thông tin phim** (tên, poster, điểm) |
| GET | `/api/comments/{movieId}` · POST `/api/comments/add` | Bình luận theo phim, **tự che từ nhạy cảm thành \*\*\*\*** (profanity filter phía server) |

### 👥 Watch Party — xem chung realtime
| Loại | Endpoint / Action | Mô tả |
|---|---|---|
| REST | `/api/watch-rooms` (tạo/danh sách) · `/{code}` · `/{code}/join` · `/{code}/leave` | Quản lý phòng, mã phòng 6 ký tự |
| WebSocket | `join-room` · `video-play/pause/seek` · `episode-change` · `sync-request` · `close-room` | Đồng bộ phát phim qua **API Gateway WebSocket** — bảng `connections` track ai đang ở phòng nào |

### 🌙 Tự cập nhật phim mới (EventBridge + Lambda sync)
Cron 02:00 mỗi đêm: gọi kkphim API lấy phim mới/cập nhật → upsert DynamoDB (so sánh `modifiedAt`, idempotent) → mirror poster về S3. Log kết quả (`added/updated/unchanged`) vào CloudWatch.

## Điểm kỹ thuật đáng chú ý

- **Thiết kế theo access pattern (DynamoDB):** bảng movies dùng `id` làm partition key, GSI `slug-index` cho tra cứu chi tiết theo slug, GSI `category-createdAt-index` cho duyệt theo thể loại mới nhất.
- **Tối ưu kích thước item:** trường nhẹ (tên, poster, năm...) lưu top-level cho danh sách dùng `ProjectionExpression`; document gốc đầy đủ (kèm episodes) lưu trong thuộc tính `doc`, có cơ chế nén tự động khi phim bộ vượt giới hạn 400KB/item.
- **Least-privilege IAM:** mỗi Lambda chỉ có quyền trên đúng bảng của nó — function bookmarks bị xâm nhập cũng không đọc được bảng users.
- **Migration dữ liệu thật:** [`scripts/seed.js`](scripts/seed.js) nhập 240 phim từ MongoDB export (`mongoexport`) vào DynamoDB theo lô 25 item (giới hạn BatchWriteItem).
- **Kho tự lớn (self-growing catalog):** tìm kiếm trượt → fallback kkphim; mở chi tiết phim lạ → tự ingest vào DynamoDB + mirror poster về S3 — kho phim lớn dần theo chính hành vi người dùng.
- **Realtime serverless:** WebSocket API + bảng `connections`; Lambda broadcast qua `ApiGatewayManagementApi` — không server socket nào chạy 24/7.
- **Hot xoay vòng theo ngày:** xếp hạng `rating × log10(votes)` từ điểm TMDB, xáo trộn bằng PRNG seed theo ngày (giờ VN) — cả ngày ổn định, qua đêm tự đổi bộ phim.
- **Giám sát:** mọi request ghi log CloudWatch; alarm tự kích hoạt khi API trả ≥5 lỗi 5XX trong 5 phút.

## Triển khai

Yêu cầu: AWS CLI, SAM CLI, Node.js ≥ 20, tài khoản AWS đã `aws configure`.

```bash
# 1. Build & deploy toàn bộ hạ tầng
sam build
sam deploy --guided
# Nhập các parameter khi được hỏi: JwtSecret, EmailUser, EmailPass,
# GoogleClientId, GoogleAndroidClientId

# 2. Nạp dữ liệu phim
npm install
node scripts/seed.js appxemphim.movies.json

# 3. Test
curl https://<api-id>.execute-api.<region>.amazonaws.com/prod/api/movies/limit/5
```

## Chi phí

| Hạng mục | Free tier | Thực tế sử dụng |
|---|---|---|
| Lambda | 1 triệu request/tháng (vĩnh viễn) | vài nghìn |
| DynamoDB | 25 GB (vĩnh viễn) | ~50 MB |
| API Gateway | 1 triệu request/tháng (12 tháng đầu) | vài nghìn |
| CloudWatch | 10 alarms | 1 alarm |

**Tổng: ≈ $0/tháng.** Băng thông video không đi qua AWS (link m3u8 từ nguồn ngoài) nên không phát sinh chi phí streaming.

## Dọn dẹp

```bash
aws s3 rm s3://cinemax-posters-<account-id> --recursive
sam delete
```

## 📱 Tải ứng dụng

| | |
|---|---|
| **Tải trực tiếp (APK)** | [⬇️ Cinemax.apk](https://github.com/nguyenwoong20/Cinemax-Serverless-AWS/raw/main/apk/Cinemax.apk) (~55 MB, Android) |
| **Xem trong repo** | [apk/Cinemax.apk](apk/Cinemax.apk) |

> Cài đặt: tải APK về điện thoại Android → mở file → cho phép "Cài đặt từ nguồn không xác định" nếu được hỏi. Mở app là duyệt phim ngay — toàn bộ dữ liệu phục vụ từ AWS.

## Repo liên quan

- 📱 [Cinemax-Flutter-App](https://github.com/nguyenwoong20/Cinemax-Flutter-App) — ứng dụng Flutter
- 🖥️ [cinemax-backend](https://github.com/nguyenwoong20/cinemax-backend) — backend Express/MongoDB gốc (đã được thay thế bởi repo này)
