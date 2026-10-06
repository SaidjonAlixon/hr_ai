# VPS’ga ko‘chish — Vercel + Neon o‘rniga bitta server

Server: Ubuntu 24.04, 4 vCPU, 8 GB RAM, 120 GB (eskiz.uz). Bu loyiha uchun yetarli va zaxira bilan.

```
Brauzer / Telegram ──HTTPS──► nginx ──► dist/public (frontend)
                                  └──► /api → Node (pm2, 1 nusxa, :8080) ──► PostgreSQL (localhost)
```

## Hozirgi holat (2026-10-06 dan)

| Nima | Qayerda |
|------|---------|
| Platforma | **https://vaksinahr.uz** (va `www`) — VPS `189.74.99.250`, DNS eskiz’da |
| Baza | VPS’dagi PostgreSQL 18 (`hr`), Neon ishlatilmaydi |
| Fayllar | `/opt/hr_ai/artifacts/api-server/uploads/` (Vercel Blob’dagilar `uploads/blob/` ga ko‘chirilgan) |
| Telegram | HR bot va «Vaksina lokatsiya» bot webhook’lari → `https://vaksinahr.uz/api/...` |
| Eski manzil | `hr-ai-gamma.vercel.app` → `vaksinahr.uz` ga 308 yo‘naltiradi (Vercel o‘chirilsa — shunchaki ishlamaydi) |
| Zaxira | `/var/backups/hr/` har 6 soatda (14 kun), `weekly/` (90 kun), `archive/` — Neon va Blob’ning yakuniy nusxasi (doimiy) |
| Nazorat | pm2 (yiqilsa ko‘taradi), `watchdog.sh` har 2 daqiqada (qotsa qayta ishga tushiradi), server qayta yonsa hammasi o‘zi turadi |

Fayllar `deploy/` papkasida:

| Fayl | Nima qiladi |
|------|-------------|
| `setup-server.sh` | Toza serverni bir marta tayyorlaydi: Node 24, pnpm, pm2, PostgreSQL, nginx, firewall, swap, backup, watchdog |
| `deploy.sh` | Yangi kodni chiqaradi: git pull → build → frontend almashtirish → API qayta ishga tushirish → tekshiruv |
| `backup-db.sh` | Har 6 soatda `pg_dump` + `uploads/` + `.env`, 14 kun; yakshanba nusxasi 90 kun |
| `watchdog.sh` | `/api/healthz` javob bermasa API’ni qayta ishga tushiradi |
| `migrate-from-neon.sh` | Neon → lokal baza nusxa (endi faqat tarix uchun) |
| `mirror-vercel-blob.mjs` | Vercel Blob → `uploads/blob/` (bajarilgan) |
| `ecosystem.config.cjs` | pm2 sozlamasi (faqat 1 nusxa) |
| `nginx/hr.conf` | nginx: statik frontend, `/api` proxy, SSE, kesh sarlavhalari |
| `vps.env.example` | `.env` namunasi |

---

## 0. Oldindan bilish kerak bo‘lgan 5 narsa

1. **API faqat 1 nusxada ishlaydi.** Fon ishlari (eslatmalar, davomat, eskalatsiya) jarayon ichida ishlaydi. 2 nusxa = har bildirishnoma 2 marta. `ecosystem.config.cjs` dagi `instances: 1` ni o‘zgartirmang.
2. **Vercel’da ishlamagan fon ishlari yoqiladi:** reviziya ogohlantirishlari, javob olish eskalatsiyasi, ops-ticket eskalatsiyasi, bo‘shatilganlarni tozalash. Ko‘chishdan keyin yangi bildirishnomalar chiqishi — normal.
3. **Domen o‘zgaradi** → hamma bir marta qayta login qiladi; barmoq izi / Passkey qayta ulanadi; brauzer push bildirishnomalariga qayta ruxsat beriladi.
4. **`SESSION_SECRET` va `FACE_DESCRIPTOR_KEY` Vercel’dagi bilan aynan bir xil bo‘lsin** — Face ID vektorlari shu kalit bilan shifrlangan.
5. **Endi zaxira sizning javobgarligingizda.** `backup-db.sh` har kecha ishlaydi; tashqi nusxa uchun `BACKUP_RSYNC_TARGET` sozlang (6-bo‘lim).

---

## 1. Domen

Domen kerak (masalan `hr.vaksina.uz`). DNS’da **A yozuvi → `189.74.99.250`**.
Ko‘chishdan 1 kun oldin TTL ni 300 qiling.

Neon versiyasini bilib oling (Neon → SQL Editor):

```sql
SELECT version();   -- masalan "PostgreSQL 17.x" → PG_MAJOR=17
```

## 2. Serverni tayyorlash (bir marta, ~10 daqiqa)

```bash
ssh root@189.74.99.250
curl -fsSL https://raw.githubusercontent.com/SaidjonAlixon/hr_ai/main/deploy/setup-server.sh -o setup.sh
HR_DOMAIN=hr.vaksina.uz CERT_EMAIL=admin@vaksina.uz PG_MAJOR=17 bash setup.sh
```

Repo private bo‘lsa: avval serverda `ssh-keygen -t ed25519`, `~/.ssh/id_ed25519.pub` ni GitHub → repo → Settings → Deploy keys ga qo‘shing va `REPO_URL=git@github.com:SaidjonAlixon/hr_ai.git` bilan ishga tushiring.

Skript oxirida DB paroli `/root/.hr-db-password` da, `.env` esa `/opt/hr_ai/.env` da yaratiladi (DATABASE_URL va PUBLIC_APP_URL allaqachon yozilgan).

## 3. `.env` ni to‘ldirish

```bash
nano /opt/hr_ai/.env
```

Vercel → Project → Settings → Environment Variables dagi qiymatlarni ko‘chiring:
`SESSION_SECRET`, `FACE_DESCRIPTOR_KEY`, `CRON_SECRET`, `TELEGRAM_*`, `VAPID_*`, `OPENAI_API_KEY`, `BLOB_READ_WRITE_TOKEN` (bo‘lsa), `VAKSINAMED_*` (bo‘lsa).
**`DATABASE_URL` va `PUBLIC_APP_URL` ga tegmang** — ular yangi serverniki.

## 4. Ma’lumotni Neon’dan ko‘chirish

### 4.1. Sinov (ish vaqtida, hech narsa o‘chmaydi)

Neon → Connection string → **Pooled emas, Direct** (hostda `-pooler` yo‘q) URL’ni oling.

Sinov paytida `.env` da `BACKGROUND_JOBS=0` turishi shart — aks holda VPS ham Vercel bilan birga xodimlarga eslatma yuboradi.

```bash
sudo -iu hrapp NEON_URL='postgresql://USER:PASS@ep-xxx.REGION.aws.neon.tech/neondb?sslmode=require' \
  bash /opt/hr_ai/deploy/migrate-from-neon.sh
sudo -iu hrapp bash /opt/hr_ai/deploy/deploy.sh
```

Skript oxirida asosiy jadvallar sonini Neon bilan solishtiradi — hammasi `OK` bo‘lishi kerak.

Endi `https://hr.vaksina.uz` ochiladi — login, davomat, Face ID, fayllarni tekshiring. Bu sinov — Telegram botlar hali Vercel’da, sinovda kiritilgan ma’lumot haqiqiy ko‘chishda ustidan yoziladi.

### 4.2. Haqiqiy ko‘chish (kechasi, ~15–30 daqiqa)

Dump olingandan keyin Neon’ga yozilgan ma’lumot ko‘chmaydi — shuning uchun xodimlar ishlamaydigan vaqtda:

```bash
sudo -iu hrapp pm2 stop hr-api
sudo -iu hrapp NEON_URL='...4.1 dagi bilan bir xil...' bash /opt/hr_ai/deploy/migrate-from-neon.sh
sudo -iu hrapp sed -i 's/^BACKGROUND_JOBS=.*/BACKGROUND_JOBS=1/' /opt/hr_ai/.env
sudo -iu hrapp pm2 restart hr-api --update-env
```

## 5. Telegram va Vercel’ni yangi serverga o‘tkazish

```bash
SECRET="$(grep ^CRON_SECRET= /opt/hr_ai/.env | cut -d= -f2-)"
# HR bot webhook → yangi domen
curl -X POST https://hr.vaksina.uz/api/telegram/setup -H "Authorization: Bearer $SECRET"
# Filial (lokatsiya) bot webhook
curl -X POST https://hr.vaksina.uz/api/telegram-filial/setup -H "x-setup-secret: $SECRET"
```

**BotFather** → `/mybots` → bot → Bot Settings → **Menu Button** va **Configure Mini App** → `https://hr.vaksina.uz`.

**Vercel’ni o‘chirish (muhim):** Vercel → Project → Settings → Cron Jobs’ni o‘chiring yoki loyihani Pause qiling. Aks holda Vercel cron’lari Neon’dagi eski ma’lumot bo‘yicha bildirishnoma yuborishda davom etadi. Neon’ni 1–2 hafta zaxira sifatida qoldirib, keyin o‘chiring.

## 6. Zaxira (backup)

`setup-server.sh` har kecha 03:15 da `deploy/backup-db.sh` ni ishga tushiradi → `/var/backups/hr/`.

```bash
sudo -iu hrapp bash /opt/hr_ai/deploy/backup-db.sh   # qo‘lda
ls -lh /var/backups/hr/
tail -n 20 /var/log/hr-backup.log
```

Server butunlay yo‘qolsa ham zaxira qolishi uchun — boshqa server/kompyuterga nusxa:
`crontab -u hrapp -e` → qatorni `BACKUP_RSYNC_TARGET=user@backup-host:/backups/hr/ /opt/hr_ai/deploy/backup-db.sh ...` qiling (SSH kalit bilan).
Qo‘shimcha: eskiz paneldan haftalik snapshot.

Tiklash:

```bash
pg_restore --clean --if-exists --no-owner -d "$LOCAL_URL" /var/backups/hr/db-YYYYMMDD-HHMM.dump
```

## 7. Har kungi ish

| Vazifa | Buyruq |
|--------|--------|
| Yangi kodni chiqarish (git push’dan keyin) | `sudo -iu hrapp bash /opt/hr_ai/deploy/deploy.sh` |
| Loglar | `sudo -iu hrapp pm2 logs hr-api --lines 200` |
| Holat / xotira | `sudo -iu hrapp pm2 monit` |
| API’ni qayta ishga tushirish | `sudo -iu hrapp pm2 restart hr-api` |
| Disk | `df -h` |
| Sekin so‘rovlar (1s+) | `sudo tail -f /var/log/postgresql/postgresql-*-main.log` |
| Oldingi frontendga qaytish | `cd /opt/hr_ai/artifacts/vaksina-hr/dist && mv public public.bad && mv public.prev public` |

Tashqi monitoring (bepul): UptimeRobot → `https://hr.vaksina.uz/api/healthz` har 5 daqiqa.

## 8. Xavfsizlik (bir marta)

```bash
# SSH faqat kalit bilan (avval o‘z kalitingizni ~/.ssh/authorized_keys ga qo‘shib tekshiring!)
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

`setup-server.sh` allaqachon: firewall (faqat 22/80/443), fail2ban, avtomatik xavfsizlik yangilanishlari, Postgres faqat `localhost`, ilova root emas — `hrapp` foydalanuvchisi ostida.

## 9. Muammo bo‘lsa

| Belgi | Tekshiring |
|-------|------------|
| Sayt ochilmaydi | `systemctl status nginx`, `nginx -t`, DNS A yozuvi |
| 502 Bad Gateway | API o‘chgan: `pm2 logs hr-api` |
| Login 503 | `.env` dagi `DATABASE_URL`, `systemctl status postgresql` |
| Face ID hammaga «mos kelmadi» | `SESSION_SECRET` / `FACE_DESCRIPTOR_KEY` Vercel’dagidan farq qiladi |
| Telegram javob bermaydi | 5-bo‘limdagi setup buyruqlari, `.env` dagi tokenlar |
| Bildirishnoma 2 marta | Vercel cron’lari hali yoniq yoki pm2’da 2 nusxa (`pm2 ls`) |
