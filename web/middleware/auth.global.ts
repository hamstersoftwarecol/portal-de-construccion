const PUBLIC = ['/login', '/registro', '/restablecer']
export default defineNuxtRouteMiddleware(async (to) => {
  const s = useSession()
  if (!s.loaded.value) await s.load()
  const isPublic = PUBLIC.includes(to.path)
  if (!s.user.value && !isPublic) return navigateTo('/login')
  if (s.user.value && isPublic && to.path === '/login') return navigateTo('/')
})
