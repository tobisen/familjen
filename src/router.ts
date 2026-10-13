import { createRouter, createWebHashHistory } from 'vue-router'
import Home from './views/Home.vue'
import Calendar from './views/Calendar.vue'
import Section from './views/Section.vue'
import Settings from './views/Settings.vue'
import Lists from './views/Lists.vue'
export const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: Home },
    { path: '/kalender', component: Calendar },
    { path: '/listor', component: Lists },
    ...['chatt', 'karta'].map((section) => ({
      path: `/${section}`,
      component: Section,
      props: { section },
    })),
    { path: '/installningar', component: Settings },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
