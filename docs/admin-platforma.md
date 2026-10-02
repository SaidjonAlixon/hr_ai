# VAKSINA MED HR — admin hisobi bo‘yicha to‘liq qo‘llanma

Bu hujjat **admin** akkauntida chap menyuda ko‘rinadigan barcha bo‘lim sarlavhalari, sahifalar va ularning vazifasini boshidan oxirigacha yozadi. Manzillar platformadagi yo‘llardir (`/dashboard` kabi).

Admin va asoschi platformaning to‘liq ko‘rinishiga ega. **Foydalanuvchilar** va **Bo‘shatilganlar** sahifalari faqat admin uchun. Qolgan sozlamalarning ko‘pini asoschi ham ochadi.

Kirish: login sahifasi. Muvaffaqiyatli kirgach bosh sahifa Dashboard.

---

## Menyuning bo‘lim sarlavhalari

Admin menyusi shu guruhlarga bo‘linadi:

1. Asosiy
2. Davomat
3. Mening ishim
4. Arizalar
5. Xodim kerak
6. Xodimlar
7. Ishga qabul
8. Apteka tarmog‘i
9. Logistika
10. Omborxona
11. Sozlamalar

Pastki qismda profil, bildirishnomalar va chiqish ham bor.

---

## 1. Asosiy

### Dashboard

Yo‘l: `/dashboard`

Kunlik qisqa ko‘rinish: kelganlar, kechikkanlar, kelmaganlar, ochiq topshiriqlar va e’tibor talab qiladigan kartalar. Bu yer boshqaruvning kirish nuqtasi. Chuqur hisobotlar Davomat va Hisobot sahifalarida.

### Javob olish

Yo‘l: `/javob-olish`

Xodim o‘z smenasidan ma’lum soat yoki butun kun uchun ruxsat so‘raydi. Sabab yoziladi. Ketma-ket kunlar bitta paket bo‘lib ketadi.

Tasdiq zanjiri:

1. Dorixona xodimida avval koordinator. Ofis xodimida avval bo‘lim boshlig‘i.
2. Ular 8 soat ichida javob bermasa, so‘rov HR menejer va HR direktorga o‘tadi.
3. Yakuniy ruxsatni HR beradi. Admin bu bosqichni o‘zi ham yopishi mumkin.

HR yoki admin yakuniy **tasdiq** bersa, shu xodimning o‘sha kuni Davomatda **Sababli** bo‘ladi. Izohda sabab va soat oralig‘i turadi, kim tasdiqlagani ko‘rinadi. Bu kun jarimaga tushmaydi va kelmagan deb hisoblanmaydi. Koordinator yoki bo‘lim boshlig‘ining oraliq tasdig‘i hali Sababli qilmaydi.

Davomatdagi Sababli tugmasi bilan bu yo‘l bir xil natija beradi. Qo‘lda qo‘yilgan Sababli ustidan javob olish yozilmaydi.

### Javob olish holati

Yo‘l: `/javob-olish/holat`

Barcha so‘rovlarning kuzatuvi: kutayotgan, tasdiqlangan, rad etilgan. Kimda turibdi, qachon yuborilgan, qachon qaror qilingan.

### Tashkiliy tuzilma

Yo‘l: `/tashkiliy-tuzilma`

Kompaniya daraxti: rahbariyat, bo‘limlar, koordinatorlar, filial mudirlari va ularning jamoasi. Kim kimga hisobot berishi shu yerda ko‘rinadi.

### Oylik

Yo‘l: `/oylik`

Oylik maosh jadvali. Fiksa, kunlik hisob, jarima ustuni. Davomatdagi kechikish va kelmaslik jarimasi shu oyga bog‘lanadi. Jarimalar kartasidan Davomat ichidagi Jarimalar bo‘limiga o‘tish mumkin.

### Oylik hisob

Yo‘l: `/hisobkitob`

Oylikni hisoblash va tekshirish: ish kunlari, davomat, jarima va yakuniy summa. Tasdiqlash shu hisob-kitob oqimida.

### Reviziya

Yo‘l: `/reviziya`

Filial tekshiruvi. Akt, kamchilik, mas’ul va muddat. Hujjat alohida ochiladi: `/reviziya/hujjat/:id`.

### AyTi

Yo‘l: `/it`

Axborot texnologiyalari bo‘limi: murojaatlar va tiketlar. 24 soat ichida yopilmasa yuqoriga ko‘tariladi.

---

## 2. Davomat

### Davomat tahlili

Yo‘l: `/davomat/analytics`

Davomat hisobotining grafik ko‘rinishi: kelish, kechikish, kelmaslik, bo‘lim va smena bo‘yicha ulush.

### Xatoliklar

Yo‘l: `/davomat/xatoliklar`

Yuz, QR, GPS yoki smena oynasi sabab davomat qabul qilinmagan holatlar. Xodimga tushunarli izoh chiqishi uchun xato matnlari shu yerda yig‘iladi.

### Davomat hisobot

Yo‘l: `/davomat`

Asosiy davomat sahifasi. Ichida oltitagacha ichki bo‘lim bor:

| Ichki bo‘lim | Nima qiladi |
| --- | --- |
| Jadval (kun / hafta / oy) | Kunlik jadval, haftalik va oylik kataklar. Holat ranglari: vaqtida yashil, kech sariq, kelmagan qizil, sababli moviy-yashil, dam kulrang |
| Tahlil va grafik | Shu davr bo‘yicha grafik |
| Xodimlar jami | Har xodimning kelgan, kelmagan, kechikkan kuni va ish soati |
| Jarimalar | Kechikkan va kelmagan kunlar bo‘yicha jarima ro‘yxati |
| Smena va filial | Smena va filial kesimida ko‘rinish |
| Cheklist holati | Admin uchun cheklist kesimi (ruxsat bo‘lsa) |

Filtrlar: sana, bo‘lim, ofis yoki dorixona, smena, filial, koordinator, qidiruv, holat (kelgan, kech, kelmagan, ta’til, dam).

Kunlik jadvaldagi amallar (qatordagi tugmalar):

- Qalam — vaqtni qo‘lda yozish. Admin va HR direktor.
- Bekor qilish — keldim yoki ketdimni qaytarish. Faqat admin.
- Sababli — kunni jarimasiz sababli qilish. Izoh majburiy (kamida 3 belgi). Kim va qachon belgilagani bosilganda ko‘rinadi. Admin va HR menejer.
- Soat — shu xodimning smenasi va kelish–ketish vaqti. Faqat admin. Ofis, dorixona va boshqa xodim farqi yo‘q. Smena tanlansa standart vaqt chiqadi, keyin shu odam uchun o‘zgartiriladi. Doimiy yoki muddatli. Faqat shu xodimga ta’sir qiladi. Davomat, jarima va uning Keldim/Ketdimi shu vaqtga qarab hisoblanadi. Smena ustunida «o‘zgartirilgan» yozuvi chiqadi.

Ishga kirish va bo‘shatish qoidasi:

- Yangi xodim tizimga kiritilgan kundan hisoblanadi. Shu oyning oldingi kunlari qizil katakda **Ishga qabul qilinmagan**. Bu kunlar kelmagan ham, jarima ham emas. Oldingi oylarda bu xodim chiqmaydi.
- Bo‘shatilgan xodimning davomati tizimga kirgan kundan bo‘shatilgan kungacha qoladi, arxivga tushsa ham. Undan keyingi kunlar chiqmaydi.

Excel: filial filtrida bo‘sh «-» chiqmaydi, bir filialdagilar mudir kartasidagi nom bilan bir xil yoziladi. Kelganlar varag‘ida Holat: o‘z vaqtida yashil, kechikkan va ketish yozilmagan sariq.

### Bloklash oynasi

Yo‘l: `/davomat/bloklash`

Yashil hududda o‘z vaqtida tasdiqlamagan xodimning davomati bloklanadi. Admin blokni ko‘radi va ochishi mumkin.

### Dorixona ochilishi

Yo‘l: `/davomat/dorixona-ochilishi`

Filialning ochilish holati: kim keldi, dorixona ochildimi.

### Davomat

Yo‘l: `/davomat-face`

Xodimning o‘z ekrani: Keldim va Ketdim. Face ID yoki QR, belgilangan hudud (GPS). Smena vaqti tashqarisida ham tugma ochiq, kechikish esa belgilangan kelish vaqtidan hisoblanadi. Admin xodimga qo‘ygan smena va vaqt shu yerda ham ishlaydi.

### Smena va filial

Yo‘l: `/smena-filial`

Xodimning ishlaydigan filiali va smenasi. Mudirlar doimiy smenaga yopishtirilmaydi, ular kunlik rotatsiyada. Admin alohida xodimga vaqt qo‘yishi Davomat hisobotidagi soat tugmasida.

Standart smenalar:

| Smena | Vaqt |
| --- | --- |
| Ofis | 09:00–18:00, shanba–yakshanba dam |
| 1-smena | 08:00–17:00 |
| 2-smena | 17:00–23:45 |
| 3-smena | 23:00–07:00 (keyingi kun) |

Ofisga o‘tkazilgan xodim dam kunida dam oladi. Dorixona smenasiga o‘tkazilgan ofis xodimi dam kunida ham ish kuni hisoblanadi. Bu o‘zgarish faqat shu odamga tegishli.

### Cheklist holati

Yo‘l: `/checklist-holati`

Koordinatorning filial cheklisti bajarilganmi. Ofisdagi davomat sessiyasi cheklist hisobiga aralashmaydi.

### Davomat QR

Yo‘l: `/davomat-qr`

Bo‘lim boshlig‘i va ruxsati borlar uchun QR bilan tasdiq. Adminning to‘liq QR boshqaruvi Sozlamalardagi Davomat QR da.

---

## 3. Mening ishim

### Topshiriqlar

Yo‘l: `/vazifalar`

Vazifa berish va bajarish. Muddat, mas’ul, holat. Maxfiy vazifani admin, asoschi va direktor belgilaydi.

### Topshiriqlar tahlili

Yo‘l: `/vazifalar/tahlil`

Kim qancha vazifani vaqtida yopgani.

### Eslatmalarim

Yo‘l: `/eslatmalar`

Shaxsiy eslatma: sana, vaqt, takrorlanish.

---

## 4. Arizalar

### Arizalar

Yo‘l: `/requests`

Ichki arizalar ro‘yxati. Yangi ariza: `/requests/new`. Bitta ariza: `/requests/:id`.

---

## 5. Xodim kerak

### Xodim kerak

Yo‘l: `/xodim-kerak`

Filial yoki bo‘lim odam so‘raganda ochiladigan ehtiyoj. Smena bo‘sh qolsa «xodim kerak» sloti va ogohlantirish chiqadi.

---

## 6. Xodimlar

### Xodimlar

Yo‘l: `/employees`

Faol xodimlar ro‘yxati: ism, lavozim, bo‘lim, filial, telefon, holat. Bo‘shatilganlar bu ro‘yxatda qolmaydi, ular Sozlamalardagi Bo‘shatilganlar arxivida.

Qo‘shimcha:

- `/employees/duplicates` — dublikat kartalar
- `/employees/other` — boshqa toifa

Xodim tizimga qo‘shilgan kuni `hiredAt` hisoblanadi. Davomat shu kundan yuradi.

---

## 7. Ishga qabul

Nomzod ishga kirguncha o‘tadigan zanjir.

### Ish o‘rinlari

Yo‘l: `/vacancies`

Ochiq vakansiyalar. Yangi vakansiya: `/vacancies/new`. Karta: `/vacancies/:id`.

### Nomzodlar

Yo‘l: `/candidates`

Nomzodlar ro‘yxati. Yangi nomzod: `/candidates/new`. Karta: `/candidates/:id`.

Nomzod bosqichlari:

| Bosqich | Yo‘l |
| --- | --- |
| Telefon suhbati | `/candidates/:id/phone-interview` |
| Onlayn suhbat | `/candidates/:id/online-interview` |
| Preboarding | `/candidates/:id/preboarding` |
| Oflayn suhbat | `/candidates/:id/offline-interview` |
| Yakuniy qaror | `/candidates/:id/final-decision` |
| Taklif | `/candidates/:id/offer` |
| Hujjatlar | `/candidates/:id/documents` |
| Stajirovka | `/candidates/:id/internship` |

Eski yo‘llar: `/interviews`, `/pipeline`.

### Stajirovkalar

Yo‘l: `/internships`

Stajirovkadagi odamlar va ularning muddati.

---

## 8. Apteka tarmog‘i

### Aptekalar tarmog‘i

Yo‘l: `/pharmacy-network`

Dorixonalar daraxti: koordinator, filial, mudir, farmasevt, stajyor. Filial qo‘shish, odam qo‘shish, rol almashtirish, GPS, filialni butunlay o‘chirish.

Filial nomi bir xil yozilishi kerak. Noto‘g‘ri yozilgan dublikat (masalan, harf xatosi bilan ochilgan filial) ichidagi xodimlari bilan o‘chiriladi, to‘g‘ri yozilgan filial qoladi.

### Bog‘lanish

Yo‘l: `/boglanish`

Filial telefoni, ish vaqti va bog‘lanish oynasi. Telegramdagi filial boti shu ma’lumotni ko‘rsatadi.

### Ehtiyoj

Yo‘l: `/ehtiyoj`

Filialdagi bo‘sh shtat: qaysi smenada odam yetishmaydi.

### Cheklist

Yo‘l: `/checklist`

Koordinator filialga kirganda to‘ldiradigan cheklist. Admin menyusida alohida emas, Cheklist holati orqali kuzatiladi. Sahifa o‘zi shu yo‘lda.

---

## 9. Logistika

Admin logistika modulini ko‘radi.

| Sahifa | Yo‘l | Vazifa |
| --- | --- | --- |
| Dashboard / VHK | `/logistika/dashboard` | Logistika bosh ko‘rinishi |
| Boshqaruv | `/logistika/boshqaruv` | Mashina va yoqilg‘i boshqaruvi |
| Live | `/logistika/live` | Jonli joylashuv |
| GPS Davomat | `/logistika/davomat` | Haydovchi davomati |
| Panel | `/logistika/panel` | Logistika sozlamalari |

---

## 10. Omborxona

### Omborxona_ish

Yo‘l: `/omborxona-ish`

Ombor smenalari va ombor xodimlarining ishi. Smena yaratish va odam ajratish admin va ombor boshlig‘ida. Rahbariyat ko‘radi.

Ombor checkout qoidasi: ketish vaqti smena tugashiga 2 soat qo‘shilgan muddat.

---

## 11. Sozlamalar

### Foydalanuvchilar

Yo‘l: `/admin/users`

Faqat admin. Login, rol, bo‘lim, telefon, holat. Yangi foydalanuvchi o‘z bo‘limiga va rolida xodim kartasiga bog‘lanadi. Ishga kirgan kun shu yaratilgan kun.

Holat «Tugatilgan» qilinsa, odam Bo‘shatilganlar arxiviga ko‘chadi: login o‘chadi, davomat yozuvlari saqlanadi va Davomatda faqat ishlagan oralig‘ida ko‘rinadi.

### Bo‘shatilganlar

Yo‘l: `/admin/boshatilganlar`

Faqat admin. Arxiv: ism, lavozim, filial, qachon kirgan, qachon bo‘shatilgan, kim bo‘shatgan, sabab. Bu odamlar faol ro‘yxatlarda yo‘q.

### Qurilmalar

Yo‘l: `/admin/qurilmalar`

Xodim qurilmalari va xavfsizlik. O‘zgartirish faqat admin.

### Ko‘chma davomat

Yo‘l: `/admin/kochma-davomat`

Maydonda, ofisdan tashqarida davomat qilish ruxsati.

### Ko‘chma xarita

Yo‘l: `/admin/kochma-xarita`

Ko‘chma xodimlarning xaritadagi nuqtalari.

### Jonli kuzatuv

Yo‘l: `/admin/kochma-live`

Hozir qayerdaligi.

### Face ID

Yo‘l: `/admin/faces`

Yuz namunalari. Keldim/Ketdim shu yuz bilan tasdiqlanadi.

### Smena sozlamalari

Yo‘l: `/admin/smena-sozlamalar`

Butun tarmoq uchun standart ofis va smena vaqtlari. Bitta xodimga alohida vaqt Davomat hisobotidagi soat tugmasida, bu yerdagi standartni buzmaydi.

### Davomat QR

Yo‘l: `/admin/davomat-qr`

Filial va bo‘lim QR kodlari. QR ichidagi manzil haqiqiy saytga qaraydi.

### Test

Yo‘l: `/admin/test`

Bildirishnoma va sinov yuborish.

### Hisobot

Yo‘l: `/admin/holat`

Koordinatorlar kesimidagi umumiy hisobot: filial, mudir, farmasevt, stajyor, kelish foizi.

### Xodimlar hisoboti

Yo‘l: `/admin/holat/xodim`

Bitta xodimning varaqasi: davomat kunlari, hujjat, tasdiqlash. Tasdiqlangan hisobot havolasi: `/hisobot/tasdiq/:token`.

### Bo‘limlar

Yo‘l: `/admin/departments`

Tashkilot bo‘limlari va ularning boshliqlari. Rol yangi odamni shu bo‘limga qo‘yadi.

Asosiy bo‘lim nomlari:

| Bo‘lim | Kim kiradi |
| --- | --- |
| Rahbariyat | admin, direktor, asoschi, moliya, yurist, direktor yordamchisi |
| HR | HR direktor, HR menejer, HR auditor, kadr rahbar |
| Rekruting | rekruter |
| Trening | trener |
| Koordinator | koordinator |
| Farmasevt | mudir, farmasevt, stajyor |
| AyTi | dasturchi, tarmoq, IT rahbar |
| Reviziya | revizor |
| Xavfsizlik | SB |
| Moliya | moliya xodim, kassir |
| Ta’minot | ta’minot |
| Rivojlantirish | rivojlantirish |
| Ma’muriy-xo‘jalik | ma’muriy, komunal |
| Marketing | marketing |
| Omborxona | ombor |
| Distribyutsiya | distribyutsiya xodimlari |
| GPP | GPP |
| Oshpaz | oshpaz |
| Farrosh | farrosh |
| Mexanik | mexanik |

### Kirish materiallari

Yo‘l: `/admin/kirish-videolar`

Yangi xodim ko‘radigan kirish videolari. Ko‘rish sahifasi: `/kirish`.

### Preboarding

Yo‘l: `/admin/preboarding`

Ish boshlashdan oldingi kursni joylash va tahrirlash. Xodim ko‘radigan sahifa: `/preboarding`.

### Darslik joylash

Yo‘l: `/admin/darsliklar`

Lavozim bo‘yicha darsliklar. Xodim ko‘radigan sahifa: `/darsliklar`.

### Atestatsiya joylash

Yo‘l: `/admin/atestatsiya`

Imtihon va o‘tish balli. Xodim ko‘radigan sahifa: `/atestatsiya`.

---

## Admin menyusida alohida chiqmaydigan, lekin bor sahifalar

| Sahifa | Yo‘l | Izoh |
| --- | --- | --- |
| Bildirishnomalar | `/notifications` | Qo‘ng‘iroq belgisi |
| Chat | `/chat` | Ichki yozishma |
| Reyting | `/reyting` | Ballar |
| Texnik bo‘lim | `/texnik` | Texnik murojaat |
| Nazorat | `/nazorat` | Nazorat oynasi |
| Distribyutsiya | `/distribyutsiya` | Menyu asosan distribyutsiya rahbari va HR da. Admin boshqaruv huquqiga ega |
| Telegram kirish | `/tg` | Botdan kirish |

---

## Davomat holatlari

| Holat | Ma’nosi | Jarima |
| --- | --- | --- |
| O‘z vaqtida keldi | Kelish vaqti + imtiyoz ichida | Yo‘q |
| Kechikib keldi | Imtiyozdan keyin kelgan | Ha |
| Keldi, ketish yozilmagan | Keldim bor, Ketdim yo‘q | Hisobotda alohida |
| Kelmagan | Ish kunida kelmagan | Ha |
| Ta’til | Ta’til yoki javob kuni (eski hisob) | Yo‘q |
| Dam | Ofis shanba–yakshanba | Yo‘q |
| Sababli | Admin/HR yoki HR tasdiqlagan javob olish | Yo‘q |
| Ishga qabul qilinmagan | Shu oyda, ishga kirishdan oldingi kun | Yo‘q |
| Qo‘shimcha ish | Dam kunida ixtiyoriy kelgan ofis xodimi | Yo‘q |

Jarima 2026-10-01 dan boshlanadi. Sababli, dam, ta’til, ishga qabul qilinmagan kun va bo‘shatilgandan keyingi kun hisobga kirmaydi.

---

## Kim nima qila oladi (qisqa)

| Ish | Kim |
| --- | --- |
| Foydalanuvchi yaratish, o‘chirish, bo‘shatish | Faqat admin |
| Smena va shu xodimning kelish–ketish vaqtini o‘zgartirish | Faqat admin |
| Davomatni qo‘lda bekor qilish | Faqat admin |
| Davomat vaqtini qo‘lda yozish | Admin va HR direktor |
| Sababli qilish | Admin va HR menejer |
| Javob olishni yakuniy tasdiqlash | HR; admin ham yopishi mumkin |
| Filial va dorixona xodimini qo‘shish yoki o‘chirish | Admin va HR menejer |
| Ko‘chma va qurilmani o‘zgartirish | Faqat admin |
| Hisobotni ko‘rish | Admin, rahbariyat, HR, koordinator (o‘z doirasi) |

Koordinator faqat o‘z filiallarini ko‘radi. Bo‘lim boshlig‘i o‘z bo‘limini ko‘radi. Admin hamma joyni ko‘radi.
