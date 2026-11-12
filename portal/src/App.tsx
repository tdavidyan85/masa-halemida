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
import { lazy, Suspense } from 'react'
import { ChunkBoundary } from './components/ChunkBoundary'
import { Loading } from './components/States'

// each environment is its own chunk: a parent never downloads the teacher's code, and the login stays small
const named = <M, K extends keyof M>(load: () => Promise<M>, key: K) =>
  lazy(async () => ({ default: (await load())[key] as unknown as React.ComponentType }))
const admin = () => import('./pages/admin'), teacher = () => import('./pages/teacher'), parent = () => import('./pages/parent')
const student = () => import('./pages/student'), materials = () => import('./pages/materials')
const AdminHome = named(admin, 'AdminHome'), AdminUsers = named(admin, 'AdminUsers'), AdminTeachers = named(admin, 'AdminTeachers'), AdminGroups = named(admin, 'AdminGroups')
const TeacherHome = named(teacher, 'TeacherHome'), TeacherGroups = named(teacher, 'TeacherGroups'), GroupDetailPage = named(teacher, 'GroupDetailPage')
const TeacherStudents = named(teacher, 'TeacherStudents'), TeacherAssignments = named(teacher, 'TeacherAssignments')
const ParentHome = named(parent, 'ParentHome'), ParentApprovals = named(parent, 'ParentApprovals'), ParentProgress = named(parent, 'ParentProgress'), ParentSettings = named(parent, 'ParentSettings')
const StudentHome = named(student, 'StudentHome'), StudentTasks = named(student, 'StudentTasks'), StudentTests = named(student, 'StudentTests')
const StudentProgress = named(student, 'StudentProgress'), PlayPage = named(student, 'PlayPage'), QuizPage = named(student, 'QuizPage')
const MaterialsPage = named(materials, 'MaterialsPage'), MaterialPage = named(materials, 'MaterialPage')
const TeacherMaterials = MaterialsPage

/** a lazily loaded page: spinner while it downloads, a retry screen if the download fails */
const page = (el: ReactNode) => <ChunkBoundary><Suspense fallback={<Loading label="טוענים…" />}>{el}</Suspense></ChunkBoundary>

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
        <Route index element={page(<AdminHome />)} />
        <Route path="users" element={page(<AdminUsers />)} />
        <Route path="teachers" element={page(<AdminTeachers />)} />
        <Route path="groups" element={page(<AdminGroups />)} />
      </Route>

      <Route path="/teacher" element={<RequireRole role="teacher"><AppShell role="teacher" /></RequireRole>}>
        <Route index element={page(<TeacherHome />)} />
        <Route path="groups" element={page(<TeacherGroups />)} />
        <Route path="groups/:groupId" element={page(<GroupDetailPage />)} />
        <Route path="students" element={page(<TeacherStudents />)} />
        <Route path="assignments" element={page(<TeacherAssignments />)} />
        <Route path="materials" element={page(<TeacherMaterials />)} />
        <Route path="materials/:materialId" element={page(<MaterialPage />)} />
      </Route>

      <Route path="/parent" element={<RequireRole role="parent"><AppShell role="parent" /></RequireRole>}>
        <Route index element={page(<ParentHome />)} />
        <Route path="approvals" element={page(<ParentApprovals />)} />
        <Route path="progress" element={page(<ParentProgress />)} />
        <Route path="settings" element={page(<ParentSettings />)} />
        <Route path="materials" element={page(<MaterialsPage />)} />
        <Route path="materials/:materialId" element={page(<MaterialPage />)} />
      </Route>

      <Route path="/student" element={<RequireRole role="student"><AppShell role="student" /></RequireRole>}>
        <Route index element={page(<StudentHome />)} />
        <Route path="tasks" element={page(<StudentTasks />)} />
        <Route path="tests" element={page(<StudentTests />)} />
        <Route path="progress" element={page(<StudentProgress />)} />
        <Route path="play/:assignmentId" element={page(<PlayPage />)} />
        <Route path="quiz/:assignmentId" element={page(<QuizPage />)} />
      </Route>

      <Route path="*" element={<main className="page-narrow"><ErrorState title="העמוד לא נמצא" message="אולי הקישור ישן." action={{ label: 'לדף הבית', to: '/' }} /></main>} />
    </Routes>
    </>
  )
}
