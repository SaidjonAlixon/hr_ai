import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { ThemeProvider } from './components/theme-provider';
import { I18nProvider } from './i18n/I18nProvider';
import { Toaster } from './components/ui/toaster';
import { TooltipProvider } from './components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from 'wouter';
import { AuthProvider } from './contexts/AuthContext';
import { Layout } from './components/layout/Layout';
import { RealtimeSync } from './lib/realtime-sync';
import { DeviceSecurityListener } from './components/DeviceSecurityListener';

// Login asosiy paketda qoladi. Qolgan sahifalar kirish/yangilashda birga tahlil qilinmasin.
import Login from './pages/login';
import NotFound from './pages/not-found';

const Dashboard = lazy(() => import('./pages/dashboard'));
const RequestsList = lazy(() => import('./pages/requests/index'));
const NewRequest = lazy(() => import('./pages/requests/new'));
const RequestDetails = lazy(() => import('./pages/requests/show'));
const VacanciesList = lazy(() => import('./pages/vacancies/index'));
const NewVacancy = lazy(() => import('./pages/vacancies/new'));
const VacancyDetails = lazy(() => import('./pages/vacancies/show'));
const CandidatesList = lazy(() => import('./pages/candidates/index'));
const NewCandidate = lazy(() => import('./pages/candidates/new'));
const CandidateProfile = lazy(() => import('./pages/candidates/show'));
const InternshipsPage = lazy(() => import('./pages/internships/index'));
const PharmacyNetworkPage = lazy(() => import('./pages/pharmacy-network/index'));
const TashkiliyTuzilmaPage = lazy(() => import('./pages/tashkiliy-tuzilma/index'));
const VazifalarPage = lazy(() => import('./pages/vazifalar/index'));
const VazifalarTahlilPage = lazy(() => import('./pages/vazifalar/tahlil'));
const EslatmalarPage = lazy(() => import('./pages/eslatmalar/index'));
const KirishPage = lazy(() => import('./pages/kirish/index'));
const DarsliklarPage = lazy(() => import('./pages/darsliklar/index'));
const AtestatsiyaPage = lazy(() => import('./pages/atestatsiya/index'));
const EhtiyojPage = lazy(() => import('./pages/ehtiyoj/index'));
const XodimKerakPage = lazy(() => import('./pages/xodim-kerak/index'));
const ChecklistPage = lazy(() => import('./pages/checklist/index'));
const ChecklistHolatiPage = lazy(() => import('./pages/checklist-holati/index'));
const OylikPage = lazy(() => import('./pages/oylik/index'));
const HisobkitobPage = lazy(() => import('./pages/hisobkitob/index'));
const ReviziyaPage = lazy(() => import('./pages/reviziya/index'));
const ReviziyaDocPage = lazy(() => import('./pages/reviziya/show'));
const OpsDeptPage = lazy(() => import('./pages/ops-dept/index'));
const ReytingPage = lazy(() => import('./pages/reyting/index'));
const AdminHolatPage = lazy(() => import('./pages/admin/holat'));
const XodimHisobotPage = lazy(() => import('./pages/admin/xodim-hisobot'));
const HisobotTasdiqPage = lazy(() => import('./pages/hisobot-tasdiq'));
const AdminUsersPage = lazy(() => import('./pages/admin/users'));
const BoshatilganlarPage = lazy(() => import('./pages/admin/boshatilganlar'));
const AdminDepartmentsPage = lazy(() => import('./pages/admin/departments'));
const AdminKirishVideosPage = lazy(() => import('./pages/admin/kirish-videos'));
const AdminPreboardingPage = lazy(() => import('./pages/admin/preboarding'));
const PreboardingPage = lazy(() => import('./pages/preboarding/index'));
const AdminDarsliklarPage = lazy(() => import('./pages/admin/darsliklar'));
const AdminAtestatsiyaPage = lazy(() => import('./pages/admin/atestatsiya'));
const AdminFacesPage = lazy(() => import('./pages/admin/faces'));
const AdminSmenaSozlamalarPage = lazy(() => import('./pages/admin/smena-sozlamalar'));
const AdminDavomatQrPage = lazy(() => import('./pages/admin/davomat-qr'));
const AdminTestPage = lazy(() => import('./pages/admin/test'));
const AdminQurilmalarPage = lazy(() => import('./pages/admin/qurilmalar'));
const AdminKochmaDavomatPage = lazy(() => import('./pages/admin/kochma-davomat'));
const AdminKochmaXaritaPage = lazy(() => import('./pages/admin/kochma-xarita'));
const AdminKochmaLivePage = lazy(() => import('./pages/admin/kochma-live'));
const DavomatKochmaPage = lazy(() => import('./pages/davomat/kochma'));
const LogistikaPage = lazy(() => import('./pages/logistika/index'));
const DistribyutsiyaPage = lazy(() => import('./pages/distribyutsiya/index'));
const OmborxonaIshPage = lazy(() => import('./pages/omborxona-ish/index'));
const EmployeesPage = lazy(() => import('./pages/employees/index'));
const EmployeesOtherPage = lazy(() => import('./pages/employees/other'));
const EmployeeDuplicatesPage = lazy(() => import('./pages/employees/duplicates'));
const DavomatPage = lazy(() => import('./pages/davomat/index'));
const DavomatXatoliklarPage = lazy(() => import('./pages/davomat/xatoliklar'));
const DavomatBloklashPage = lazy(() => import('./pages/davomat/bloklash'));
const DorixonaOchilishiPage = lazy(() => import('./pages/davomat/dorixona-ochilishi'));
const DavomatFacePage = lazy(() => import('./pages/davomat/face'));
const DavomatQrPage = lazy(() => import('./pages/davomat/qr'));
const DavomatOfisdaPage = lazy(() => import('./pages/davomat/ofisda'));
const SmenaFilialPage = lazy(() => import('./pages/smena-filial/index'));
const BoglanishPage = lazy(() => import('./pages/boglanish/index'));
const NotificationsPage = lazy(() => import('./pages/notifications/index'));
const TgEntryPage = lazy(() => import('./pages/tg-entry'));
const JavobOlishPage = lazy(() => import('./pages/javob-olish/index'));
const JavobOlishHolatPage = lazy(() => import('./pages/javob-olish/holat'));

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

function ProtectedRoute({ component: Component, ...rest }: any) {
  return (
    <Route {...rest}>
      {params => (
        <Layout>
          <Suspense fallback={<PageFallback />}>
            <Component params={params} />
          </Suspense>
        </Layout>
      )}
    </Route>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
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
      <Route path="/davomat-face">
        <Suspense fallback={<PageFallback />}>
          <DavomatFacePage />
        </Suspense>
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
      <ProtectedRoute path="/pharmacy-network" component={PharmacyNetworkPage} />
      <ProtectedRoute path="/boglanish" component={BoglanishPage} />
      <ProtectedRoute path="/logistika/:section" component={LogistikaPage} />
      <ProtectedRoute path="/logistika" component={LogistikaIndexRedirect} />
      <ProtectedRoute path="/distribyutsiya" component={DistribyutsiyaPage} />
      <ProtectedRoute path="/omborxona-ish" component={OmborxonaIshPage} />
      <ProtectedRoute path="/tashkiliy-tuzilma" component={TashkiliyTuzilmaPage} />
      <ProtectedRoute path="/internships" component={InternshipsPage} />
      <ProtectedRoute path="/notifications" component={NotificationsPage} />
      <ProtectedRoute path="/admin/users" component={AdminUsersPage} />
      <ProtectedRoute path="/admin/boshatilganlar" component={BoshatilganlarPage} />
      <ProtectedRoute path="/admin/holat/xodim" component={XodimHisobotPage} />
      <ProtectedRoute path="/admin/holat" component={AdminHolatPage} />
      <ProtectedRoute path="/admin/departments" component={AdminDepartmentsPage} />
      <ProtectedRoute path="/admin/kirish-videolar" component={AdminKirishVideosPage} />
      <ProtectedRoute path="/admin/preboarding" component={AdminPreboardingPage} />
      <ProtectedRoute path="/admin/darsliklar" component={AdminDarsliklarPage} />
      <ProtectedRoute path="/admin/atestatsiya" component={AdminAtestatsiyaPage} />
      <ProtectedRoute path="/admin/faces" component={AdminFacesPage} />
      <ProtectedRoute path="/admin/smena-sozlamalar" component={AdminSmenaSozlamalarPage} />
      <ProtectedRoute path="/admin/davomat-qr" component={AdminDavomatQrPage} />
      <ProtectedRoute path="/admin/test" component={AdminTestPage} />
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
            <RealtimeSync />
            <DeviceSecurityListener />
            <TooltipProvider>
              <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, '') || ''}>
                <Router />
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
