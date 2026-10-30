import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from './auth/useAuth'
import { supabase } from './lib/supabase'
import { ServiceThumbnail } from './components/ServiceThumbnail'
import { normalizeGoogleDriveUrl } from './lib/googleDriveUrl'
import { SiteHeader } from './components/SiteHeader'
import { formatRupiah } from './format'
import { categoryDisplayName } from './categoryLabels'

function AuthForm({ register = false }: { register?: boolean }) {
  const { user, loading, configurationStatus, signOutError, signIn, signUp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/dashboard'

  if (loading) return <p className="auth-message" role="status">Memuat akun…</p>
  if (user) return <Navigate to={from} replace />

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    if (configurationStatus !== 'ready') {
      setMessage(configurationStatus === 'missing'
        ? 'Layanan autentikasi belum dikonfigurasi. Silakan coba lagi nanti.'
        : 'Konfigurasi layanan autentikasi tidak valid. Silakan hubungi administrator.')
      return
    }
    if (register && (!displayName.trim() || displayName.trim().length > 80)) {
      setMessage('Nama tampilan wajib diisi dan maksimal 80 karakter.')
      return
    }
    setPending(true)
    try {
      if (register) {
        await signUp(email.trim(), password, displayName.trim())
        setMessage('Pendaftaran berhasil. Periksa email Anda untuk mengonfirmasi akun sebelum masuk.')
      } else {
        await signIn(email.trim(), password)
        navigate(from, { replace: true })
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Permintaan gagal. Periksa data Anda atau coba lagi nanti.')
    } finally {
      setPending(false)
    }
  }

  return <main className="auth-page auth-page--auth">
    <section className="auth-card auth-card--form" aria-labelledby="auth-title">
      <Link className="auth-brand" to="/">Mie Sukses Creative Marketplace</Link>
      <h1 id="auth-title">{register ? 'Buat akun' : 'Masuk'}</h1>
      <p>{register ? 'Mulai berkarya bersama komunitas kreatif Perbanas.' : 'Masuk ke akun Mie Sukses Anda.'}</p>
      <form onSubmit={submit}>
        {register && <><label htmlFor="display-name">Nama</label><input id="display-name" autoComplete="name" required minLength={1} maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></>}
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="password">Kata sandi</label>
        <input id="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
        <button className="button button-dark" type="submit" disabled={pending}>{pending ? 'Memproses…' : register ? 'Daftar' : 'Log in'}</button>
      </form>
      <p className="auth-feedback" role="status" aria-live="polite">{message}</p>
      {signOutError && !register && <p className="auth-feedback" role="status">Proses keluar gagal. Status sesi mungkin sudah berubah; periksa halaman akun sebelum melanjutkan.</p>}
      <p>{register ? 'Sudah punya akun?' : 'Belum punya akun?'} <Link to={register ? '/login' : '/register'}>{register ? 'Masuk' : 'Daftar'}</Link></p>
    </section>
  </main>
}

export function LoginPage() { return <AuthForm /> }
export function RegisterPage() { return <AuthForm register /> }

export function AboutPage() {
  return <><SiteHeader /><main className="page-shell"><header className="page-heading"><p className="eyebrow">TENTANG MIE SUKSES</p><h1>Ruang untuk ide kreatif mahasiswa.</h1><p>Mie Sukses menghubungkan mahasiswa kreatif Perbanas Institute dengan orang yang membutuhkan karya dan layanan kreatif.</p></header><section className="panel"><h2>Karya lokal, kesempatan nyata</h2><p>Temukan layanan kreatif, kenali karya para kreator, dan dukung talenta mahasiswa melalui kolaborasi yang sesuai kebutuhanmu.</p><Link className="button button-dark" to="/#featured">Jelajahi layanan</Link></section></main></>
}

export function DashboardPage() {
  const { user, roles, roleStatus, signOut, signOutError } = useAuth()
  const navigate = useNavigate()
  async function handleSignOut() {
    try {
      await signOut()
      navigate('/')
    } catch {
      // Auth state and the persistent provider notice handle a local sign-out on revoke failure.
    }
  }
  return <main className="page-shell">
    <header className="page-heading"><p className="eyebrow">AKUN MARKETPLACE</p><h1>Halo{user?.email ? `, ${user.email}` : ''}</h1><p>Kelola akses buyer dan seller dari satu tempat.</p></header>
    <section className="panel account-dashboard"><div className="panel-heading"><div><p className="eyebrow">STATUS AKUN</p><h2>{roleStatus === 'ready' ? 'Role akun' : 'Memverifikasi akses'}</h2>{roleStatus === 'ready' && <div className="role-labels">{roles.length ? roles.map((role) => <span className="status-chip" key={role}>{role.toUpperCase()}</span>) : 'Akun aktif'}</div>}</div><span className="status-chip">{roleStatus === 'ready' ? 'Siap' : roleStatus === 'error' ? 'Periksa koneksi' : 'Memuat'}</span></div>
      <nav className="account-links" aria-label="Menu akun"><Link to="/profile">Profil dan keamanan</Link><Link to="/orders">Riwayat pesanan</Link>{roles.includes('seller') && <Link to="/seller">Seller Studio</Link>}{roles.includes('admin') && <Link to="/admin">Admin</Link>}</nav>
      {roleStatus === 'ready' && roles.includes('buyer') && !roles.includes('seller') && <SellerOnboarding />}
      <div className="form-actions"><button className="button button-outline" onClick={handleSignOut}>Keluar</button><Link className="button button-dark" to="/">Kembali ke katalog</Link></div>
      {signOutError && <p className="page-feedback error-panel" role="status" aria-live="polite">Tidak dapat keluar saat ini. Silakan coba lagi.</p>}
    </section>
  </main>
}

function SellerOnboarding({ activeSeller = false }: { activeSeller?: boolean }) {
  const { user, refreshAuthorization } = useAuth()
  const [portfolioUrl, setPortfolioUrl] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    async function load() {
      if (!supabase || !user) { setLoading(false); return }
      let { data: profile, error } = await supabase.from('seller_onboarding').select('portfolio_url,evidence_url').eq('user_id', user.id).maybeSingle()
      if (error && ['42703', 'PGRST204'].includes(error.code ?? '')) {
        const fallback = await supabase.from('seller_onboarding').select('portfolio_url').eq('user_id', user.id).maybeSingle()
        profile = fallback.data as typeof profile
        error = fallback.error
        if (!error) setMessage('Portfolio tersimpan. Backend ini belum mendukung tautan evidence opsional.')
      }
      if (!active) return
      if (error) setMessage('Informasi onboarding tidak dapat dimuat.')
      else { setPortfolioUrl(profile?.portfolio_url ?? ''); setEvidenceUrl(profile?.evidence_url ?? '') }
      setLoading(false)
    }
    void load().catch(() => { if (active) { setMessage('Informasi onboarding tidak dapat dimuat.'); setLoading(false) } })
    return () => { active = false }
  }, [user, reload])
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !user) return
    const parsed = normalizeGoogleDriveUrl(portfolioUrl)
    const evidence = normalizeGoogleDriveUrl(evidenceUrl)
    if (!parsed || evidence === null) { setMessage('Gunakan tautan HTTPS drive.google.com atau docs.google.com.'); return }
    setBusy(true); setMessage('')
    try {
      const { error } = await supabase.functions.invoke('seller-onboarding', { body: { portfolioUrl: parsed, evidenceUrl: evidence || null } })
      if (error) {
        const response = (error as { context?: unknown }).context
        if (response instanceof Response) {
          try {
            const body = await response.clone().json() as { error?: unknown }
            if (typeof body.error === 'string') { setMessage(body.error); return }
          } catch { /* Use the account-level fallback below. */ }
        }
        setMessage('Portfolio URL gagal disimpan. Pastikan akun buyer aktif dan coba lagi.')
        return
      }
      setMessage(activeSeller ? 'Portfolio URL diperbarui.' : 'Seller aktif. Buyer tetap aktif di akun ini.')
      setReload((value) => value + 1)
      refreshAuthorization()
    } catch {
      setMessage('Layanan seller tidak dapat dijangkau. Periksa koneksi lalu coba lagi.')
    } finally {
      setBusy(false)
    }
  }
  return <section className="onboarding-panel" aria-labelledby="seller-onboarding-title"><div><p className="eyebrow">{activeSeller ? 'PORTFOLIO SELLER' : 'AKTIVASI SELLER'}</p><h2 id="seller-onboarding-title">{activeSeller ? 'Tautan karya dan evidence' : 'Mulai sebagai seller'}</h2></div>
    <p>{activeSeller ? 'Perbarui portfolio Drive kapan saja. Akses seller tetap aktif.' : 'Portfolio Google Drive mengaktifkan akses seller. Evidence tambahan bersifat opsional.'} Atur izin berbagi Drive agar pembeli dapat membuka tautan.</p>
    <form className="settings-form onboarding-form" onSubmit={(event) => void save(event)}><label htmlFor={activeSeller ? 'seller-portfolio-url-edit' : 'seller-portfolio-url'}>Tautan portfolio Google Drive</label><input id={activeSeller ? 'seller-portfolio-url-edit' : 'seller-portfolio-url'} type="url" required maxLength={2048} value={portfolioUrl} onChange={(event) => setPortfolioUrl(event.target.value)} placeholder="https://drive.google.com/..." /><label htmlFor={activeSeller ? 'seller-evidence-url-edit' : 'seller-evidence-url'}>Tautan evidence tambahan <span>(opsional)</span></label><input id={activeSeller ? 'seller-evidence-url-edit' : 'seller-evidence-url'} type="url" maxLength={2048} value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="https://drive.google.com/..." /><button className="button button-dark" disabled={busy || loading}>{loading ? 'Memuat…' : busy ? 'Menyimpan…' : activeSeller ? 'Simpan tautan' : 'Aktifkan seller'}</button></form>
    {normalizeGoogleDriveUrl(portfolioUrl) && <p><a href={normalizeGoogleDriveUrl(portfolioUrl)!} target="_blank" rel="noopener noreferrer">Open portfolio link</a></p>}
    {normalizeGoogleDriveUrl(evidenceUrl) && <p><a href={normalizeGoogleDriveUrl(evidenceUrl)!} target="_blank" rel="noopener noreferrer">Open evidence link</a></p>}
    {message && <p className="auth-feedback" role="status" aria-live="polite">{message}</p>}
  </section>
}

type AdminOrder = { id: string; buyer_id: string; seller_id: string; status: string; payment_status: string; total_idr: string | number; placed_at: string; order_items: Array<{ title_snapshot: string }> }
type AdminUser = { id: string; display_name: string | null; account_status: string; roles: string[] }
type AdminListing = { id: string; seller_id: string; title: string; status: string }

export function AdminOrdersPage() {
  const { user: currentUser } = useAuth()
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [listings, setListings] = useState<AdminListing[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true); setMessage('')
      if (!supabase) { setLoading(false); setMessage('Supabase belum dikonfigurasi.'); return }
      const [ordersResult, usersResult, rolesResult, listingsResult] = await Promise.all([
        supabase.from('orders').select('id,buyer_id,seller_id,status,payment_status,total_idr,placed_at,order_items(title_snapshot)').order('placed_at', { ascending: false }),
        supabase.from('profiles').select('id,display_name,account_status').order('created_at', { ascending: false }),
        supabase.from('user_roles').select('user_id,role'),
        supabase.from('creative_services').select('id,seller_id,title,status').order('created_at', { ascending: false }),
      ])
      if (!active) return
      if (ordersResult.error || usersResult.error || rolesResult.error || listingsResult.error) setMessage('Data admin tidak dapat dimuat. Periksa migrasi dan hak akses backend.')
      else {
        setOrders((ordersResult.data ?? []) as AdminOrder[])
        const rolesByUser = new Map<string, string[]>()
        for (const row of rolesResult.data ?? []) rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) ?? []), row.role])
        setUsers((usersResult.data ?? []).map((profile) => ({ ...profile, roles: rolesByUser.get(profile.id) ?? [] })))
        setListings((listingsResult.data ?? []) as AdminListing[])
      }
      setLoading(false)
    }
    void load().catch(() => { if (active) { setMessage('Antrean pesanan tidak dapat dimuat.'); setLoading(false) } })
    return () => { active = false }
  }, [reload])

  async function confirmPayment(orderId: string, result: 'paid' | 'failed') {
    if (!supabase) return
    const note = window.prompt(`Catatan pembayaran DEMO ${result} (opsional):`)
    if (note === null) return
    setBusyId(orderId); setMessage('')
    const { error } = await supabase.rpc('confirm_demo_payment', { p_order_id: orderId, p_result: result, p_note: note.trim() || null })
    setMessage(error ? 'Konfirmasi simulasi ditolak. Status order mungkin berubah atau hak admin tidak berlaku.' : `Pembayaran DEMO dikonfirmasi sebagai ${result}.`)
    setBusyId(''); if (!error) setReload((value) => value + 1)
  }

  async function cancelOrder(orderId: string) {
    if (!supabase) return
    setBusyId(orderId); setMessage('')
    const { error } = await supabase.rpc('transition_order', { p_order_id: orderId, p_target: 'cancelled' })
    setMessage(error ? 'Pembatalan ditolak oleh backend.' : 'Pesanan dibatalkan.')
    setBusyId(''); if (!error) setReload((value) => value + 1)
  }

  async function removeListing(listing: AdminListing) {
    if (!supabase || !window.confirm(`Arsipkan listing “${listing.title}”? Listing tidak lagi muncul di katalog.`)) return
    setBusyId(listing.id); setMessage('')
    const { error } = await supabase.rpc('moderate_listing', { p_service_id: listing.id, p_status: 'archived' })
    setBusyId('')
    setMessage(error ? 'Listing tidak dapat diarsipkan oleh backend.' : 'Listing diarsipkan.')
    if (!error) setReload((value) => value + 1)
  }

  async function removeUser(target: AdminUser) {
    if (!supabase || !window.confirm(`Hapus ${target.display_name || target.id.slice(0, 8)} dari marketplace? Akses akan dicabut; riwayat pesanan tetap disimpan.`)) return
    setBusyId(target.id); setMessage('')
    try {
      for (const listing of listings.filter((item) => item.seller_id === target.id && item.status !== 'archived')) {
        const { error } = await supabase.rpc('moderate_listing', { p_service_id: listing.id, p_status: 'archived' })
        if (error) throw new Error('Listing akun ini tidak dapat diarsipkan.')
      }
      const { error: deactivateError } = await supabase.rpc('deactivate_account', { p_user_id: target.id })
      if (deactivateError) throw new Error('Akun tidak dapat dinonaktifkan; backend mungkin menolak penghapusan admin terakhir.')
      const { error: anonymizeError } = await supabase.rpc('anonymize_profile', { p_user_id: target.id, p_display_name: 'Deleted user' })
      setMessage(anonymizeError ? 'Akses akun dicabut. Profil tetap disimpan karena masih terkait riwayat pesanan atau data yang perlu ditinjau.' : 'Akun dinonaktifkan dan profil dianonimkan.')
      setReload((value) => value + 1)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Akun tidak dapat dihapus.')
      setReload((value) => value + 1)
    } finally { setBusyId('') }
  }

  return <main className="page-shell"><header className="page-heading"><p className="eyebrow">ADMIN</p><h1>Administrasi marketplace</h1><p>Kelola akun, listing, dan konfirmasi pembayaran simulasi.</p></header>
    <section className="panel admin-orders"><h2>Akun pengguna</h2><p>Akun yang dihapus dicabut aksesnya. Data untuk pesanan terdahulu tetap tersimpan.</p>{users.map((target) => <article className="order-row" key={target.id}><div className="order-row-heading"><strong>{target.display_name || 'Tanpa nama'}</strong><span className="status-chip">{target.account_status.toUpperCase()}</span></div><small>{target.id}</small><div className="role-labels">{target.roles.map((role) => <span className="status-chip" key={role}>{role.toUpperCase()}</span>)}</div>{target.account_status === 'active' && target.id !== currentUser?.id && <button className="button button-quiet" disabled={busyId === target.id} onClick={() => void removeUser(target)}>Hapus pengguna</button>}</article>)}</section>
    <section className="panel admin-orders"><h2>Listing jasa</h2>{listings.map((listing) => <article className="order-row" key={listing.id}><div className="order-row-heading"><strong>{listing.title}</strong><span className="status-chip">{listing.status.toUpperCase()}</span></div><small>Seller {listing.seller_id.slice(0, 8)}</small>{listing.status !== 'archived' && <button className="button button-quiet" disabled={busyId === listing.id} onClick={() => void removeListing(listing)}>Hapus listing</button>}</article>)}</section>
    <header className="page-heading"><p className="eyebrow">PEMBAYARAN DEMO</p><h2>Antrean pesanan</h2><p>Konfirmasi ini hanya simulasi dan tidak memproses uang sungguhan.</p></header>
    <section className="panel admin-orders" aria-live="polite">
      {loading ? <p role="status">Memuat pesanan…</p> : message && !orders.length ? <p className="page-feedback error-panel" role="alert">{message}</p> : orders.length ? <ul className="order-list">{orders.map((order) => <li className="order-row" key={order.id}><div className="order-row-heading"><h2><Link to={`/orders/${order.id}`}>{order.order_items.map((item) => item.title_snapshot).join(', ') || `Pesanan ${order.id}`}</Link></h2><span className="status-chip">{orderStatusText[order.status] ?? order.status}</span></div><p>Pembayaran demo: <strong>{paymentStatusText[order.payment_status] ?? order.payment_status}</strong></p><p>{formatRupiah(order.total_idr)} · {new Date(order.placed_at).toLocaleString('id-ID')}</p><small>Pembeli {order.buyer_id} · Seller {order.seller_id}</small>
        {order.status === 'awaiting_payment' && ['unpaid', 'pending'].includes(order.payment_status) && <div className="form-actions"><button className="button button-dark" disabled={busyId === order.id} onClick={() => void confirmPayment(order.id, 'paid')}>Konfirmasi demo berhasil</button><button className="button button-outline" disabled={busyId === order.id} onClick={() => void confirmPayment(order.id, 'failed')}>Tandai demo gagal</button></div>}
        {order.status === 'awaiting_payment' && ['unpaid', 'failed'].includes(order.payment_status) && <button className="button button-quiet" disabled={busyId === order.id} onClick={() => void cancelOrder(order.id)}>Batalkan pesanan</button>}
      </li>)}</ul> : <div className="empty-state"><h2>Belum ada pesanan</h2><p>Pesanan buyer akan muncul setelah checkout.</p></div>}
      {message && orders.length > 0 && <p className="page-feedback" role="status" aria-live="polite">{message}</p>}
    </section>
  </main>
}

export function ProfilePage() {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      if (!supabase || !user) return
      const { data, error } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle()
      if (error) { if (active) setMessage('Profil tidak dapat dimuat.'); return }
      if (active) setName(data?.display_name ?? '')
    }
    void load().catch(() => { if (active) setMessage('Profil tidak dapat dimuat.') })
    return () => { active = false }
  }, [user])

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !user) return
    setBusy(true); setMessage('')
    try {
      const { error } = await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', user.id)
      setMessage(error ? 'Profil tidak dapat disimpan.' : 'Profil berhasil disimpan.')
    } catch { setMessage('Profil tidak dapat disimpan. Periksa koneksi lalu coba lagi.') }
    finally { setBusy(false) }
  }

  async function updateCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true); setMessage('')
    const updates: { email?: string; password?: string } = {}
    if (email.trim() !== user?.email) updates.email = email.trim()
    if (password) updates.password = password
    if (!Object.keys(updates).length) { setMessage('Tidak ada perubahan email atau kata sandi.'); setBusy(false); return }
    const { error } = await supabase.auth.updateUser(updates)
    setMessage(error ? error.message : updates.email ? 'Permintaan perubahan berhasil. Periksa email untuk mengonfirmasi alamat baru.' : 'Kata sandi berhasil diperbarui.')
    if (!error) setPassword('')
    setBusy(false)
  }

  return <main className="page-shell">
    <header className="page-heading"><p className="eyebrow">PENGATURAN AKUN</p><h1>Profil dan keamanan</h1><p>Perbarui nama akun, alamat email, dan kata sandi.</p></header>
    <div className="profile-panels">
      <section className="panel"><h2>Informasi profil</h2><p className="panel-copy">Foto profil tidak diperlukan untuk menggunakan marketplace.</p>
        <form className="settings-form" onSubmit={saveProfile}><label htmlFor="profile-name">Nama tampilan</label><input id="profile-name" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /><button className="button button-dark" disabled={busy}>Simpan nama</button></form>
      </section>
      <section className="panel"><h2>Akun dan keamanan</h2><p className="panel-copy">Email masuk: {user?.email ?? '—'}. Perubahan email mungkin memerlukan konfirmasi.</p>
        <form className="settings-form" onSubmit={updateCredentials}><label htmlFor="profile-email">Email baru</label><input id="profile-email" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /><label htmlFor="profile-password">Kata sandi baru <span>(kosongkan jika tidak diubah)</span></label><input id="profile-password" type="password" minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><button className="button button-dark" disabled={busy}>Perbarui akses akun</button></form>
      </section>
      {message && <p className="page-feedback" role="status" aria-live="polite">{message}</p>}
    </div>
  </main>
}

type CartSnapshot = {
  id: string
  cart_items: Array<{
    service_id: string
    quantity: number
    creative_services: { title: string; price_idr: string|number; delivery_days: number } | null
  }>
}
type CheckoutRetry = { idempotencyKey: string; cartId: string; serviceIds: string[] }

export function CartPage() {
  const { user } = useAuth()
  const [cart, setCart] = useState<CartSnapshot|null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [retry, setRetry] = useState<CheckoutRetry|null>(null)
  const [orders, setOrders] = useState<Array<{ id:string; seller_id:string; total_idr:string|number }>>([])
  const retryKey = `mie-sukses-checkout:${user?.id ?? ''}`

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      if (!supabase || !user) { setCart(null); setLoading(false); return }
      const { data,error } = await supabase.from('carts')
        .select('id,cart_items(service_id,quantity,creative_services(title,price_idr,delivery_days))')
        .eq('buyer_id',user.id).eq('status','active').maybeSingle()
      if (!active) return
      if (error) setMessage('Your cart could not be loaded.')
      setCart(error ? null : data as CartSnapshot|null)
      setLoading(false)
    }
    void load().catch(() => { if (active) { setMessage('Your cart could not be loaded.'); setLoading(false) } })
    return () => { active = false }
  },[user,refresh])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(retryKey)
        setRetry(saved ? JSON.parse(saved) as CheckoutRetry : null)
      } catch {
        setRetry(null)
      }
    },0)
    return () => window.clearTimeout(timer)
  },[retryKey])

  async function removeItem(serviceId: string) {
    if (!supabase) return
    setBusy(true)
    const { error } = await supabase.rpc('mutate_cart',{p_action:'remove',p_service_id:serviceId})
    if (error) setMessage('The item could not be removed.')
    else { setMessage('Item removed.'); setRefresh((value) => value+1) }
    setBusy(false)
  }

  async function checkout(request?: CheckoutRetry) {
    if (!supabase || busy || (!request && !cart)) return
    const attempt = request ?? { idempotencyKey:crypto.randomUUID(),cartId:cart!.id,serviceIds:cart!.cart_items.map((item) => item.service_id) }
    setBusy(true); setMessage('')
    try { localStorage.setItem(retryKey,JSON.stringify(attempt)) }
    catch { setMessage('Browser storage is unavailable; checkout cannot safely retain its retry key.'); setBusy(false); return }
    setRetry(attempt)
    const { data,error } = await supabase.rpc('checkout_cart',{
      p_idempotency_key:attempt.idempotencyKey,p_cart_id:attempt.cartId,p_service_ids:attempt.serviceIds,
    })
    if (error) setMessage('Checkout was rejected or could not be confirmed. Retry safely using the same request.')
    else {
      const result=data as {orders?:Array<{id:string;seller_id:string;total_idr:string|number}>}
      setOrders(result.orders ?? [])
      try { localStorage.removeItem(retryKey) } catch { /* The completed batch remains idempotent in the database. */ }
      setRetry(null);setCart(null);setMessage('Checkout completed. Your seller orders are ready for simulated payment confirmation.')
      setRefresh((value) => value+1)
    }
    setBusy(false)
  }

  const total = (cart?.cart_items ?? []).reduce((sum,item) => sum+BigInt(item.creative_services?.price_idr ?? 0),0n)
  return <main className="auth-page cart-page"><section className="auth-card cart-card" aria-labelledby="cart-title">
    <Link className="auth-brand" to="/">Mie Sukses Creative Marketplace</Link><h1 id="cart-title">Your cart</h1>
    {loading ? <p role="status">Loading cart…</p> : cart?.cart_items.length ? <>
      <ul>{cart.cart_items.map((item) => <li key={item.service_id}>
        <strong>{item.creative_services?.title ?? 'Listing no longer available'}</strong>
        <span>{item.creative_services ? ` · ${formatRupiah(item.creative_services.price_idr)} · ${item.creative_services.delivery_days} days` : ''}</span>
        <button type="button" disabled={busy} onClick={() => void removeItem(item.service_id)}>Remove</button>
      </li>)}</ul>
      <p>Current estimate: {formatRupiah(total)}. Prices and eligibility are revalidated at checkout.</p>
      {retry ? <button className="button button-dark" disabled={busy} onClick={() => void checkout(retry)}>{busy?'Retrying…':'Recover previous checkout'}</button>
        : <button className="button button-dark" disabled={busy} onClick={() => void checkout()}>{busy?'Checking out…':'Checkout'}</button>}
    </> : <><p>Your active cart is empty.</p>{retry && <button className="button button-dark" disabled={busy} onClick={() => void checkout(retry)}>{busy?'Recovering…':'Recover previous checkout'}</button>}</>}
    {message && <p className="auth-feedback" role="status">{message}</p>}
    {orders.length>0 && <><p>Orders were saved to your account.</p><ul aria-label="Seller orders">{orders.map((order)=><li key={order.id}><Link to={`/orders/${order.id}`}>Order {order.id}: {formatRupiah(order.total_idr)}</Link></li>)}</ul></>}
    <p><Link to="/orders">Order history</Link> · <Link to="/">Continue browsing</Link></p>
  </section></main>
}

type ServiceDetail = {
  id: string; seller_id: string; title: string; short_summary: string; description: string
  deliverables: string; price_idr: string|number; delivery_days: number
  service_categories: { name: string; is_active: boolean } | Array<{ name: string; is_active: boolean }> | null
  creative_service_media: Array<{ id: string; drive_url: string | null; sort_order: number }>
}

export function ServiceDetailPage() {
  const { serviceId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [service, setService] = useState<ServiceDetail | null>(null)
  const [sellerName, setSellerName] = useState('Creative seller')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      const client = supabase
      if (!client || !serviceId) { setError('This service could not be loaded.'); setLoading(false); return }
      const { data, error: queryError } = await client.from('creative_services')
        .select('id,seller_id,title,short_summary,description,deliverables,price_idr,delivery_days,service_categories(name,is_active),creative_service_media(id,drive_url,sort_order)')
        .eq('id', serviceId).eq('status', 'published').maybeSingle()
      if (!active) return
      const item = data as unknown as ServiceDetail | null
      const category = Array.isArray(item?.service_categories) ? item.service_categories[0] : item?.service_categories
      if (queryError || !item || !category?.is_active) { setError('This service is unavailable.'); setLoading(false); return }
      setService(item)
      const { data: profile } = await client.from('seller_presentations').select('display_name').eq('id', item.seller_id).maybeSingle()
      if (!active) return
      setSellerName(profile?.display_name?.trim() || 'Creative seller')
      setLoading(false)
    }
    void load().catch(() => { if (active) { setError('This service could not be loaded.'); setLoading(false) } })
    return () => { active = false }
  }, [serviceId])

  async function addToCart() {
    if (!user) { navigate('/login', { state: { from: { pathname: `/services/${serviceId}` } } }); return }
    if (!supabase || !service) return
    setBusy(true); setMessage('')
    try {
      const { error: cartError } = await supabase.rpc('mutate_cart', { p_action: 'add', p_service_id: service.id })
      setMessage(cartError ? 'This service could not be added to your cart.' : 'Added to your cart.')
    } catch { setMessage('The cart could not be reached. Please try again.') }
    finally { setBusy(false) }
  }
  const serviceCategory = Array.isArray(service?.service_categories) ? service.service_categories[0] : service?.service_categories

  return <main className="page-shell service-detail-page">
    <p><Link className="auth-brand" to="/#featured">← Back to services</Link></p>
    {loading ? <p className="auth-message" role="status">Loading service…</p> : error || !service
      ? <section className="panel error-panel"><h1>Service unavailable</h1><p>{error || 'This service could not be loaded.'}</p><Link className="button button-dark" to="/">Browse services</Link></section>
      : <>
        <header className="page-heading"><p className="eyebrow">{categoryDisplayName(serviceCategory?.name)}</p><h1>{service.title}</h1><p>{service.short_summary}</p></header>
        <div className="service-detail-layout">
          <div className="service-detail-main">
            <div className="service-gallery service-gallery--default"><ServiceThumbnail category={serviceCategory?.name ?? ''} alt={`${service.title} category thumbnail`} /></div>
            {service.creative_service_media.filter((item) => item.drive_url).map((item) => <p key={item.id}><a href={item.drive_url!} target="_blank" rel="noopener noreferrer">View service sample on Google Drive</a></p>)}
            {service.creative_service_media.some((item) => item.drive_url) && <small>Configure Google Drive sharing permissions so viewers can open these links.</small>}
            <section className="detail-section"><p className="eyebrow">ABOUT THIS SERVICE</p><h2>What you’ll get</h2><p>{service.description}</p></section>
            <section className="detail-section"><p className="eyebrow">DELIVERABLES</p><h2>Included in the service</h2><p>{service.deliverables}</p></section>
            <section className="detail-section"><p className="eyebrow">CREATED BY</p><h2>{sellerName}</h2><p>Independent creative seller</p></section>
          </div>
          <aside className="service-purchase"><p className="eyebrow">STARTING AT</p><strong>{formatRupiah(service.price_idr)}</strong><p>Delivery in {service.delivery_days} days</p><button className="button button-dark" disabled={busy} onClick={() => void addToCart()}>{busy ? 'Adding…' : 'Add to cart'}</button>{message && <p className="auth-feedback" role="status">{message}</p>}</aside>
        </div>
      </>}
  </main>
}

type MarketplaceOrder = {
  id: string; buyer_id: string; seller_id: string; status: string; payment_status: string
  total_idr: string | number; placed_at: string
  order_items: Array<{ title_snapshot: string; description_snapshot: string; category_snapshot: string; deliverables_snapshot: string; unit_price_idr: string | number; delivery_days_snapshot: number }>
  order_events: Array<{ event_type: string; note: string; created_at: string }>
  payment_records: Array<{ status: string; note: string | null; created_at: string }>
  order_deliverables: Array<{ title: string; drive_url: string; notes: string | null; created_at: string }>
}
const orderStatusText: Record<string, string> = {
  awaiting_payment: 'Menunggu konfirmasi pembayaran demo', confirmed: 'Dikonfirmasi', in_progress: 'Sedang dikerjakan',
  delivered: 'Hasil dikirim', revision_requested: 'Revisi diminta', completed: 'Selesai', cancelled: 'Dibatalkan',
}
const paymentStatusText: Record<string, string> = { unpaid: 'Belum dimulai (simulasi)', pending: 'Menunggu konfirmasi admin (simulasi)', paid: 'Terkonfirmasi (simulasi)', failed: 'Gagal (simulasi)' }

export function BuyerOrdersPage() {
  const { user } = useAuth()
  const [orders, setOrders] = useState<MarketplaceOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true); setError('')
      if (!supabase || !user) { setLoading(false); return }
      const { data, error: queryError } = await supabase.from('orders').select('id,buyer_id,seller_id,status,payment_status,total_idr,placed_at,order_items(title_snapshot,description_snapshot,category_snapshot,deliverables_snapshot,unit_price_idr,delivery_days_snapshot),order_events(event_type,note,created_at),payment_records(status,note,created_at),order_deliverables(title,drive_url,notes,created_at)').eq('buyer_id', user.id).order('placed_at', { ascending: false })
      if (!active) return
      if (queryError) setError('Riwayat pesanan tidak dapat dimuat. Coba lagi nanti.')
      else setOrders((data ?? []) as MarketplaceOrder[])
      setLoading(false)
    }
    void load().catch(() => { if (active) { setError('Riwayat pesanan tidak dapat dimuat.'); setLoading(false) } })
    return () => { active = false }
  }, [user])
  return <main className="auth-page"><section className="auth-card"><Link className="auth-brand" to="/dashboard">Kembali ke dashboard</Link><h1>Riwayat pesanan</h1><p>Semua status pembayaran di sini adalah simulasi. Tidak ada pembayaran uang sungguhan.</p>
    {loading ? <p role="status">Memuat pesanan…</p> : error ? <p className="auth-feedback" role="alert">{error}</p> : orders.length ? <ul>{orders.map((order) => <li key={order.id}><p><Link to={`/orders/${order.id}`}><strong>{order.order_items.map((item) => item.title_snapshot).join(', ') || `Pesanan ${order.id}`}</strong></Link></p><p>{orderStatusText[order.status] ?? order.status} · Pembayaran demo: {paymentStatusText[order.payment_status] ?? order.payment_status} · {formatRupiah(order.total_idr)}</p><small>{new Date(order.placed_at).toLocaleString('id-ID')}</small></li>)}</ul> : <p>Belum ada pesanan. Pesanan yang dibuat saat checkout akan muncul di sini.</p>}
    <p><Link to="/">Jelajahi jasa</Link></p></section></main>
}

export function OrderDetailPage() {
  const { orderId = '' } = useParams()
  const { user, roles } = useAuth()
  const [order, setOrder] = useState<MarketplaceOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true); setMessage('')
      if (!supabase || !user) { setLoading(false); return }
      const { data, error } = await supabase.from('orders').select('id,buyer_id,seller_id,status,payment_status,total_idr,placed_at,order_items(title_snapshot,description_snapshot,category_snapshot,deliverables_snapshot,unit_price_idr,delivery_days_snapshot),order_events(event_type,note,created_at),payment_records(status,note,created_at),order_deliverables(title,drive_url,notes,created_at)').eq('id', orderId).maybeSingle()
      if (!active) return
      if (error || !data || (data.buyer_id !== user.id && data.seller_id !== user.id && !roles.includes('admin'))) setMessage('Pesanan tidak ditemukan atau Anda tidak memiliki akses.')
      else setOrder(data as MarketplaceOrder)
      setLoading(false)
    }
    void load().catch(() => { if (active) { setMessage('Detail pesanan tidak dapat dimuat.'); setLoading(false) } })
    return () => { active = false }
  }, [user, orderId, reload, roles])

  async function transition(target: 'completed') {
    if (!supabase || !order) return
    setBusy(true); setMessage('')
    const { error } = await supabase.rpc('transition_order', { p_order_id: order.id, p_target: target })
    setMessage(error ? 'Perubahan status ditolak. Pastikan status pesanan masih mengizinkan tindakan ini.' : 'Pesanan berhasil ditandai selesai.')
    setBusy(false); if (!error) setReload((value) => value + 1)
  }
  async function startPayment() {
    if (!supabase || !order) return
    setBusy(true); setMessage('')
    const { error } = await supabase.rpc('start_demo_payment', { p_order_id: order.id })
    setMessage(error ? 'Pembayaran simulasi tidak dapat dimulai.' : 'Permintaan simulasi tercatat. Pesanan menunggu konfirmasi admin.')
    setBusy(false); if (!error) setReload((value) => value + 1)
  }
  async function requestRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !order) return
    if (!revision.trim()) { setMessage('Jelaskan perubahan yang diminta.'); return }
    setBusy(true); setMessage('')
    const { error } = await supabase.rpc('request_order_revision', { p_order_id: order.id, p_note: revision.trim() })
    setMessage(error ? 'Permintaan revisi ditolak. Pesanan mungkin sudah memiliki permintaan revisi atau tidak lagi dapat direvisi.' : 'Permintaan revisi terkirim.')
    setBusy(false); if (!error) { setRevision(''); setReload((value) => value + 1) }
  }

  const isBuyer = order?.buyer_id === user?.id
  if (loading) return <p className="auth-message" role="status">Memuat detail pesanan…</p>
  return <main className="auth-page"><section className="auth-card"><Link className="auth-brand" to={isBuyer ? '/orders' : '/seller'}>Kembali ke pesanan</Link><h1>Detail pesanan</h1>
    {message && <p className="auth-feedback" role={order ? 'status' : 'alert'}>{message}</p>}
    {!order ? null : <><p>Status: <strong>{orderStatusText[order.status] ?? order.status}</strong></p><p>Status pembayaran: <strong>DEMO / SIMULASI — {paymentStatusText[order.payment_status] ?? order.payment_status}</strong></p><p>Total: {formatRupiah(order.total_idr)}</p><p>Dibuat: {new Date(order.placed_at).toLocaleString('id-ID')}</p>
      <h2>Item pesanan</h2><ul>{order.order_items.map((item, index) => <li key={`${item.title_snapshot}-${index}`}><strong>{item.title_snapshot}</strong><p>{categoryDisplayName(item.category_snapshot)} · {formatRupiah(item.unit_price_idr)} · {item.delivery_days_snapshot} hari</p><p>{item.description_snapshot}</p><p>Hasil: {item.deliverables_snapshot}</p></li>)}</ul>
      {isBuyer && order.status === 'awaiting_payment' && order.payment_status !== 'pending' && <button className="button button-dark" disabled={busy} onClick={() => void startPayment()}>Mulai pembayaran demo</button>}
      {isBuyer && order.status === 'awaiting_payment' && order.payment_status === 'pending' && <p>Pembayaran simulasi menunggu konfirmasi admin. Jangan mengirim uang sungguhan.</p>}
      <h2>Hasil kerja</h2>{order.order_deliverables.length ? <ul>{order.order_deliverables.map((item, index) => <li key={`${item.title}-${index}`}><strong>{item.title}</strong><p><a href={item.drive_url} target="_blank" rel="noopener noreferrer">Buka hasil di Google Drive</a></p>{item.notes && <p>{item.notes}</p>}<small>{new Date(item.created_at).toLocaleString('id-ID')}</small></li>)}</ul> : <p>Belum ada hasil yang dikirim.</p>}
      {order.order_events.map((event, index) => <p key={`${event.event_type}-${index}`}>Revisi diminta: {event.note}</p>)}
      {isBuyer && order.status === 'delivered' && order.payment_status === 'paid' && <><button className="button button-dark" disabled={busy} onClick={() => void transition('completed')}>Terima hasil dan selesaikan</button>{!order.order_events.some((event) => event.event_type === 'revision_requested') && <form onSubmit={requestRevision}><label htmlFor="revision-note">Minta revisi (maksimal satu kali)</label><textarea id="revision-note" required maxLength={2000} value={revision} onChange={(event) => setRevision(event.target.value)} /><button disabled={busy}>Kirim permintaan revisi</button></form>}</>}
      <h2>Riwayat pembayaran simulasi</h2>{order.payment_records.length ? <ul>{order.payment_records.map((record, index) => <li key={`${record.created_at}-${index}`}>{paymentStatusText[record.status] ?? record.status}{record.note ? ` · ${record.note}` : ''} · {new Date(record.created_at).toLocaleString('id-ID')}</li>)}</ul> : <p>Belum ada aktivitas pembayaran simulasi.</p>}
      {isBuyer && !roles.includes('buyer') && <p>Akun pembeli tidak aktif; tindakan pesanan dinonaktifkan oleh server.</p>}
    </>}
  </section></main>
}

function SellerOrderInbox({ sellerId }: { sellerId: string }) {
  const [orders, setOrders] = useState<MarketplaceOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [busyOrder, setBusyOrder] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      if (!supabase) { setLoading(false); return }
      const { data, error } = await supabase.from('orders').select('id,buyer_id,seller_id,status,payment_status,total_idr,placed_at,order_items(title_snapshot,description_snapshot,category_snapshot,deliverables_snapshot,unit_price_idr,delivery_days_snapshot),order_events(event_type,note,created_at),payment_records(status,note,created_at),order_deliverables(title,drive_url,notes,created_at)').eq('seller_id', sellerId).order('placed_at', { ascending: false })
      if (!active) return
      if (error) setMessage('Pesanan seller tidak dapat dimuat.')
      else setOrders((data ?? []) as MarketplaceOrder[])
      setLoading(false)
    }
    void load().catch(() => { if (active) { setMessage('Pesanan seller tidak dapat dimuat.'); setLoading(false) } })
    return () => { active = false }
  }, [sellerId, reload])
  async function startWork(orderId: string) {
    if (!supabase) return
    setBusyOrder(orderId)
    const { error } = await supabase.rpc('transition_order', { p_order_id: orderId, p_target: 'in_progress' })
    setMessage(error ? 'Pesanan tidak dapat dimulai.' : 'Pesanan ditandai sedang dikerjakan.')
    setBusyOrder(''); if (!error) setReload((value) => value + 1)
  }
  async function deliver(event: FormEvent<HTMLFormElement>, orderId: string) {
    event.preventDefault()
    if (!supabase) return
    const form = new FormData(event.currentTarget)
    const url = String(form.get('url') ?? '').trim()
    const title = String(form.get('title') ?? '').trim()
    if (!title || title.length > 120 || !/^https:\/\/drive\.google\.com(?:[/:?#]|$)/i.test(url)) { setMessage('Masukkan judul dan URL HTTPS Google Drive yang valid.'); return }
    setBusyOrder(orderId)
    const { error } = await supabase.functions.invoke('order-deliverable', { body: { orderId, url, title, notes: String(form.get('notes') ?? '').trim() } })
    setMessage(error ? 'Hasil tidak dapat dikirim. Periksa URL Google Drive dan status pesanan.' : 'Hasil kerja berhasil dikirim ke pembeli.')
    setBusyOrder(''); if (!error) setReload((value) => value + 1)
  }
  return <section aria-labelledby="seller-orders-title"><h2 id="seller-orders-title">Pesanan pelanggan</h2>{loading ? <p role="status">Memuat pesanan…</p> : orders.length ? orders.map((order) => <article key={order.id}><h3><Link to={`/orders/${order.id}`}>Pesanan {order.id}</Link></h3><p>{order.order_items.map((item) => item.title_snapshot).join(', ')} · {orderStatusText[order.status] ?? order.status}</p><p>Pembayaran demo: {paymentStatusText[order.payment_status] ?? order.payment_status}</p>{order.status === 'confirmed' && order.payment_status === 'paid' && <button disabled={busyOrder === order.id} onClick={() => void startWork(order.id)}>Mulai pengerjaan</button>}{['in_progress', 'revision_requested'].includes(order.status) && order.payment_status === 'paid' && <form onSubmit={(event) => void deliver(event, order.id)}><label htmlFor={`deliver-title-${order.id}`}>Judul hasil</label><input id={`deliver-title-${order.id}`} name="title" required maxLength={120} /><label htmlFor={`deliver-url-${order.id}`}>URL Google Drive</label><input id={`deliver-url-${order.id}`} name="url" type="url" required placeholder="https://drive.google.com/..." /><label htmlFor={`deliver-notes-${order.id}`}>Catatan</label><textarea id={`deliver-notes-${order.id}`} name="notes" maxLength={2000} /><button disabled={busyOrder === order.id}>Kirim hasil</button></form>}</article>) : <p>Belum ada pesanan pelanggan.</p>}{message && <p className="auth-feedback" role="status">{message}</p>}</section>
}

type SellerListing = {
  id: string; title: string; short_summary: string; description: string; deliverables: string
  category_id: number; price_idr: string | number; delivery_days: number; status: string
  creative_service_media: Array<{ id: string; drive_url: string | null; sort_order: number }>
}
type SellerPortfolio = { id: string; title: string; description: string | null; drive_url: string | null; is_public: boolean; sort_order: number }
type MediaRemovalRequest =
  | { action: 'remove'; kind: 'listing'; mediaId: string }
  | { action: 'remove'; kind: 'portfolio'; portfolioId: string }

function isMediaRemovalSuccess(data: unknown): data is { removed: true; cleanupPending: boolean } {
  return data !== null && typeof data === 'object' && 'removed' in data && data.removed === true
    && 'cleanupPending' in data && typeof data.cleanupPending === 'boolean'
}
type SellerCategory = { id: number; name: string }

export function SellerPage() {
  const { user, roles, roleStatus } = useAuth()
  const [categories, setCategories] = useState<SellerCategory[]>([])
  const [listings, setListings] = useState<SellerListing[]>([])
  const [portfolio, setPortfolio] = useState<SellerPortfolio[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const eligible = roleStatus === 'ready' && roles.includes('seller')

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true); setMessage('')
      if (!supabase || !user || !eligible) { setLoading(false); return }
      const client = supabase
      const [categoryResult, listingResult, portfolioResult] = await Promise.all([
        client.from('service_categories').select('id,name').eq('is_active', true).order('sort_order'),
        client.from('creative_services').select('id,title,short_summary,description,deliverables,category_id,price_idr,delivery_days,status,creative_service_media(id,drive_url,sort_order)').eq('seller_id', user.id).order('created_at', { ascending: false }),
        client.from('portfolio_items').select('id,title,description,drive_url,is_public,sort_order').eq('seller_id', user.id).order('sort_order'),
      ])
      if (!active) return
      if (categoryResult.error || listingResult.error || portfolioResult.error) {
        setMessage('Studio data tidak dapat dimuat. Periksa akses database dan coba muat ulang.')
      } else {
        const nextListings = (listingResult.data ?? []) as SellerListing[]
        const nextPortfolio = (portfolioResult.data ?? []) as SellerPortfolio[]
        setCategories(categoryResult.data ?? []); setListings(nextListings); setPortfolio(nextPortfolio)
      }
      if (active) setLoading(false)
    }
    void load().catch(() => { if (active) { setMessage('Studio data tidak dapat dimuat.'); setLoading(false) } })
    return () => { active = false }
  }, [user, eligible, reload])

  async function saveListing(event: FormEvent<HTMLFormElement>, serviceId?: string) {
    event.preventDefault()
    if (!supabase || !user) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const values = {
      title: String(form.get('title') ?? '').trim(), short_summary: String(form.get('summary') ?? '').trim(),
      description: String(form.get('description') ?? '').trim(), deliverables: String(form.get('deliverables') ?? '').trim(),
      category_id: Number(form.get('category')), price_idr: String(form.get('price') ?? ''), delivery_days: Number(form.get('days')),
    }
    if (!values.title || values.title.length > 120 || !values.short_summary || values.short_summary.length > 300 || !values.description || values.description.length > 5000 || !values.deliverables || values.deliverables.length > 2000 || !Number.isInteger(values.category_id) || !Number.isInteger(values.delivery_days) || values.delivery_days < 1 || !/^\d+$/.test(values.price_idr) || BigInt(values.price_idr) <= 0n) {
      setMessage('Periksa isian: batas judul 120, ringkasan 300, deskripsi 5.000, hasil 2.000 karakter; harga dan durasi harus bilangan positif.')
      return
    }
    setBusy(true); setMessage('')
    try {
      const result = serviceId
        ? await supabase.from('creative_services').update(values).eq('id', serviceId).eq('seller_id', user.id)
        : await supabase.from('creative_services').insert({ ...values, seller_id: user.id })
      setMessage(result.error ? 'Listing tidak dapat disimpan. Periksa kelayakan seller, kategori, dan data yang diisi.' : 'Listing tersimpan sebagai draft.')
      if (!result.error) { setEditing(null); setReload((value) => value + 1) }
    } catch { setMessage('Listing tidak dapat disimpan. Periksa koneksi lalu coba lagi.') }
    finally { setBusy(false) }
  }

  async function listingTransition(id: string, status: 'published' | 'paused' | 'archived') {
    if (!supabase) return
    setBusy(true)
    const { error } = await supabase.rpc('transition_listing', { p_service_id: id, p_status: status })
    setMessage(error ? 'Perubahan status ditolak. Pastikan listing lengkap dan transisinya valid.' : `Listing diperbarui: ${status}.`)
    setBusy(false); if (!error) setReload((value) => value + 1)
  }

  async function saveListingMedia(event: FormEvent<HTMLFormElement>, serviceId: string, sortOrder: number) {
    event.preventDefault()
    if (!supabase) return
    const form = new FormData(event.currentTarget)
    const driveUrl = normalizeGoogleDriveUrl(String(form.get('drive_url') ?? ''))
    if (driveUrl === null) { setMessage('Gunakan tautan HTTPS drive.google.com atau docs.google.com.'); return }
    if (!driveUrl) { setMessage('Tidak ada tautan thumbnail untuk disimpan.'); return }
    setBusy(true)
    const serviceMedia = listings.find((listing) => listing.id === serviceId)?.creative_service_media ?? []
    const existing = sortOrder === -32768 ? serviceMedia.find((media) => media.sort_order === sortOrder) : undefined
    const result = existing
      ? await supabase.from('creative_service_media').update({ drive_url: driveUrl }).eq('id', existing.id)
      : await supabase.from('creative_service_media').insert({ service_id: serviceId, drive_url: driveUrl, sort_order: sortOrder === -32768 ? sortOrder : Math.max(0, ...serviceMedia.map((media) => media.sort_order)) + 1 })
    setMessage(result.error ? 'Google Drive link could not be saved.' : 'Google Drive link saved.')
    setBusy(false); if (!result.error) setReload((value) => value + 1)
  }

  async function removeMedia(request: MediaRemovalRequest, label: string) {
    if (!supabase || !window.confirm(`Hapus ${label} ini?`)) return
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('media-upload', { body: request })
      if (error || !isMediaRemovalSuccess(data)) {
        setMessage(`${label} tidak dapat dihapus.`)
        return
      }
      setMessage(data.cleanupPending ? `${label} dihapus; pembersihan Storage lama masih tertunda.` : `${label} dihapus.`)
      setReload((value) => value + 1)
    } catch {
      setMessage(`${label} tidak dapat dihapus.`)
    } finally {
      setBusy(false)
    }
  }

  async function removeListingMedia(mediaId: string) {
    await removeMedia({ action: 'remove', kind: 'listing', mediaId }, 'Media')
  }

  async function addPortfolio(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const driveUrl = normalizeGoogleDriveUrl(String(form.get('drive_url') ?? ''))
    if (driveUrl === null) { setMessage('Gunakan tautan HTTPS drive.google.com atau docs.google.com.'); return }
    setBusy(true)
    try {
      const { error } = await supabase.from('portfolio_items').insert({ id: crypto.randomUUID(), seller_id: user?.id, title: String(form.get('title') ?? '').trim(), description: String(form.get('description') ?? '').trim() || null, drive_url: driveUrl || null, is_public: form.get('isPublic') === 'on' })
      setMessage(error ? 'Portfolio entry could not be saved.' : 'Portfolio entry added.')
      if (!error) { formElement.reset(); setReload((value) => value + 1) }
    } catch { setMessage('Portfolio entry could not be saved. Check your connection and try again.') }
    finally { setBusy(false) }
  }

  async function savePortfolio(event: FormEvent<HTMLFormElement>, item: SellerPortfolio) {
    event.preventDefault()
    if (!supabase) return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    const driveUrl = normalizeGoogleDriveUrl(String(form.get('drive_url') ?? ''))
    if (driveUrl === null) { setMessage('Gunakan tautan HTTPS drive.google.com atau docs.google.com.'); setBusy(false); return }
    const { error } = await supabase.from('portfolio_items').update({ title: String(form.get('title') ?? '').trim(), description: String(form.get('description') ?? '').trim() || null, drive_url: driveUrl || null, is_public: form.get('is_public') === 'on' }).eq('id', item.id)
    setMessage(error ? 'Portfolio tidak dapat diperbarui.' : 'Portfolio diperbarui.')
    setBusy(false); if (!error) setReload((value) => value + 1)
  }

  async function removePortfolio(id: string) {
    await removeMedia({ action: 'remove', kind: 'portfolio', portfolioId: id }, 'Portfolio')
  }

  if (roleStatus === 'loading' || loading) return <main className="page-shell"><section className="panel cart-state" role="status"><span className="loading-dot" /><p>Memuat Seller Studio…</p></section></main>
  if (!user || roleStatus !== 'ready' || !eligible) return <main className="page-shell"><section className="panel error-panel"><h1>Seller Studio</h1><p>{roleStatus === 'error' ? 'Status seller tidak dapat diverifikasi.' : 'Akses studio memerlukan akun aktif dengan kemampuan seller.'}</p><Link className="button button-outline" to="/dashboard">Kembali ke dashboard</Link></section></main>

  return <main className="page-shell seller-page"><header className="page-heading"><p className="eyebrow">RUANG KREATOR</p><h1>Seller Studio</h1><p>Kelola layanan, tautan karya, dan pesanan dari satu tempat.</p></header><section className="seller-studio">
    <div className="studio-intro"><span className="status-chip">SELLER AKTIF</span><p>Listing dan portfolio dibatasi ke akun Anda.</p></div><SellerOnboarding activeSeller /><SellerOrderInbox sellerId={user.id} />
    {message && <p className="auth-feedback" role="status" aria-live="polite">{message}</p>}
    <h2>Buat listing</h2><ListingForm categories={categories} busy={busy} onSave={(event) => void saveListing(event)} />
    <h2>Listing Anda</h2>{listings.length ? listings.map((item) => <article className="seller-listing" key={item.id}>
      <h3>{item.title} <small>({item.status})</small></h3><p>{item.short_summary}</p>
      {[...item.creative_service_media].sort((a, b) => a.sort_order - b.sort_order).map((media) => <div key={media.id}>{media.drive_url && <a href={media.drive_url} target="_blank" rel="noopener noreferrer">Open Google Drive listing link</a>} {media.sort_order === -32768 && <strong>Thumbnail link</strong>} <button type="button" disabled={busy} onClick={() => void removeListingMedia(media.id)}>Remove link</button></div>)}
      {item.status !== 'archived' && <><form onSubmit={(event) => void saveListingMedia(event, item.id, -32768)}><label htmlFor={`thumb-${item.id}`}>Google Drive thumbnail link (optional)</label><input id={`thumb-${item.id}`} name="drive_url" type="url" maxLength={2048} defaultValue={item.creative_service_media.find((media) => media.sort_order === -32768)?.drive_url ?? ''} /><button disabled={busy}>Save thumbnail link</button></form><form onSubmit={(event) => void saveListingMedia(event, item.id, 0)}><label htmlFor={`gallery-${item.id}`}>Google Drive gallery link</label><input id={`gallery-${item.id}`} name="drive_url" type="url" required maxLength={2048} /><button disabled={busy}>Add gallery link</button></form><p>Configure Drive sharing permissions so viewers can open these links.</p>
      <button type="button" disabled={busy} onClick={() => setEditing(editing === item.id ? null : item.id)}>{editing === item.id ? 'Tutup edit' : 'Edit listing'}</button>
      {editing === item.id && <ListingForm categories={categories} listing={item} busy={busy} onSave={(event) => void saveListing(event, item.id)} />}
      {item.status === 'draft' || item.status === 'paused' ? <button type="button" disabled={busy} onClick={() => void listingTransition(item.id, 'published')}>Publikasikan</button> : item.status === 'published' ? <button type="button" disabled={busy} onClick={() => void listingTransition(item.id, 'paused')}>Jeda listing</button> : null}
      <button type="button" disabled={busy} onClick={() => void listingTransition(item.id, 'archived')}>Arsipkan</button></>}
    </article>) : <p>Belum ada listing. Listing baru dibuat sebagai draft.</p>}
    <h2>Portfolio</h2><form onSubmit={addPortfolio}><label htmlFor="portfolio-title">Judul karya</label><input id="portfolio-title" name="title" required maxLength={120} /><label htmlFor="portfolio-description">Deskripsi</label><textarea id="portfolio-description" name="description" maxLength={2000} /><label htmlFor="portfolio-drive-url">Google Drive link (optional)</label><input id="portfolio-drive-url" name="drive_url" type="url" maxLength={2048} /><p>Configure Drive sharing permissions so viewers can open this link.</p><label><input type="checkbox" name="isPublic" /> Tampilkan di portfolio publik</label><button className="button button-dark" disabled={busy}>Tambah karya</button></form>
    {portfolio.map((item) => <article className="seller-listing" key={item.id}>{item.drive_url && <p><a href={item.drive_url} target="_blank" rel="noopener noreferrer">Open Google Drive portfolio link</a></p>}<form onSubmit={(event) => void savePortfolio(event, item)}><label htmlFor={`portfolio-title-${item.id}`}>Judul karya</label><input id={`portfolio-title-${item.id}`} name="title" required maxLength={120} defaultValue={item.title} /><label htmlFor={`portfolio-description-${item.id}`}>Deskripsi</label><textarea id={`portfolio-description-${item.id}`} name="description" maxLength={2000} defaultValue={item.description ?? ''} /><label htmlFor={`portfolio-url-${item.id}`}>Google Drive link (optional)</label><input id={`portfolio-url-${item.id}`} name="drive_url" type="url" maxLength={2048} defaultValue={item.drive_url ?? ''} /><label><input type="checkbox" name="is_public" defaultChecked={item.is_public} /> Tampilkan di portfolio publik</label><button disabled={busy}>Simpan</button><button type="button" disabled={busy} onClick={() => void removePortfolio(item.id)}>Hapus karya</button></form></article>)}
  </section></main>
}

function ListingForm({ categories, listing, busy, onSave }: { categories: SellerCategory[]; listing?: SellerListing; busy: boolean; onSave: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="listing-form" onSubmit={onSave}><label>Judul<input name="title" required maxLength={120} defaultValue={listing?.title ?? ''} /></label><label>Ringkasan<input name="summary" required maxLength={300} defaultValue={listing?.short_summary ?? ''} /></label><label>Deskripsi<textarea name="description" required maxLength={5000} defaultValue={listing?.description ?? ''} /></label><label>Hasil yang diterima<textarea name="deliverables" required maxLength={2000} defaultValue={listing?.deliverables ?? ''} /></label><label>Kategori<select name="category" required defaultValue={listing?.category_id ?? ''}><option value="" disabled>Pilih kategori</option>{categories.map((category) => <option key={category.id} value={category.id}>{categoryDisplayName(category.name)}</option>)}</select></label><label>Harga (IDR)<input name="price" type="number" min="1" step="1" required defaultValue={listing?.price_idr ?? ''} /></label><label>Durasi (hari)<input name="days" type="number" min="1" max="32767" step="1" required defaultValue={listing?.delivery_days ?? ''} /></label><button className="button button-dark" disabled={busy}>{listing ? 'Simpan perubahan' : 'Simpan sebagai draft'}</button></form>
}
