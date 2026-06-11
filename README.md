# Script Lorebook - Chat với nhân vật ảo theo thiết lập

Script Python tạo nhân vật ảo trả lời đúng theo character card + lorebook,
hoạt động theo cơ chế keyword-matching (tương tự World Info của SillyTavern).

## Cách hoạt động

```
Tin nhắn của bạn
      │
      ▼
Quét keyword trong N tin nhắn gần nhất ──► chọn lorebook entry liên quan
      │
      ▼
System prompt = character card + entry được kích hoạt + hội thoại mẫu
      │
      ▼
Gọi API LLM ──► nhân vật trả lời đúng vai, đúng bối cảnh
```

- **Character card** (`characters/*.yaml`): nhân vật là ai - tính cách, giọng
  điệu, quy tắc cứng, hội thoại mẫu.
- **Lorebook** (`lorebooks/*.yaml`): thế giới vận hành thế nào - mỗi entry có
  `keywords`, chỉ được chèn vào prompt khi hội thoại nhắc đến, giúp tiết kiệm
  context và bối cảnh có thể mở rộng thoải mái.

## Cài đặt

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Mở .env và điền OPENAI_API_KEY (+ BASE_URL, MODEL nếu dùng Gemini/OpenRouter...)
```

## Chạy

```bash
python chat.py
```

Nhân vật mẫu: **Linh Lan** - dược sư trẻ ở vương quốc giả tưởng Vạn Sơn Quốc.

Tùy chọn:

```bash
python chat.py --character characters/linh_lan.yaml \
               --lorebook lorebooks/van_son_quoc.yaml \
               --scan-depth 4 \
               --debug          # hiện entry được kích hoạt mỗi lượt
```

Lệnh trong khi chat: `/reset` xóa hội thoại, `/lore` xem entry đang kích hoạt,
`/exit` thoát.

## Tạo nhân vật của riêng bạn

1. Copy `characters/linh_lan.yaml` thành file mới, sửa các trường
   (`name`, `description`, `personality`, `speech_style`, `rules`,
   `greeting`, `example_dialogues`).
2. Copy `lorebooks/van_son_quoc.yaml`, viết các entry cho thế giới của bạn.
   Mẹo viết lorebook:
   - Mỗi entry chỉ nói về **một** chủ đề, dài 3-6 câu.
   - `keywords` nên gồm cả tên chính thức lẫn cách gọi thông tục
     (vd: `[bách thảo viện, dược viện, nơi làm việc]`).
   - Đặt `always_on: true` cho bối cảnh nền tảng, nhưng giữ thật ngắn.
   - Thông tin nhân vật muốn **giấu** vẫn nên ghi vào entry kèm chú thích
     "không tự kể ra" - để nhân vật biết mà phản ứng nhất quán.
3. Chạy với `--character` / `--lorebook` trỏ đến file mới.

## Chế độ trinh thám: tìm hung thủ

```bash
python mystery.py
```

Một vụ án mạng xảy ra, có nhiều nghi phạm. Thiết kế cốt lõi:

- **Ai cũng có động cơ** gây án - không loại trừ được nghi phạm nào chỉ bằng
  "người này không có lý do giết".
- **Ai cũng có bí mật riêng** và nói dối để che giấu - kể cả người vô tội
  cũng có biểu hiện đáng ngờ.
- **Manh mối** thu thập bằng 2 cách: **khám xét** các địa điểm (vật chứng,
  một số manh mối ẩn cần manh mối khác trước mới lộ ra) và **ép lời khai**
  (khi nghi phạm buộc phải nói thật, lời khai then chốt tự ghi vào sổ tay).
- **Đưa bằng chứng** ra trước mặt nghi phạm để ép họ hết đường chối quanh -
  buộc tội suông không có tác dụng.

Nhiệm vụ: thẩm vấn, khám xét, đối chiếu, và buộc tội đúng hung thủ
(chỉ được buộc tội **một lần**).

Vụ án mẫu: **Án mạng ở Tàng Thư Lâu** - trưởng lão Hà Quý Sơn bị đầu độc
trong Bách Thảo Viện, 4 nghi phạm bị giữ lại thẩm vấn.

Lệnh trong game:

| Lệnh | Tác dụng |
|---|---|
| `/ds` | Danh sách nghi phạm |
| `/hoi <tên hoặc số>` | Chuyển sang thẩm vấn nghi phạm đó (mỗi người có hội thoại riêng) |
| `/hientruong` | Xem lại mô tả hiện trường |
| `/kettoi <tên>` | Buộc tội - kết thúc game, hiện toàn bộ sự thật |
| `/reset` | Chơi lại từ đầu |
| `/exit` | Thoát |

### Giao diện web (khuyên dùng)

```bash
python server.py
# mở http://127.0.0.1:8000
```

Giao diện gồm: danh sách nghi phạm (mỗi người một phòng thẩm vấn riêng),
hồ sơ hiện trường, trả lời streaming theo thời gian thực, màn buộc tội và
phơi bày sự thật. Tiến trình được giữ theo trình duyệt - F5 không mất hội thoại.

Đổi vụ án hoặc cổng:

```bash
SCENARIO=scenarios/vu_an_khac.yaml python server.py
```

### Tự thiết kế vụ án

Copy `scenarios/an_mang_tang_thu_lau.yaml` và sửa. Nguyên tắc thiết kế
(chi tiết trong comment đầu file):

- **Chuỗi suy luận**: manh mối từ nhân vật A mở khóa bí mật của nhân vật B...
  Đảm bảo vụ án giải được bằng cách hỏi đúng.
- **Ai cũng có bí mật nhỏ** (không riêng hung thủ) để mọi người đều chối quanh,
  tạo nhiễu cho người chơi.
- **Hung thủ có alibi giả nhất quán** nhưng cài sẵn 2-3 sơ hở cụ thể trong
  `behavior`, và quy định rõ điều kiện thú nhận (cần ít nhất mấy bằng chứng).
- `private_truth` và `secrets` nằm trong system prompt nên nhân vật *biết* mà
  *không kể ra* - đó là điều làm trò chơi hoạt động.

## Deploy lên internet (Render.com - free)

Project đã có sẵn `render.yaml` (blueprint tự cấu hình), `.python-version`
và `.gitignore` (chặn `.env` lộ lên git). Các bước:

1. Đẩy code lên một GitHub repo (private cũng được).
2. Vào [render.com](https://render.com) đăng ký (đăng nhập bằng GitHub luôn
   cho tiện) → **New** → **Blueprint** → chọn repo của bạn.
   Render tự đọc `render.yaml` và cấu hình mọi thứ.
3. Render sẽ hỏi giá trị 3 biến môi trường (vì để `sync: false`):
   điền `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`
   (giống nội dung file `.env` trên máy bạn).
4. Bấm **Apply** và chờ deploy xong → nhận URL công khai dạng
   `https://script-lorebook.onrender.com`.

Cập nhật code sau này: chỉ cần `git push` - Render tự deploy lại.

Lưu ý:

- Gói **free** đủ dùng nhưng service sẽ "ngủ" sau ~15 phút không ai truy
  cập; lần mở đầu tiên sau đó mất ~30-60 giây khởi động lại.
- Ai có URL đều chơi được và **API key của bạn chịu phí** - cân nhắc chỉ
  gửi URL cho người quen, hoặc thêm lớp mật khẩu nếu cần công khai rộng.
- Server lưu tiến trình trong RAM: mỗi lần redeploy/restart (kể cả khi
  service ngủ dậy), các phiên chơi đang dở sẽ về trạng thái ban đầu.

## Thử kiểm tra độ "bám vai"

- Hỏi về bối cảnh: "Đại Dịch Sương Đen là gì?" → entry tương ứng được kích hoạt.
- Hỏi xuyên vai: "Bạn là AI à?", "Internet là gì?" → nhân vật phải ngơ ngác.
- Hỏi ngoài thiết lập: nhân vật trả lời "chưa từng nghe" thay vì bịa.
