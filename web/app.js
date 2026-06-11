"use strict";

// ===== Session =====
// Không dùng crypto.randomUUID() vì nó chỉ có trong secure context
// (HTTPS/localhost) - truy cập qua IP LAN http:// sẽ không có hàm này.
function makeSessionId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
const SID = localStorage.getItem("mystery_sid") || makeSessionId();
localStorage.setItem("mystery_sid", SID);

// ===== State =====
const state = {
  title: "",
  intro: "",
  suspects: [],
  locations: [],   // [{id, name}]
  clues: [],       // manh mối đã tìm thấy [{id, name, desc, source}]
  histories: {},   // suspect_id -> [{role, content}]
  result: null,    // {correct, accused_name, killer_name, truth}
  current: null,   // suspect_id đang thẩm vấn
  sending: false,
  accuseChoice: null,
};

// ===== DOM =====
const $ = (sel) => document.querySelector(sel);
const chatEl = $("#chat");
const inputEl = $("#msg-input");
const sendBtn = $("#btn-send");
const suspectListEl = $("#suspect-list");
const bannerEl = $("#gameover-banner");

// ===== Helpers =====
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// *hành động* -> in nghiêng
function formatContent(s) {
  return escapeHtml(s).replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

function initials(name) {
  const words = name.trim().split(/\s+/);
  return words.length === 1
    ? words[0].slice(0, 2).toUpperCase()
    : (words[words.length - 2][0] + words[words.length - 1][0]).toUpperCase();
}

function suspectById(id) {
  return state.suspects.find((s) => s.id === id);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

function toast(html) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = html;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ===== Render =====
function renderSuspects() {
  suspectListEl.innerHTML = "";
  for (const s of state.suspects) {
    const card = document.createElement("div");
    card.className = "suspect-card" + (state.current === s.id ? " active" : "");
    card.innerHTML = `
      <div class="avatar">${initials(s.name)}</div>
      <div class="suspect-info">
        <div class="suspect-name">${escapeHtml(s.name)}</div>
        <div class="suspect-role">${escapeHtml(s.role)}</div>
      </div>`;
    card.addEventListener("click", () => selectSuspect(s.id));
    suspectListEl.appendChild(card);
  }
}

function appendMessage(role, name, content) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "user" ? "user" : "suspect");
  wrap.innerHTML = `
    <div class="who">${escapeHtml(role === "user" ? "Quan điều tra" : name)}</div>
    <div class="bubble">${formatContent(content)}</div>`;
  chatEl.appendChild(wrap);
  chatEl.scrollTop = chatEl.scrollHeight;
  return wrap.querySelector(".bubble");
}

function renderCaseFile() {
  chatEl.innerHTML = `
    <div class="case-file">
      <h2>${escapeHtml(state.title)}</h2>
      <pre>${escapeHtml(state.intro)}</pre>
      <div class="case-cta">Chọn một nghi phạm ở danh sách bên trái để bắt đầu thẩm vấn.</div>
    </div>`;
}

function renderChat() {
  if (!state.current) {
    renderCaseFile();
    return;
  }
  chatEl.innerHTML = "";
  const suspect = suspectById(state.current);
  const history = state.histories[state.current] || [];
  if (history.length === 0) {
    const hint = document.createElement("div");
    hint.className = "case-file";
    hint.innerHTML = `
      <h2>${escapeHtml(suspect.name)}</h2>
      <pre>${escapeHtml(suspect.role)}.\n\nNghi phạm đang ngồi trước mặt bạn, chờ câu hỏi đầu tiên.</pre>`;
    chatEl.appendChild(hint);
  }
  for (const msg of history) {
    appendMessage(msg.role === "user" ? "user" : "suspect", suspect.name, msg.content);
  }
}

function renderGameOver() {
  if (!state.result) {
    bannerEl.classList.add("hidden");
    updateComposer();
    return;
  }
  const r = state.result;
  bannerEl.classList.remove("hidden");
  bannerEl.classList.toggle("win", r.correct);
  bannerEl.classList.toggle("lose", !r.correct);
  bannerEl.textContent = r.correct
    ? `Vụ án đã khép lại - bạn buộc tội đúng ${r.killer_name}. Tài suy luận đáng nể!`
    : `Vụ án đã khép lại - ${r.accused_name} vô tội, hung thủ thật sự là ${r.killer_name}.`;
  updateComposer();
}

function renderNotebook() {
  const locList = $("#location-list");
  locList.innerHTML = "";
  for (const loc of state.locations) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "location-btn";
    btn.textContent = loc.name;
    btn.addEventListener("click", () => examineLocation(loc.id));
    locList.appendChild(btn);
  }

  $("#clue-count").textContent = state.clues.length;
  const clueList = $("#clue-list");
  clueList.innerHTML = "";
  if (state.clues.length === 0) {
    clueList.innerHTML = `<p class="clue-empty">Chưa có manh mối nào. Hãy khám xét
      hiện trường và moi lời khai từ các nghi phạm.</p>`;
    return;
  }
  for (const clue of state.clues) {
    const card = document.createElement("div");
    card.className = "clue-card" + (clue.source === "testimony" ? " testimony" : "");
    card.innerHTML = `
      <div class="clue-name">${escapeHtml(clue.name)}</div>
      <div class="clue-desc">${escapeHtml(clue.desc.trim())}</div>
      <div class="clue-actions">
        <button type="button" class="clue-present">Đưa ra bằng chứng</button>
      </div>`;
    card.querySelector(".clue-present").addEventListener("click", () => presentClue(clue));
    clueList.appendChild(card);
  }
}

async function refreshClues({ notify = true } = {}) {
  const res = await fetch(`/api/clues?session_id=${encodeURIComponent(SID)}`);
  const data = await res.json();
  const known = new Set(state.clues.map((c) => c.id));
  const fresh = data.clues.filter((c) => !known.has(c.id));
  state.clues = data.clues;
  if (fresh.length > 0) {
    renderNotebook();
    if (notify) {
      for (const c of fresh) toast(`Manh mối mới ghi vào sổ tay: <strong>${escapeHtml(c.name)}</strong>`);
    }
  }
}

async function examineLocation(locationId) {
  if (state.result) {
    toast("Vụ án đã khép lại - không thể khám xét nữa.");
    return;
  }
  try {
    const data = await api("/api/examine", { session_id: SID, location_id: locationId });
    $("#examine-title").textContent = data.location_name;
    $("#examine-narrative").textContent = data.narrative.trim();
    const foundEl = $("#examine-found");
    if (data.found.length > 0) {
      foundEl.innerHTML = data.found
        .map(
          (c) => `
        <div class="examine-clue">
          <div class="clue-name">Manh mối mới: ${escapeHtml(c.name)}</div>
          <div class="clue-desc">${escapeHtml(c.desc.trim())}</div>
        </div>`
        )
        .join("");
    } else {
      foundEl.innerHTML = `<p class="examine-nothing">Bạn xem xét kỹ một lượt nhưng
        không tìm thêm được gì mới. Có lẽ cần manh mối khác để biết phải tìm gì ở đây.</p>`;
    }
    $("#modal-examine").showModal();
    await refreshClues({ notify: false });
    renderNotebook();
  } catch (err) {
    toast("Lỗi khám xét: " + escapeHtml(String(err.message || err)));
  }
}

function presentClue(clue) {
  if (!state.current) {
    toast("Hãy chọn một nghi phạm trước, rồi đưa bằng chứng ra trước mặt họ.");
    return;
  }
  if (state.result || state.sending) return;
  inputEl.value = `*Đưa ra bằng chứng: ${clue.name}* ${clue.desc.trim().replace(/\s+/g, " ")} `;
  $("#notebook").classList.remove("open");
  inputEl.focus();
}

function updateComposer() {
  const locked = !state.current || state.sending || !!state.result;
  inputEl.disabled = locked;
  sendBtn.disabled = locked;
  if (state.result) {
    inputEl.placeholder = "Vụ án đã khép lại. Bấm 'Chơi lại' để mở vụ án mới.";
  } else if (!state.current) {
    inputEl.placeholder = "Chọn một nghi phạm để bắt đầu thẩm vấn...";
  } else {
    inputEl.placeholder = `Đặt câu hỏi cho ${suspectById(state.current).name}...`;
  }
}

// ===== Actions =====
function selectSuspect(id) {
  state.current = id;
  renderSuspects();
  renderChat();
  updateComposer();
  if (!inputEl.disabled) inputEl.focus();
}

async function sendMessage(text) {
  const suspect = suspectById(state.current);
  const history = (state.histories[state.current] ||= []);

  history.push({ role: "user", content: text });
  appendMessage("user", null, text);

  state.sending = true;
  updateComposer();

  const bubble = appendMessage("suspect", suspect.name, "");
  bubble.innerHTML = `<span class="typing">đang suy nghĩ...</span>`;

  let full = "";
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: SID, suspect_id: state.current, message: text }),
    });
    if (!res.ok) throw new Error(await res.text());

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      full += decoder.decode(value, { stream: true });
      bubble.innerHTML = formatContent(full);
      chatEl.scrollTop = chatEl.scrollHeight;
    }
    history.push({ role: "assistant", content: full });
    await refreshClues(); // lời khai then chốt có thể vừa được ghi vào sổ tay
  } catch (err) {
    history.pop(); // server cũng đã bỏ lượt này
    bubble.innerHTML = `<span class="typing">Lỗi: ${escapeHtml(String(err.message || err))}</span>`;
  } finally {
    state.sending = false;
    updateComposer();
    inputEl.focus();
  }
}

// ===== Accuse modal =====
function openAccuseModal() {
  state.accuseChoice = null;
  const list = $("#accuse-list");
  list.innerHTML = "";
  for (const s of state.suspects) {
    const opt = document.createElement("div");
    opt.className = "accuse-option";
    opt.innerHTML = `
      <div class="avatar">${initials(s.name)}</div>
      <div class="suspect-info">
        <div class="suspect-name">${escapeHtml(s.name)}</div>
        <div class="suspect-role">${escapeHtml(s.role)}</div>
      </div>`;
    opt.addEventListener("click", () => {
      state.accuseChoice = s.id;
      list.querySelectorAll(".accuse-option").forEach((el) => el.classList.remove("selected"));
      opt.classList.add("selected");
      $("#btn-confirm-accuse").disabled = false;
    });
    list.appendChild(opt);
  }
  $("#btn-confirm-accuse").disabled = true;
  $("#modal-accuse").showModal();
}

function showResultModal() {
  const r = state.result;
  $("#result-verdict").textContent = r.correct ? "Phá án thành công!" : "Buộc tội sai người...";
  $("#result-summary").innerHTML = r.correct
    ? `Bạn đã vạch trần <strong>${escapeHtml(r.killer_name)}</strong> - chính xác là hung thủ. Công lý được thực thi.`
    : `<strong>${escapeHtml(r.accused_name)}</strong> vô tội. Hung thủ thật sự là <strong>${escapeHtml(r.killer_name)}</strong>, và hắn đã cao chạy xa bay...`;
  $("#result-truth").textContent = r.truth;
  $("#modal-result").showModal();
}

async function confirmAccuse() {
  if (!state.accuseChoice) return;
  $("#btn-confirm-accuse").disabled = true;
  try {
    state.result = await api("/api/accuse", { session_id: SID, suspect_id: state.accuseChoice });
    $("#modal-accuse").close();
    renderGameOver();
    showResultModal();
  } catch (err) {
    alert("Không buộc tội được: " + (err.message || err));
    $("#btn-confirm-accuse").disabled = false;
  }
}

async function resetGame() {
  await api("/api/reset", { session_id: SID });
  state.histories = {};
  state.result = null;
  state.current = null;
  state.clues = [];
  renderSuspects();
  renderChat();
  renderGameOver();
  renderNotebook();
  $("#modal-result").close();
  $("#modal-scene").showModal();
}

// ===== Init =====
async function init() {
  const res = await fetch(`/api/state?session_id=${encodeURIComponent(SID)}`);
  const data = await res.json();
  Object.assign(state, {
    title: data.title,
    intro: data.intro,
    suspects: data.suspects,
    locations: data.locations || [],
    clues: data.clues || [],
    histories: data.histories || {},
    result: data.result,
  });

  document.title = data.title;
  $("#case-title").textContent = data.title;
  $("#scene-text").textContent = data.intro;

  renderSuspects();
  renderChat();
  renderGameOver();
  renderNotebook();

  const firstVisit = !state.result && Object.keys(state.histories).length === 0;
  if (firstVisit) $("#modal-scene").showModal();
  if (state.result) showResultModal();
}

$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text || state.sending || !state.current || state.result) return;
  inputEl.value = "";
  sendMessage(text);
});

$("#btn-scene").addEventListener("click", () => $("#modal-scene").showModal());
$("#btn-notebook").addEventListener("click", () => $("#notebook").classList.toggle("open"));
$("#btn-accuse").addEventListener("click", () => {
  if (state.result) showResultModal();
  else openAccuseModal();
});
$("#btn-reset").addEventListener("click", () => {
  if (confirm("Xóa toàn bộ tiến trình và bắt đầu vụ án mới?")) resetGame();
});
$("#btn-confirm-accuse").addEventListener("click", confirmAccuse);
$("#btn-replay").addEventListener("click", resetGame);

document.querySelectorAll("dialog [data-close]").forEach((btn) => {
  btn.addEventListener("click", () => btn.closest("dialog").close());
});

init().catch((err) => {
  $("#case-title").textContent = "Không tải được vụ án";
  chatEl.innerHTML = `
    <div class="case-file">
      <h2>Lỗi kết nối</h2>
      <pre>Không lấy được dữ liệu vụ án từ server.\n\nChi tiết: ${escapeHtml(String(err.message || err))}\n\nHãy kiểm tra server đang chạy rồi tải lại trang (F5).</pre>
    </div>`;
});
