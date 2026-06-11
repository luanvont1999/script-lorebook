#!/usr/bin/env python3
"""Chat CLI với nhân vật ảo: character card + lorebook keyword-matching.

Cách dùng:
    python chat.py
    python chat.py --character characters/linh_lan.yaml --lorebook lorebooks/van_son_quoc.yaml
"""

import argparse
import os
import sys
from pathlib import Path

import yaml
from dotenv import load_dotenv
from openai import OpenAI

# Số tin nhắn gần nhất được quét để kích hoạt lorebook entry
DEFAULT_SCAN_DEPTH = 4


def load_yaml(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def find_active_entries(entries: list[dict], history: list[dict], scan_depth: int) -> list[dict]:
    """Chọn các lorebook entry được kích hoạt bởi keyword trong hội thoại gần đây."""
    recent_text = " ".join(
        msg["content"] for msg in history[-scan_depth:]
    ).lower()

    active = []
    for entry in entries:
        if entry.get("always_on"):
            active.append(entry)
            continue
        keywords = entry.get("keywords", [])
        if any(kw.lower() in recent_text for kw in keywords):
            active.append(entry)
    return active


def build_system_prompt(card: dict, active_entries: list[dict]) -> str:
    """Ghép character card + lorebook entries thành system prompt."""
    parts = [
        f"Bạn đang nhập vai nhân vật {card['name']} trong một cuộc hội thoại. "
        f"Hãy trả lời hoàn toàn trong vai nhân vật, tuân thủ nghiêm ngặt thiết lập dưới đây.",
        f"# NHÂN VẬT: {card['name']}\n\n## Mô tả\n{card['description']}",
        f"## Tính cách\n{card['personality']}",
        f"## Cách nói chuyện\n{card['speech_style']}",
        f"## Quy tắc bắt buộc\n{card['rules']}",
    ]

    if active_entries:
        lore_text = "\n\n".join(
            f"### {e['name']}\n{e['content']}" for e in active_entries
        )
        parts.append(
            "# THIẾT LẬP THẾ GIỚI (thông tin liên quan đến hội thoại hiện tại)\n\n"
            + lore_text
        )

    examples = card.get("example_dialogues", [])
    if examples:
        ex_text = "\n\n".join(
            f"Người dùng: {ex['user']}\n{card['name']}: {ex['char']}" for ex in examples
        )
        parts.append(
            "# HỘI THOẠI MẪU (tham khảo giọng văn, KHÔNG lặp lại nguyên văn)\n\n" + ex_text
        )

    return "\n\n---\n\n".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description="Chat với nhân vật ảo theo thiết lập")
    parser.add_argument("--character", default="characters/linh_lan.yaml", help="Đường dẫn file character card")
    parser.add_argument("--lorebook", default="lorebooks/van_son_quoc.yaml", help="Đường dẫn file lorebook")
    parser.add_argument("--scan-depth", type=int, default=DEFAULT_SCAN_DEPTH, help="Số tin nhắn gần nhất dùng để kích hoạt lorebook")
    parser.add_argument("--debug", action="store_true", help="Hiện các lorebook entry được kích hoạt mỗi lượt")
    args = parser.parse_args()

    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        sys.exit("Thiếu OPENAI_API_KEY. Hãy copy .env.example thành .env và điền API key.")

    client = OpenAI(
        api_key=api_key,
        base_url=os.getenv("OPENAI_BASE_URL") or None,
    )
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    card = load_yaml(args.character)
    entries = load_yaml(args.lorebook).get("entries", [])

    print(f"=== Chat với {card['name']} (model: {model}) ===")
    print("Lệnh: /reset xóa hội thoại, /lore xem entry đang kích hoạt, /exit thoát\n")

    history: list[dict] = []
    greeting = card.get("greeting", "").strip()
    if greeting:
        history.append({"role": "assistant", "content": greeting})
        print(f"{card['name']}: {greeting}\n")

    while True:
        try:
            user_input = input("Bạn: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nTạm biệt!")
            break

        if not user_input:
            continue
        if user_input == "/exit":
            print("Tạm biệt!")
            break
        if user_input == "/reset":
            history = [{"role": "assistant", "content": greeting}] if greeting else []
            print("(Đã xóa hội thoại)\n")
            continue
        if user_input == "/lore":
            active = find_active_entries(entries, history, args.scan_depth)
            names = ", ".join(e["name"] for e in active) or "(không có)"
            print(f"(Entry đang kích hoạt: {names})\n")
            continue

        history.append({"role": "user", "content": user_input})

        active = find_active_entries(entries, history, args.scan_depth)
        if args.debug:
            print(f"  [debug] entry kích hoạt: {[e['name'] for e in active]}")

        system_prompt = build_system_prompt(card, active)
        messages = [{"role": "system", "content": system_prompt}] + history

        print(f"\n{card['name']}: ", end="", flush=True)
        reply_parts: list[str] = []
        try:
            stream = client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    reply_parts.append(delta)
                    print(delta, end="", flush=True)
        except Exception as exc:  # noqa: BLE001 - hiển thị lỗi API cho người dùng
            print(f"\n(Lỗi khi gọi API: {exc})\n")
            history.pop()
            continue

        print("\n")
        history.append({"role": "assistant", "content": "".join(reply_parts)})


if __name__ == "__main__":
    main()
