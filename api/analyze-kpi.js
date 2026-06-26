const kpiConfigFromDisk = require("../data/kpi-config.json");

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const provider = body.provider || "openai";
    const note = (body.note || "").trim();
    const metrics = (body.metrics || "").trim();
    const employeeName = (body.employeeName || "").trim();
    const reviewPeriod = (body.reviewPeriod || "").trim();
    const kpiConfig = body.kpiConfig || kpiConfigFromDisk;
    const runtimeCredentials = body.runtimeCredentials || {};

    if (!note) {
      return res.status(400).json({ error: "Missing note" });
    }

    const prompt = buildPrompt({
      note,
      metrics,
      employeeName,
      reviewPeriod,
      kpiConfig
    });

    const raw = provider === "gemini"
      ? await callGemini(prompt, runtimeCredentials)
      : await callOpenAI(prompt, runtimeCredentials);

    const parsed = parseJson(raw);
    const normalized = normalizeAnalysis(parsed, kpiConfig);

    return res.status(200).json({
      ok: true,
      provider,
      analysis: normalized
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error.message || "KPI analysis failed"
    });
  }
};

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function buildPrompt({ note, metrics, employeeName, reviewPeriod, kpiConfig }) {
  return `
You are a KPI evaluation assistant.
Analyze the employee work note and produce strict JSON only.

Employee name: ${employeeName || "N/A"}
Review period: ${reviewPeriod || "N/A"}
Metrics: ${metrics || "N/A"}

KPI configuration:
${JSON.stringify(kpiConfig, null, 2)}

Instructions:
1. Read the note and explain what work movement happened in plain Thai-friendly business language.
2. Extract evidence, concrete actions, outcomes, collaboration, experiments, and business impact.
3. Score every active KPI item from 1.0 to 5.0.
4. If there is weak evidence, keep score moderate and explain what is missing.
5. Do not fabricate metrics. If a metric is missing, say it is inferred or missing.
6. Return JSON with this shape:
{
  "summary": "short executive summary",
  "confidence": "low | medium | high",
  "movementAnalysis": [
    { "title": "what the note suggests", "detail": "explanation" }
  ],
  "evidence": ["..."],
  "recommendations": ["..."],
  "itemScores": [
    {
      "id": "seo_geo_aio",
      "score": 4.2,
      "reason": "..."
    }
  ]
}

Work note:
${note}
  `.trim();
}

async function callOpenAI(prompt, runtimeCredentials = {}) {
  const apiKey = process.env.OPENAI_API_KEY || runtimeCredentials.openaiApiKey;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a precise KPI scoring assistant. Output valid JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || "OpenAI request failed");
  }

  return payload.choices?.[0]?.message?.content || "{}";
}

async function callGemini(prompt, runtimeCredentials = {}) {
  const apiKey = process.env.GEMINI_API_KEY || runtimeCredentials.geminiApiKey;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ]
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || "Gemini request failed");
  }

  const parts = payload.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("").trim() || "{}";
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Model did not return valid JSON");
    }
    return JSON.parse(match[0]);
  }
}

function normalizeAnalysis(parsed, kpiConfig) {
  const activeItems = kpiConfig.parts.flatMap((part) =>
    part.items
      .filter((item) => !item.inactive)
      .map((item) => ({ ...item, part }))
  );
  const rawWeightTotal = activeItems.reduce(
    (sum, item) => sum + (item.part.weight * item.weightWithinPart) / 100,
    0
  );
  const normalizationFactor = rawWeightTotal > 0 ? 100 / rawWeightTotal : 1;

  const itemScores = activeItems.map((item) => {
    const fromModel = (parsed.itemScores || []).find((entry) => entry.id === item.id) || {};
    const score = clamp(Number(fromModel.score || 0), 1, 5);
    const scoreNormalized = score / 5;
    const rawContribution = scoreNormalized * item.weightWithinPart * (item.part.weight / 100);
    const weightedContribution = rawContribution * normalizationFactor;

    return {
      id: item.id,
      name: item.name,
      score,
      scoreNormalized,
      rawContribution,
      weightedContribution,
      reason: fromModel.reason || "No reason provided by model"
    };
  });

  const overallWeightedScore = round1(
    itemScores.reduce((sum, item) => sum + item.weightedContribution, 0)
  );

  return {
    summary: parsed.summary || "AI ยังสรุปภาพรวมไม่ครบ",
    confidence: parsed.confidence || "medium",
    movementAnalysis: Array.isArray(parsed.movementAnalysis) ? parsed.movementAnalysis : [],
    evidence: sanitizeStringArray(parsed.evidence),
    recommendations: sanitizeStringArray(parsed.recommendations),
    itemScores,
    overallWeightedScore,
    scoringSummary: {
      rawWeightTotal: round2(rawWeightTotal),
      normalizedTo: 100,
      normalizationFactor: round4(normalizationFactor)
    },
    scoringNote: buildScoringNote(rawWeightTotal)
  };
}

function buildScoringNote(rawWeightTotal) {
  if (rawWeightTotal === 100) {
    return "คะแนนนี้คำนวณจากน้ำหนัก KPI ครบ 100% ตามฟอร์ม จึงไม่ต้อง normalize เพิ่ม";
  }

  if (rawWeightTotal > 100) {
    return `น้ำหนัก KPI ที่ active อยู่รวมกัน ${round2(rawWeightTotal)}% ระบบจึง normalize ลงมาเป็น 100% อัตโนมัติก่อนคิดคะแนน เพื่อให้คะแนนรวมไม่เกินจริง`;
  }

  return `น้ำหนัก KPI ที่ active อยู่รวมกัน ${round2(rawWeightTotal)}% ระบบจึง scale ขึ้นเป็นฐาน 100% อัตโนมัติ เพื่อให้เปรียบเทียบคะแนนรวมได้ชัดเจน`;
}

function sanitizeStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}
