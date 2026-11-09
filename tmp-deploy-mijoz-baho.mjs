import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const SSH_KEY = path.join(os.homedir(), ".ssh", "id_ed25519_hr_vps");
const SSH_HOST = "root@vaksinahr.uz";
const SSH_OPTS = ["-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes", "-o", "ConnectTimeout=30"];

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 40 * 1024 * 1024,
    ...opts,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim() || `exit ${r.status}`;
    throw new Error(`${cmd} ${args.join(" ")} failed: ${err}`);
  }
  return r.stdout || "";
}

function ssh(remoteCmd) {
  return run("ssh", [...SSH_OPTS, SSH_HOST, remoteCmd]);
}

function scp(local, remote) {
  return run("scp", [...SSH_OPTS, local, `${SSH_HOST}:${remote}`]);
}

const paths = [
  "artifacts/api-server/package.json",
  "artifacts/api-server/src/jobs/explanation-report.ts",
  "artifacts/api-server/src/lib/attendance-jarima.ts",
  "artifacts/api-server/src/lib/customer-ratings-core.ts",
  "artifacts/api-server/src/lib/customer-ratings.test.ts",
  "artifacts/api-server/src/lib/customer-ratings.ts",
  "artifacts/api-server/src/lib/discipline.ts",
  "artifacts/api-server/src/lib/explanation-letter-report.ts",
  "artifacts/api-server/src/lib/explanation-letter.ts",
  "artifacts/api-server/src/lib/jarima-switch.ts",
  "artifacts/api-server/src/routes/customer-ratings.ts",
  "artifacts/api-server/src/routes/discipline.ts",
  "artifacts/api-server/src/routes/index.ts",
  "artifacts/vaksina-hr/src/App.tsx",
  "artifacts/vaksina-hr/src/components/explanation-letter/StageLadder.tsx",
  "artifacts/vaksina-hr/src/components/layout/Layout.tsx",
  "artifacts/vaksina-hr/src/i18n/I18nProvider.tsx",
  "artifacts/vaksina-hr/src/i18n/locales/ru.ts",
  "artifacts/vaksina-hr/src/i18n/locales/uz.ts",
  "artifacts/vaksina-hr/src/lib/customer-rating-qr-pdf.ts",
  "artifacts/vaksina-hr/public/vaksina-syringe-icon.png",
  "artifacts/vaksina-hr/public/vaksinahr_logo.png",
  "artifacts/vaksina-hr/public/logo_vaksina.png",
  "artifacts/vaksina-hr/src/lib/discipline-api.ts",
  "artifacts/vaksina-hr/src/lib/explanation-letters-api.ts",
  "artifacts/vaksina-hr/src/pages/baho/public-rate.tsx",
  "artifacts/vaksina-hr/src/pages/mijozlar-baholashi/index.tsx",
  "artifacts/vaksina-hr/src/pages/oylik/discipline-panel.tsx",
  "artifacts/vaksina-hr/src/pages/oylik/explanation-letters.tsx",
  "artifacts/vaksina-hr/src/pages/oylik/jarima-panel.tsx",
  "artifacts/vaksina-hr/src/pages/reyting/customer-board.tsx",
  "artifacts/vaksina-hr/src/pages/reyting/index.tsx",
  "artifacts/vaksina-hr/src/pages/tushuntirish-xatim.tsx",
  "lib/db/src/schema/customer-ratings.ts",
  "lib/db/src/schema/index.ts",
  "tmp-deploy-mijoz-baho.sh",
];

for (const p of paths) {
  if (!fs.existsSync(path.join(ROOT, p))) throw new Error(`Missing: ${p}`);
}

const tarLocal = path.join(ROOT, "tmp-mijoz-baho.tar");
const tarRemote = "/tmp/mijoz-baho.tar";
const listFile = path.join(ROOT, "tmp-mijoz-baho-files.txt");
fs.writeFileSync(listFile, paths.join("\n") + "\n", "utf8");

console.log("==> tar");
run("tar", ["-cf", tarLocal, "-T", listFile], { cwd: ROOT, shell: false });

console.log("==> scp bundle");
scp(tarLocal, tarRemote);

console.log("==> extract on VPS");
ssh(`set -e; cd /opt/hr_ai; tar -xf ${tarRemote}; rm -f ${tarRemote}; chmod +x tmp-deploy-mijoz-baho.sh`);

console.log("==> build + pm2");
const out = ssh("bash /opt/hr_ai/tmp-deploy-mijoz-baho.sh");
process.stdout.write(out);

console.log("==> public smoke");
const smoke = ssh(
  `curl -s -o /dev/null -w '%{http_code}' https://vaksinahr.uz/api/healthz; echo; curl -s -o /dev/null -w '%{http_code}' https://vaksinahr.uz/mijozlar-baholashi; echo`,
);
process.stdout.write(smoke);

try {
  fs.unlinkSync(tarLocal);
  fs.unlinkSync(listFile);
} catch {
  /* ignore */
}

console.log("DONE");
