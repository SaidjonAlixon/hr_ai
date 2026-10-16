/**
 * Test farmasevt: birinchi telefon asosiy, boshqa qurilmadan kirish blok.
 * Usage (VPS): node scripts/seed-device-test-user.mjs
 */
import pg from "pg";

const LOGIN = "device_test";
const PASSWORD = "TestDevice1!";
const FULL_NAME = "Qurilma Test Farmasevt";
const ROLE = "farmasevt";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL kerak");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url });

try {
  await pool.query(`
    INSERT INTO device_security_settings (id)
    SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM device_security_settings WHERE id = 1)
  `);
  await pool.query(`
    UPDATE device_security_settings
    SET
      enforcement_mode = 'pharmacy',
      pharmacy_max_devices = 1,
      pharmacy_require_approve = FALSE,
      pharmacy_block_foreign = TRUE,
      updated_at = NOW()
    WHERE id = 1
  `);

  const existing = await pool.query(
    `SELECT id FROM users WHERE lower(login) = lower($1) LIMIT 1`,
    [LOGIN],
  );

  let userId;
  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    await pool.query(
      `UPDATE users
       SET full_name = $2, role = $3, password = $4, status = 'active',
           device_security_enforced = TRUE
       WHERE id = $1`,
      [userId, FULL_NAME, ROLE, PASSWORD],
    );
    console.log("Updated user id=", userId);
  } else {
    const ins = await pool.query(
      `INSERT INTO users (full_name, role, login, password, status, device_security_enforced)
       VALUES ($1, $2, $3, $4, 'active', TRUE)
       RETURNING id`,
      [FULL_NAME, ROLE, LOGIN, PASSWORD],
    );
    userId = ins.rows[0].id;
    console.log("Created user id=", userId);
  }

  // Toza test: eski qurilmalar/sessiyalar tozalansin
  await pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM device_change_requests WHERE user_id = $1`, [userId]);
  await pool.query(`DELETE FROM user_devices WHERE user_id = $1`, [userId]);

  const settings = await pool.query(
    `SELECT enforcement_mode, pharmacy_max_devices, pharmacy_require_approve, pharmacy_block_foreign
     FROM device_security_settings WHERE id = 1`,
  );

  console.log(JSON.stringify({
    ok: true,
    login: LOGIN,
    password: PASSWORD,
    role: ROLE,
    userId,
    settings: settings.rows[0],
    howToTest: [
      "1) Telefon A da login → kiradi, shu telefon asosiy bo‘ladi",
      "2) Chiqib qayta kirish (shu telefon) → yana ishlaydi",
      "3) Telefon B / boshqa brauzer da login → blok + adminga so‘rov",
      "4) Admin /admin/qurilmalar dan tasdiqlasa → B asosiy, A ishlamaydi",
    ],
  }, null, 2));
} finally {
  await pool.end();
}
