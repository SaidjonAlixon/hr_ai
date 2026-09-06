# Face ID — arxitektura, AI va boshqa platformaga ko‘chirish qo‘llanmasi

Bu hujjat **VAKSINA HR** loyihasidagi Face ID tizimini tavsiflaydi: qanday ishlaydi, qaysi texnologiyalar ishlatilgan, xarajat qanday kamaytirilgan, boshqa platformaga qanday qo‘llash mumkin va **Cursor AI ga nima deb yozish kerak** (14-bo‘lim).

---

## 1. Qisqa xulosa

| Qatlam | Texnologiya | Vazifa |
|--------|-------------|--------|
| **Brauzer (client)** | [face-api.js](https://github.com/justadudewhohacks/face-api.js) + TinyFaceDetector + FaceRecognitionNet | Kameradan yuz topish, 128-o‘lchamli embedding (vektor) chiqarish |
| **Server (asosiy)** | Node.js + PostgreSQL | Vektorlarni solishtirish, GPS, davomat, shifrlash |
| **Server (ixtiyoriy)** | OpenAI Vision (`gpt-4o`, `detail: low`) | Anti-spoof, duplicate enroll, shubhali loginlarda rasm bilan tasdiq |
| **Xarajat strategiyasi** | 2 bosqichli: avval **bepul lokal** embedding, keyin **faqat kerak bo‘lganda** AI | Har bir kadr uchun cloud AI chaqirilmaydi |

**Asosiy g‘oya:** og‘ir yuz tanish AI serverda emas, **foydalanuvchi brauzerida** bajariladi. Server faqat 128 ta son (descriptor) bilan tez matematik solishtiradi. OpenAI faqat “shubha” va “xavfsizlik” holatlarida ishlaydi.

---

## 2. Umumiy oqim (flow)

```
┌─────────────┐     getUserMedia      ┌──────────────────┐
│  Brauzer    │ ───────────────────►  │  face-api.js     │
│  (kamera)   │                       │  (CDN modellar)  │
└─────────────┘                       └────────┬─────────┘
        │                                      │
        │  128-d descriptor + JPEG snapshot    │
        │  + liveness proof (challenge token)    │
        ▼                                      ▼
┌─────────────────────────────────────────────────────────┐
│  API Server                                              │
│  1) Liveness token tekshiruvi (HMAC)                     │
│  2) Lokal: euclidean + cosine (barcha profillar)          │
│  3) Ixtiyoriy: OpenAI anti-spoof / photo compare         │
│  4) GPS + filial radius (davomat)                        │
└─────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────┐
│  face_profiles  │  user_id, descriptor (JSON/shifrlangan), photo_url
│  (PostgreSQL)   │
└─────────────────┘
```

### 2.1. Ulanish (enroll)

1. Foydalanuvchi login/parol bilan tizimga kiradi.
2. `FaceIdEnroll` → `FaceScanDialog` ochiladi.
3. `GET /api/auth/face/challenge?mode=enroll` — server **challenge token** va qadamlar beradi (hozir: faqat `center`, 3 muvaffaqiyatli kadr).
4. Brauzer har ~200–400 ms da kadr oladi:
   - oval ramka ichida yuz bormi?
   - yorug‘lik, fokus, bir nechta yuz, yonbosh burish tekshiruvi
   - landmark + **FaceRecognitionNet** → 128-d vektor (L2 normalize)
5. Bir nechta vektordan `averageDescriptorsRobust()` — chetki namunalar tashlanadi.
6. `POST /api/auth/face/enroll` — body:
   - `descriptors[]` yoki `descriptor`
   - `snapshot` (base64 JPEG)
   - `liveness` (challenge token, steps, motion)
7. Server:
   - liveness validatsiyasi
   - OpenAI enroll inspect (anti-spoof) — yoqilgan bo‘lsa
   - lokal duplicate: boshqa user bilan dist ≤ `FACE_ENROLL_BLOCK_MAX` (~0.22)
   - OpenAI duplicate: eng yaqin 1–2 profil rasmi bilan solishtirish
   - `face_profiles` ga yozish (descriptor + photo)

### 2.2. Davomat login (face-verify)

Sahifa: `/davomat-face`

1. `FaceScanDialog` mode=`login` — 2 ta markaz kadr.
2. `POST /api/davomat/face-verify`:
   - GPS **majburiy**
   - Agar sessiya (login/parol) bor bo‘lsa → faqat **shu akkaunt egasining** yuzi (`matchFaceForOwnerWithAi`)
   - Sessiya yo‘q bo‘lsa → barcha bazadan qidirish (`matchFaceForAuthWithAi`)
3. Muvaffaq bo‘lsa → cookie sessiya + bugungi davomat holati (`in` / `out` / `done`).

### 2.3. Keldim / Ketdim (face-punch)

Sessiya ochiq bo‘lganda qayta to‘liq skan shart emas:

- `POST /api/davomat/face-punch` — descriptor + GPS
- Liveness qayta talab qilinmaydi (allaqachon `face-verify` dan o‘tgan)

---

## 3. Qaysi kutubxonalar va modellar

### 3.1. Client — face-api.js (bepul, brauzerda)

**Fayl:** `artifacts/vaksina-hr/src/lib/face-id.ts`

| Model | Vazifa |
|-------|--------|
| `tinyFaceDetector` | Tez yuz detektsiyasi (inputSize 416 enroll, 320 blink) |
| `faceLandmark68Net` | 68 nuqta — burish, ko‘z ochiq/yopiq (EAR), oval tekshiruv |
| `faceRecognitionNet` | **128-o‘lchamli FaceNet-style embedding** |

Modellar CDN dan yuklanadi (server xarajati yo‘q):

```text
https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js
https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights
```

**Shart:** `https` yoki `localhost` (`window.isSecureContext`).

### 3.2. Server — lokal matematika (bepul)

**Fayl:** `artifacts/api-server/src/lib/face-identity.ts`

- Vektor uzunligi: **128**
- L2 normalize qilingan
- Masofa: `dist = euclidean(a, b)`, `cosine = dot(a, b)`
- Login qabul: `dist ≤ 0.34` VA `cosine ≥ 0.942` (env orqali sozlanadi)
- Enroll blok (boshqa akkaunt): `dist ≤ 0.22`

**Fayl:** `artifacts/api-server/src/lib/face-match.ts`

- Barcha profillar 60 soniyalik **memory cache**
- Descriptorlar DB da JSON yoki **AES-256-GCM** (`FACE_DESCRIPTOR_KEY`)
- Eng yaqin user tanlash, ambiguous (ikki user juda yaqin) holat

### 3.3. Ixtiyoriy AI — OpenAI Vision

**Fayl:** `artifacts/api-server/src/lib/face-ai-verify.ts`

| Funksiya | Qachon chaqiriladi |
|----------|-------------------|
| `inspectLiveAntiSpoof` | Enroll va login oldidan — telefon/print/ekran rad |
| `rejectIfFaceTakenByAi` | Enroll — boshqa xodim rasmi bilan bir xil odam |
| `resolveLoginIdentityWithAi` | Login — lokal top-3 nomzod + **bazadagi JPEG** bilan pairwise compare |
| `confirmOwnerFaceWithAi` | Login/parol sessiyasi bor — 1:1 owner tekshiruv |

**Model:** `OPENAI_FACE_MODEL` (default `gpt-4o`)

**Xarajat kamaytirish:**

```env
FACE_AI_IMAGE_DETAIL=low        # ~85 token/rasm (high — juda qimmat)
FACE_AI_GALLERY_MAX=3           # Eng ko‘p 3 nomzod
FACE_AI_PAIRWISE_MAX=3          # Eng ko‘p 3 ta OpenAI compare
FACE_AI_DUP_MAX=2               # Enroll duplicate: 2 ta qo'shni
FACE_AI_SKIP_IF_CLEAR=false     # Aniq lokal match bo‘lsa ham AI (default: xavfsizlik uchun o‘chiq)
FACE_AI_CONFIRM=false           # Qo‘shimcha confirm o‘chirilgan
```

`OPENAI_API_KEY` bo‘lmasa yoki `FACE_AI_VERIFY=0` bo‘lsa — tizim **faqat lokal embedding** bilan ishlaydi.

---

## 4. Liveness (jonli yuz) — AI siz ham ishlaydi

Ikki qatlam:

### 4.1. Client + server challenge (bepul)

1. Server `issueFaceChallenge()` — HMAC imzoli token, TTL 120 s.
2. Client bir nechta kadr oladi, vektorlar orasidagi **motion** hisoblanadi (`livenessMotion()`).
3. Server `evaluateLiveness()` — challenge steps bajarilganmi + `motion ≥ LIVENESS_MIN_MOTION`.

Hozirgi konfiguratsiya: faqat **markaz** poza (burish challenge soddalashtirilgan — telefonlarda barqarorlik uchun).

### 4.2. Client sifat filtrlari (bepul)

`detectFaceDescriptor()` tekshiradi:

- qorong‘ulik, past o‘tkazuvchanlik
- bir nechta yuz
- juda uzoq / juda yaqin
- yonbosh burish, ko‘z yopiq, niqob
- Laplacian sharpness (xira kadr)

### 4.3. OpenAI anti-spoof (ixtiyoriy, pullik)

Telefon ekranidagi rasm, chop etilgan foto, video replay — `inspectLiveAntiSpoof()` JSON javobida `spoof: true` bo‘lsa rad etiladi.

---

## 5. Ma’lumotlar bazasi

**Jadval:** `face_profiles` (`lib/db/src/schema/face-profiles.ts`)

| Ustun | Turi | Izoh |
|-------|------|------|
| `user_id` | integer, unique | Bir user = bitta profil |
| `descriptor` | text | JSON `number[][]` yoki shifrlangan `enc:v1:...` |
| `photo_url` | text | `data:image/jpeg;base64,...` (Neon/PostgreSQL ichida) |
| `last_used_at` | timestamp | Davomatda yangilanadi |

**Muhim:** embedding serverda qayta hisoblanmaydi — faqat client yuborgan 128 son saqlanadi va solishtiriladi.

---

## 6. API endpointlar

| Method | Path | Auth | Vazifa |
|--------|------|------|--------|
| GET | `/api/auth/face/status` | Ha | Ulanganmi? |
| GET | `/api/auth/face/challenge` | Yo‘q | Liveness token |
| POST | `/api/auth/face/enroll` | Ha | Face ID ulash |
| DELETE | `/api/auth/face` | Ha | Face ID o‘chirish |
| GET | `/api/auth/face/photo` | Ha | O‘z rasmi |
| POST | `/api/davomat/face-verify` | Ixtiyoriy | Skan + GPS + identifikatsiya |
| POST | `/api/davomat/face-punch` | Sessiya | Keldim/Ketdim |
| GET | `/api/admin/faces` | Admin | Barcha profillar, duplicate risk |
| DELETE | `/api/admin/faces/:userId` | Admin | Reset |

**Asosiy frontend fayllar:**

- `artifacts/vaksina-hr/src/lib/face-id.ts` — modellar, detect, API
- `artifacts/vaksina-hr/src/components/FaceScanDialog.tsx` — kamera UI
- `artifacts/vaksina-hr/src/components/FaceIdEnroll.tsx` — profilga ulash
- `artifacts/vaksina-hr/src/pages/davomat/face.tsx` — davomat sahifasi

**Asosiy backend fayllar:**

- `artifacts/api-server/src/routes/face.ts`
- `artifacts/api-server/src/routes/davomat.ts` (face-verify, face-punch)
- `artifacts/api-server/src/lib/face-identity.ts`
- `artifacts/api-server/src/lib/face-match.ts`
- `artifacts/api-server/src/lib/face-ai-verify.ts`
- `artifacts/api-server/src/lib/face-ai-decision.ts`

---

## 7. Xavfsizlik

1. **HTTPS** — kamera va cookie uchun majburiy.
2. **Descriptor shifrlash** — `FACE_DESCRIPTOR_KEY` (yoki `SESSION_SECRET` fallback), AES-256-GCM.
3. **Challenge HMAC** — replay attack oldini olish.
4. **Rate limit** — enroll/challenge uchun IP va user limit.
5. **Enroll duplicate** — lokal (qattiq threshold) + AI (rasm).
6. **Owner verify** — login qilgan odam boshqaning yuzi bilan davomat qila olmaydi.
7. **GPS** — filial radiusi ichida bo‘lish (davomat).
8. **Ambiguous match** — ikki user juda yaqin bo‘lsa login rad (xato ochilish oldini olish).

---

## 8. Boshqa platformaga qo‘llash — bosqichma-bosqich

### Bosqich 1: Minimal MVP (AI siz, arzon)

1. **Brauzerda** face-api.js o‘rnating (yoki TensorFlow.js + BlazeFace + MobileFaceNet — xuddi shu g‘oya).
2. Enroll: 2–3 markaz kadr → o‘rtacha vektor → serverga POST.
3. **DB:** `user_id`, `descriptor` (JSON), ixtiyoriy `photo` (JPEG base64 yoki S3).
4. **Login:** yangi vektor → barcha profillar bilan `dist`/`cosine` → eng yaqin + threshold.
5. **Liveness:** challenge token + kadrlar orasida minimal motion (OpenAI shart emas).
6. Thresholdlarni o‘z jamoangiz bilan kalibrlang (yorug‘lik, hijab, telefon kamerasi).

**Xarajat:** ~$0 AI (faqat hosting + DB).

### Bosqich 2: Sifat va xavfsizlik

1. Oval UI + landmark asosida sifat filtrlari (qorong‘u, ko‘p yuz, yonbosh).
2. Enroll paytida **qattiq** duplicate threshold (0.20–0.25).
3. Login paytida **yumshoqroq** threshold (0.32–0.38) + ambiguous margin.
4. GPS / geofence (agar davomat kerak bo‘lsa).
5. Descriptor shifrlash va rate limit.

### Bosqich 3: OpenAI qatlami (ixtiyoriy, nazoratli xarajat)

Faqat quyidagi holatlarda chaqiring:

| Holat | AI vazifasi |
|-------|-------------|
| Enroll | 1 rasm — anti-spoof + sifat |
| Enroll | 1–2 qo‘shni profil — duplicate tekshiruv |
| Login | Faqat top-3 lokal nomzod + **bazadagi foto** bilan compare |
| Owner 1:1 | Sessiya bor foydalanuvchi — bitta enroll foto bilan |

**Hech qachon** har bir kadr uchun AI ishlatmang — bu xarajatni 10–100 marta oshiradi.

Sozlamalar (tavsiya):

```env
OPENAI_API_KEY=sk-...
OPENAI_FACE_MODEL=gpt-4o
FACE_AI_VERIFY=1
FACE_AI_IMAGE_DETAIL=low
FACE_AI_ANTISPOOF=1
FACE_AI_ENROLL_INSPECT=1
FACE_AI_GALLERY_MAX=3
FACE_AI_PAIRWISE_MAX=2
FACE_AI_DUP_MAX=2
FACE_AI_SKIP_IF_CLEAR=false
```

### Bosqich 4: Admin va monitoring

- Ro‘yxat: kim ulangan, rasmi, oxirgi foydalanish
- Duplicate risk (vektor masofasi < `FACE_SIMILAR_WARN`)
- Excel export
- Admin reset

---

## 9. Environment o‘zgaruvchilari (to‘liq ro‘yxat)

```env
# Asosiy
FACE_DESCRIPTOR_KEY=...          # Descriptor AES shifrlash (tavsiya: kuchli random)
SESSION_SECRET=...               # Fallback kalit

# Lokal thresholdlar
FACE_MATCH_THRESHOLD=0.34
FACE_MATCH_MIN_COSINE=0.942
FACE_ENROLLMENT_THRESHOLD=0.22
FACE_AMBIGUOUS_MARGIN=0.08
LIVENESS_MIN_MOTION=0.006

# OpenAI (ixtiyoriy)
OPENAI_API_KEY=sk-...
OPENAI_FACE_MODEL=gpt-4o
FACE_AI_VERIFY=1
FACE_AI_IMAGE_DETAIL=low
FACE_AI_TIMEOUT_MS=20000
FACE_AI_GALLERY_MAX=3
FACE_AI_PAIRWISE_MAX=3
FACE_AI_DUP_MAX=2
FACE_AI_ANTISPOOF=1
FACE_AI_ENROLL_INSPECT=1
FACE_AI_CONFIRM=0
FACE_AI_SKIP_IF_CLEAR=0
FACE_AI_MIN_CONFIDENCE=0.9
FACE_AI_MIN_SIMILARITY=0.88
FACE_OWNER_MATCH_MAX=0.48
FACE_OWNER_MIN_COSINE=0.88
FACE_OWNER_AI_MIN_CONFIDENCE=0.72
FACE_OWNER_AI_MIN_SIMILARITY=0.68

# Rasm saqlash
FACE_STORE_PHOTOS=1              # 0 = faqat vektor
```

---

## 10. Alternativalar (nima ishlatilmagan va nima uchun)

| Yondashuv | Nima uchun tanlanmagan / qo‘shilmagan |
|-----------|--------------------------------------|
| AWS Rekognition / Azure Face API | Har bir chaqiruv pullik; 100+ xodim × kunlik davomat qimmat |
| Server-side ONNX / GPU | Infra murakkabligi; Vercel serverless GPU yo‘q |
| Faqat OpenAI (embedding siz) | Har login 1+ vision chaqiruvi — oylik xarajat yuqori |
| 3D kamera / IR liveness | Qurilma narxi va integratsiya |

**Tanlangan hybrid:** client embedding (bepul) + server matematika (bepul) + OpenAI faqat “shubha/xavfsizlik” (nazoratli).

---

## 11. Test va kalibrlash

- Unit testlar: `face-identity.test.ts`, `face-ai-verify.test.ts`
- Enroll: bir xil odam turli yorug‘likda `dist` 0.12–0.38 oralig‘ida bo‘lishi kerak
- Boshqa odam: odatda `dist > 0.45`
- Admin `/admin/faces` — “similar risk” va duplicate juftlar
- Production log: `face_verify`, `face_verify_ai`, `face_ai_antispoof` eventlari

---

## 12. Tez-tez so‘raladigan savollar

**Face ID bilan login/parol almashtiradimi?**  
Yo‘q. Login/parol asosiy kirish. Face ID — davomat va (ixtiyoriy) tez tasdiq.

**Bitta yuz ikki akkauntga yoziladimi?**  
Yo‘q — enroll duplicate (lokal + AI) bloklaydi.

**OpenAI o‘chirilsa ishlaydimi?**  
Ha — lokal embedding bilan ishlaydi; anti-spoof zaifroq bo‘ladi.

**Hijab / ko‘zoynak?**  
Embedding va AI promptlarida e’tiborsiz qoldirish ko‘rsatilgan; baribir real jamoa bilan threshold kalibrlang.

---

## 13. Xulosa

VAKSINA HR Face ID **3 qatlamli** model:

1. **Client AI (face-api.js)** — asosiy tanish, $0 inference.
2. **Server matematika** — tez, xavfsiz, masshtablanadi.
3. **OpenAI Vision (ixtiyoriy)** — faqat spoof, duplicate va noaniq loginlarda, `detail: low` bilan arzonlashtirilgan.

Boshqa platformaga ko‘chirishda avval **1–2-bosqich**ni to‘liq ishga tushiring; keyin trafik va xavfsizlik talabiga qarab **3-bosqich** OpenAI qatlamini qo‘shing.

---

## 14. Cursor uchun tayyor promptlar

Boshqa loyihaga Face ID qo‘shish uchun Cursor chatiga quyidagi promptlardan birini copy-paste qiling. `[...]` qismlarni o‘z loyihangizga mos to‘ldiring.

### 14.1. Qanday ishlatiladi

1. Yangi loyiha yoki mavjud loyihani Cursor’da oching.
2. Chatga `@docs/FACE-ID-IMPLEMENTATION.md` ni ulang (yoki bu faylni yangi loyihaga nusxalang).
3. Agar manba kod mavjud bo‘lsa, quyidagi fayllarni ham `@` bilan qo‘shing:
   - `artifacts/vaksina-hr/src/lib/face-id.ts`
   - `artifacts/vaksina-hr/src/components/FaceScanDialog.tsx`
   - `artifacts/vaksina-hr/src/components/FaceIdEnroll.tsx`
   - `artifacts/api-server/src/lib/face-identity.ts`
   - `artifacts/api-server/src/lib/face-match.ts`
   - `artifacts/api-server/src/lib/face-ai-verify.ts`
   - `artifacts/api-server/src/routes/face.ts`
   - `artifacts/api-server/src/routes/davomat.ts`
4. Quyidagi **to‘liq prompt**ni yuboring (birinchi marta shundan boshlang).
5. Keyingi sessiyalarda **qisqa prompt** yetarli bo‘ladi.

---

### 14.2. To‘liq prompt (asosiy — copy-paste)

```text
Mening loyihamga VAKSINA HR dagi Face ID tizimini xuddi shu arxitektura va arzonlashtirish uslubi bilan qo'sh.

MANBA: @docs/FACE-ID-IMPLEMENTATION.md va agar mavjud bo'lsa quyidagi fayllarni namuna qilib o'qi:
- artifacts/vaksina-hr/src/lib/face-id.ts
- artifacts/vaksina-hr/src/components/FaceScanDialog.tsx
- artifacts/vaksina-hr/src/components/FaceIdEnroll.tsx
- artifacts/api-server/src/lib/face-identity.ts
- artifacts/api-server/src/lib/face-match.ts
- artifacts/api-server/src/lib/face-ai-verify.ts
- artifacts/api-server/src/routes/face.ts
- artifacts/api-server/src/routes/davomat.ts (face-verify, face-punch)

MAQSAD: 3 qatlamli hybrid Face ID:
1) Client (bepul): face-api.js — TinyFaceDetector + faceLandmark68Net + faceRecognitionNet → 128-d L2-normalized embedding
2) Server (bepul): euclidean distance + cosine similarity bilan matching, AES-256-GCM descriptor shifrlash
3) Server (ixtiyoriy, nazoratli): OpenAI Vision faqat anti-spoof, enroll duplicate va shubhali loginlarda (detail: low)

OQIMLAR:
- Enroll: GET challenge (HMAC token) → 2-3 markaz kadr → averageDescriptorsRobust → POST enroll + liveness + snapshot
- Verify: POST face-verify — GPS majburiy, owner yoki global match
- Punch: POST face-punch — sessiya ochiq, liveness qayta talab qilinmasin

THRESHOLD (default):
- Login: dist ≤ 0.34, cosine ≥ 0.942
- Enroll duplicate block: dist ≤ 0.22
- Ambiguous margin: 0.08

ARZONLASHTIRISH (majburiy):
- Har kadr uchun OpenAI chaqirilmasin
- FACE_AI_IMAGE_DETAIL=low (~85 token/rasm)
- FACE_AI_GALLERY_MAX=3, FACE_AI_PAIRWISE_MAX=3, FACE_AI_DUP_MAX=2
- OPENAI_API_KEY bo'lmasa faqat lokal embedding ishlasin

XAVFSIZLIK:
- HTTPS, rate limit, challenge replay oldini olish
- Bir yuz ikki akkauntga yozilmasin (lokal + AI duplicate)
- Login qilgan user faqat o'z yuzi bilan verify (owner match)
- Ambiguous match (ikki user juda yaqin) — login rad

DB:
- face_profiles: user_id (unique), descriptor (JSON yoki shifrlangan), photo_url, last_used_at

API ENDPOINTLAR:
- GET  /api/auth/face/status
- GET  /api/auth/face/challenge
- POST /api/auth/face/enroll
- DELETE /api/auth/face
- GET  /api/auth/face/photo
- POST /api/davomat/face-verify
- POST /api/davomat/face-punch
- GET  /api/admin/faces (admin)
- DELETE /api/admin/faces/:userId (admin)

MENING LOYIHAM:
- Stack: [React + Node + PostgreSQL / Flutter / Vue + FastAPI / boshqa — TO'LDIRING]
- Auth: [JWT / session cookie / boshqa — TO'LDIRING]
- Davomat kerakmi: [ha / yo'q]
- GPS / geofence kerakmi: [ha / yo'q]
- OpenAI qatlami: [ha / yo'q / keyinroq]

VAZIFA:
1) Avval mavjud kod strukturasini o'rgan
2) DB migration: face_profiles jadvali
3) Client: kamera UI (oval ramka, sifat filtrlari, enroll/login modlari)
4) Backend: challenge, enroll, verify, punch, admin
5) Env o'zgaruvchilar va .env.example
6) OpenAI qatlami ixtiyoriy flag bilan (FACE_AI_VERIFY=0 bo'lsa o'chsin)
7) Qisqa README bo'limi

Avval reja yoz, keyin bosqichma-bosqich implement qil. Mavjud kod uslubiga mos yoz, ortiqcha abstraksiya qo'shma.
```

---

### 14.3. Qisqa prompt (keyingi sessiyalar uchun)

```text
@docs/FACE-ID-IMPLEMENTATION.md bo'yicha Face ID qo'sh yoki tugat:
- Client: face-api.js, 128-d embedding brauzerda
- Server: lokal dist/cosine match + ixtiyoriy OpenAI (faqat spoof/duplicate/shubha, detail:low)
- Enroll, verify, punch oqimlari
- Threshold: login 0.34, enroll duplicate 0.22
- Mening stack: [STACK NOMI]
Avval reja, keyin kod.
```

---

### 14.4. Faqat backend uchun

```text
@docs/FACE-ID-IMPLEMENTATION.md asosida Face ID backend yoz:

JADVAL:
- face_profiles (user_id unique, descriptor text, photo_url text, last_used_at timestamp)

ENDPOINTLAR:
- GET  /api/auth/face/challenge — HMAC liveness token
- POST /api/auth/face/enroll — descriptor + snapshot + liveness
- DELETE /api/auth/face
- GET  /api/auth/face/status
- POST /api/davomat/face-verify — GPS + match + sessiya
- POST /api/davomat/face-punch — descriptor + GPS

MODULLAR:
- face-identity.ts: liveness HMAC, dist/cosine, thresholdlar
- face-match.ts: cache (60s), AES-256-GCM shifrlash, ambiguous match
- face-ai-verify.ts: OpenAI anti-spoof + pairwise compare (ixtiyoriy, arzon)

ENV: FACE_MATCH_THRESHOLD, FACE_DESCRIPTOR_KEY, OPENAI_API_KEY, FACE_AI_IMAGE_DETAIL=low

Stack: [Node/Express / FastAPI / Django — TO'LDIRING]
Unit testlar ham qo'sh. Mavjud auth middleware bilan integratsiya qil.
```

---

### 14.5. Faqat frontend uchun

```text
@docs/FACE-ID-IMPLEMENTATION.md asosida Face ID frontend yoz:

KUTUBXONA:
- face-api.js CDN (TinyFaceDetector, faceLandmark68Net, faceRecognitionNet)
- Modellar: jsdelivr CDN weights

KOMPONENTLAR:
- FaceScanDialog — oval kamera UI, enroll (3 kadr) va login (2 kadr) modlari
- FaceIdEnroll — profilga ulash
- face-id.ts — detectFaceDescriptor, averageDescriptorsRobust, API chaqiruvlar

SIFAT FILTRLARI:
- yorug'lik, fokus (Laplacian), bir nechta yuz, yonbosh burish, ko'z yumish (EAR)
- HTTPS / localhost tekshiruvi

API:
- GET  /api/auth/face/challenge
- POST /api/auth/face/enroll
- POST /api/davomat/face-verify

Xato xabarlari o'zbekcha. Mavjud dizayn tizimiga mos UI.
Stack: [React / Vue / Svelte — TO'LDIRING]
```

---

### 14.6. Flutter / mobil uchun

```text
@docs/FACE-ID-IMPLEMENTATION.md arxitekturasini Flutter mobil ilovaga moslashtir:

CLIENT:
- google_mlkit_face_detection yoki tflite MobileFaceNet (128-d vektor)
- Embedding brauzer/server emas — mobil qurilmada hisoblanadi
- Kamera UI: oval guide, enroll (3 kadr) va verify (2 kadr)

SERVER (o'zgarmaydi):
- Bir xil API kontrakt: descriptor[] + snapshot + liveness + GPS
- Lokal dist/cosine + ixtiyoriy OpenAI serverda

OQIM:
- Enroll: challenge → kadrlar → POST enroll
- Davomat: face-verify (GPS majburiy) → face-punch

Platform: Flutter iOS + Android
Avval kutubxona tanlovi va API kontrakt, keyin kod. OpenAI faqat serverda.
```

---

### 14.7. Faqat OpenAI qatlamini qo‘shish (mavjud Face ID bor loyihaga)

```text
Mavjud Face ID tizimimga @docs/FACE-ID-IMPLEMENTATION.md dagi OpenAI qatlamini qo'sh:

QOIDALAR:
- Har kadr uchun AI chaqirilmasin
- inspectLiveAntiSpoof — enroll va login oldidan (telefon/print/ekran rad)
- rejectIfFaceTakenByAi — enroll duplicate (1-2 qo'shni profil rasmi)
- resolveLoginIdentityWithAi — faqat top-3 lokal nomzod + bazadagi JPEG
- confirmOwnerFaceWithAi — sessiya bor user uchun 1:1

SOZLAMALAR:
FACE_AI_IMAGE_DETAIL=low
FACE_AI_GALLERY_MAX=3
FACE_AI_PAIRWISE_MAX=3
FACE_AI_DUP_MAX=2
FACE_AI_SKIP_IF_CLEAR=false
OPENAI_FACE_MODEL=gpt-4o

FACE_AI_VERIFY=0 bo'lsa butun AI qatlam o'chsin.
Mavjud lokal matching o'zgarmasin — AI faqat qo'shimcha tekshiruv.
```

---

### 14.8. Debug / muammo tuzatish prompti

```text
@docs/FACE-ID-IMPLEMENTATION.md bo'yicha Face ID muammosini tuzat:

MUAMMO: [masalan: "enroll duplicate xato beradi" / "login ishlamaydi" / "kamera ochilmaydi"]

TEKSHIR:
1) HTTPS / isSecureContext
2) face-api modellar yuklanganmi
3) descriptor 128-d va L2 normalize
4) threshold: dist/cosine
5) liveness challenge token va motion
6) OPENAI_API_KEY va FACE_AI_VERIFY flag
7) GPS permission (davomat)

Log va xato xabarlarini tahlil qil, minimal fix qil.
```

---

### 14.9. Prompt tanlash jadvali

| Vaziyat | Qaysi prompt |
|---------|--------------|
| Yangi loyiha, to‘liq Face ID | **14.2** To‘liq prompt |
| Oldin boshlangan, davom ettirish | **14.3** Qisqa prompt |
| Faqat API / server | **14.4** Backend |
| Faqat kamera UI | **14.5** Frontend |
| Mobil ilova | **14.6** Flutter |
| Lokal matching bor, AI qo‘shish | **14.7** OpenAI qatlam |
| Xato / ishlamayapti | **14.8** Debug |

---

*Hujjat manbasi: `hr_ai-VAKSINA` repozitoriyasi — `artifacts/vaksina-hr` va `artifacts/api-server` Face ID modullari.*
