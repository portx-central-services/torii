import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import 'virtual:uno.css';
import '@unocss/reset/tailwind.css';
import './app.css';
import { AuthProvider } from './auth/AuthProvider.js';
import { RequireAdmin, RequireAuth, RequirePM } from './auth/RequireAuth.js';
import { NavShell } from './components/NavShell.js';
import { SignInPage } from './routes/signin.js';
import { PortfolioDashboardPage } from './routes/dashboard.js';
import { CustomersListPage } from './routes/customers-list.js';
import { CustomerDetailPage } from './routes/customer-detail.js';
import { PeopleListPage } from './routes/people-list.js';
import { ProjectsListPage } from './routes/projects-list.js';
import { ProjectDetailPage } from './routes/project-detail.js';
import { CapacityPage } from './routes/capacity.js';
import { RisksPage } from './routes/risks.js';
import { TimelinePage } from './routes/timeline.js';
import { PersonDetailPage } from './routes/person-detail.js';
import { TrackersPage } from './routes/trackers.js';
import { InsightsPage } from './routes/insights.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Routes>
            <Route path="/signin" element={<SignInPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <NavShell />
                </RequireAuth>
              }
            >
              <Route index element={<PortfolioDashboardPage />} />
              <Route path="customers" element={<CustomersListPage />} />
              <Route path="customers/:id" element={<CustomerDetailPage />} />
              <Route path="projects" element={<ProjectsListPage />} />
              <Route path="projects/:id" element={<ProjectDetailPage />} />
              <Route path="people" element={<PeopleListPage />} />
              <Route path="people/:id" element={<PersonDetailPage />} />
              <Route path="capacity" element={<CapacityPage />} />
              <Route path="risks" element={<RisksPage />} />
              <Route path="timeline" element={<TimelinePage />} />
              <Route
                path="insights"
                element={
                  <RequirePM>
                    <InsightsPage />
                  </RequirePM>
                }
              />
              <Route
                path="trackers"
                element={
                  <RequireAdmin>
                    <TrackersPage />
                  </RequireAdmin>
                }
              />
            </Route>
          </Routes>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
