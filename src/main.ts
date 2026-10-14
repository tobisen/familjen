import './domain/appearance'
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './style.css'
const app = createApp(App)
app.config.errorHandler = () => {
  document.getElementById('app')!.innerHTML =
    '<section style="padding:30px;font:16px system-ui"><h1>Familjen kunde inte starta</h1><p>Din session finns kvar. <a href="' +
    import.meta.env.BASE_URL +
    'recover/">Återställ appens cache</a></p></section>'
}
app.use(router).mount('#app')
