import { firebaseSettings } from "./config/firebase.js";
import { deleteApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  addDoc,
  collection,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const SETTINGS_STORAGE_KEY = "kpi-ai-app-settings";
const sampleNote = `สัปดาห์นี้ปรับ technical SEO และ schema ให้บทความชุดการเมือง 18 ชิ้น ทำให้คะแนน Yoast ผ่านเกณฑ์มากขึ้น
ร่วมทำ dashboard รายสัปดาห์ให้ทีม editorial ดู CTR, traffic และ AI cite แบบรวมศูนย์ พร้อมสรุป insight ว่าหัวข้อไหนควรขยายต่อ
ช่วยทดสอบและปรับ UX ของ feature บนหน้า homepage ใหม่ โดยลดขั้นตอนการใช้งานจาก 4 step เหลือ 2 step
ทดลอง AI helper สำหรับสรุป related content และเก็บ feedback จากทีมใช้งานเพื่อนำมาปรับปรุงรอบถัดไป
สรุป guideline SEO/GEO/AIO ให้ทีมใช้ต่อ และตอบคำถามเวลาทีมลงบทความ`;

const form = document.getElementById("analysis-form");
const settingsForm = document.getElementById("settings-form");
const submitButton = document.getElementById("submit-btn");
const fillSampleButton = document.getElementById("fill-sample-btn");
const resultCard = document.getElementById("result-card");
const analysisStatus = document.getElementById("analysis-status");
const firebaseStatus = document.getElementById("firebase-status");
const recentEntries = document.getElementById("recent-entries");
const settingsDrawer = document.getElementById("settings-drawer");
const providerBadge = document.getElementById("provider-badge");
const storageBadge = document.getElementById("storage-badge");

let kpiConfig;
let firestore = null;
let firebaseEnabled = false;
let appSettings = loadStoredSettings();

init();

async function init() {
  kpiConfig = await loadKpiConfig();
  renderKpiOverview();
  hydrateSettingsForm();
  applySettingsToUi();
  await setupFirebase();
  await loadRecentEntries();
  wireEvents();
}

function wireEvents() {
  form.addEventListener("submit", handleSubmit);
  settingsForm.addEventListener("submit", handleSaveSettings);
  document.getElementById("open-settings-btn").addEventListener("click", openSettingsDrawer);
  document.getElementById("close-settings-btn").addEventListener("click", closeSettingsDrawer);
  document.getElementById("settings-backdrop").addEventListener("click", closeSettingsDrawer);
  document.getElementById("reset-settings-btn").addEventListener("click", resetSettings);

  fillSampleButton.addEventListener("click", () => {
    document.getElementById("employee-name").value = "สุรกิจ วงศ์สุวรรณ";
    document.getElementById("review-period").value = "Q2 / 2569";
    document.getElementById("metrics").value = "Traffic +18%, AI Cite 87%, Time Spent +9%, Returning Users +11%";
    document.getElementById("work-note").value = sampleNote;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSettingsDrawer();
    }
  });
}

async function loadKpiConfig() {
  const response = await fetch("./data/kpi-config.json");
  if (!response.ok) {
    throw new Error("ไม่สามารถโหลด KPI config ได้");
  }
  return response.json();
}

function loadStoredSettings() {
  const fallback = buildDefaultSettings();

  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    return mergeSettings(fallback, JSON.parse(raw));
  } catch (error) {
    console.error(error);
    return fallback;
  }
}

function buildDefaultSettings() {
  return {
    defaultProvider: "openai",
    openaiApiKey: "",
    geminiApiKey: "",
    firebase: {
      enabled: firebaseSettings.enabled,
      config: { ...firebaseSettings.config }
    }
  };
}

function mergeSettings(base, incoming = {}) {
  return {
    ...base,
    ...incoming,
    firebase: {
      ...base.firebase,
      ...(incoming.firebase || {}),
      config: {
        ...base.firebase.config,
        ...((incoming.firebase || {}).config || {})
      }
    }
  };
}

function hydrateSettingsForm() {
  document.getElementById("settings-default-provider").value = appSettings.defaultProvider || "openai";
  document.getElementById("settings-openai-key").value = appSettings.openaiApiKey || "";
  document.getElementById("settings-gemini-key").value = appSettings.geminiApiKey || "";
  document.getElementById("settings-firebase-enabled").checked = Boolean(appSettings.firebase.enabled);
  document.getElementById("settings-firebase-api-key").value = appSettings.firebase.config.apiKey || "";
  document.getElementById("settings-firebase-auth-domain").value = appSettings.firebase.config.authDomain || "";
  document.getElementById("settings-firebase-project-id").value = appSettings.firebase.config.projectId || "";
  document.getElementById("settings-firebase-storage-bucket").value = appSettings.firebase.config.storageBucket || "";
  document.getElementById("settings-firebase-messaging-sender-id").value = appSettings.firebase.config.messagingSenderId || "";
  document.getElementById("settings-firebase-app-id").value = appSettings.firebase.config.appId || "";
}

function collectSettingsFromForm() {
  return mergeSettings(buildDefaultSettings(), {
    defaultProvider: document.getElementById("settings-default-provider").value,
    openaiApiKey: document.getElementById("settings-openai-key").value.trim(),
    geminiApiKey: document.getElementById("settings-gemini-key").value.trim(),
    firebase: {
      enabled: document.getElementById("settings-firebase-enabled").checked,
      config: {
        apiKey: document.getElementById("settings-firebase-api-key").value.trim(),
        authDomain: document.getElementById("settings-firebase-auth-domain").value.trim(),
        projectId: document.getElementById("settings-firebase-project-id").value.trim(),
        storageBucket: document.getElementById("settings-firebase-storage-bucket").value.trim(),
        messagingSenderId: document.getElementById("settings-firebase-messaging-sender-id").value.trim(),
        appId: document.getElementById("settings-firebase-app-id").value.trim()
      }
    }
  });
}

function applySettingsToUi() {
  document.getElementById("provider").value = appSettings.defaultProvider || "openai";
  providerBadge.textContent = `Provider: ${formatProviderLabel(appSettings.defaultProvider || "openai")}`;
  storageBadge.textContent = appSettings.firebase.enabled ? "Storage: Firebase configured" : "Storage: Local mode";
  storageBadge.className = appSettings.firebase.enabled ? "mini-badge active" : "mini-badge";
}

function openSettingsDrawer() {
  settingsDrawer.classList.remove("hidden");
}

function closeSettingsDrawer() {
  settingsDrawer.classList.add("hidden");
}

async function handleSaveSettings(event) {
  event.preventDefault();

  const previousSettings = JSON.stringify(appSettings.firebase.config);
  appSettings = collectSettingsFromForm();
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));
  applySettingsToUi();
  await setupFirebase(previousSettings);
  await loadRecentEntries();
  closeSettingsDrawer();
}

async function resetSettings() {
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
  appSettings = buildDefaultSettings();
  hydrateSettingsForm();
  applySettingsToUi();
  await setupFirebase();
  await loadRecentEntries();
}

async function setupFirebase(previousConfigJson = "") {
  const resolvedSettings = appSettings.firebase;
  const hasRealConfig = resolvedSettings.enabled && !Object.values(resolvedSettings.config).some((value) => {
    const text = String(value || "").trim();
    return !text || text.startsWith("YOUR_") || text.includes("YOUR_FIREBASE");
  });

  if (!hasRealConfig) {
    firestore = null;
    firebaseEnabled = false;
    firebaseStatus.textContent = "Firebase: local-only mode";
    firebaseStatus.className = "status-pill warn";
    storageBadge.textContent = "Storage: Local mode";
    storageBadge.className = "mini-badge";
    return;
  }

  try {
    const currentApp = getApps()[0];
    const nextConfigJson = JSON.stringify(resolvedSettings.config);

    if (currentApp && previousConfigJson && previousConfigJson !== nextConfigJson) {
      await deleteApp(currentApp);
    }

    const app = getApps()[0] || initializeApp(resolvedSettings.config);
    firestore = getFirestore(app);
    firebaseEnabled = true;
    firebaseStatus.textContent = "Firebase: connected";
    firebaseStatus.className = "status-pill";
    storageBadge.textContent = "Storage: Firebase connected";
    storageBadge.className = "mini-badge active";
  } catch (error) {
    console.error(error);
    firestore = null;
    firebaseEnabled = false;
    firebaseStatus.textContent = "Firebase: config error";
    firebaseStatus.className = "status-pill error";
    storageBadge.textContent = "Storage: Firebase error";
    storageBadge.className = "mini-badge";
  }
}

function renderKpiOverview() {
  const container = document.getElementById("kpi-overview");
  container.innerHTML = "";

  kpiConfig.parts.forEach((part) => {
    part.items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "kpi-item";
      card.innerHTML = `
        <div class="tag-row">
          <span class="tag">${escapeHtml(part.name)}</span>
          <span class="tag">${part.weight}% part weight</span>
          <span class="tag">${item.weightWithinPart}% in part</span>
        </div>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.goal)}</p>
      `;
      container.appendChild(card);
    });
  });
}

async function handleSubmit(event) {
  event.preventDefault();

  const payload = {
    employeeName: document.getElementById("employee-name").value.trim(),
    reviewPeriod: document.getElementById("review-period").value.trim(),
    provider: document.getElementById("provider").value,
    metrics: document.getElementById("metrics").value.trim(),
    note: document.getElementById("work-note").value.trim()
  };

  if (!payload.note) {
    alert("กรุณาใส่ note งานก่อนเริ่มวิเคราะห์");
    return;
  }

  setLoading(true);
  resultCard.classList.remove("hidden");
  analysisStatus.textContent = "Analyzing";
  analysisStatus.className = "status-pill neutral";

  let entryRef = null;

  try {
    if (firebaseEnabled) {
      entryRef = await addDoc(collection(firestore, "kpiEntries"), {
        ...payload,
        status: "processing",
        createdAt: serverTimestamp()
      });
    }

    const response = await fetch("./api/analyze-kpi", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...payload,
        kpiConfig,
        runtimeCredentials: getRuntimeCredentials()
      })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "ไม่สามารถวิเคราะห์ KPI ได้");
    }

    renderAnalysis(result.analysis);
    analysisStatus.textContent = `Analyzed with ${payload.provider}`;
    analysisStatus.className = "status-pill";

    if (firebaseEnabled && entryRef) {
      await updateDoc(doc(firestore, "kpiEntries", entryRef.id), {
        status: "completed",
        analysis: result.analysis,
        updatedAt: serverTimestamp()
      });
    }

    await loadRecentEntries();
  } catch (error) {
    console.error(error);
    analysisStatus.textContent = "Analysis failed";
    analysisStatus.className = "status-pill error";
    document.getElementById("summary-text").textContent = error.message;

    if (firebaseEnabled && entryRef) {
      await updateDoc(doc(firestore, "kpiEntries", entryRef.id), {
        status: "failed",
        error: error.message,
        updatedAt: serverTimestamp()
      });
    }
  } finally {
    setLoading(false);
  }
}

function getRuntimeCredentials() {
  return {
    openaiApiKey: appSettings.openaiApiKey || "",
    geminiApiKey: appSettings.geminiApiKey || ""
  };
}

function renderAnalysis(analysis) {
  document.getElementById("overall-score").textContent = analysis.overallWeightedScore.toFixed(1);
  document.getElementById("scoring-summary").textContent = formatScoringSummary(analysis.scoringSummary);
  document.getElementById("confidence-text").textContent = `Confidence: ${analysis.confidence}`;
  document.getElementById("summary-text").textContent = analysis.summary;
  document.getElementById("scoring-note").textContent = analysis.scoringNote || "";

  renderMovementAnalysis(analysis.movementAnalysis || []);
  renderScoreBreakdown(analysis.itemScores || []);
  renderEvidence(analysis.evidence || []);
  renderRecommendations(analysis.recommendations || []);
  document.getElementById("json-output").textContent = JSON.stringify(analysis, null, 2);
}

function renderMovementAnalysis(items) {
  const container = document.getElementById("movement-analysis");
  container.innerHTML = items.length
    ? items.map((item) => `
        <article class="movement-card">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.detail)}</p>
        </article>
      `).join("")
    : '<p class="empty-note">ยังไม่มี movement analysis</p>';
}

function renderScoreBreakdown(items) {
  const container = document.getElementById("score-breakdown");
  container.innerHTML = items.length
    ? items.map((item) => {
        const width = Math.max(4, Math.min(100, item.scoreNormalized * 100));
        return `
          <article class="score-card">
            <div class="score-top">
              <div>
                <h3>${escapeHtml(item.name)}</h3>
                <p>${escapeHtml(item.reason)}</p>
              </div>
              <div class="score-meta">${item.score.toFixed(1)} / 5<br>${item.weightedContribution.toFixed(1)} pts<br>raw ${item.rawContribution.toFixed(2)}</div>
            </div>
            <div class="score-bar">
              <div class="score-fill" style="width:${width}%"></div>
            </div>
          </article>
        `;
      }).join("")
    : '<p class="empty-note">ยังไม่มี score breakdown</p>';
}

function renderEvidence(items) {
  const container = document.getElementById("evidence-list");
  container.innerHTML = items.length
    ? items.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")
    : '<p class="empty-note">ยังไม่มี evidence</p>';
}

function renderRecommendations(items) {
  const container = document.getElementById("recommendations");
  container.innerHTML = items.length
    ? items.map((item) => `<p>${escapeHtml(item)}</p>`).join("")
    : '<p class="empty-note">ยังไม่มีคำแนะนำ</p>';
}

async function loadRecentEntries() {
  if (!firebaseEnabled || !firestore) {
    recentEntries.innerHTML = '<p class="empty-note">ยังไม่เชื่อม Firebase จึงยังไม่ดึง history จาก cloud</p>';
    return;
  }

  try {
    const snapshot = await getDocs(
      query(collection(firestore, "kpiEntries"), orderBy("createdAt", "desc"), limit(5))
    );

    if (snapshot.empty) {
      recentEntries.innerHTML = '<p class="empty-note">ยังไม่มีข้อมูลล่าสุด</p>';
      return;
    }

    recentEntries.innerHTML = snapshot.docs.map((entry) => {
      const data = entry.data();
      const score = data.analysis?.overallWeightedScore;
      return `
        <article class="recent-card">
          <div class="recent-title">
            <h3>${escapeHtml(data.employeeName || "ไม่ระบุชื่อ")}</h3>
            <div class="recent-score">${score ? score.toFixed(1) : "-"}</div>
          </div>
          <p class="recent-meta">${escapeHtml(data.reviewPeriod || "-")} · ${escapeHtml(data.provider || "-")} · ${escapeHtml(data.status || "-")}</p>
          <p>${escapeHtml((data.note || "").slice(0, 120))}${(data.note || "").length > 120 ? "..." : ""}</p>
        </article>
      `;
    }).join("");
  } catch (error) {
    console.error(error);
    recentEntries.innerHTML = '<p class="empty-note">ดึง history จาก Firebase ไม่สำเร็จ โปรดเช็ก Firestore rules และ index</p>';
  }
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  fillSampleButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "กำลังวิเคราะห์..." : "วิเคราะห์ KPI ด้วย AI";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatProviderLabel(provider) {
  return provider === "gemini" ? "Gemini" : "OpenAI";
}

function formatScoringSummary(summary) {
  if (!summary) {
    return "";
  }

  return `Weight basis ${summary.rawWeightTotal}% -> normalized to ${summary.normalizedTo}%`;
}
