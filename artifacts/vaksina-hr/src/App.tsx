import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, type ComponentType } from 'react';
import { ThemeProvider } from './components/theme-provider';
import { I18nProvider } from './i18n/I18nProvider';
import { Toaster } from './components/ui/toaster';
import { TooltipProvider } from './components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import { AuthProvider } from './contexts/AuthContext';
import { Layout } from './components/layout/Layout';
import { RealtimeSync } from './lib/realtime-sync';
import { DeviceSecurityListener } from './components/DeviceSecurityListener';

// Pages
import Login from './pages/login';
import Dashboard from './pages/dashboard';
import RequestsList from './pages/requests/index';
import NewRequest from './pages/requests/new';
import RequestDetails from './pages/requests/show';
import VacanciesList from './pages/vacancies/index';
import NewVacancy from './pages/vacancies/new';
import VacancyDetails from './pages/vacancies/show';
import CandidatesList from './pages/candidates/index';
import NewCandidate from './pages/candidates/new';
import CandidateProfile from './pages/candidates/show';
import InternshipsPage from './pages/internships/index';
import PharmacyNetworkPage from './pages/pharmacy-network/index';
import TashkiliyTuzilmaPage from './pages/tashkiliy-tuzilma/index';
import VazifalarPage from './pages/vazifalar/index';
import VazifalarTahlilPage from './pages/vazifalar/tahlil';
import EslatmalarPage from './pages/eslatmalar/index';
import KirishPage from './pages/kirish/index';
import EhtiyojPage from './pages/ehtiyoj/index';
import XodimKerakPage from './pages/xodim-kerak/index';
import ChecklistPage from './pages/checklist/index';
import ChecklistHolatiPage from './pages/checklist-holati/index';
import OylikPage from './pages/oylik/index';
import HisobkitobPage from './pages/hisobkitob/index';
import ReviziyaPage from './pages/reviziya/index';
import ReviziyaDocPage from './pages/reviziya/show';
import OpsDeptPage from './pages/ops-dept/index';
import ReytingPage from './pages/reyting/index';
import AdminHolatPage from './pages/admin/holat';
import AdminUsersPage from './pages/admin/users';
import AdminDepartmentsPage from './pages/admin/departments';
import AdminKirishVideosPage from './pages/admin/kirish-videos';
import AdminFacesPage from './pages/admin/faces';
import AdminSmenaSozlamalarPage from './pages/admin/smena-sozlamalar';
import AdminDavomatQrPage from './pages/admin/davomat-qr';
import AdminTestPage from './pages/admin/test';
import AdminQurilmalarPage from './pages/admin/qurilmalar';
import AdminKochmaDavomatPage from './pages/admin/kochma-davomat';
import AdminKochmaXaritaPage from './pages/admin/kochma-xarita';
import AdminKochmaLivePage from './pages/admin/kochma-live';
import DavomatKochmaPage from './pages/davomat/kochma';
import LogistikaPage, { LogistikaIndexRedirect } from './pages/logistika/index';
import DistribyutsiyaPage from './pages/distribyutsiya/index';
import OmborxonaIshPage from './pages/omborxona-ish/index';
import EmployeesPage from './pages/employees/index';
import EmployeesOtherPage from './pages/employees/other';
import EmployeeDuplicatesPage from './pages/employees/duplicates';
import DavomatPage from './pages/davomat/index';
import DavomatAnalyticsPage from './pages/davomat/analytics';
import DavomatXatoliklarPage from './pages/davomat/xatoliklar';
import DavomatFacePage from './pages/davomat/face';
import DavomatQrPage from './pages/davomat/qr';
import DavomatOfisdaPage from './pages/davomat/ofisda';
import SmenaFilialPage from './pages/smena-filial/index';
import BoglanishPage from './pages/boglanish/index';
import NotificationsPage from './pages/notifications/index';
import TgEntryPage from './pages/tg-entry';
import NotFound from './pages/not-found';

const JavobOlishPage = lazy(() => import('./pages/javob-olish/index'));
const JavobOlishHolatPage = lazy(() => import('./pages/javob-olish/holat'));

function LazyPage({ component: Component }: { component: ComponentType<any> }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
          Yuklanmoqda…
        </div>
      }
    >
      <Component />
    </Suspense>
  );
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
          <Component params={params} />
        </Layout>
      )}
    </Route>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/tg" component={TgEntryPage} />
      <Route path="/davomat-face" component={DavomatFacePage} />
      <ProtectedRoute path="/davomat-qr" component={DavomatQrPage} />
      <Route path="/" component={() => {
        window.location.replace('/dashboard');
        return null;
      }} />
      
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
      <ProtectedRoute path="/ehtiyoj" component={EhtiyojPage} />
      <ProtectedRoute path="/xodim-kerak" component={XodimKerakPage} />
      <ProtectedRoute path="/checklist" component={ChecklistPage} />
      <ProtectedRoute path="/checklist-holati" component={ChecklistHolatiPage} />
      <ProtectedRoute path="/oylik" component={OylikPage} />
      <ProtectedRoute path="/hisobkitob" component={HisobkitobPage} />
      <ProtectedRoute path="/reviziya/hujjat/:id" component={ReviziyaDocPage} />
      <ProtectedRoute path="/reviziya" component={ReviziyaPage} />
      <ProtectedRoute path="/it" component={() => <OpsDeptPage dept="it" />} />
      <ProtectedRoute path="/texnik" component={() => <OpsDeptPage dept="texnik" />} />
      <ProtectedRoute path="/reyting" component={ReytingPage} />
      
      <ProtectedRoute path="/employees/duplicates" component={EmployeeDuplicatesPage} />
      <ProtectedRoute path="/employees/other" component={EmployeesOtherPage} />
      <ProtectedRoute path="/employees" component={EmployeesPage} />
      <ProtectedRoute path="/davomat/analytics" component={DavomatAnalyticsPage} />
      <ProtectedRoute path="/davomat/xatoliklar" component={DavomatXatoliklarPage} />
      <ProtectedRoute path="/davomat/ofisda" component={DavomatOfisdaPage} />
      <ProtectedRoute path="/davomat" component={DavomatPage} />
      <ProtectedRoute path="/davomat-kochma" component={DavomatKochmaPage} />
      <ProtectedRoute path="/smena-filial" component={SmenaFilialPage} />
      <ProtectedRoute path="/javob-olish/holat" component={() => <LazyPage component={JavobOlishHolatPage} />} />
      <ProtectedRoute path="/javob-olish" component={() => <LazyPage component={JavobOlishPage} />} />
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
      <ProtectedRoute path="/admin/holat" component={AdminHolatPage} />
      <ProtectedRoute path="/admin/departments" component={AdminDepartmentsPage} />
      <ProtectedRoute path="/admin/kirish-videolar" component={AdminKirishVideosPage} />
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
