import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, useEffect, type ReactNode } from 'react';
import { lazyPage } from './lib/route-prefetch';
import { ThemeProvider } from './components/theme-provider';
import { I18nProvider } from './i18n/I18nProvider';
import { Toaster } from './components/ui/toaster';
import { TooltipProvider } from './components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from 'wouter';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Layout } from './components/layout/Layout';
import { StudentShell } from './components/student/StudentShell';
import { isStudentRole } from './lib/roles';
import { RealtimeSync } from './lib/realtime-sync';
import { DeviceSecurityListener } from './components/DeviceSecurityListener';
import { PharmacyFaceGate } from './components/PharmacyFaceGate';
import { DisciplineLockOverlay } from './components/DisciplineLockOverlay';
import { ExplanationLetterPrompt } from './components/explanation-letter/ExplanationLetterPrompt';
import { CallLayer } from './components/calls/CallLayer';
import { AI_CHAT_ENABLED } from './lib/chat-flag';

// Login asosiy paketda qoladi. Qolgan sahifalar kirish/yangilashda birga tahlil qilinmasin.
import Login from './pages/login';
import NotFound from './pages/not-found';

const Dashboard = lazyPage('/dashboard', () => import('./pages/dashboard'));
const RequestsList = lazyPage('/requests', () => import('./pages/requests/index'));
const NewRequest = lazyPage('/requests/new', () => import('./pages/requests/new'));
const RequestDetails = lazyPage([], () => import('./pages/requests/show'));
const VacanciesList = lazyPage('/vacancies', () => import('./pages/vacancies/index'));
const NewVacancy = lazyPage('/vacancies/new', () => import('./pages/vacancies/new'));
const VacancyDetails = lazyPage([], () => import('./pages/vacancies/show'));
const CandidatesList = lazyPage('/candidates', () => import('./pages/candidates/index'));
const NewCandidate = lazyPage('/candidates/new', () => import('./pages/candidates/new'));
const CandidateProfile = lazyPage([], () => import('./pages/candidates/show'));
const InternshipsPage = lazyPage('/internships', () => import('./pages/internships/index'));
const OquvchilarPage = lazyPage('/oquvchilar', () => import('./pages/oquvchilar/index'));
const PharmacyNetworkPage = lazyPage('/pharmacy-network', () => import('./pages/pharmacy-network/index'));
const TashkiliyTuzilmaPage = lazyPage('/tashkiliy-tuzilma', () => import('./pages/tashkiliy-tuzilma/index'));
const VazifalarPage = lazyPage('/vazifalar', () => import('./pages/vazifalar/index'));
const VazifalarTahlilPage = lazyPage('/vazifalar/tahlil', () => import('./pages/vazifalar/tahlil'));
const EslatmalarPage = lazyPage('/eslatmalar', () => import('./pages/eslatmalar/index'));
const KirishPage = lazyPage('/kirish', () => import('./pages/kirish/index'));
const DarsliklarPage = lazyPage('/darsliklar', () => import('./pages/darsliklar/index'));
const AtestatsiyaPage = lazyPage('/atestatsiya', () => import('./pages/atestatsiya/index'));
const EhtiyojPage = lazyPage('/ehtiyoj', () => import('./pages/ehtiyoj/index'));
const XodimKerakPage = lazyPage('/xodim-kerak', () => import('./pages/xodim-kerak/index'));
const ChecklistPage = lazyPage('/checklist', () => import('./pages/checklist/index'));
const ChecklistHolatiPage = lazyPage('/checklist-holati', () => import('./pages/checklist-holati/index'));
const OylikPage = lazyPage('/oylik', () => import('./pages/oylik/index'));
const HisobkitobPage = lazyPage('/hisobkitob', () => import('./pages/hisobkitob/index'));
const ReviziyaPage = lazyPage('/reviziya', () => import('./pages/reviziya/index'));
const ReviziyaDocPage = lazyPage('/reviziya/hujjat', () => import('./pages/reviziya/show'));
const OpsDeptPage = lazyPage(['/it', '/texnik'], () => import('./pages/ops-dept/index'));
const ReytingPage = lazyPage('/reyting', () => import('./pages/reyting/index'));
const AdminHolatPage = lazyPage('/admin/holat', () => import('./pages/admin/holat'));
const XodimHisobotPage = lazyPage('/admin/holat/xodim', () => import('./pages/admin/xodim-hisobot'));
const HisobotTasdiqPage = lazyPage([], () => import('./pages/hisobot-tasdiq'));
const AdminUsersPage = lazyPage('/admin/users', () => import('./pages/admin/users'));
const BoshatilganlarPage = lazyPage('/admin/boshatilganlar', () => import('./pages/admin/boshatilganlar'));
const AdminDepartmentsPage = lazyPage('/admin/departments', () => import('./pages/admin/departments'));
const AdminKirishVideosPage = lazyPage('/admin/kirish-videolar', () => import('./pages/admin/kirish-videos'));
const AdminPreboardingPage = lazyPage('/admin/preboarding', () => import('./pages/admin/preboarding'));
const PreboardingPage = lazyPage('/preboarding', () => import('./pages/preboarding/index'));
const AdminDarsliklarPage = lazyPage('/admin/darsliklar', () => import('./pages/admin/darsliklar'));
const AdminAtestatsiyaPage = lazyPage('/admin/atestatsiya', () => import('./pages/admin/atestatsiya'));
const AdminAtestatsiyaBazaPage = lazyPage('/admin/atestatsiya/baza', () => import('./pages/admin/atestatsiya-baza'));
const AdminFacesPage = lazyPage('/admin/faces', () => import('./pages/admin/faces'));
const AdminDavomatQrPage = lazyPage('/admin/davomat-qr', () => import('./pages/admin/davomat-qr'));
const AdminTestPage = lazyPage('/admin/test', () => import('./pages/admin/test'));
const AdminScannerPage = lazyPage('/admin/scanner', () => import('./pages/admin/scanner'));
const YordamchiAiPage = lazyPage('/admin/yordamchi-ai', () => import('./pages/admin/yordamchi-ai'));
const YordamPage = lazyPage('/yordam', () => import('./pages/yordam'));
const AdminTushuntirishXatlariPage = lazyPage('/admin/tushuntirish-xatlari', () => import('./pages/admin/tushuntirish-xatlari'));
const AdminJarimalarPage = lazyPage('/admin/jarimalar', () => import('./pages/admin/jarimalar'));
const TushuntirishXatimPage = lazyPage('/tushuntirish-xatim', () => import('./pages/tushuntirish-xatim'));
const AbetPage = lazyPage('/abet', () => import('./pages/abet'));
const AdminQurilmalarPage = lazyPage('/admin/qurilmalar', () => import('./pages/admin/qurilmalar'));
const AdminKochmaDavomatPage = lazyPage('/admin/kochma-davomat', () => import('./pages/admin/kochma-davomat'));
const AdminKochmaXaritaPage = lazyPage('/admin/kochma-xarita', () => import('./pages/admin/kochma-xarita'));
const AdminKochmaLivePage = lazyPage('/admin/kochma-live', () => import('./pages/admin/kochma-live'));
const PublicFilialMapPage = lazyPage([], () => import('./pages/filiallar/index'));
const DavomatKochmaPage = lazyPage('/davomat-kochma', () => import('./pages/davomat/kochma'));
const LogistikaPage = lazyPage('/logistika', () => import('./pages/logistika/index'));
const DistribyutsiyaPage = lazyPage('/distribyutsiya', () => import('./pages/distribyutsiya/index'));
const OmborxonaIshPage = lazyPage('/omborxona-ish', () => import('./pages/omborxona-ish/index'));
const EmployeesPage = lazyPage('/employees', () => import('./pages/employees/index'));
const EmployeesOtherPage = lazyPage('/employees/other', () => import('./pages/employees/other'));
const EmployeeDuplicatesPage = lazyPage('/employees/duplicates', () => import('./pages/employees/duplicates'));
const DavomatPage = lazyPage('/davomat', () => import('./pages/davomat/index'));
const DavomatXatoliklarPage = lazyPage('/davomat/xatoliklar', () => import('./pages/davomat/xatoliklar'));
const DavomatBloklashPage = lazyPage('/davomat/bloklash', () => import('./pages/davomat/bloklash'));
const DorixonaOchilishiPage = lazyPage('/davomat/dorixona-ochilishi', () => import('./pages/davomat/dorixona-ochilishi'));
const DavomatFacePage = lazyPage([], () => import('./pages/davomat/face'));
const DavomatQrPage = lazyPage('/davomat-qr', () => import('./pages/davomat/qr'));
const DavomatOfisdaPage = lazyPage('/davomat/ofisda', () => import('./pages/davomat/ofisda'));
const SmenaFilialPage = lazyPage('/smena-filial', () => import('./pages/smena-filial/index'));
const BoglanishPage = lazyPage('/boglanish', () => import('./pages/boglanish/index'));
const NotificationsPage = lazyPage('/notifications', () => import('./pages/notifications/index'));
const TgEntryPage = lazyPage([], () => import('./pages/tg-entry'));
const JavobOlishPage = lazyPage('/javob-olish', () => import('./pages/javob-olish/index'));
const JavobOlishHolatPage = lazyPage('/javob-olish/holat', () => import('./pages/javob-olish/holat'));
const ResepsionPage = lazyPage('/resepsion', () => import('./pages/resepsion/index'));
const TxVerifyPage = lazyPage([], () => import('./pages/tx-verify'));
const QongiroqPage = lazyPage('/qongiroq', () => import('./pages/qongiroq/index'));
const KonferensiyaPage = lazyPage([], () => import('./pages/konferensiya/index'));

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Yuklanmoqda…
    </div>
  );
}

function ItDeptPage() {
  return <OpsDeptPage dept="it" />;
}

function TexnikDeptPage() {
  return <OpsDeptPage dept="texnik" />;
}

function LogistikaIndexRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation('/logistika/dashboard');
  }, [setLocation]);
  return <PageFallback />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => {
        const status = (err as { status?: number } | undefined)?.status;
        if (status === 401 || status === 403 || status === 404 || status === 204) return false;
        return count < 1;
      },
      staleTime: 45_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

/** O‘quvchi faqat /kirish ni ko‘radi — boshqa yo‘llar unga yo‘naltiriladi */
function StudentGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [location] = useLocation();
  if (!isStudentRole(user?.role)) return <>{children}</>;
  if (location !== '/kirish') return <Redirect to="/kirish" />;
  return (
    <StudentShell>
      <Suspense fallback={<PageFallback />}>
        <KirishPage />
      </Suspense>
    </StudentShell>
  );
}

/** O‘quvchiga xodimlar uchun global qatlamlar (qo‘ng‘iroq, realtime, …) kerak emas */
function StaffOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (isStudentRole(user?.role)) return null;
  return <>{children}</>;
}

function ProtectedRoute({ component: Component, ...rest }: any) {
  return (
    <Route {...rest}>
      {params => (
        <StudentGate>
          <Layout>
            <Suspense fallback={<PageFallback />}>
              <Component params={params} />
            </Suspense>
          </Layout>
        </StudentGate>
      )}
    </Route>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      {/* Chat-bot vaqtincha yopilgan — /yordam sahifasi ko‘rinmaydi (AI_CHAT_ENABLED) */}
      {AI_CHAT_ENABLED ? (
        <Route path="/yordam">
          <Suspense fallback={<PageFallback />}>
            <YordamPage />
          </Suspense>
        </Route>
      ) : null}
      <Route path="/filiallar">
        <Suspense fallback={<PageFallback />}>
          <PublicFilialMapPage />
        </Suspense>
      </Route>
      <Route path="/hisobot/tasdiq/:token">
        <Suspense fallback={<PageFallback />}>
          <HisobotTasdiqPage />
        </Suspense>
      </Route>
      <Route path="/tg">
        <Suspense fallback={<PageFallback />}>
          <TgEntryPage />
        </Suspense>
      </Route>
      <Route path="/tx/:token">
        <Suspense fallback={<PageFallback />}>
          <TxVerifyPage />
        </Suspense>
      </Route>
      <Route path="/davomat-face">
        <Suspense fallback={<PageFallback />}>
          <DavomatFacePage />
        </Suspense>
      </Route>
      <Route path="/konferensiya/:code">
        {params => (
          <Suspense fallback={<div className="min-h-[100dvh] bg-slate-950" />}>
            <KonferensiyaPage params={params} />
          </Suspense>
        )}
      </Route>
      <Route path="/davomat/face">
        <Redirect to="/davomat-face" />
      </Route>
      <ProtectedRoute path="/davomat-qr" component={DavomatQrPage} />
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
      
      <ProtectedRoute path="/dashboard" component={Dashboard} />
      
      <ProtectedRoute path="/requests" component={RequestsList} />
      <ProtectedRoute path="/requests/new" component={NewRequest} />
      <ProtectedRoute path="/requests/:id" component={RequestDetails} />

      <Route path="/nazorat">
        {() => {
          window.location.replace('/requests');
          return null;
        }}
      </Route>
      <ProtectedRoute path="/vacancies" component={VacanciesList} />
      <ProtectedRoute path="/vacancies/new" component={NewVacancy} />
      <ProtectedRoute path="/vacancies/:id" component={VacancyDetails} />
      
      <ProtectedRoute path="/candidates" component={CandidatesList} />
      <ProtectedRoute path="/candidates/new" component={NewCandidate} />
      <Route path="/candidates/:id/phone-interview">
        {(params) => <Redirect to={`/candidates/${params.id}`} />}
      </Route>
      <Route path="/candidates/:id/online-interview">
        {(params) => <Redirect to={`/candidates/${params.id}`} />}
      </Route>
      <Route path="/candidates/:id/preboarding">
        {(params) => <Redirect to={`/candidates/${params.id}`} />}
      </Route>
      <Route path="/candidates/:id/offline-interview">
        {(params) => <Redirect to={`/candidates/${params.id}`} />}
      </Route>
      <Route path="/candidates/:id/final-decision">
        {(params) => <Redirect to={`/candidates/${params.id}`} />}
      </Route>
      <Route path="/candidates/:id/offer">
        {(params) => <Redirect to={`/candidates/${params.id}`} />}
      </Route>
      <Route path="/candidates/:id/documents">
        {(params) => <Redirect to={`/candidates/${params.id}`} />}
      </Route>
      <Route path="/candidates/:id/internship">
        {(params) => <Redirect to={`/candidates/${params.id}`} />}
      </Route>
      <ProtectedRoute path="/candidates/:id" component={CandidateProfile} />
      
      <Route path="/interviews">
        <Redirect to="/candidates" />
      </Route>
      <Route path="/pipeline">
        <Redirect to="/candidates" />
      </Route>
      <ProtectedRoute path="/vazifalar/tahlil" component={VazifalarTahlilPage} />
      <ProtectedRoute path="/vazifalar" component={VazifalarPage} />
      <ProtectedRoute path="/eslatmalar" component={EslatmalarPage} />
      <Route path="/chat">
        <Redirect to="/dashboard" />
      </Route>
      <ProtectedRoute path="/kirish" component={KirishPage} />
      <ProtectedRoute path="/preboarding" component={PreboardingPage} />
      <ProtectedRoute path="/darsliklar" component={DarsliklarPage} />
      <ProtectedRoute path="/atestatsiya" component={AtestatsiyaPage} />
      <ProtectedRoute path="/ehtiyoj" component={EhtiyojPage} />
      <ProtectedRoute path="/xodim-kerak" component={XodimKerakPage} />
      <ProtectedRoute path="/checklist" component={ChecklistPage} />
      <ProtectedRoute path="/checklist-holati" component={ChecklistHolatiPage} />
      <ProtectedRoute path="/oylik" component={OylikPage} />
      <ProtectedRoute path="/hisobkitob" component={HisobkitobPage} />
      <ProtectedRoute path="/reviziya/hujjat/:id" component={ReviziyaDocPage} />
      <ProtectedRoute path="/reviziya" component={ReviziyaPage} />
      <ProtectedRoute path="/it" component={ItDeptPage} />
      <ProtectedRoute path="/texnik" component={TexnikDeptPage} />
      <ProtectedRoute path="/reyting" component={ReytingPage} />
      
      <ProtectedRoute path="/employees/duplicates" component={EmployeeDuplicatesPage} />
      <ProtectedRoute path="/employees/other" component={EmployeesOtherPage} />
      <ProtectedRoute path="/employees" component={EmployeesPage} />
      <ProtectedRoute path="/davomat/analytics" component={DavomatPage} />
      <ProtectedRoute path="/davomat/xatoliklar" component={DavomatXatoliklarPage} />
      <ProtectedRoute path="/davomat/bloklash" component={DavomatBloklashPage} />
      <ProtectedRoute path="/davomat/dorixona-ochilishi" component={DorixonaOchilishiPage} />
      <ProtectedRoute path="/davomat/ofisda" component={DavomatOfisdaPage} />
      <ProtectedRoute path="/davomat" component={DavomatPage} />
      <ProtectedRoute path="/davomat-kochma" component={DavomatKochmaPage} />
      <ProtectedRoute path="/smena-filial" component={SmenaFilialPage} />
      <ProtectedRoute path="/javob-olish/holat" component={JavobOlishHolatPage} />
      <ProtectedRoute path="/javob-olish" component={JavobOlishPage} />
      <ProtectedRoute path="/resepsion" component={ResepsionPage} />
      <ProtectedRoute path="/pharmacy-network" component={PharmacyNetworkPage} />
      <ProtectedRoute path="/boglanish" component={BoglanishPage} />
      <ProtectedRoute path="/logistika/:section" component={LogistikaPage} />
      <ProtectedRoute path="/logistika" component={LogistikaIndexRedirect} />
      <ProtectedRoute path="/distribyutsiya" component={DistribyutsiyaPage} />
      <ProtectedRoute path="/omborxona-ish" component={OmborxonaIshPage} />
      <ProtectedRoute path="/tashkiliy-tuzilma" component={TashkiliyTuzilmaPage} />
      <ProtectedRoute path="/internships" component={InternshipsPage} />
      <ProtectedRoute path="/oquvchilar" component={OquvchilarPage} />
      <ProtectedRoute path="/notifications" component={NotificationsPage} />
      <ProtectedRoute path="/qongiroq" component={QongiroqPage} />
      <ProtectedRoute path="/admin/users" component={AdminUsersPage} />
      <ProtectedRoute path="/admin/boshatilganlar" component={BoshatilganlarPage} />
      <ProtectedRoute path="/admin/holat/xodim" component={XodimHisobotPage} />
      <ProtectedRoute path="/admin/holat" component={AdminHolatPage} />
      <ProtectedRoute path="/admin/departments" component={AdminDepartmentsPage} />
      <ProtectedRoute path="/admin/kirish-videolar" component={AdminKirishVideosPage} />
      <ProtectedRoute path="/admin/preboarding" component={AdminPreboardingPage} />
      <ProtectedRoute path="/admin/darsliklar" component={AdminDarsliklarPage} />
      <ProtectedRoute path="/admin/atestatsiya/baza" component={AdminAtestatsiyaBazaPage} />
      <ProtectedRoute path="/admin/atestatsiya" component={AdminAtestatsiyaPage} />
      <ProtectedRoute path="/admin/faces" component={AdminFacesPage} />
      <Route path="/admin/smena-sozlamalar">
        <Redirect to="/oylik?jadval=1" />
      </Route>
      <ProtectedRoute path="/admin/davomat-qr" component={AdminDavomatQrPage} />
      <ProtectedRoute path="/admin/test" component={AdminTestPage} />
      <ProtectedRoute path="/admin/scanner" component={AdminScannerPage} />
      <ProtectedRoute path="/admin/yordamchi-ai" component={YordamchiAiPage} />
      <ProtectedRoute path="/admin/tushuntirish-xatlari" component={AdminTushuntirishXatlariPage} />
      <ProtectedRoute path="/admin/jarimalar" component={AdminJarimalarPage} />
      <ProtectedRoute path="/tushuntirish-xatim" component={TushuntirishXatimPage} />
      <ProtectedRoute path="/abet" component={AbetPage} />
      <ProtectedRoute path="/admin/qurilmalar" component={AdminQurilmalarPage} />
      <ProtectedRoute path="/admin/kochma-davomat" component={AdminKochmaDavomatPage} />
      <ProtectedRoute path="/admin/kochma-xarita" component={AdminKochmaXaritaPage} />
      <ProtectedRoute path="/admin/kochma-live" component={AdminKochmaLivePage} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StaffOnly>
              <RealtimeSync />
              <DeviceSecurityListener />
              <PharmacyFaceGate />
              <DisciplineLockOverlay />
            </StaffOnly>
            <TooltipProvider>
              <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, '') || ''}>
                <Router />
                <StaffOnly>
                  <ExplanationLetterPrompt />
                  <CallLayer />
                </StaffOnly>
              </WouterRouter>
              <Toaster />
            </TooltipProvider>
          </AuthProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

export default App;
