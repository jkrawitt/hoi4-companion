import { createRouter, createWebHashHistory } from 'vue-router'
import OverviewView from '@/views/OverviewView.vue'
import FocusPlanView from '@/views/FocusPlanView.vue'

const router = createRouter({
  // Hash history keeps reloads and deep links working on GitHub Pages without a 404 fallback.
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'overview', component: OverviewView },
    { path: '/focus', name: 'focus', component: FocusPlanView },
  ],
  // Pages are kept alive, so going back finds them where they were left.
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
})

export default router
