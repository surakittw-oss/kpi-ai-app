import { firebaseSettings } from "./config/firebase.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
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

const sampleNote = `สัปดาห์นี้ปรับ technical SEO และ schema ให้บทความชุดการเมือง 18 ชิ้น ทำให้คะแนน Yoast ผ่านเกณฑ์มากขึ้น
ร่วมทำ dashboard รายสัปดาห์ให้ทีม editorial ดู CTR, traffic และ AI cite แบบรวมศูนย์ พร้อมสรุป insight ว่าหัวข้อไหนควรขยายต่อ
ช่วยทดสอบและปรับ UX ของ feature บนหน้า homepage ใหม่ โดยลดขั้นตอนการใช้งานจาก 4 step เหลือ 2 step
ทดลอง AI helper สำหรับสรุป related content และเก็บ feedback จากทีมใช้งานเพื่อนำมาปรับปรุงรอบถัดไป
สรุป guideline SEO/GEO/AIO ให้ทีมใช้ต่อ และตอบคำถามเวลาทีมลงบทความ`;

const form = document.getElementById("analysis-form");
const submitButton = document.getElementById("submit-btn");
const fillSampleButton = document.getElementById("fill-sample-btn");
const resultCard = document.getElementById("result-card");
const analysisStatus = document.getElementById("analysis-status");
const firebaseStatus = document.getElementById("firebase-status");
const recentEntries = document.getElementById("recent-entries");

let kpiConfig;
let firestore = null;
let firebaseEnabled = false;

init();

async function init() {
  kpiConfig = await loadKpiConfig();
  renderKpiOverview();
  setupFirebase();
  await loadRecentEntries();
  wireEvents();
}

function wireEvents() {
  form.addEventListener("submit", handleSubmit);
  fillSampleButton.addEventListener("click", () => {
    document.getElementById("employee-name").value = "สุรกิจ วงศ์สุวรรณ";
    document.getElementById("review-period").value = "Q2 / 2569";
    document.getElementById("metrics").value = "Traffic +18%, AI Cite 87%, Time Spent +9%, Returning Users +11%";
    document.getElementById("work-note").value = sampleNote;
  });
}

async function loadKpiConfig() {
  const response = await fetch("./data/kpi-config.json");
  if (!response.ok) {
    throw new Error("ไม่สามารถโหลด KPI config ได้");
  }
  return response.json();
}

function setupFirebase() {
  const hasRealConfig = firebaseSettings.enabled && !Object.values(firebaseSettings.config).some((value) => {
    const text = String(value).trim();
    return text.startsWith("YOUR_") || text.includes("YOUR_FIREBASE");
  });

  if (!hasRealConfig) {
    firebaseEnabled = false;
    firebaseStatus.textContent = "Firebase: local-only mode";
    firebaseStatus.className = "status-pill warn";
    return;
  }

  try {
    const app = initializeApp(firebaseSettings.config);
    firestore = getFirestore(app);
    firebaseEnabled = true;
    firebaseStatus.textContent = "Firebase: connected";
    firebaseStatus.className = "status-pill";
  } catch (error) {
    console.error(error);
    firebaseEnabled = false;
    firebaseStatus.textContent = "Firebase: config error";
    firebaseStatus.className = "status-pill error";
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
          <span class="tag">${part.name}</span>
          <span class="tag">${part.weight}% part weight</span>
          <span class="tag">${item.weightWithinPart}% in part</span>
        </div>
        <h3>${item.name}</h3>
        <p>${item.goal}</p>
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
        kpiConfig
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

function renderAnalysis(analysis) {
  document.getElementById("overall-score").textContent = analysis.overallWeightedScore.toFixed(1);
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
              <div class="score-meta">${item.score.toFixed(1)} / 5<br>${item.weightedContribution.toFixed(1)} pts</div>
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
