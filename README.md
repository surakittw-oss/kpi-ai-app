# KPI AI App

MVP สำหรับประเมิน KPI จาก work note โดยใช้ OpenAI หรือ Gemini วิเคราะห์ note งาน แล้ว map เข้า rubric KPI พร้อมบันทึก history ลง Firebase Firestore

## โครงสร้าง

- `index.html` หน้า UI หลัก
- `styles.css` งานออกแบบและ layout
- `app.js` logic ฝั่ง client, เรียก AI API, render score, save history
- `api/analyze-kpi.js` serverless function สำหรับเรียก OpenAI หรือ Gemini
- `data/kpi-config.json` โครงสร้าง KPI และน้ำหนักคะแนน
- `config/firebase.js` ค่า Firebase web config

## สิ่งที่ระบบทำได้

- รับ note ความเคลื่อนไหวงาน, metrics, ชื่อพนักงาน และรอบประเมิน
- ส่ง note ไปให้ AI วิเคราะห์ว่า "คุณทำอะไร", "มี evidence อะไร", "เกี่ยวกับ KPI ข้อไหน"
- สร้างคะแนนเบื้องต้นระดับ 1-5 ต่อหัวข้อ
- คำนวณ weighted score ออกมาเป็นคะแนนรวม 100
- หาก Part 2 และ Part 3 ยังไม่ถูกตั้ง rubric จริง ระบบจะ normalize คะแนนจากหัวข้อที่ active อยู่และแจ้งไว้ในผลลัพธ์
- หากน้ำหนัก KPI ในฟอร์มรวมกันไม่เท่ากับ 100% เช่น 105% ระบบจะ normalize weight อัตโนมัติก่อนคิดคะแนน และอธิบาย basis นี้ใน UI
- บันทึก request และผลการวิเคราะห์ลง Firestore เมื่อเปิดใช้ Firebase
- มีเมนู `Settings หลังบ้าน` สำหรับตั้งค่า provider default, API key แบบ prototype และ Firebase config ผ่านหน้าเว็บ

## การตั้งค่า

1. ตั้งค่า API keys ใน environment ของ Vercel หรือ local server จากไฟล์ `.env.example`
2. แก้ไฟล์ `config/firebase.js`
3. เปลี่ยน `enabled` เป็น `true`
4. ใส่ Firebase web config ของโปรเจกต์จริง
5. สร้าง Firestore collection ชื่อ `kpiEntries`

หมายเหตุ:

- ถ้าไม่ได้ตั้ง environment variables ฝั่ง server คุณยังสามารถกรอก API key ผ่านเมนู `Settings หลังบ้าน` ได้สำหรับการทดสอบภายใน
- สำหรับ production ควรเก็บ API key ไว้ที่ server environment เท่านั้น ไม่ควรพึ่ง browser storage

## Firestore ที่แนะนำ

Collection: `kpiEntries`

Document example:

```json
{
  "employeeName": "สุรกิจ วงศ์สุวรรณ",
  "reviewPeriod": "Q2 / 2569",
  "provider": "openai",
  "note": "สรุปงาน...",
  "metrics": "Traffic +18%",
  "status": "completed",
  "analysis": {
    "overallWeightedScore": 78.4
  },
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

## เรื่องที่ควรทำต่อก่อนใช้จริง

- เติม rubric ของ Part 2 และ Part 3 ให้ครบ
- เพิ่ม Firebase Auth และ Firestore Security Rules
- เพิ่มหน้า manager review เพื่อ override คะแนนของ AI
- เก็บหลักฐานแนบ เช่น URL งาน, dashboard link, screenshot
- เพิ่ม export เป็น PDF หรือ summary report

## วิธี deploy

เหมาะกับ Vercel เพราะใช้ static frontend + serverless function

1. import โปรเจกต์นี้เข้า Vercel
2. ตั้งค่า environment variables
3. deploy
4. เปิดหน้าเว็บและทดสอบด้วย sample note
