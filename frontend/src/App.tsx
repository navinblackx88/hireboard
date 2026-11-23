import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppLayout, homeFor } from "./components/Layout";
import { ConfirmHost, PageSpinner } from "./components/common";
import { Toaster } from "./components/ui/sonner";
import { useMe } from "./hooks/api";
import type { Role } from "./lib/types";
import { useAuth } from "./stores/auth";
import { Login, Signup } from "./pages/Auth";
import JobsPage from "./pages/Jobs";
import JobDetailPage from "./pages/JobDetail";

const CandidateDashboard = lazy(() => import("./pages/candidate/Dashboard"));
const Resumes = lazy(() => import("./pages/candidate/Resumes"));
const MyApplications = lazy(() => import("./pages/candidate/Applications"));
const ApplicationPage = lazy(() => import("./pages/candidate/ApplicationDetail"));
const EmployerDashboard = lazy(() => import("./pages/employer/Dashboard"));
const JobEditor = lazy(() => import("./pages/employer/JobEditor"));
const Applicants = lazy(() => import("./pages/employer/Applicants"));
const AdminAnalytics = lazy(() => import("./pages/admin/Analytics"));
const AdminJobs = lazy(() => import("./pages/admin/Jobs"));
const AdminUsers = lazy(() => import("./pages/admin/Users"));
const AdminEmails = lazy(() => import("./pages/admin/Emails"));
const Profile = lazy(() => import("./pages/Profile"));

/** Route guard: signed in, and (optionally) one of the given roles. */
function Require({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const token = useAuth((s) => s.accessToken);
  const { data: me, isLoading } = useMe();
  const location = useLocation();
  if (!token) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (isLoading || !me) return <PageSpinner />;
  if (roles && !roles.includes(me.role)) return <Navigate to={homeFor(me.role)} replace />;
  return <>{children}</>;
}

function Home() {
  const token = useAuth((s) => s.accessToken);
  const { data: me, isLoading } = useMe();
  if (token && isLoading) return <PageSpinner />;
  return <Navigate to={homeFor(me?.role)} replace />;
}

export function App() {
  return (
    <>
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route element={<AppLayout />}>
            <Route index element={<Home />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/:id" element={<JobDetailPage />} />
            <Route path="/profile" element={<Require><Profile /></Require>} />

            <Route path="/candidate" element={<Require roles={["candidate"]}><CandidateDashboard /></Require>} />
            <Route path="/candidate/resumes" element={<Require roles={["candidate"]}><Resumes /></Require>} />
            <Route path="/candidate/applications" element={<Require roles={["candidate"]}><MyApplications /></Require>} />
            <Route path="/candidate/applications/:id" element={<Require roles={["candidate"]}><ApplicationPage /></Require>} />

            <Route path="/employer" element={<Require roles={["employer"]}><EmployerDashboard /></Require>} />
            <Route path="/employer/jobs/new" element={<Require roles={["employer"]}><JobEditor /></Require>} />
            <Route path="/employer/jobs/:id/edit" element={<Require roles={["employer", "admin"]}><JobEditor /></Require>} />
            <Route path="/employer/jobs/:id" element={<Require roles={["employer", "admin"]}><Applicants /></Require>} />

            <Route path="/admin" element={<Require roles={["admin"]}><AdminAnalytics /></Require>} />
            <Route path="/admin/jobs" element={<Require roles={["admin"]}><AdminJobs /></Require>} />
            <Route path="/admin/users" element={<Require roles={["admin"]}><AdminUsers /></Require>} />
            <Route path="/admin/emails" element={<Require roles={["admin"]}><AdminEmails /></Require>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster position="bottom-right" richColors closeButton />
      <ConfirmHost />
    </>
  );
}
