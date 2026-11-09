import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { RequireRole } from './auth/RequireRole'
import { AppShell } from './components/AppShell'
import { ErrorState } from './components/States'
import { DataContext } from './data'
import type { DataSource } from './data/source'
import type { Session } from './data/types'
import Landing from './pages/login/Landing'
import AdultLogin from './pages/login/AdultLogin'
import StudentLogin from './pages/login/StudentLogin'
import { ForgotPassword, ResetPassword, SignUp } from './pages/login/AccountPages'
import { AdminGroups, AdminHome, AdminTeachers, AdminUsers } from './pages/admin'
import { GroupDetailPage, TeacherAssignments, TeacherGroups, TeacherHome, TeacherMaterials, TeacherStudents } from './pages/teacher'
import { ParentApprovals, ParentHome, ParentProgress, ParentSettings } from './pages/parent'
import { MaterialPage, MaterialsPage } from './pages/materials'
import { PlayPage, QuizPage, StudentHome, StudentProgress, StudentTasks, StudentTests } from './pages/student'

export function Providers({ source, session, children }: { source: DataSource; session?: Session | null; children: ReactNode }) {
  return <DataContext.Provider value={source}><AuthProvider initial={session}>{children}</AuthProvider></DataContext.Provider>
}

/** arriving from a password-reset e-mail (server mode): go straight to choosing a new password */
function RecoveryRedirect() {
  const { recovery } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  useEffect(() => { if (recovery && pathname !== '/reset-password') navigate('/reset-password', { replace: true }) }, [recovery, pathname, navigate])
  return null
}

export function AppRoutes() {
  return (
    <>
    <RecoveryRedirect />
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<AdultLogin />} />
      <Route path="/login/student" element={<StudentLogin />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/admin" element={<RequireRole role="admin"><AppShell role="admin" /></RequireRole>}>
        <Route index element={<AdminHome />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="teachers" element={<AdminTeachers />} />
        <Route path="groups" element={<AdminGroups />} />
      </Route>

      <Route path="/teacher" element={<RequireRole role="teacher"><AppShell role="teacher" /></RequireRole>}>
        <Route index element={<TeacherHome />} />
        <Route path="groups" element={<TeacherGroups />} />
        <Route path="groups/:groupId" element={<GroupDetailPage />} />
        <Route path="students" element={<TeacherStudents />} />
        <Route path="assignments" element={<TeacherAssignments />} />
        <Route path="materials" element={<TeacherMaterials />} />
        <Route path="materials/:materialId" element={<MaterialPage />} />
      </Route>

      <Route path="/parent" element={<RequireRole role="parent"><AppShell role="parent" /></RequireRole>}>
        <Route index element={<ParentHome />} />
        <Route path="approvals" element={<ParentApprovals />} />
        <Route path="progress" element={<ParentProgress />} />
        <Route path="settings" element={<ParentSettings />} />
        <Route path="materials" element={<MaterialsPage />} />
        <Route path="materials/:materialId" element={<MaterialPage />} />
      </Route>

      <Route path="/student" element={<RequireRole role="student"><AppShell role="student" /></RequireRole>}>
        <Route index element={<StudentHome />} />
        <Route path="tasks" element={<StudentTasks />} />
        <Route path="tests" element={<StudentTests />} />
        <Route path="progress" element={<StudentProgress />} />
        <Route path="play/:assignmentId" element={<PlayPage />} />
        <Route path="quiz/:assignmentId" element={<QuizPage />} />
      </Route>

      <Route path="*" element={<main className="page-narrow"><ErrorState title="העמוד לא נמצא" message="אולי הקישור ישן." action={{ label: 'לדף הבית', to: '/' }} /></main>} />
    </Routes>
    </>
  )
}
