import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  /**
   * 路由切换后回到顶部（列表翻页/详情之间跳转不该停在页面中段）；
   * 带 hash 的导航（目录锚点）交给浏览器自己滚动。
   */
  scrollBehavior: (to, _from, savedPosition) => {
    if (savedPosition) return savedPosition
    if (to.hash) return {}
    return { top: 0 }
  },
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/projects/:slug',
      name: 'project-detail',
      component: () => import('@/views/ProjectDetailView.vue'),
      props: true,
    },
    {
      path: '/notes',
      name: 'notes',
      component: () => import('@/views/NotesView.vue'),
    },
    {
      path: '/notes/:slug',
      name: 'note-detail',
      component: () => import('@/views/NoteDetailView.vue'),
      props: true,
    },
    {
      path: '/admin/login',
      name: 'admin-login',
      component: () => import('@/views/admin/LoginView.vue'),
    },
    {
      path: '/admin',
      component: () => import('@/views/admin/AdminLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: { name: 'admin-projects' } },
        { path: 'projects', name: 'admin-projects', component: () => import('@/views/admin/ProjectListView.vue') },
        { path: 'projects/new', name: 'admin-project-new', component: () => import('@/views/admin/ProjectEditView.vue') },
        {
          path: 'projects/:id',
          name: 'admin-project-edit',
          component: () => import('@/views/admin/ProjectEditView.vue'),
          props: true,
        },
        { path: 'notes/new', name: 'admin-note-new', component: () => import('@/views/admin/NoteEditView.vue') },
        {
          path: 'notes/:id',
          name: 'admin-note-edit',
          component: () => import('@/views/admin/NoteEditView.vue'),
          props: true,
        },
      ],
    },
  ],
})

// 路由守卫：后台页面需登录，未认证跳登录页并携带回跳地址。
router.beforeEach((to) => {
  if (to.meta.requiresAuth) {
    const auth = useAuthStore()
    if (!auth.isAuthenticated) {
      return { name: 'admin-login', query: { redirect: to.fullPath } }
    }
  }
  return true
})

export default router
