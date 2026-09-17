import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from 'wouter';
import { Eye, EyeOff, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '../components/ui/card';
import { useToast } from '../hooks/use-toast';
import type { User } from '@workspace/api-client-react';
import { compactCredential } from '../lib/utils';
import { ThemeToggle } from '../components/theme-toggle';
import { LanguageSwitcher } from '../components/language-switcher';
import { HELP_ASSISTANT_ENABLED, HelpAssistantDialog } from '../components/HelpAssistantDialog';
import { OperatorHeadsetIcon } from '../components/OperatorHeadsetIcon';
import { useI18n } from '../i18n/I18nProvider';
import { isStajyor, isLimitedOfficeStaffRole } from '../lib/roles';
import { loginWithDevice, requestDeviceChange } from '../lib/device-security-api';

type DeviceGate =
  | null
  | {
      code: 'DEVICE_PENDING' | 'DEVICE_NOT_AUTHORIZED';
      message: string;
      deviceName?: string;
      canRequestChange?: boolean;
    };

export default function Login() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [gate, setGate] = useState<DeviceGate>(null);
  const [requesting, setRequesting] = useState(false);
  const { switchToUser } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useI18n();

  const goAfterLogin = (user: User) => {
    switchToUser(user);
    if (isStajyor(user.role)) {
      setLocation('/kirish');
      return;
    }
    if (isLimitedOfficeStaffRole(user.role)) {
      setLocation('/vazifalar');
      return;
    }
    setLocation('/dashboard');
  };

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const loginTrim = compactCredential(login);
    const passwordTrim = compactCredential(password);
    if (loginTrim !== login) setLogin(loginTrim);
    if (passwordTrim !== password) setPassword(passwordTrim);
    if (!loginTrim || !passwordTrim) return;

    setPending(true);
    setGate(null);
    try {
      const data = await loginWithDevice(loginTrim, passwordTrim);
      goAfterLogin(data.user);
    } catch (err) {
      const data = (err as { data?: Record<string, unknown>; code?: string })?.data || {};
      const code = String((err as { code?: string }).code || data.code || '');
      const message = String(
        data.message || data.error || (err as Error).message || t('login.errorDefault'),
      );
      if (code === 'DEVICE_PENDING' || code === 'DEVICE_NOT_AUTHORIZED') {
        setGate({
          code: code as 'DEVICE_PENDING' | 'DEVICE_NOT_AUTHORIZED',
          message,
          deviceName: (data.device as { name?: string } | undefined)?.name,
          canRequestChange: Boolean(data.canRequestChange) || code === 'DEVICE_NOT_AUTHORIZED',
        });
      } else {
        toast({
          title: t('login.errorTitle'),
          description: message,
          variant: 'destructive',
        });
      }
    } finally {
      setPending(false);
    }
  };

  const handleRequestChange = async () => {
    setRequesting(true);
    try {
      await requestDeviceChange('Login sahifasidan so‘rov');
      toast({
        title: 'So‘rov yuborildi',
        description: 'Administrator tasdig‘ini kuting.',
      });
    } catch (err) {
      toast({
        title: 'Yuborilmadi',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setRequesting(false);
    }
  };

  if (gate) {
    const pendingGate = gate.code === 'DEVICE_PENDING';
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4 dark:from-slate-950 dark:to-slate-900">
        <div className="absolute right-4 top-4 flex gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
        <Card className="w-full max-w-md border-2 shadow-lg">
          <CardHeader className="space-y-3 text-center">
            <div
              className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${
                pendingGate ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
              }`}
            >
              {pendingGate ? <ShieldQuestion className="h-7 w-7" /> : <ShieldAlert className="h-7 w-7" />}
            </div>
            <CardTitle className="text-xl">
              {pendingGate ? 'Yangi qurilma' : 'Qurilma tasdiqlanmagan'}
            </CardTitle>
            <CardDescription className="text-sm leading-relaxed">{gate.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {gate.deviceName ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2">
                <div className="text-xs text-muted-foreground">Qurilma</div>
                <div className="font-medium">{gate.deviceName}</div>
              </div>
            ) : null}
            {pendingGate ? (
              <p className="text-center text-xs text-muted-foreground">
                Status: Tasdiqlash kutilmoqda — admin panelga bildirishnoma yuborildi.
              </p>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                Dashboard, QR va Face ID ochilmaydi. Asosiy qurilmangizdan kiring.
              </p>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            {gate.canRequestChange ? (
              <Button
                className="w-full"
                variant="secondary"
                disabled={requesting}
                onClick={() => void handleRequestChange()}
              >
                Qurilmani almashtirish so‘rash
              </Button>
            ) : null}
            <Button className="w-full" variant="outline" onClick={() => setGate(null)}>
              Orqaga
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#eef1f5] p-4 dark:from-slate-950 dark:to-slate-900 dark:bg-gradient-to-br">
      <div className="absolute right-4 top-4 flex gap-2">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
      <div className="flex w-full max-w-md flex-col items-center gap-5">
        <img
          src={`${import.meta.env.BASE_URL}logo3d-light.png`}
          alt="VAKSINA MED HR"
          width={800}
          height={220}
          decoding="async"
          className="h-28 w-auto max-w-[min(100%,420px)] object-contain sm:h-32"
        />
        <Card className="w-full border-t-[3px] border-t-[#1e3a8a] shadow-lg dark:border-t-primary">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold tracking-tight text-[#1e3a8a] dark:text-foreground">
              {t('login.title')}
            </CardTitle>
            <CardDescription>{t('login.subtitle')}</CardDescription>
          </CardHeader>
          <form onSubmit={(e) => void handleLogin(e)}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login">{t('login.login')}</Label>
                <Input
                  id="login"
                  autoComplete="username"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder={t('login.loginPlaceholder')}
                  className="bg-slate-50 dark:bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t('login.password')}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('login.passwordPlaceholder')}
                    className="bg-slate-50 pr-10 dark:bg-background"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label="Toggle password"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full bg-[#1e3a8a] hover:bg-[#1e3a8a]/90" disabled={pending}>
                {pending ? t('login.submitting') : t('login.submit')}
              </Button>
              {HELP_ASSISTANT_ENABLED ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-2 text-muted-foreground"
                  onClick={() => setHelpOpen(true)}
                >
                  <OperatorHeadsetIcon className="h-4 w-4" />
                  {t('login.help')}
                </Button>
              ) : null}
            </CardFooter>
          </form>
        </Card>
      </div>
      <HelpAssistantDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
