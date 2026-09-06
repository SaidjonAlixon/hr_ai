# Smena, davomat va filial hisoblash (HR Pro)

## Dual verification (Face ID | QR)

Apteka (mudir / farmasevt / stajyor):

```
GPS → yashil hudud → Face ID  → CHECK_IN/OUT
                   └→ QR kod → CHECK_IN/OUT
```

- Face ID va QR **mustaqil** (bir-birini talab qilmaydi)
- Hududdan tashqarida ikkala tugma disabled
- `check_in_method` / `check_out_method`: `FACE_ID` | `QR`
- QR yaratish: `/davomat-qr` — faqat mudir / koordinator
- QR payload: `VMHR1.<qrId>.<token>` (DB da faqat sha256 hash)
- Audit: `attendance_punch_audit`

Ofis xodimlari: avvalgidek faqat Face ID (+ ofis geofence).


- **Smena** = rejalashtirilgan ish oynasi — **faqat mudir / farmasevt / stajyor**
- **Ofis xodimlari** smena tanlamaydi: faqat admin belgilagan ofis vaqti (default 09:00–18:00)
- **Davomat** = haqiqiy check-in / check-out
- Ishlangan soat **faqat punch** dan; smena davomiyligiga qarab yozilmaydi
- Admin smena/ofis vaqtlarini qo‘lda o‘zgartiradi: `/admin/smena-sozlamalar` → `PATCH /api/attendance-settings`

## 3 smena (Asia/Tashkent, default — admin o‘zgartirishi mumkin)
| Smena | Vaqt | Planned |
|-------|------|---------|
| 1 | 08:00–17:00 | 9 soat (unpaid break default 60 → to‘lanadigan 8) |
| 2 | 17:00–23:45 | 6 soat 45 daq |
| 3 | 23:00–07:00 (overnight) | 8 soat; `workDate` = boshlanish kuni |
| Ofis | 09:00–18:00 | smena yo‘q |

## Juftliklar
- Max **2** smena / kun
- `one+two`, `two+three` — OK
- `one+three` — ogohlantirish
- `one+two+three` — xato
- 2+3 overlap **45 daq** bir marta (interval merge)

## Filial ustuvorligi
1. substitute (o‘rniga)
2. temp_one_day
3. rotation
4. permanent

Tarix `employee_branch_assignments` da saqlanadi — eski oylar buzilmaydi.

## Yangi jadvallar
- `attendance_shift_segments`
- `employee_branch_assignments`
- `employee_day_shift_plans`
- `attendance_pay_settings`
- `attendance_records` ga: `resolved_branch_*`, `shift_plan`

## API
- `GET/PATCH /api/attendance-settings`
- `GET/POST /api/employees/:id/branch-assignments`
- `GET /api/employees/:id/branch-on/:date`
- `GET/PUT /api/employees/:id/day-shifts/:date`

## DB
```bash
pnpm db:push
```

## Test
```bash
pnpm --filter @workspace/api-server run test:attendance
```

## Kod
- `artifacts/api-server/src/lib/attendance-engine.ts` — hisob yadrosi
- `artifacts/api-server/src/lib/attendance-workdate.ts` — tungi workDate
- `artifacts/api-server/src/routes/attendance-settings.ts`
- `artifacts/api-server/src/routes/davomat.ts` — engine + overnight punch
- `artifacts/api-server/src/routes/smena.ts` — 3-smena / juftliklar
