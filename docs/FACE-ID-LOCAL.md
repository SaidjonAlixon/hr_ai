# Face ID — lokal birinchi, AI zaxira

Brauzerda **face-api.js@0.22.2** 128-d embedding. Server PostgreSQL da Euclidean + cosine.

**Mavjud foydalanuvchilar qayta enroll qilmaydi** — eski descriptorlar ishlayveradi.

## Qanday ishlaydi

1. **Lokal** match (tez, bepul) — aniq bo‘lsa darhol OK, OpenAI **chaqirilmaydi**
2. **AI zaxira** — faqat soft zona / ambiguous / lokal yetmasa
3. `FACE_AI_VERIFY=0` — AI butunlay o‘chadi (faqat lokal)

## Oqim

1. **Enroll** — `POST /api/auth/face/enroll` (duplicate `0.22/0.97`)
2. **Verify** — `POST /api/davomat/face-verify` + GPS/geofence
3. **Punch** — `POST /api/davomat/face-punch`

## ENV

```bash
FACE_AI_VERIFY=1
FACE_AI_SKIP_IF_CLEAR=1
FACE_MATCH_THRESHOLD=0.48
FACE_MATCH_MIN_COSINE=0.88
FACE_OWNER_MATCH_MAX=0.55
FACE_OWNER_MIN_COSINE=0.85
FACE_ENROLLMENT_THRESHOLD=0.22
FACE_ENROLL_MIN_COSINE=0.97
# FACE_DESCRIPTOR_KEY=...   # o‘zgartirmang — eski yuzlar buziladi
OPENAI_API_KEY=...          # soft/ambiguous uchun
```

## Ishga tushirish

```bash
cd artifacts/api-server && pnpm dev
cd artifacts/vaksina-hr && pnpm dev
```

## Qayta enroll (faqat kerak bo‘lsa)

Admin → Face ID → reset, yoki `FACE_DESCRIPTOR_KEY` o‘zgarganda. Oddiy deployda **kerak emas**.
