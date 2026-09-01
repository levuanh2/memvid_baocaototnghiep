"""Một câu hỏi tốn bao nhiêu token đầu ra? -> num_predict=3000 đủ cho mấy câu?

Đo được (01/09): xin 10 câu ở CẢ temp=0.2 lẫn 0.8 đều trả JSON BỊ CẮT giữa chừng, hỏng
cả hai lượt. Không phải model lặp, không phải ngữ liệu thiếu — output vượt trần.
"""
import sys


def main() -> int:
    from shared.env_loader import load_project_env
    load_project_env()

    import sqlite3

    from app.clients.llm_factory import ask_ai
    from app.domains.quiz import generator as gen
    from app.domains.vectorstore import chunk_text_store

    con = sqlite3.connect(chunk_text_store._db_path())
    try:
        rows = con.execute("SELECT chunk_id, text FROM chunks WHERE length(text) > 80 "
                           "ORDER BY chunk_id LIMIT 12").fetchall()
    finally:
        con.close()

    chunks = [{"chunk_id": str(c), "text": t, "heading": ""} for c, t in rows]
    context, _ = gen.build_context(chunks)
    print(f"ngu lieu {len(context)} ky tu | num_predict hien tai = {gen.QUIZ_NUM_PREDICT}")
    print(f"{'xin':>4} {'ky tu ra':>9} {'~token':>8} {'cau JSON':>9}  ket qua")

    for n in (3, 5, 8):
        thu = {}

        def _ask(prompt, **kw):
            r = ask_ai(prompt, **kw)
            thu["raw"] = str(r or "")
            return r

        qs, err, _ = gen.generate_questions(
            context, {"question_count": n, "difficulty": "mixed",
                      "question_types": ["multiple_choice", "true_false"]}, ask=_ask)
        raw = thu.get("raw", "")
        # ~2.7 ky tu/token cho tieng Viet voi tokenizer gemma
        print(f"{n:>4} {len(raw):>9} {int(len(raw) / 2.7):>8} {len(qs):>9}  "
              f"{'OK' if not err else 'HONG: ' + err[:40]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
