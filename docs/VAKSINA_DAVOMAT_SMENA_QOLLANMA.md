# VAKSINA HR — Davomat va smena qo‘llanmasi

**Maqsad:** ChatGPT / dizayn / banner uchun to‘liq, aniq qo‘llanma.  
**Manba:** tizim kodi (`attendance-engine`, `shift-hours`) — Asia/Tashkent (UTC+5).  
**Yangilangan:** 2026-03-23.

---

## 1. Asosiy tushunchalar

| Atama | Ma’nosi |
|--------|---------|
| **Keldim** | Ishga kelishni tasdiqlash (check-in) |
| **Ketdim** | Ishdan ketishni tasdiqlash (check-out) |
| **Smena** | Rejalashtirilgan ish oynasi (boshlanish–tugash) |
| **Ketdim muddati** | Shu vaqtgacha «Ketdim» bosilishi **shart**; o‘tsa kun avtomatik yopiladi |
| **Kechikish** | Smena boshidan **15 daqiqa** o‘tgach Keldim = kechikish |
| **Erta ketish** | Smena tugashidan oldin Ketdim — sabab (izoh) kerak |
| **Yashil hudud** | Filial GPS radiusida (odatda **30 m**); ofis **100 m** |

**Muhim:**
1. Avval **GPS** yoqiladi → yashil hudud ichida bo‘lish kerak.
2. Keyin usul tanlanadi: **Face ID**, **QR** yoki (ruxsat bo‘lsa) **barmoq izi**.
3. Usul tasdiqlangach «Keldim» / «Ketdim» bosiladi.
4. Ishlangan soat faqat haqiqiy punch dan hisoblanadi (smena uzunligiga «avtomatik to‘ldirilmaydi»).

---

## 2. Standart smenalar (apteka: mudir / farmasevt / stajyor)

| # | Smena | Ish vaqti | Tungi? | Tanaffus (default) | Keldim (tavsiya) | Ketdim (tavsiya) | **Ketdim oxirgi muddat** |
|---|--------|-----------|--------|---------------------|------------------|------------------|---------------------------|
| 1 | **1-smena** | **08:00 – 17:00** | Yo‘q | 60 daq | 08:00 atrofida (08:15 gacha kechikishsiz) | 17:00 dan keyin | **Shu kun 23:55** |
| 2 | **2-smena** | **17:00 – 23:59** | Yo‘q* | 0 | 17:00 atrofida (17:15 gacha kechikishsiz) | 23:59 atrofida | **Ertasi kun 02:00** (23:55 emas!) |
| 3 | **3-smena** | **23:00 – 07:00** | Ha (ertasi) | 0 | 23:00 atrofida (23:15 gacha kechikishsiz) | 07:00 atrofida | **Smena tugagan ertalab 10:00** |
| — | **Ofis** | **09:00 – 18:00** | Yo‘q | 60 daq | 09:00 atrofida (09:15 gacha kechikishsiz) | 18:00 dan keyin | **Shu kun 23:55** |
| — | **O‘rta smena** | Admin belgilagan; default = 1-smena | — | 15 daq grace | Start ±15 daq | End dan keyin | **1-smena qoidasi: 23:55** |

\*2-smena tugashi 23:59; **23:45 dan keyin** erta ketish izohi talab qilinmaydi.

---

## 3. Banner / ChatGPT uchun qisqa jadval (nusxa)

```
VAKSINA HR — KELDIM / KETDIM

1-SMENA     Ish: 08:00–17:00     Keldim ≈ 08:00     Ketdim ≤ 23:55 (shu kun)
2-SMENA     Ish: 17:00–23:59     Keldim ≈ 17:00     Ketdim ≤ 02:00 (ERTASI kun)
3-SMENA     Ish: 23:00–07:00     Keldim ≈ 23:00     Ketdim ≤ 10:00 (ertalab)
OFIS        Ish: 09:00–18:00     Keldim ≈ 09:00     Ketdim ≤ 23:55 (shu kun)

Kechikish: start + 15 daqiqa
GPS: filial 30 m · ofis 100 m
Ketdim muddati o‘tsa → kun avtomatik yopiladi (Keldim saqlanadi)
```

---

## 4. Har bir smena — batafsil

### 4.1. 1-smena

| Maydon | Qiymat |
|--------|--------|
| Ish oynasi | 08:00 → 17:00 |
| Keldim qachon | Ideal: **08:00**. **08:15** dan keyin = kechikish |
| Ketdim qachon | Ideal: **17:00** dan keyin |
| Ketdim oxirgi muddat | **Shu ish kuni 23:55** |
| Agar Ketdim yo‘q | 23:55 dan keyin kun yopiladi; Keldim vaqti saqlanadi |
| Erta ketish | 17:00 dan oldin Ketdim → **izoh majburiy** |

**Misol:** 08:09 da Keldim, Ketdim bosilmadi → kechqurun 23:55 dan keyin «Bugun yopilgan».

### 4.2. 2-smena

| Maydon | Qiymat |
|--------|--------|
| Ish oynasi | 17:00 → 23:59 |
| Keldim | Ideal: **17:00**. **17:15** dan keyin = kechikish |
| Ketdim | Ideal: **23:59** atrofida |
| Ketdim oxirgi muddat | **Ertasi kun soat 02:00** |
| Diqqat | 1-smenadagi **23:55 qoidasi 2-smenaga tatbiq etilmaydi** |
| Erta ketish | **23:45 dan keyin** ketish — izoh shart emas |

**Misol:** Dushanba 17:05 Keldim → Ketdim seshanba **02:00** gacha bo‘lishi kerak.

### 4.3. 3-smena (tun)

| Maydon | Qiymat |
|--------|--------|
| Ish oynasi | 23:00 → ertasi 07:00 |
| workDate | Boshlanish kuni (masalan: 23:00 Dushanba → workDate = Dushanba) |
| Keldim | Ideal: **23:00**. **23:15** dan keyin = kechikish |
| Ketdim | Ideal: **07:00** |
| Ketdim oxirgi muddat | Smena tugagan **ertalab 10:00** |

**Misol:** Yakshanba 23:10 Keldim → Ketdim dushanba **10:00** gacha.

### 4.4. Ofis

| Maydon | Qiymat |
|--------|--------|
| Kimlar | Ofis xodimlari (apteka smenasi yo‘q rollar) |
| Ish oynasi | **09:00 – 18:00** (admin o‘zgartirishi mumkin) |
| Keldim | Ideal: **09:00**. **09:15** dan keyin = kechikish |
| Ketdim muddati | **Shu kun 23:55** (1-smena bilan bir xil) |
| Geofence | Asosiy ofis **100 m** |

### 4.5. O‘rta smena

- Apteka xodimiga «O‘rta smena» biriktirilishi mumkin.
- Vaqt admin sozlamasidan; bo‘lmasa **1-smena** (08:00–17:00).
- Ketdim muddati: **23:55** (1-smena / ofis qoidasi).

---

## 5. Omborxona

| Tur | Ish | Keldim | Ketdim muddati |
|-----|-----|--------|----------------|
| **Erkin grafik** (joriy default) | **08:00 → ertasi 07:00** | 08:00 dan istalgan vaqtda | **Ertasi 07:00** gacha (istalgan vaqtda yopish mumkin) |
| Eski / maxsus ombor smena (`wh:…`) | Admin belgilagan start–end | Start ±15 daq | **Tugash + 2 soat** |

- Ombor xodimida kechikish/jarima **erkin grafikda odatda yo‘q**.
- Dam: odatda **yakshanba**.

---

## 6. Xavfsizlik (SB)

| Maydon | Qiymat |
|--------|--------|
| Default smena | **09:00 → ertasi 09:00** (24 soat = 1 ish kuni) |
| Ketdim muddati | Smena tugashidan **+2 soat** (default: ertasi **11:00**) |
| Grafik turlari | Du–Sha (yakshanba dam) · Kun ora · Har kuni |
| SB boshliq | Ofis qoidalari (09:00–18:00, ofis dam kunlari) |

---

## 7. Juft smenalar (bir kunda)

| Ruxsat | Izoh |
|--------|------|
| **1+2** | OK — kelish 1-smena boshida, ketish 2-smena oxirida |
| **2+3** | OK — tungi o‘tish |
| **1+3** | Ogohlantirish |
| **1+2+3** | Xato (maks. 2 smena / kun) |

Ko‘p filial: bir kunda 2 filial (smena vaqtlari kesishmasa). 1-smena Ketdi bo‘lgach 2-filialda qayta Keldim mumkin (kun butunlay yopilmasligi mumkin).

---

## 8. Ketdim muddati — yagona qoida xulosasi

| Smena / holat | Oxirgi «Ketdim» |
|---------------|-----------------|
| 1-smena | Shu kun **23:55** |
| Ofis / O‘rta (default) | Shu kun **23:55** |
| 2-smena (yoki 1+2, kechgi tugash) | Ertasi **02:00** |
| 3-smena (tun) | Ertalab **10:00** |
| Ombor erkin | Ertasi **07:00** |
| Ombor / SB (eski +2 soat) | Tugash **+ 2 soat** |

Agar muddat o‘tsa va Ketdim yo‘q:
- Kun **yopiladi** (tizimda «Bugun yopilgan» / avtomatik yopish).
- Keldim vaqti **saqlanadi**.
- Keyingi smenada yana «Keldim» dan boshlanadi.

---

## 9. GPS va usullar

| Qoida | Qiymat |
|--------|--------|
| Filial radius | **30 m** |
| Ofis radius | **100 m** |
| Hududdan tashqari | Keldim/Ketdim qabul qilinmaydi |
| Usullar | Face ID · QR · barmoq izi (ruxsat bo‘lsa) |
| Ofis | Odatda Face ID (enroll majburiy bo‘lishi mumkin) |
| QR | Mudir/koordinator yaratadi; skaner filialda |

---

## 10. Erta ketish va kechikish

| Holat | Natija |
|--------|--------|
| Keldim > start + **15 daq** | Kechikish |
| Ketdim < smena tugashi | Erta ketish → **izoh** (2-smena 23:45+ dan tashqari) |
| Ketdim muddati o‘tdi | Yangi Ketdim qabul qilinmaydi; kun yopiladi |

---

## 11. Admin o‘zgartirishi mumkin

Standart vaqtlar `/admin` smena sozlamalaridan o‘zgarishi mumkin:
- 1 / 2 / 3 smena start–end
- Ofis 09:00–18:00
- Grace (default 15 daq)
- Xodimga vaqtinchalik smena override

**Banner va ChatGPT uchun default jadvalni ishlating; individual override bo‘lsa xodim kartasidagi smena ustun.**

---

## 12. ChatGPT uchun system prompt (nusxa)

```
Sen VAKSINA HR davomat yordamchisisan. Vaqt zonasi: Asia/Tashkent.

Standart smenalar:
- 1-smena: 08:00–17:00. Keldim ~08:00 (kechikish 08:15 dan). Ketdim oxirgi muddat: SHU KUN 23:55.
- 2-smena: 17:00–23:59. Keldim ~17:00 (kechikish 17:15 dan). Ketdim oxirgi muddat: ERTASI KUN 02:00 (23:55 EMAS).
- 3-smena: 23:00–07:00 (overnight). Keldim ~23:00. Ketdim oxirgi muddat: ertalab 10:00.
- Ofis: 09:00–18:00. Ketdim oxirgi muddat: shu kun 23:55.
- Ombor erkin: 08:00 → ertasi 07:00. Ketdim ertasi 07:00 gacha.
- SB: 09:00 → ertasi 09:00; Ketdim tugash +2 soat (11:00).

GPS: filial 30 m, ofis 100 m. Avval Face ID/QR, keyin Keldim/Ketdim.
Ketdim muddati o‘tsa kun yopiladi; Keldim saqlanadi.
Javoblar o‘zbekcha, aniq soatlar bilan, qisqa.
```

---

## 13. Banner matn variantlari (qisqa)

**Variant A — 3 qator:**
> 1-smena 08:00–17:00 · Ketdim ≤ 23:55  
> 2-smena 17:00–23:59 · Ketdim ≤ ertasi 02:00  
> 3-smena 23:00–07:00 · Ketdim ≤ ertalab 10:00  

**Variant B — bitta qoida:**
> Ishingiz tugagach «Ketdim»ni bosing.  
> 1-smena/ofis: **23:55** gacha · 2-smena: **ertasi 02:00** · 3-smena: **ertalab 10:00**.  
> Bosmasangiz kun avtomatik yopiladi.

**Variant C — GPS:**
> Keldim va Ketdim faqat yashil hududda (filial 30 m). GPS yoqing.

---

*Fayl: `docs/VAKSINA_DAVOMAT_SMENA_QOLLANMA.md` — VAKSINA HR platformasi haqiqiy qoidalari.*
