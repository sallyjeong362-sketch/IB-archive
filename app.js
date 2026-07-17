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

let app, auth, db, storage, currentUser = null;
let posts = []; // cached posts from Firestore, newest first
let unsubComments = null;
let activeDetailPostId = null;
let linkRowCount = 0;

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
  ["setupScreen", "nameScreen", "app"].forEach((s) => { $(s).hidden = s !== id; });
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

// ---------- bootstrap ----------

function boot() {
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
  subscribeToPosts();
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

// ---------- posts: list & filter ----------

function subscribeToPosts() {
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $("loadingNote").hidden = true;
    populateSubjectFilter();
    renderPostList();
    if (activeDetailPostId) {
      const p = posts.find((x) => x.id === activeDetailPostId);
      if (p) renderDetail(p);
    }
  }, (err) => {
    console.error(err);
    $("loadingNote").hidden = true;
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

  const filtered = posts.filter((p) => {
    if (subject && !(p.tags || []).includes(subject)) return false;
    if (!search) return true;
    const haystack = [p.title, p.lessonText, p.actionDescription, ...(p.tags || [])].join(" ").toLowerCase();
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

  return `
    <div class="post-card" data-id="${p.id}">
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

async function uploadFileList(fileList, postId) {
  const files = [...fileList];
  const results = [];
  for (const file of files) {
    const path = `uploads/${postId}/${Date.now()}_${file.name}`;
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
    const newDocRef = doc(collection(db, "posts"));

    const [files, images] = await Promise.all([
      uploadFileList($("fileInput").files, newDocRef.id),
      uploadFileList($("imageInput").files, newDocRef.id),
    ]);

    const linksWithType = links.map((l) => {
      const yid = extractYoutubeId(l.url);
      return { url: l.url, label: l.label || "", type: yid ? "youtube" : "link", youtubeId: yid || null };
    });

    await setDoc(newDocRef, {
      title,
      tags,
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
  const q = query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"));
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
    await deleteDoc(doc(db, "posts", p.id));
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
    await deleteDoc(doc(db, "posts", postId, "comments", commentId));
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
    await addDoc(collection(db, "posts", activeDetailPostId, "comments"), {
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
