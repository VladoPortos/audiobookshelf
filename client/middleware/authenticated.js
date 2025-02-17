export default function ({ store, redirect, route }) {
  // If the user is not authenticated
  if (!store.state.user.user) {
    if (route.name === 'batch') return redirect('/login')
    return redirect(`/login?redirect=${route.path}`)
  }
}