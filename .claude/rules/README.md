# Shared Agent Rules

Nơi để rule/skill dùng chung cho các công cụ AI coding của dự án.

## Bố cục thật (đã đối chiếu 2026-08-28)

```
.claude/rules/
  AGENTS.md                              luật bắt buộc: đọc .playbook trước khi sửa mã
  skills/frontend-design/SKILL.md         skill dùng chung — MỘT bản duy nhất
  *.mdc                                   rule cho Claude-style agent
.cursor/rules/*.mdc                       rule cho Cursor (7 file TRÙNG TÊN với trên
                                          nhưng NỘI DUNG KHÁC — chưa hợp nhất)
```

Thêm skill mới thì đặt ở `.claude/rules/skills/<ten-skill>/SKILL.md`.

## Ba chỗ tài liệu này từng nói sai (sửa 2026-08-28)

- Ghi vị trí skill là `.agents/rules/skills/frontend-design/SKILL.md`. Thư mục `.agents/`
  **rỗng**, đường dẫn đó chưa bao giờ tồn tại.
- Ghi có bridge file `CLAUDE.md`. Không có file nào tên vậy trong kho.
- Ghi có `.cursor/rules/project-rules.mdc`. File đó nằm ở `.claude/rules/`, không phải
  `.cursor/rules/`.

`SKILL.md` cũng từng có **hai bản y hệt** (`rules/frontend-design/` và
`rules/skills/frontend-design/`, cùng md5). Cả hai đều được nạp vào context mỗi phiên nên
tốn gấp đôi cho cùng một nội dung. Đã giữ lại bản trong `skills/`.

## Về 7 file `.mdc` trùng tên

`.claude/rules/*.mdc` và `.cursor/rules/*.mdc` là **bản sao y hệt** — chỉ khác line-ending
(CRLF vs LF), nên `cmp` báo "khác" ở mọi dòng. So sau khi chuẩn hoá thì 0 dòng khác thật:

```bash
for f in .claude/rules/*.mdc; do
  b=".cursor/rules/$(basename "$f")"
  [ -f "$b" ] && diff --strip-trailing-cr "$f" "$b"
done   # rỗng -> giống hệt nhau
```

Trùng lặp ở đây do tooling ép: Cursor chỉ đọc `.cursor/rules/`. Chưa gộp. Cần
`.gitattributes` để hết lệch line-ending.

Không đối xứng: `project-rules.mdc` chỉ có ở `.claude/`, `karpathy-guidelines.mdc` chỉ có
ở `.cursor/`.
