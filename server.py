#!/usr/bin/env python3
"""Web GUI cho game trinh thám - backend FastAPI.

Chạy:
    python server.py
    # rồi mở http://127.0.0.1:8000
"""

from __future__ import annotations

import os

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from pydantic import BaseModel

from chat import find_active_entries, load_yaml
from mystery import build_suspect_prompt

SCAN_DEPTH = 4

load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise SystemExit("Thiếu OPENAI_API_KEY. Hãy copy .env.example thành .env và điền API key.")

client = OpenAI(api_key=api_key, base_url=os.getenv("OPENAI_BASE_URL") or None)
model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

scenario_path = os.getenv("SCENARIO", "scenarios/an_mang_tang_thu_lau.yaml")
scenario = load_yaml(scenario_path)
characters = scenario["characters"]
char_by_id = {c["id"]: c for c in characters}
lore_entries = load_yaml(scenario["lorebook"]).get("entries", []) if scenario.get("lorebook") else []

locations = scenario.get("locations", [])
location_by_id = {l["id"]: l for l in locations}
clues = scenario.get("clues", [])
clue_by_id = {c["id"]: c for c in clues}

# Trạng thái game theo session (in-memory):
# sessions[sid] = {"histories": {...}, "result": dict | None, "clues": [clue_id...]}
sessions: dict[str, dict] = {}


def get_session(session_id: str) -> dict:
    return sessions.setdefault(session_id, {"histories": {}, "result": None, "clues": []})


def public_clue(clue: dict) -> dict:
    """Dạng manh mối gửi ra frontend (không lộ keywords/suspect/requires)."""
    return {"id": clue["id"], "name": clue["name"], "desc": clue["desc"], "source": clue["source"]}


def found_clues(session: dict) -> list[dict]:
    return [public_clue(clue_by_id[cid]) for cid in session["clues"]]


def unlock_testimony_clues(session: dict, suspect_id: str, reply: str) -> None:
    """Khi nghi phạm khai thật, lời khai then chốt tự ghi vào sổ tay."""
    text = reply.lower()
    for clue in clues:
        if (
            clue.get("source") == "testimony"
            and clue.get("suspect") == suspect_id
            and clue["id"] not in session["clues"]
            and any(kw.lower() in text for kw in clue.get("keywords", []))
        ):
            session["clues"].append(clue["id"])


app = FastAPI(title="Script Lorebook Mystery")


class ChatRequest(BaseModel):
    session_id: str
    suspect_id: str
    message: str


class AccuseRequest(BaseModel):
    session_id: str
    suspect_id: str


class ResetRequest(BaseModel):
    session_id: str


class ExamineRequest(BaseModel):
    session_id: str
    location_id: str


@app.get("/api/state")
def get_state(session_id: str):
    """Toàn bộ thông tin công khai + tiến trình của session (để khôi phục khi F5)."""
    session = get_session(session_id)
    return {
        "title": scenario["title"],
        "intro": scenario["intro"],
        "suspects": [{"id": c["id"], "name": c["name"], "role": c["role"]} for c in characters],
        "locations": [{"id": l["id"], "name": l["name"]} for l in locations],
        "clues": found_clues(session),
        "histories": session["histories"],
        "result": session["result"],
    }


@app.get("/api/clues")
def get_clues(session_id: str):
    return {"clues": found_clues(get_session(session_id))}


@app.post("/api/examine")
def examine(req: ExamineRequest):
    location = location_by_id.get(req.location_id)
    if not location:
        raise HTTPException(404, "Không có địa điểm này")
    session = get_session(req.session_id)
    if session["result"]:
        raise HTTPException(409, "Vụ án đã khép lại. Hãy chơi lại để tiếp tục.")

    # Chốt danh sách manh mối TRƯỚC lượt khám này: manh mối ẩn (requires)
    # chỉ lộ ra ở lượt khám sau, khi người chơi đã có manh mối tiên quyết.
    clues_before = set(session["clues"])
    newly_found = []
    for clue in clues:
        if clue.get("source") != "scene" or clue.get("location") != req.location_id:
            continue
        if clue["id"] in clues_before:
            continue
        if any(req_id not in clues_before for req_id in clue.get("requires", [])):
            continue
        session["clues"].append(clue["id"])
        newly_found.append(public_clue(clue))

    return {
        "location_name": location["name"],
        "narrative": location["desc"],
        "found": newly_found,
    }


@app.post("/api/chat")
def chat(req: ChatRequest):
    suspect = char_by_id.get(req.suspect_id)
    if not suspect:
        raise HTTPException(404, "Không tìm thấy nghi phạm")
    session = get_session(req.session_id)
    if session["result"]:
        raise HTTPException(409, "Vụ án đã khép lại. Hãy chơi lại để tiếp tục.")

    history = session["histories"].setdefault(req.suspect_id, [])
    history.append({"role": "user", "content": req.message})

    active_lore = find_active_entries(lore_entries, history, SCAN_DEPTH) if lore_entries else []
    system_prompt = build_suspect_prompt(scenario, suspect, active_lore)
    messages = [{"role": "system", "content": system_prompt}] + history

    def generate():
        parts: list[str] = []
        try:
            stream = client.chat.completions.create(model=model, messages=messages, stream=True)
            for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    parts.append(delta)
                    yield delta
        except Exception as exc:  # noqa: BLE001 - báo lỗi API về client
            yield f"\n[Lỗi khi gọi API: {exc}]"
        finally:
            if parts:
                reply = "".join(parts)
                history.append({"role": "assistant", "content": reply})
                unlock_testimony_clues(session, req.suspect_id, reply)
            else:
                history.pop()  # API hỏng hoàn toàn -> bỏ lượt hỏi để thử lại

    return StreamingResponse(generate(), media_type="text/plain; charset=utf-8")


@app.post("/api/accuse")
def accuse(req: AccuseRequest):
    accused = char_by_id.get(req.suspect_id)
    if not accused:
        raise HTTPException(404, "Không tìm thấy nghi phạm")
    session = get_session(req.session_id)
    if session["result"]:
        raise HTTPException(409, "Bạn đã buộc tội rồi - chỉ được một lần.")

    killer = char_by_id[scenario["killer"]]
    result = {
        "correct": accused["id"] == scenario["killer"],
        "accused_name": accused["name"],
        "killer_name": killer["name"],
        "truth": scenario["truth"],
    }
    session["result"] = result
    return result


@app.post("/api/reset")
def reset(req: ResetRequest):
    sessions[req.session_id] = {"histories": {}, "result": None, "clues": []}
    return {"ok": True}


app.mount("/", StaticFiles(directory="web", html=True), name="web")


if __name__ == "__main__":
    # 0.0.0.0 = chấp nhận kết nối từ máy khác trong mạng LAN
    uvicorn.run(app, host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "8000")))
