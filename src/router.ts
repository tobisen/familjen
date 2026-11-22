import { createRouter, createWebHashHistory } from 'vue-router'
import Calendar from './views/Calendar.vue'
import Settings from './views/Settings.vue'
import Lists from './views/Lists.vue'
import Chat from './views/Chat.vue'
import { getPersonalOwner } from './data/personalWeekRepository'
export const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/kalender' },
    { path: '/kalender', component: Calendar },
    { path: '/listor', component: Lists },
    { path: '/chatt', component: Chat },
    { path: '/karta', component: () => import('./views/Map.vue') },
    { path: '/installningar', component: Settings },
    {
      path: '/min-vecka',
      component: () => import('./views/PersonalWeek.vue'),
      beforeEnter: async () => {
        try {
          return (await getPersonalOwner()) ? true : '/kalender'
        } catch {
          return '/kalender'
        }
      },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
