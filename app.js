import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, setDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const CONFIG_KEY = "ibArchiveFirebaseConfig";
const NAME_KEY = "ibArchiveTeacherName";

// IB PYP Programme of Inquiry taxonomy
const UOI_UNITS = [
  { key: "who-we-are", name: "Who We Are", color: "#E0812F" },
  { key: "how-we-express-ourselves", name: "How We Express Ourselves", color: "#D6247A" },
  { key: "how-we-organise-ourselves", name: "How We Organise Ourselves", color: "#1FA6A0" },
  { key: "how-the-world-works", name: "How the World Works", color: "#2E9FD6" },
  { key: "sharing-the-planet", name: "Sharing the Planet", color: "#7CB342" },
  { key: "where-we-are-in-place-and-time", name: "Where We Are in Place and Time", color: "#5E3A87" },
];
const UOI_CATEGORIES = [
  { key: "central-idea", name: "Central Idea" },
  { key: "specified-concepts", name: "Specified Concepts" },
  { key: "additional-concepts", name: "Additional Concepts" },
  { key: "atl-skills", name: "ATL Skills & Sub-skills" },
  { key: "learner-profile-attributes", name: "Learner Profile Attributes" },
  { key: "language-focus", name: "Language Focus" },
];
const LEARNER_PROFILE = [
  { key: "inquirers", name: "Inquirers (탐구하는 사람)" },
  { key: "knowledgeable", name: "Knowledgeable (지식이 풍부한 사람)" },
  { key: "thinkers", name: "Thinkers (생각하는 사람)" },
  { key: "communicators", name: "Communicators (소통하는 사람)" },
  { key: "principled", name: "Principled (원칙을 지키는 사람)" },
  { key: "open-minded", name: "Open-minded (열린 마음을 지닌 사람)" },
  { key: "caring", name: "Caring (배려하는 사람)" },
  { key: "risk-takers", name: "Risk-takers (도전하는 사람)" },
  { key: "balanced", name: "Balanced (균형 잡힌 사람)" },
  { key: "reflective", name: "Reflective (성찰하는 사람)" },
];
const UOI_BY_KEY = Object.fromEntries(UOI_UNITS.map((u) => [u.key, u]));
const CATEGORY_BY_KEY = Object.fromEntries(UOI_CATEGORIES.map((c) => [c.key, c]));
const PROFILE_BY_KEY = Object.fromEntries(LEARNER_PROFILE.map((p) => [p.key, p]));

let app, auth, db, storage, currentUser = null;

let textbooks = []; // cached top-level textbook docs
let units = [];     // cached units for the currently open textbook
let posts = [];     // cached posts for the currently open unit

let unsubTextbooks = null;
let unsubUnits = null;
let unsubPosts = null;
let unsubComments = null;

let currentTextbookId = null;
let currentTextbookName = "";
let currentUnitId = null;
let currentUnitName = "";

let activeDetailPostId = null;
let linkRowCount = 0;
let selectedUoi = null;

const $ = (id) => document.getElementById(id);

// ---------- utils ----------

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function isSafeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function extractYoutubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2];
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2];
    }
  } catch {
    return null;
  }
  return null;
}

function formatBytes(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)}${units[i]}`;
}

function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { t.hidden = true; }, 2600);
}

function showScreen(id) {
  ["loadingScreen", "setupScreen", "nameScreen", "app"].forEach((s) => { $(s).hidden = s !== id; });
}

// UTF-8 safe base64 helpers, used to embed firebaseConfig in a shareable URL.
function b64EncodeUnicode(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
}
function b64DecodeUnicode(str) {
  return decodeURIComponent(atob(str).split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join(""));
}
function buildShareUrl(config) {
  const encoded = b64EncodeUnicode(JSON.stringify(config));
  return `${location.origin}${location.pathname}#cfg=${encoded}`;
}
function extractConfigFromHash() {
  const m = location.hash.match(/(?:^#|[#&])cfg=([^&]+)/);
  if (!m) return null;
  try {
    return JSON.parse(b64DecodeUnicode(decodeURIComponent(m[1])));
  } catch {
    return null;
  }
}

function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.close));
});
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });
});

// ---------- IB taxonomy pickers (static UI, no Firebase needed) ----------

function renderUoiButtons() {
  $("uoiButtons").innerHTML = UOI_UNITS.map((u) => `
    <button type="button" class="uoi-btn" data-uoi="${u.key}" style="background:${u.color}">${escapeHtml(u.name)}</button>
  `).join("");
  $("uoiButtons").querySelectorAll(".uoi-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.uoi;
      selectedUoi = selectedUoi === key ? null : key;
      $("uoiButtons").querySelectorAll(".uoi-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.uoi === selectedUoi);
      });
    });
  });
}

function renderCategoryChecks() {
  $("categoryChecks").innerHTML = UOI_CATEGORIES.map((c) => `
    <label class="check-item"><input type="checkbox" value="${c.key}">${escapeHtml(c.name)}</label>
  `).join("");
}

function renderProfileChecks() {
  $("profileChecks").innerHTML = LEARNER_PROFILE.map((p) => `
    <label class="check-item"><input type="checkbox" value="${p.key}">${escapeHtml(p.name)}</label>
  `).join("");
}

function renderTaxonomyFilters() {
  $("uoiFilter").innerHTML = '<option value="">전체 탐구단원</option>' +
    UOI_UNITS.map((u) => `<option value="${u.key}">${escapeHtml(u.name)}</option>`).join("");
  $("categoryFilter").innerHTML = '<option value="">전체 영역</option>' +
    UOI_CATEGORIES.map((c) => `<option value="${c.key}">${escapeHtml(c.name)}</option>`).join("");
  $("profileFilter").innerHTML = '<option value="">전체 학습자상</option>' +
    LEARNER_PROFILE.map((p) => `<option value="${p.key}">${escapeHtml(p.name)}</option>`).join("");
}

renderUoiButtons();
renderCategoryChecks();
renderProfileChecks();
renderTaxonomyFilters();

// ---------- bootstrap ----------

function boot() {
  // 공유 링크(#cfg=...)로 들어온 경우: 설정 화면 없이 바로 연결한다.
  const hashConfig = extractConfigFromHash();
  if (hashConfig) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(hashConfig));
    history.replaceState(null, "", location.pathname + location.search);
    initFirebase(hashConfig);
    return;
  }

  const savedConfig = localStorage.getItem(CONFIG_KEY);
  if (!savedConfig) {
    showScreen("setupScreen");
    return;
  }
  try {
    initFirebase(JSON.parse(savedConfig));
  } catch (e) {
    console.error(e);
    showScreen("setupScreen");
    $("setupError").hidden = false;
    $("setupError").textContent = "저장된 설정을 불러오지 못했습니다. 다시 입력해주세요.";
  }
}

function initFirebase(config) {
  app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);

  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      afterAuthReady();
    }
  });

  signInAnonymously(auth).catch((err) => {
    console.error(err);
    showScreen("setupScreen");
    $("setupError").hidden = false;
    $("setupError").textContent = "Firebase 연결에 실패했습니다. 설정값과 Authentication의 익명 로그인 활성화 여부를 확인해주세요. (" + err.code + ")";
  });
}

function afterAuthReady() {
  const name = localStorage.getItem(NAME_KEY);
  if (!name) {
    showScreen("nameScreen");
  } else {
    startApp(name);
  }
}

function startApp(name) {
  $("currentUserName").textContent = "🙋 " + name;
  showScreen("app");
  subscribeTextbooks();
  goToTextbooks();
}

// ---------- setup screen ----------

// Firebase 콘솔이 보여주는 코드는 키에 따옴표가 없는 JS 객체 리터럴이라 JSON.parse가 실패한다.
// import/const/initializeApp 같은 나머지 코드가 섞여 붙여넣어져도 동작하도록, 코드 안의 모든
// 최상위 { ... } 블록을 찾아 apiKey가 들어있는 블록(= firebaseConfig 객체)을 골라낸다.
function extractBracedObject(text) {
  const blocks = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 1, j = i + 1;
    for (; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") { depth--; if (depth === 0) break; }
    }
    if (depth === 0) {
      blocks.push(text.slice(i, j + 1));
      i = j;
    }
  }
  if (blocks.length === 0) return null;
  return blocks.find((b) => b.includes("apiKey")) || blocks.reduce((a, b) => (b.length > a.length ? b : a));
}

function parseFirebaseConfigInput(raw) {
  const objText = extractBracedObject(raw) || raw;
  try {
    return JSON.parse(objText);
  } catch {
    // fall through to JS object literal parsing below
  }
  // Safe here: this only evaluates the current user's own pasted input, in their own browser.
  return new Function("return (" + objText + ")")();
}

$("saveConfigBtn").addEventListener("click", () => {
  const raw = $("configInput").value.trim();
  $("setupError").hidden = true;
  if (!raw) {
    $("setupError").hidden = false;
    $("setupError").textContent = "firebaseConfig 값을 붙여넣어주세요.";
    return;
  }
  let parsed;
  try {
    parsed = parseFirebaseConfigInput(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("empty");
  } catch {
    $("setupError").hidden = false;
    $("setupError").textContent = "firebaseConfig 값을 해석하지 못했습니다. Firebase 콘솔에서 복사한 코드를 그대로 붙여넣어주세요.";
    return;
  }
  const required = ["apiKey", "authDomain", "projectId", "storageBucket", "appId"];
  const missing = required.filter((k) => !parsed[k]);
  if (missing.length) {
    $("setupError").hidden = false;
    $("setupError").textContent = "다음 항목이 없습니다: " + missing.join(", ");
    return;
  }
  localStorage.setItem(CONFIG_KEY, JSON.stringify(parsed));
  initFirebase(parsed);
});

$("changeConfigBtn").addEventListener("click", () => {
  if (confirm("Firebase 연결 설정을 변경하시겠습니까? 다시 설정 화면으로 이동합니다.")) {
    localStorage.removeItem(CONFIG_KEY);
    location.reload();
  }
});

$("copyShareLinkBtn").addEventListener("click", async () => {
  const savedConfig = localStorage.getItem(CONFIG_KEY);
  if (!savedConfig) return;
  const url = buildShareUrl(JSON.parse(savedConfig));
  try {
    await navigator.clipboard.writeText(url);
    showToast("공유 링크가 복사되었습니다. 다른 선생님께 보내주세요.");
  } catch {
    prompt("아래 링크를 복사해서 다른 선생님께 보내주세요:", url);
  }
});

// ---------- name screen ----------

$("saveNameBtn").addEventListener("click", () => {
  const name = $("nameInput").value.trim();
  $("nameError").hidden = true;
  if (!name) {
    $("nameError").hidden = false;
    $("nameError").textContent = "이름을 입력해주세요.";
    return;
  }
  localStorage.setItem(NAME_KEY, name);
  startApp(name);
});

$("changeNameBtn").addEventListener("click", () => {
  const name = prompt("새 이름/별명을 입력해주세요.", localStorage.getItem(NAME_KEY) || "");
  if (name && name.trim()) {
    localStorage.setItem(NAME_KEY, name.trim());
    $("currentUserName").textContent = "🙋 " + name.trim();
  }
});

// ---------- navigation: textbooks > units > posts ----------

function showLevel(level) {
  ["textbookView", "unitView", "postView"].forEach((id) => { $(id).hidden = id !== level; });
}

function renderBreadcrumb() {
  if (!currentTextbookId) {
    $("breadcrumb").innerHTML = "";
    return;
  }
  const parts = ['<a href="#" data-nav="textbooks">🏠 전체 교재</a>'];
  if (currentUnitId) {
    parts.push(`<a href="#" data-nav="units">📘 ${escapeHtml(currentTextbookName)}</a>`);
    parts.push(`<span>📂 ${escapeHtml(currentUnitName)}</span>`);
  } else {
    parts.push(`<span>📘 ${escapeHtml(currentTextbookName)}</span>`);
  }
  $("breadcrumb").innerHTML = parts.join(' <span class="crumb-sep">›</span> ');
  $("breadcrumb").querySelectorAll("[data-nav]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (a.dataset.nav === "textbooks") goToTextbooks();
      else if (a.dataset.nav === "units") goToUnits();
    });
  });
}

function goToTextbooks() {
  currentTextbookId = null;
  currentTextbookName = "";
  currentUnitId = null;
  currentUnitName = "";
  if (unsubUnits) { unsubUnits(); unsubUnits = null; }
  if (unsubPosts) { unsubPosts(); unsubPosts = null; }
  renderBreadcrumb();
  showLevel("textbookView");
}

function goToUnits() {
  currentUnitId = null;
  currentUnitName = "";
  if (unsubPosts) { unsubPosts(); unsubPosts = null; }
  renderBreadcrumb();
  showLevel("unitView");
}

function openTextbook(id) {
  const t = textbooks.find((x) => x.id === id);
  if (!t) return;
  currentTextbookId = id;
  currentTextbookName = t.name;
  currentUnitId = null;
  currentUnitName = "";
  renderBreadcrumb();
  showLevel("unitView");
  subscribeUnits();
}

function openUnit(id) {
  const u = units.find((x) => x.id === id);
  if (!u) return;
  currentUnitId = id;
  currentUnitName = u.name;
  renderBreadcrumb();
  showLevel("postView");
  subscribeToPosts();
}

// ---------- textbooks ----------

function subscribeTextbooks() {
  const q = query(collection(db, "textbooks"), orderBy("createdAt", "desc"));
  unsubTextbooks = onSnapshot(q, (snap) => {
    textbooks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $("textbookLoadingNote").hidden = true;
    renderTextbookList();
  }, (err) => {
    console.error(err);
    $("textbookLoadingNote").hidden = true;
    showToast("교재를 불러오지 못했습니다: " + err.message);
  });
}

function renderTextbookList() {
  const search = $("textbookSearchInput").value.trim().toLowerCase();
  const filtered = search
    ? textbooks.filter((t) => (t.name || "").toLowerCase().includes(search))
    : textbooks;

  $("textbookEmptyNote").hidden = textbooks.length !== 0;
  $("textbookNoMatchNote").hidden = !(textbooks.length !== 0 && search && filtered.length === 0);
  $("textbookList").innerHTML = filtered.map(renderTextbookCard).join("");
  document.querySelectorAll(".textbook-card").forEach((card) => {
    card.addEventListener("click", () => openTextbook(card.dataset.id));
  });
}
$("textbookSearchInput").addEventListener("input", renderTextbookList);

function renderTextbookCard(t) {
  const cover = t.coverUrl
    ? `<img class="textbook-cover" src="${escapeHtml(t.coverUrl)}" alt="${escapeHtml(t.name)}">`
    : `<div class="textbook-cover textbook-cover-empty">📘</div>`;
  return `
    <div class="textbook-card" data-id="${t.id}">
      ${cover}
      <h3>${escapeHtml(t.name)}</h3>
      <p class="card-meta">${escapeHtml(t.authorName || "익명")} · ${formatDate(t.createdAt)}</p>
    </div>`;
}

$("newTextbookBtn").addEventListener("click", () => {
  $("textbookName").value = "";
  $("textbookCoverInput").value = "";
  $("textbookError").hidden = true;
  openModal("newTextbookModal");
});

$("submitTextbookBtn").addEventListener("click", async () => {
  const name = $("textbookName").value.trim();
  $("textbookError").hidden = true;
  if (!name) {
    $("textbookError").hidden = false;
    $("textbookError").textContent = "교재 이름을 입력해주세요.";
    return;
  }
  const btn = $("submitTextbookBtn");
  btn.disabled = true;
  btn.textContent = "등록 중...";
  try {
    const newRef = doc(collection(db, "textbooks"));
    let coverUrl = null, coverPath = null;
    const coverFile = $("textbookCoverInput").files[0];
    if (coverFile) {
      coverPath = `textbook-covers/${newRef.id}/${Date.now()}_${coverFile.name}`;
      const coverRef = ref(storage, coverPath);
      await uploadBytes(coverRef, coverFile);
      coverUrl = await getDownloadURL(coverRef);
    }
    await setDoc(newRef, {
      name,
      coverUrl,
      coverPath,
      authorName: localStorage.getItem(NAME_KEY) || "익명",
      authorUid: currentUser.uid,
      createdAt: serverTimestamp(),
    });
    closeModal("newTextbookModal");
    showToast("교재가 등록되었습니다.");
  } catch (err) {
    console.error(err);
    $("textbookError").hidden = false;
    $("textbookError").textContent = "등록 중 오류가 발생했습니다: " + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "등록하기";
  }
});

// ---------- units ----------

function subscribeUnits() {
  if (unsubUnits) { unsubUnits(); unsubUnits = null; }
  const q = query(collection(db, "textbooks", currentTextbookId, "units"), orderBy("createdAt", "asc"));
  unsubUnits = onSnapshot(q, (snap) => {
    units = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderUnitList();
  }, (err) => {
    console.error(err);
    showToast("유닛을 불러오지 못했습니다: " + err.message);
  });
}

function renderUnitList() {
  $("unitEmptyNote").hidden = units.length !== 0;
  $("unitList").innerHTML = units.map(renderUnitCard).join("");
  document.querySelectorAll(".unit-card").forEach((card) => {
    card.addEventListener("click", () => openUnit(card.dataset.id));
  });
}

function renderUnitCard(u) {
  return `
    <div class="unit-card" data-id="${u.id}">
      <h3>📂 ${escapeHtml(u.name)}</h3>
      <p class="card-meta">${escapeHtml(u.authorName || "익명")} · ${formatDate(u.createdAt)}</p>
    </div>`;
}

$("newUnitBtn").addEventListener("click", () => {
  $("unitName").value = "";
  $("unitError").hidden = true;
  openModal("newUnitModal");
});

$("submitUnitBtn").addEventListener("click", async () => {
  const name = $("unitName").value.trim();
  $("unitError").hidden = true;
  if (!name) {
    $("unitError").hidden = false;
    $("unitError").textContent = "유닛 이름을 입력해주세요.";
    return;
  }
  const btn = $("submitUnitBtn");
  btn.disabled = true;
  try {
    await addDoc(collection(db, "textbooks", currentTextbookId, "units"), {
      name,
      authorName: localStorage.getItem(NAME_KEY) || "익명",
      authorUid: currentUser.uid,
      createdAt: serverTimestamp(),
    });
    closeModal("newUnitModal");
    showToast("유닛이 추가되었습니다.");
  } catch (err) {
    console.error(err);
    $("unitError").hidden = false;
    $("unitError").textContent = "추가 중 오류가 발생했습니다: " + err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------- posts: list & filter (scoped to the current unit) ----------

function currentPostsCollection() {
  return collection(db, "textbooks", currentTextbookId, "units", currentUnitId, "posts");
}

function currentPostDoc(postId) {
  return doc(db, "textbooks", currentTextbookId, "units", currentUnitId, "posts", postId);
}

function subscribeToPosts() {
  if (unsubPosts) { unsubPosts(); unsubPosts = null; }
  const q = query(currentPostsCollection(), orderBy("createdAt", "desc"));
  unsubPosts = onSnapshot(q, (snap) => {
    posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    populateSubjectFilter();
    renderPostList();
    if (activeDetailPostId) {
      const p = posts.find((x) => x.id === activeDetailPostId);
      if (p) renderDetail(p);
    }
  }, (err) => {
    console.error(err);
    showToast("자료를 불러오지 못했습니다: " + err.message);
  });
}

function populateSubjectFilter() {
  const tags = new Set();
  posts.forEach((p) => (p.tags || []).forEach((t) => tags.add(t)));
  const sel = $("subjectFilter");
  const current = sel.value;
  sel.innerHTML = '<option value="">전체 과목/태그</option>' +
    [...tags].sort().map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  sel.value = current;
}

function renderPostList() {
  const search = $("searchInput").value.trim().toLowerCase();
  const subject = $("subjectFilter").value;
  const uoi = $("uoiFilter").value;
  const category = $("categoryFilter").value;
  const profile = $("profileFilter").value;

  const filtered = posts.filter((p) => {
    if (subject && !(p.tags || []).includes(subject)) return false;
    if (uoi && p.uoi !== uoi) return false;
    if (category && !(p.categories || []).includes(category)) return false;
    if (profile && !(p.learnerProfile || []).includes(profile)) return false;
    if (!search) return true;
    const haystack = [
      p.title, p.lessonText, p.actionDescription, ...(p.tags || []),
      p.uoi ? UOI_BY_KEY[p.uoi]?.name : "",
      ...(p.categories || []).map((k) => CATEGORY_BY_KEY[k]?.name || ""),
      ...(p.learnerProfile || []).map((k) => PROFILE_BY_KEY[k]?.name || ""),
    ].join(" ").toLowerCase();
    return haystack.includes(search);
  });

  $("emptyNote").hidden = filtered.length !== 0;
  $("postList").innerHTML = filtered.map(renderPostCard).join("");

  document.querySelectorAll(".post-card").forEach((card) => {
    card.addEventListener("click", () => openDetail(card.dataset.id));
  });
}

function renderPostCard(p) {
  const preview = (p.lessonText || p.actionDescription || "").slice(0, 90);
  const tags = (p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
  const fileCount = (p.files || []).length;
  const imgCount = (p.images || []).length;
  const linkCount = (p.links || []).length;
  const badges = [
    fileCount ? `📎 ${fileCount}` : "",
    imgCount ? `🖼️ ${imgCount}` : "",
    linkCount ? `🔗 ${linkCount}` : "",
  ].filter(Boolean).join("  ");
  const uoi = p.uoi ? UOI_BY_KEY[p.uoi] : null;
  const uoiPill = uoi ? `<div class="post-uoi"><span class="uoi-pill" style="background:${uoi.color}">${escapeHtml(uoi.name)}</span></div>` : "";

  return `
    <div class="post-card" data-id="${p.id}">
      ${uoiPill}
      <h3>${escapeHtml(p.title)}</h3>
      ${tags ? `<div class="post-tags">${tags}</div>` : ""}
      <p class="post-preview">${escapeHtml(preview)}</p>
      <div class="post-meta">
        <span>${escapeHtml(p.authorName || "익명")} · ${formatDate(p.createdAt)}</span>
        <span class="post-badges">${badges}</span>
      </div>
    </div>`;
}

$("searchInput").addEventListener("input", renderPostList);
$("subjectFilter").addEventListener("change", renderPostList);
$("uoiFilter").addEventListener("change", renderPostList);
$("categoryFilter").addEventListener("change", renderPostList);
$("profileFilter").addEventListener("change", renderPostList);

// ---------- new post ----------

$("newPostBtn").addEventListener("click", () => {
  $("postTitle").value = "";
  $("postTags").value = "";
  $("postText").value = "";
  $("postAction").value = "";
  $("fileInput").value = "";
  $("imageInput").value = "";
  $("linkRows").innerHTML = "";
  linkRowCount = 0;
  selectedUoi = null;
  $("uoiButtons").querySelectorAll(".uoi-btn").forEach((b) => b.classList.remove("active"));
  $("categoryChecks").querySelectorAll("input[type=checkbox]").forEach((c) => { c.checked = false; });
  $("profileChecks").querySelectorAll("input[type=checkbox]").forEach((c) => { c.checked = false; });
  $("postError").hidden = true;
  addLinkRow();
  openModal("newPostModal");
});

function addLinkRow() {
  const id = "link_" + (linkRowCount++);
  const row = document.createElement("div");
  row.className = "link-row";
  row.dataset.rowId = id;
  row.innerHTML = `
    <input type="text" class="link-label" placeholder="링크 이름 (예: 참고 영상)">
    <input type="text" class="link-url" placeholder="https://...">
    <button type="button" class="btn small remove-link">삭제</button>`;
  row.querySelector(".remove-link").addEventListener("click", () => row.remove());
  $("linkRows").appendChild(row);
}
$("addLinkBtn").addEventListener("click", addLinkRow);

function collectLinks() {
  return [...document.querySelectorAll("#linkRows .link-row")].map((row) => {
    const url = row.querySelector(".link-url").value.trim();
    const label = row.querySelector(".link-label").value.trim();
    return { url, label };
  }).filter((l) => l.url);
}

function collectCheckedValues(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[type=checkbox]:checked`)].map((c) => c.value);
}

async function uploadFileList(fileList, pathPrefix) {
  const files = [...fileList];
  const results = [];
  for (const file of files) {
    const path = `${pathPrefix}/${Date.now()}_${file.name}`;
    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    results.push({ name: file.name, url, path, size: file.size, type: file.type });
  }
  return results;
}

$("submitPostBtn").addEventListener("click", async () => {
  const title = $("postTitle").value.trim();
  $("postError").hidden = true;
  if (!title) {
    $("postError").hidden = false;
    $("postError").textContent = "제목을 입력해주세요.";
    return;
  }
  const links = collectLinks();
  const badLink = links.find((l) => !isSafeUrl(l.url));
  if (badLink) {
    $("postError").hidden = false;
    $("postError").textContent = "링크는 http(s):// 로 시작하는 올바른 주소여야 합니다: " + badLink.url;
    return;
  }

  const submitBtn = $("submitPostBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "업로드 중...";

  try {
    const tags = $("postTags").value.split(",").map((t) => t.trim()).filter(Boolean);
    // Use a client-generated doc id up front so uploaded files can be grouped under it.
    const newDocRef = doc(currentPostsCollection());
    const pathPrefix = `uploads/${currentTextbookId}/${currentUnitId}/${newDocRef.id}`;

    const [files, images] = await Promise.all([
      uploadFileList($("fileInput").files, pathPrefix),
      uploadFileList($("imageInput").files, pathPrefix),
    ]);

    const linksWithType = links.map((l) => {
      const yid = extractYoutubeId(l.url);
      return { url: l.url, label: l.label || "", type: yid ? "youtube" : "link", youtubeId: yid || null };
    });

    await setDoc(newDocRef, {
      title,
      tags,
      uoi: selectedUoi,
      categories: collectCheckedValues("categoryChecks"),
      learnerProfile: collectCheckedValues("profileChecks"),
      lessonText: $("postText").value.trim(),
      actionDescription: $("postAction").value.trim(),
      files,
      images,
      links: linksWithType,
      authorName: localStorage.getItem(NAME_KEY) || "익명",
      authorUid: currentUser.uid,
      createdAt: serverTimestamp(),
    });

    closeModal("newPostModal");
    showToast("자료가 등록되었습니다.");
  } catch (err) {
    console.error(err);
    $("postError").hidden = false;
    $("postError").textContent = "등록 중 오류가 발생했습니다: " + err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "등록하기";
  }
});

// ---------- detail + comments ----------

function openDetail(postId) {
  const p = posts.find((x) => x.id === postId);
  if (!p) return;
  activeDetailPostId = postId;
  renderDetail(p);
  openModal("detailModal");

  if (unsubComments) unsubComments();
  const q = query(collection(currentPostDoc(postId), "comments"), orderBy("createdAt", "asc"));
  unsubComments = onSnapshot(q, (snap) => {
    const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderComments(postId, comments);
  });
}

document.getElementById("detailModal").addEventListener("click", (e) => {
  if (e.target.closest('[data-close="detailModal"]') || e.target === $("detailModal")) {
    if (unsubComments) { unsubComments(); unsubComments = null; }
    activeDetailPostId = null;
  }
});

function renderDetail(p) {
  $("detailTitle").textContent = p.title;
  $("detailMeta").textContent = `${p.authorName || "익명"} · ${formatDate(p.createdAt)}`;
  $("detailTags").innerHTML = (p.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");

  const uoi = p.uoi ? UOI_BY_KEY[p.uoi] : null;
  $("detailUoi").innerHTML = uoi ? `<span class="uoi-pill" style="background:${uoi.color}">${escapeHtml(uoi.name)}</span>` : "";

  const categories = p.categories || [];
  $("detailCategoryBlock").hidden = categories.length === 0;
  $("detailCategories").innerHTML = categories.map((k) =>
    `<span class="tag">${escapeHtml(CATEGORY_BY_KEY[k]?.name || k)}</span>`).join("");

  const learnerProfile = p.learnerProfile || [];
  $("detailProfileBlock").hidden = learnerProfile.length === 0;
  $("detailProfiles").innerHTML = learnerProfile.map((k) =>
    `<span class="tag">${escapeHtml(PROFILE_BY_KEY[k]?.name || k)}</span>`).join("");

  $("detailTextBlock").hidden = !p.lessonText;
  $("detailText").textContent = p.lessonText || "";

  $("detailActionBlock").hidden = !p.actionDescription;
  $("detailAction").textContent = p.actionDescription || "";

  const files = p.files || [];
  $("detailFilesBlock").hidden = files.length === 0;
  $("detailFiles").innerHTML = files.map((f) => `
    <li><a href="${escapeHtml(f.url)}" target="_blank" rel="noopener">📎 ${escapeHtml(f.name)}<span class="file-size">${formatBytes(f.size)}</span></a></li>
  `).join("");

  const images = p.images || [];
  $("detailImagesBlock").hidden = images.length === 0;
  $("detailImages").innerHTML = images.map((img) => `
    <a href="${escapeHtml(img.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.name)}"></a>
  `).join("");

  const links = p.links || [];
  $("detailLinksBlock").hidden = links.length === 0;
  $("detailLinks").innerHTML = links.map((l) => {
    if (l.type === "youtube" && l.youtubeId) {
      return `
        <div class="link-card">
          <div class="youtube-embed"><iframe src="https://www.youtube.com/embed/${encodeURIComponent(l.youtubeId)}" allowfullscreen title="youtube"></iframe></div>
          <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label || l.url)}</a>
        </div>`;
    }
    return `<div class="link-card">🔗 <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label || l.url)}</a></div>`;
  }).join("");

  const ownerActions = $("detailOwnerActions");
  ownerActions.hidden = !(currentUser && p.authorUid === currentUser.uid);
  $("deletePostBtn").onclick = () => deletePost(p);
}

async function deletePost(p) {
  if (!confirm("이 자료를 삭제하시겠습니까? 첨부된 파일과 댓글도 함께 삭제됩니다.")) return;
  try {
    await Promise.all([...(p.files || []), ...(p.images || [])].map((f) =>
      deleteObject(ref(storage, f.path)).catch(() => {})
    ));
    await deleteDoc(currentPostDoc(p.id));
    closeModal("detailModal");
    showToast("삭제되었습니다.");
  } catch (err) {
    console.error(err);
    showToast("삭제 중 오류가 발생했습니다: " + err.message);
  }
}

function renderComments(postId, comments) {
  if (postId !== activeDetailPostId) return;
  if (comments.length === 0) {
    $("commentList").innerHTML = '<p class="no-comments">아직 댓글이 없습니다. 첫 댓글을 남겨보세요!</p>';
    return;
  }
  $("commentList").innerHTML = comments.map((c) => `
    <div class="comment" data-id="${c.id}">
      <div class="comment-head">
        <span class="comment-author">${escapeHtml(c.authorName || "익명")}</span>
        <span class="comment-time">${formatDate(c.createdAt)}</span>
      </div>
      <p class="comment-text">${escapeHtml(c.text)}</p>
      ${currentUser && c.authorUid === currentUser.uid ? `<button class="comment-delete" data-comment-id="${c.id}">삭제</button>` : ""}
    </div>
  `).join("");

  $("commentList").querySelectorAll(".comment-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteComment(postId, btn.dataset.commentId));
  });
}

async function deleteComment(postId, commentId) {
  if (!confirm("댓글을 삭제하시겠습니까?")) return;
  try {
    await deleteDoc(doc(collection(currentPostDoc(postId), "comments"), commentId));
  } catch (err) {
    console.error(err);
    showToast("댓글 삭제 중 오류가 발생했습니다.");
  }
}

$("submitCommentBtn").addEventListener("click", async () => {
  const text = $("commentInput").value.trim();
  if (!text || !activeDetailPostId) return;
  const btn = $("submitCommentBtn");
  btn.disabled = true;
  try {
    await addDoc(collection(currentPostDoc(activeDetailPostId), "comments"), {
      text,
      authorName: localStorage.getItem(NAME_KEY) || "익명",
      authorUid: currentUser.uid,
      createdAt: serverTimestamp(),
    });
    $("commentInput").value = "";
  } catch (err) {
    console.error(err);
    showToast("댓글 등록 중 오류가 발생했습니다: " + err.message);
  } finally {
    btn.disabled = false;
  }
});

boot();
