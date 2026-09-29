/* =====================================================================
   BOLSILLO · registro rápido de gastos en efectivo para la familia
   - Funciona sin conexión: todo se guarda primero en el móvil y se
     sincroniza con Supabase cuando hay red.
   - Hogar compartido: cada uno ve sus gastos y los del otro.
   - Exporta cada mes un JSON que Patrimonio Familiar sabe importar.
   ===================================================================== */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const VERSION = '1.2.0';
const MONEDAS = ['EUR', 'USD', 'MXN', 'CUP'];
const DECIMALES = { EUR: 2, USD: 2, MXN: 2, CUP: 0 };
const SIMBOLO = { EUR: '€', USD: 'US$', MXN: 'MX$', CUP: 'CUP' };
const NOMBRE_MONEDA = { EUR: 'euros', USD: 'dólares', MXN: 'pesos mexicanos', CUP: 'pesos cubanos' };
const CATEGORIAS_INICIALES = [
  { nombre: 'Comida', icono: '🛒' }, { nombre: 'Restaurantes', icono: '🍽️' },
  { nombre: 'Actividades', icono: '🎟️' }, { nombre: 'Otros', icono: '📦' },
];
const COLORES = 8; // la paleta categórica tiene 8 tonos en orden fijo; a partir del 9.º, gris
const CLAVE_ESTADO = 'bolsillo:v1';
const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/* =====================================================================
   UTILIDADES
   ===================================================================== */
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const pad = (n) => String(n).padStart(2, '0');
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const periodoDe = (fecha) => String(fecha).slice(0, 7);
const periodoActual = () => hoyISO().slice(0, 7);
const sumarDias = (iso, n) => { const [a, m, d] = iso.split('-').map(Number); const x = new Date(a, m - 1, d + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const sumarMeses = (per, n) => { const [a, m] = per.split('-').map(Number); const x = new Date(a, m - 1 + n, 1); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; };
const diasDelMes = (per) => { const [a, m] = per.split('-').map(Number); return new Date(a, m, 0).getDate(); };
const fechaLocal = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const nombreMes = (per, largo = true) => {
  const [a, m] = per.split('-').map(Number);
  const s = new Intl.DateTimeFormat('es-ES', { month: largo ? 'long' : 'short', year: 'numeric' }).format(new Date(a, m - 1, 1));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const nombreDia = (iso) => {
  if (iso === hoyISO()) return 'Hoy';
  if (iso === sumarDias(hoyISO(), -1)) return 'Ayer';
  const s = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short' }).format(fechaLocal(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const fmtNum = (n, dec = 2) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n || 0);
const fmtMon = (n, moneda = 'EUR', dec) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const d = dec ?? DECIMALES[moneda] ?? 2;
  return moneda === 'EUR' ? `${fmtNum(n, d)} €` : `${fmtNum(n, d)} ${SIMBOLO[moneda] || moneda}`;
};
const fmtEur = (n, dec = 2) => fmtMon(n, 'EUR', dec);
const fmtPct = (n, dec = 0) => (n === null || !Number.isFinite(n) ? '—' : `${fmtNum(n, dec)} %`);
const iniciales = (nombre) => (nombre || '?').trim().slice(0, 1).toUpperCase();
const vibrar = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* no disponible en iOS */ } };
const normal = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* =====================================================================
   ESTADO LOCAL (fuente de verdad en el dispositivo)
   ===================================================================== */
function estadoVacio() {
  return {
    version: 1,
    modo: null,            // 'local' | 'nube'
    usuario: null,         // { id, email }
    hogar: null,           // { id, nombre, codigo }
    yo: null,              // nombre con el que firmo mis gastos
    miembros: [],          // [{ user_id, nombre }]
    categorias: {},        // id -> fila
    gastos: {},            // id -> fila
    tasas: {},             // 'AAAA-MM|MON' -> { periodo, moneda, unidades_por_eur }
    cola: [],              // cambios pendientes de subir [{ tabla, clave, fila }]
    cursores: {},          // tabla -> último updated_at descargado
    ultimaSync: null,
    exportaciones: {},     // periodo -> ISO de la última exportación
    prefs: { moneda: 'USD', guardarAlTocar: true, ocultar: false, tema: 'auto' },
  };
}
function cargarEstado() {
  try {
    const raw = localStorage.getItem(CLAVE_ESTADO);
    if (!raw) return estadoVacio();
    const e = JSON.parse(raw);
    const base = estadoVacio();
    return { ...base, ...e, prefs: { ...base.prefs, ...(e.prefs || {}) } };
  } catch (err) { return estadoVacio(); }
}
let E = cargarEstado();
function persistir() {
  try { localStorage.setItem(CLAVE_ESTADO, JSON.stringify(E)); }
  catch (err) { toast('No queda espacio en el móvil para guardar. Exporta y borra meses antiguos.'); }
}

/* =====================================================================
   SUPABASE (opcional: sin config.js la app funciona en modo local)
   ===================================================================== */
const hayNube = () => !!(window.__SUPABASE_MOCK__ || (SUPABASE_URL && SUPABASE_ANON_KEY));
let cliente = null;
async function obtenerCliente() {
  if (window.__SUPABASE_MOCK__) return window.__SUPABASE_MOCK__;
  if (!hayNube()) return null;
  if (cliente) return cliente;
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bolsillo-auth' },
    });
    return cliente;
  } catch (err) { return null; } // sin conexión y sin la librería en caché: se sigue en local
}

const CLAVES_TABLA = { gastos: ['id'], categorias: ['id'], tasas: ['hogar_id', 'periodo', 'moneda'], miembros: ['hogar_id', 'user_id'] };
const COLUMNAS = {
  gastos: ['id', 'hogar_id', 'persona', 'fecha', 'importe', 'moneda', 'categoria_id', 'nota', 'lugar', 'etiquetas', 'eliminado', 'creado_en'],
  categorias: ['id', 'hogar_id', 'nombre', 'icono', 'color', 'orden', 'presupuesto', 'activa', 'eliminado'],
  tasas: ['hogar_id', 'periodo', 'moneda', 'unidades_por_eur'],
  miembros: ['hogar_id', 'user_id', 'nombre'],
};
const claveFila = (tabla, f) => CLAVES_TABLA[tabla].map(k => f[k]).join('|');
const claveLocal = (tabla, f) => (tabla === 'tasas' ? `${f.periodo}|${f.moneda}` : f.id);
const coleccion = (tabla) => ({ gastos: E.gastos, categorias: E.categorias, tasas: E.tasas }[tabla]);

function normalizarFila(tabla, f) {
  const r = { ...f };
  if (tabla === 'gastos') { r.importe = Number(r.importe); r.etiquetas = r.etiquetas || []; }
  if (tabla === 'categorias') { r.presupuesto = r.presupuesto === null || r.presupuesto === undefined ? null : Number(r.presupuesto); r.color = Number(r.color) || 0; }
  if (tabla === 'tasas') r.unidades_por_eur = Number(r.unidades_por_eur);
  return r;
}

// Toda modificación pasa por aquí: se aplica en el móvil al instante y se encola para subirla.
function guardarFila(tabla, fila) {
  const f = normalizarFila(tabla, { ...fila, hogar_id: E.hogar ? E.hogar.id : 'local', updated_at: new Date().toISOString() });
  coleccion(tabla)[claveLocal(tabla, f)] = f;
  if (E.modo === 'nube') {
    const clave = claveFila(tabla, f);
    const subir = {};
    COLUMNAS[tabla].forEach(k => { if (f[k] !== undefined) subir[k] = f[k]; });
    E.cola = E.cola.filter(c => !(c.tabla === tabla && c.clave === clave));
    E.cola.push({ tabla, clave, fila: subir });
  }
  persistir();
  programarSync(400);
  return f;
}
const pendiente = (tabla, f) => E.cola.some(c => c.tabla === tabla && c.clave === claveFila(tabla, f));

let sincronizando = false;
let temporizadorSync = null;
let estadoRed = { tipo: 'ok', texto: '' };
function programarSync(ms = 1500) { clearTimeout(temporizadorSync); temporizadorSync = setTimeout(sincronizar, ms); }

async function sincronizar() {
  if (E.modo !== 'nube' || !E.hogar || sincronizando) return;
  if (!navigator.onLine) { ponerEstadoRed('sinred'); return; }
  const c = await obtenerCliente();
  if (!c) { ponerEstadoRed('sinred'); return; }
  sincronizando = true; ponerEstadoRed('sincronizando');
  let cambios = false;
  try {
    const { data: ses } = await c.auth.getSession();
    if (!ses || !ses.session) { ponerEstadoRed('sesion'); return; }
    // 1) Subir lo pendiente, por lotes y por tabla (primero categorías: los gastos las referencian)
    for (const tabla of ['categorias', 'tasas', 'gastos', 'miembros']) {
      const lote = E.cola.filter(x => x.tabla === tabla);
      for (let i = 0; i < lote.length; i += 100) {
        const trozo = lote.slice(i, i + 100);
        const { error } = await c.from(tabla).upsert(trozo.map(x => x.fila), { onConflict: CLAVES_TABLA[tabla].join(',') });
        if (error) throw error;
        // Se retiran solo los elementos subidos que no hayan cambiado mientras tanto
        E.cola = E.cola.filter(x => !trozo.includes(x));
        persistir();
      }
    }
    // 2) Bajar lo nuevo desde la última vez
    for (const tabla of ['categorias', 'tasas', 'gastos']) {
      let desde = E.cursores[tabla] || null;
      for (let vuelta = 0; vuelta < 50; vuelta++) {
        let q = c.from(tabla).select('*').eq('hogar_id', E.hogar.id).order('updated_at', { ascending: true }).limit(1000);
        if (desde) q = q.gte('updated_at', desde);
        const { data, error } = await q;
        if (error) throw error;
        (data || []).forEach(f => { if (aplicarRemota(tabla, f)) cambios = true; });
        if (data && data.length) desde = data[data.length - 1].updated_at;
        if (!data || data.length < 1000) break;
      }
      if (desde) E.cursores[tabla] = desde;
    }
    const { data: miembros, error: errM } = await c.from('miembros').select('user_id,nombre').eq('hogar_id', E.hogar.id);
    if (!errM && miembros) {
      if (JSON.stringify(miembros) !== JSON.stringify(E.miembros)) cambios = true;
      E.miembros = miembros;
    }
    E.ultimaSync = new Date().toISOString();
    persistir();
    if (E.migracion) setTimeout(migrarPendiente, 0);
    ponerEstadoRed(E.cola.length ? 'pendiente' : 'ok');
  } catch (err) {
    ponerEstadoRed('error', err && err.message);
  } finally {
    sincronizando = false;
    if (cambios) render();
    else pintarEstadoRed();
    if (E.cola.length && navigator.onLine && estadoRed.tipo !== 'error') programarSync(3000);
  }
}

// Aplica una fila que llega del servidor, salvo que aquí haya un cambio más reciente sin subir.
function aplicarRemota(tabla, fila) {
  const f = normalizarFila(tabla, fila);
  if (pendiente(tabla, f)) return false;
  const col = coleccion(tabla);
  const k = claveLocal(tabla, f);
  const antes = col[k];
  if (antes && JSON.stringify(antes) === JSON.stringify(f)) return false;
  col[k] = f;
  return true;
}

let canal = null;
async function suscribirTiempoReal() {
  if (E.modo !== 'nube' || !E.hogar) return;
  const c = await obtenerCliente();
  if (!c || !c.channel) return;
  try {
    if (canal) { c.removeChannel(canal); canal = null; }
    canal = c.channel(`hogar-${E.hogar.id}`);
    ['gastos', 'categorias', 'tasas'].forEach(tabla => {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: tabla, filter: `hogar_id=eq.${E.hogar.id}` }, (p) => {
        if (p.new && Object.keys(p.new).length && aplicarRemota(tabla, p.new)) {
          if (!E.cursores[tabla] || p.new.updated_at > E.cursores[tabla]) E.cursores[tabla] = p.new.updated_at;
          persistir(); render();
        }
      });
    });
    canal.subscribe();
  } catch (err) { /* el tiempo real es un extra: la sincronización periódica cubre el resto */ }
}

function ponerEstadoRed(tipo, detalle) {
  const textos = {
    ok: 'Sincronizado', sincronizando: 'Sincronizando…', pendiente: 'Pendiente de subir',
    sinred: 'Sin conexión · guardado en el móvil', error: 'Error al sincronizar', sesion: 'Sesión caducada · vuelve a entrar',
  };
  estadoRed = { tipo, texto: textos[tipo] || tipo, detalle };
  pintarEstadoRed();
}
function pintarEstadoRed() {
  const el = $('#estado-sync');
  if (!el) return;
  if (E.modo !== 'nube') { el.innerHTML = `<span class="punto local"></span>Solo en este móvil`; return; }
  const n = E.cola.length;
  const clase = estadoRed.tipo === 'error' || estadoRed.tipo === 'sesion' ? 'error' : (n || estadoRed.tipo === 'sinred' ? 'pendiente' : '');
  const texto = n && estadoRed.tipo !== 'sincronizando' ? `${n} pendiente${n === 1 ? '' : 's'} de subir` : estadoRed.texto;
  el.innerHTML = `<span class="punto ${clase}"></span>${esc(texto)}`;
}

/* =====================================================================
   DATOS DERIVADOS
   ===================================================================== */
const categoriasOrdenadas = (incluirInactivas = false) => Object.values(E.categorias)
  .filter(c => !c.eliminado && (incluirInactivas || c.activa))
  .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre));
const categoria = (id) => E.categorias[id] || { nombre: 'Sin categoría', icono: '❔', color: 99 };
const colorCat = (c) => (c && Number.isInteger(c.color) && c.color < COLORES ? `var(--c${c.color + 1})` : 'var(--c-otro)');
const gastosVivos = () => Object.values(E.gastos).filter(g => !g.eliminado);
const personas = () => {
  const s = new Set(E.miembros.map(m => m.nombre));
  if (E.yo) s.add(E.yo);
  gastosVivos().forEach(g => s.add(g.persona));
  return [...s].filter(Boolean);
};

// Unidades de la moneda por 1 EUR para un mes. Si el mes no tiene tasa, se usa la última
// anterior y, si no hay ninguna anterior, la primera posterior (marcada como estimada).
function tasa(moneda, periodo) {
  if (moneda === 'EUR') return { valor: 1, estimada: false, periodo };
  const exacta = E.tasas[`${periodo}|${moneda}`];
  if (exacta) return { valor: exacta.unidades_por_eur, estimada: false, periodo };
  const todas = Object.values(E.tasas).filter(t => t.moneda === moneda).sort((a, b) => a.periodo.localeCompare(b.periodo));
  const anterior = todas.filter(t => t.periodo < periodo).pop();
  const ref = anterior || todas.find(t => t.periodo > periodo);
  return ref ? { valor: ref.unidades_por_eur, estimada: true, periodo: ref.periodo } : null;
}
function aEur(importe, moneda, fecha) {
  const t = tasa(moneda, periodoDe(fecha));
  return t ? importe / t.valor : null;
}
const eurDe = (g) => aEur(g.importe, g.moneda, g.fecha);

function gastosDelMes(periodo, filtroPersona = 'todos') {
  return gastosVivos().filter(g => periodoDe(g.fecha) === periodo && (filtroPersona === 'todos' || g.persona === filtroPersona));
}
function sumaEur(lista) {
  let total = 0, sinTasa = 0;
  lista.forEach(g => { const v = eurDe(g); if (v === null) sinTasa += 1; else total += v; });
  return { total, sinTasa };
}
// Monedas usadas en un mes que no tienen tasa propia de ese mes
function monedasSinTasaPropia(periodo) {
  const usadas = new Set(gastosDelMes(periodo).map(g => g.moneda).filter(m => m !== 'EUR'));
  return [...usadas].filter(m => !E.tasas[`${periodo}|${m}`]);
}

/* =====================================================================
   INTERFAZ: estado efímero
   ===================================================================== */
const ui = {
  pestana: 'anadir',
  entrada: null,
  mesMovs: periodoActual(),
  mesStats: periodoActual(),
  filtroPersona: 'todos',
  filtroCat: '',
  busqueda: '',
  hoja: null,
  mesExport: null,
  ultimoGuardado: null,
};
function entradaNueva(parcial = {}) {
  return {
    texto: '', moneda: E.prefs.moneda || 'USD', categoriaId: null, fecha: hoyISO(), persona: E.yo,
    nota: '', lugar: '', etiquetas: '', ...parcial,
  };
}

/* =====================================================================
   RENDER GENERAL
   ===================================================================== */
const ICONOS = {
  anadir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  movs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  ojo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
};
const TITULOS = { anadir: 'Nuevo gasto', movs: 'Movimientos', stats: 'Resumen', ajustes: 'Ajustes' };

function render() {
  aplicarTema();
  const app = $('#app');
  document.body.classList.toggle('oculto-privado', !!E.prefs.ocultar);
  if (!E.modo) { app.innerHTML = vistaBienvenida(); return; }
  if (E.modo === 'nube' && (!E.usuario || !E.hogar)) { app.innerHTML = E.usuario ? vistaHogar() : vistaLogin(); return; }
  if (!ui.entrada) ui.entrada = entradaNueva();

  // Conservar el foco (p. ej. la búsqueda) entre repintados
  const activo = document.activeElement;
  const foco = activo && activo.id ? { id: activo.id, ini: activo.selectionStart, fin: activo.selectionEnd } : null;

  const cuerpo = { anadir: vistaAnadir, movs: vistaMovimientos, stats: vistaResumen, ajustes: vistaAjustes }[ui.pestana]();
  app.innerHTML = `
    <header class="cabecera">
      <div><h1>${TITULOS[ui.pestana]}</h1><div class="estado-sync" id="estado-sync"></div></div>
      <button data-accion="privacidad" title="Ocultar importes" aria-label="Ocultar importes" style="color:var(--texto-2)">${ICONOS.ojo}</button>
    </header>
    <main>${cuerpo}</main>
    <nav class="tabs"><div class="tabs-dentro">
      ${['anadir', 'movs', 'stats', 'ajustes'].map(t => `
        <button class="tab ${ui.pestana === t ? 'activa' : ''}" data-accion="pestana" data-v="${t}">${ICONOS[t]}<span>${{ anadir: 'Añadir', movs: 'Movimientos', stats: 'Resumen', ajustes: 'Ajustes' }[t]}</span></button>`).join('')}
    </div></nav>
    ${ui.hoja ? vistaHoja() : ''}`;
  pintarEstadoRed();
  if (foco) {
    const el = document.getElementById(foco.id);
    if (el) { el.focus(); try { el.setSelectionRange(foco.ini, foco.fin); } catch (e) { /* no todos los campos lo admiten */ } }
  }
}

function aplicarTema() {
  const t = E.prefs.tema;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t === 'oscuro' ? 'dark' : 'light');
}

/* =====================================================================
   BIENVENIDA, ACCESO Y HOGAR
   ===================================================================== */
const LOGO = '<img class="logo" src="icons/icon-192.png" alt="Bolsillo" width="64" height="64">';

function vistaBienvenida() {
  const nube = hayNube();
  return `<div class="acceso">${LOGO}
    <h1>Bolsillo</h1>
    <p class="sub">Apunta un gasto en efectivo en tres toques, aunque no haya conexión. Al final del mes, se lo pasas a Patrimonio Familiar.</p>
    ${nube ? `
      <button class="btn bloque" data-accion="empezar-nube">Entrar con mi cuenta</button>
      <p class="mini" style="margin-top:12px">Los gastos se comparten con tu hogar y se guardan en la nube cuando hay conexión.</p>
      <div class="separador"></div>
      <button class="enlace" data-accion="empezar-local">Usar solo en este móvil</button>`
    : `
      <div class="aviso neutro">No hay base de datos configurada (config.js vacío). Puedes usar la app solo en este móvil y conectarla más adelante.</div>
      <div class="campo"><label for="nombre-local">Tu nombre (el mismo que en Patrimonio)</label><input class="input" id="nombre-local" placeholder="Jose" autocomplete="given-name"></div>
      <div class="campo"><label for="pareja-local">Nombre de tu pareja (opcional)</label><input class="input" id="pareja-local" placeholder="Blanca"></div>
      <button class="btn bloque" data-accion="crear-local">Empezar</button>`}
  </div>`;
}

function vistaLogin() {
  return `<div class="acceso">${LOGO}
    <h1>Entrar</h1>
    <p class="sub">Usa el mismo correo en tus dispositivos. Tu pareja entra con su propia cuenta y se une a tu hogar con un código.</p>
    <div class="campo"><label for="email">Correo</label><input class="input" id="email" type="email" autocomplete="email" inputmode="email"></div>
    <div class="campo"><label for="clave">Contraseña</label><input class="input" id="clave" type="password" autocomplete="current-password"></div>
    <div id="msg-login"></div>
    <button class="btn bloque" data-accion="login">Entrar</button>
    <button class="btn sec bloque" style="margin-top:8px" data-accion="registro">Crear cuenta nueva</button>
    ${Object.keys(E.gastos).length ? '' : '<div class="separador"></div><button class="enlace" data-accion="volver-bienvenida">Volver</button>'}
  </div>`;
}

function vistaHogar() {
  return `<div class="acceso">${LOGO}
    <h1>Tu hogar</h1>
    <p class="sub">Un hogar agrupa los gastos de la familia. Uno lo crea y el otro se une con el código.</p>
    <div class="campo"><label for="mi-nombre">Tu nombre (el mismo que en Patrimonio)</label><input class="input" id="mi-nombre" placeholder="Jose"></div>
    <div class="tarjeta">
      <h2>Crear un hogar nuevo</h2>
      <div class="campo"><label for="nombre-hogar">Nombre</label><input class="input" id="nombre-hogar" value="Familia"></div>
      <button class="btn bloque" data-accion="crear-hogar">Crear hogar</button>
    </div>
    <div class="tarjeta">
      <h2>Unirme con un código</h2>
      <div class="campo"><label for="codigo">Código de invitación</label><input class="input" id="codigo" placeholder="ABC123" autocapitalize="characters"></div>
      <button class="btn sec bloque" data-accion="unirse-hogar">Unirme</button>
    </div>
    <div id="msg-hogar"></div>
    <button class="enlace" data-accion="cerrar-sesion">Cerrar sesión</button>
  </div>`;
}

async function login(registro) {
  const email = $('#email').value.trim();
  const clave = $('#clave').value;
  const msg = $('#msg-login');
  if (!email || clave.length < 6) { msg.innerHTML = '<div class="aviso rojo">Escribe el correo y una contraseña de al menos 6 caracteres.</div>'; return; }
  const c = await obtenerCliente();
  if (!c) { msg.innerHTML = '<div class="aviso rojo">No hay conexión con el servidor. Inténtalo cuando tengas red.</div>'; return; }
  msg.innerHTML = '<p class="mini">Conectando…</p>';
  const r = registro ? await c.auth.signUp({ email, password: clave }) : await c.auth.signInWithPassword({ email, password: clave });
  if (r.error) { msg.innerHTML = `<div class="aviso rojo">${esc(traducirError(r.error.message))}</div>`; return; }
  if (!r.data.session) { msg.innerHTML = '<div class="aviso verde">Cuenta creada. Revisa tu correo para confirmarla y después entra.</div>'; return; }
  E.usuario = { id: r.data.session.user.id, email };
  await cargarHogar();
  persistir(); render();
}

function traducirError(m) {
  if (/Invalid login/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/already registered/i.test(m)) return 'Ese correo ya tiene cuenta: usa «Entrar».';
  if (/Email not confirmed/i.test(m)) return 'Falta confirmar el correo (revisa tu bandeja de entrada).';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión con el servidor.';
  return m;
}

async function cargarHogar() {
  const c = await obtenerCliente();
  const { data: mias } = await c.from('miembros').select('hogar_id,nombre').eq('user_id', E.usuario.id);
  if (!mias || !mias.length) { E.hogar = null; return; }
  const { data: h } = await c.from('hogares').select('id,nombre,codigo').eq('id', mias[0].hogar_id);
  if (!h || !h.length) return;
  entrarEnHogar(h[0], mias[0].nombre);
}

function entrarEnHogar(hogar, miNombre) {
  const cambia = !E.hogar || E.hogar.id !== hogar.id;
  if (cambia) {
    // Lo que hubiera en modo local (o de otro hogar) se guarda aparte para subirlo
    // al hogar después de la primera sincronización, casando las categorías por nombre.
    const gastos = gastosVivos();
    if (gastos.length || Object.keys(E.tasas).length) {
      E.migracion = { gastos, tasas: Object.values(E.tasas), categorias: Object.values(E.categorias).filter(c => !c.eliminado) };
    }
    E.categorias = {}; E.gastos = {}; E.tasas = {}; E.cursores = {}; E.cola = [];
  }
  E.hogar = { id: hogar.id, nombre: hogar.nombre, codigo: hogar.codigo };
  E.yo = miNombre;
  ui.entrada = entradaNueva();
  persistir();
  sincronizar().then(() => { migrarPendiente(); suscribirTiempoReal(); });
}

function migrarPendiente() {
  const m = E.migracion;
  if (!m || !Object.keys(E.categorias).length) return; // hace falta haber bajado las categorías del hogar
  const delHogar = Object.values(E.categorias);
  const mapa = {};
  m.categorias.forEach(c => {
    const igual = delHogar.find(h => normal(h.nombre) === normal(c.nombre));
    if (igual) mapa[c.id] = igual.id;
    else {
      const usados = new Set(Object.values(E.categorias).map(x => x.color));
      let color = 0; while (usados.has(color) && color < COLORES) color++;
      const nueva = guardarFila('categorias', { ...c, color, orden: Object.keys(E.categorias).length });
      mapa[c.id] = nueva.id;
    }
  });
  m.tasas.forEach(t => { if (!E.tasas[`${t.periodo}|${t.moneda}`]) guardarFila('tasas', { periodo: t.periodo, moneda: t.moneda, unidades_por_eur: t.unidades_por_eur }); });
  m.gastos.forEach(g => guardarFila('gastos', { ...g, categoria_id: mapa[g.categoria_id] || g.categoria_id }));
  delete E.migracion;
  persistir();
  toast(`${m.gastos.length} gasto${m.gastos.length === 1 ? '' : 's'} de este móvil pasados al hogar`);
  render();
  sincronizar();
}

async function crearHogar(unirse) {
  const nombre = $('#mi-nombre').value.trim();
  const msg = $('#msg-hogar');
  if (!nombre) { msg.innerHTML = '<div class="aviso rojo">Escribe tu nombre.</div>'; return; }
  const c = await obtenerCliente();
  if (!c) { msg.innerHTML = '<div class="aviso rojo">Necesitas conexión para este paso.</div>'; return; }
  const r = unirse
    ? await c.rpc('unirse_hogar', { p_codigo: $('#codigo').value, p_mi_nombre: nombre })
    : await c.rpc('crear_hogar', { p_nombre: $('#nombre-hogar').value, p_mi_nombre: nombre });
  if (r.error) { msg.innerHTML = `<div class="aviso rojo">${esc(r.error.message)}</div>`; return; }
  const h = Array.isArray(r.data) ? r.data[0] : r.data;
  entrarEnHogar(h, nombre);
  render();
}

function crearLocal() {
  const yo = $('#nombre-local').value.trim();
  const pareja = $('#pareja-local').value.trim();
  if (!yo) { toast('Escribe tu nombre'); return; }
  E.modo = 'local'; E.yo = yo;
  E.hogar = { id: 'local', nombre: 'Este móvil', codigo: null };
  E.miembros = [{ user_id: 'yo', nombre: yo }, ...(pareja ? [{ user_id: 'pareja', nombre: pareja }] : [])];
  CATEGORIAS_INICIALES.forEach((c, i) => guardarFila('categorias', { id: nuevoId(), nombre: c.nombre, icono: c.icono, color: i, orden: i, presupuesto: null, activa: true, eliminado: false }));
  ui.entrada = entradaNueva();
  persistir(); render();
}

/* =====================================================================
   PANTALLA: AÑADIR
   ===================================================================== */
function valorEntrada() {
  const t = ui.entrada.texto;
  if (!t) return 0;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
function textoImporte(t) {
  if (!t) return '0';
  const [ent, dec] = t.split(',');
  const e = new Intl.NumberFormat('es-ES').format(Number(ent || 0));
  return dec !== undefined ? `${e},${dec}` : e;
}

// Combinaciones frecuentes de los últimos 60 días (importe + moneda + categoría)
function rapidos() {
  const limite = sumarDias(hoyISO(), -60);
  const cuenta = {};
  gastosVivos().filter(g => g.fecha >= limite && g.persona === E.yo && E.categorias[g.categoria_id]).forEach(g => {
    const k = `${g.importe}|${g.moneda}|${g.categoria_id}`;
    cuenta[k] = (cuenta[k] || 0) + 1;
  });
  return Object.entries(cuenta).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k]) => { const [importe, moneda, categoria_id] = k.split('|'); return { importe: Number(importe), moneda, categoria_id }; });
}

function vistaAnadir() {
  const en = ui.entrada;
  const valor = valorEntrada();
  const periodo = periodoDe(en.fecha);
  const t = tasa(en.moneda, periodo);
  const eur = en.moneda !== 'EUR' && valor && t ? valor / t.valor : null;
  const cats = categoriasOrdenadas();
  const hoyTotal = sumaEur(gastosVivos().filter(g => g.fecha === hoyISO())).total;
  const mes = gastosDelMes(periodoActual());
  const mesTotal = sumaEur(mes).total;
  const presupuesto = cats.reduce((s, c) => s + (c.presupuesto || 0), 0);
  const quedan = diasDelMes(periodoActual()) - Number(hoyISO().slice(8)) + 1;
  const porDia = presupuesto ? Math.max(0, presupuesto - mesTotal) / quedan : null;
  const fechas = [hoyISO(), sumarDias(hoyISO(), -1), sumarDias(hoyISO(), -2)];
  const otraFecha = !fechas.includes(en.fecha);
  const miembros = personas();

  return `
    <div class="resumen-rapido">
      <div class="item"><div class="mini">Hoy</div><div class="v num privado">${fmtEur(hoyTotal, 0)}</div></div>
      <div class="item"><div class="mini">${nombreMes(periodoActual(), false)}</div><div class="v num privado">${fmtEur(mesTotal, 0)}</div></div>
      ${porDia !== null ? `<div class="item"><div class="mini">Puedes gastar</div><div class="v num privado">${fmtEur(porDia, 0)}/día</div></div>` : ''}
    </div>

    <div class="segmentado" role="radiogroup" aria-label="Moneda">
      ${MONEDAS.map(m => `<button class="${en.moneda === m ? 'activo' : ''}" data-accion="moneda" data-v="${m}" role="radio" aria-checked="${en.moneda === m}">${m}</button>`).join('')}
    </div>
    <div class="importe num ${valor ? '' : 'vacio'}" aria-live="polite">${textoImporte(en.texto)}<span class="moneda">${SIMBOLO[en.moneda]}</span></div>
    ${en.moneda !== 'EUR' && !t
      ? `<button class="aviso-tasa" data-accion="abrir-tasas" data-v="${periodo}">Falta el tipo de cambio de ${en.moneda} · añadirlo</button>`
      : `<div class="conversion num">${eur !== null ? `≈ ${fmtEur(eur)}${t.estimada ? ` · tasa de ${nombreMes(t.periodo, false)}` : ''}` : '&nbsp;'}</div>`}

    <div class="teclado">
      ${['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map(k => `<button class="tecla" data-accion="tecla" data-v="${k}" aria-label="${k === '⌫' ? 'Borrar' : k}">${k}</button>`).join('')}
    </div>

    <div class="categorias-grid">
      ${cats.map(c => `
        <button class="cat ${en.categoriaId === c.id ? 'activa' : ''}" style="--cat-color:${colorCat(c)}" data-accion="categoria" data-v="${c.id}">
          <span class="ico">${esc(c.icono)}</span><span>${esc(c.nombre)}</span>
        </button>`).join('')}
      <button class="cat nueva" data-accion="nueva-categoria"><span class="ico">＋</span><span>Nueva</span></button>
    </div>
    ${E.prefs.guardarAlTocar
      ? `<p class="mini" style="text-align:center;margin:8px 0 0">Escribe el importe y toca la categoría: se guarda al momento.</p>`
      : `<button class="btn bloque guardar-fijo" data-accion="guardar-entrada" ${valor && en.categoriaId ? '' : 'disabled'}>Guardar gasto</button>`}

    <button class="enlace" style="display:block;margin:10px auto 0;font-size:13px" data-accion="pegar-atajo">📋 Pegar gasto guardado por el atajo sin conexión</button>

    <div class="etiqueta-sec">Fecha</div>
    <div class="chips scroll">
      ${fechas.map(f => `<button class="chip ${en.fecha === f ? 'activo' : ''}" data-accion="fecha" data-v="${f}">${nombreDia(f)}</button>`).join('')}
      <label class="chip ${otraFecha ? 'activo' : ''}" style="position:relative">
        ${otraFecha ? esc(nombreDia(en.fecha)) : 'Otra fecha'}
        <input type="date" id="fecha-otra" max="${hoyISO()}" value="${en.fecha}" data-cambio="fecha-otra" style="position:absolute;inset:0;opacity:0;width:100%">
      </label>
    </div>

    ${miembros.length > 1 ? `
      <div class="etiqueta-sec">Pagó</div>
      <div class="chips">${miembros.map(p => `<button class="chip ${en.persona === p ? 'activo' : ''}" data-accion="persona" data-v="${esc(p)}"><span class="avatar">${esc(iniciales(p))}</span>${esc(p)}</button>`).join('')}</div>` : ''}

    <details class="detalles" ${en.nota || en.lugar || en.etiquetas ? 'open' : ''}>
      <summary>＋ Nota, lugar o etiquetas</summary>
      <div class="campo"><label for="en-nota">Nota</label><input class="input" id="en-nota" data-cambio="entrada" data-campo="nota" value="${esc(en.nota)}" placeholder="Ej. compra semanal"></div>
      <div class="campo"><label for="en-lugar">Lugar</label><input class="input" id="en-lugar" list="lugares" data-cambio="entrada" data-campo="lugar" value="${esc(en.lugar)}" placeholder="Ej. Mercado de 19 y B"></div>
      <datalist id="lugares">${[...new Set(gastosVivos().map(g => g.lugar).filter(Boolean))].slice(0, 50).map(l => `<option value="${esc(l)}">`).join('')}</datalist>
      <div class="campo"><label for="en-etiq">Etiquetas (separadas por comas)</label><input class="input" id="en-etiq" data-cambio="entrada" data-campo="etiquetas" value="${esc(en.etiquetas)}" placeholder="Ej. viaje-cdmx, cumple"></div>
      ${E.prefs.guardarAlTocar ? `<button class="btn bloque" data-accion="guardar-entrada" ${valor && en.categoriaId ? '' : 'disabled'}>Guardar con estos detalles</button>` : ''}
    </details>

    ${rapidos().length ? `
      <div class="etiqueta-sec">Repetir un gasto habitual</div>
      <div class="chips scroll">${rapidos().map(r => { const c = categoria(r.categoria_id); return `<button class="chip" data-accion="rapido" data-v="${r.importe}|${r.moneda}|${r.categoria_id}">${esc(c.icono)} ${fmtMon(r.importe, r.moneda)}</button>`; }).join('')}</div>` : ''}
  `;
}

function pulsarTecla(k) {
  const en = ui.entrada;
  let t = en.texto;
  if (k === '⌫') t = t.slice(0, -1);
  else if (k === ',') { if (!t.includes(',') && (DECIMALES[en.moneda] > 0)) t = (t || '0') + ','; }
  else {
    const [ent, dec] = t.split(',');
    if (dec !== undefined && dec.length >= 2) return;
    if (dec === undefined && ent.length >= 9) return;
    t = t === '0' ? k : t + k;
  }
  en.texto = t;
  vibrar();
  render();
}

function guardarEntrada() {
  const en = ui.entrada;
  const importe = Math.round(valorEntrada() * 100) / 100;
  if (!importe) { toast('Escribe primero el importe'); return; }
  if (!en.categoriaId) { toast('Elige una categoría'); return; }
  if (en.fecha > hoyISO()) { toast('La fecha no puede ser futura'); return; }
  const g = guardarFila('gastos', {
    id: nuevoId(), persona: en.persona || E.yo, fecha: en.fecha, importe, moneda: en.moneda,
    categoria_id: en.categoriaId, nota: en.nota.trim() || null, lugar: en.lugar.trim() || null,
    etiquetas: en.etiquetas.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean),
    eliminado: false, creado_en: new Date().toISOString(),
  });
  E.prefs.moneda = en.moneda; persistir();
  vibrar();
  const c = categoria(g.categoria_id);
  ui.entrada = entradaNueva({ moneda: en.moneda, fecha: en.fecha });
  render();
  const aviso = en.moneda !== 'EUR' && !tasa(en.moneda, periodoDe(g.fecha)) ? ' (sin tipo de cambio)' : '';
  toast(`${c.icono} ${fmtMon(importe, g.moneda)} en ${c.nombre}${aviso}`, 'Deshacer', () => {
    guardarFila('gastos', { ...E.gastos[g.id], eliminado: true });
    render();
  });
}

/* =====================================================================
   PANTALLA: MOVIMIENTOS
   ===================================================================== */
function vistaMovimientos() {
  const per = ui.mesMovs;
  const q = normal(ui.busqueda);
  const lista = gastosDelMes(per, ui.filtroPersona)
    .filter(g => !ui.filtroCat || g.categoria_id === ui.filtroCat)
    .filter(g => !q || normal(`${categoria(g.categoria_id).nombre} ${g.nota || ''} ${g.lugar || ''} ${(g.etiquetas || []).join(' ')} ${g.persona} ${g.importe}`).includes(q))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || String(b.creado_en).localeCompare(String(a.creado_en)));
  const porDia = {};
  lista.forEach(g => { (porDia[g.fecha] = porDia[g.fecha] || []).push(g); });
  const { total, sinTasa } = sumaEur(lista);
  const miembros = personas();

  return `
    ${selectorMes(per, 'mes-movs')}
    <div class="campo" style="margin-top:10px"><input class="input" id="busqueda" type="search" placeholder="Buscar por nota, lugar, etiqueta…" value="${esc(ui.busqueda)}" data-cambio="busqueda"></div>
    <div class="chips scroll">
      ${miembros.length > 1 ? ['todos', ...miembros].map(p => `<button class="chip ${ui.filtroPersona === p ? 'activo' : ''}" data-accion="filtro-persona" data-v="${esc(p)}">${p === 'todos' ? 'Todos' : esc(p)}</button>`).join('') : ''}
      <button class="chip ${!ui.filtroCat ? 'activo' : ''}" data-accion="filtro-cat" data-v="">Todas</button>
      ${categoriasOrdenadas(true).map(c => `<button class="chip ${ui.filtroCat === c.id ? 'activo' : ''}" data-accion="filtro-cat" data-v="${c.id}">${esc(c.icono)} ${esc(c.nombre)}</button>`).join('')}
    </div>
    <div class="fila" style="margin:12px 4px 0"><span class="mini">${lista.length} gasto${lista.length === 1 ? '' : 's'}</span><strong class="num privado">${fmtEur(total)}</strong></div>
    ${sinTasa ? `<div class="aviso" style="margin-top:8px">${sinTasa} gasto${sinTasa === 1 ? '' : 's'} sin tipo de cambio no ${sinTasa === 1 ? 'suma' : 'suman'} en euros. <button class="enlace" data-accion="abrir-tasas" data-v="${per}">Añadir tasa</button></div>` : ''}
    ${lista.length === 0 ? `<div class="tarjeta" style="text-align:center;margin-top:12px"><p class="sub" style="margin:0">No hay gastos con estos filtros.</p></div>` : ''}
    ${Object.entries(porDia).map(([dia, gs]) => `
      <div class="dia-cab"><span>${nombreDia(dia)}</span><span class="num privado">${fmtEur(sumaEur(gs).total)}</span></div>
      <div class="lista">${gs.map(filaGasto).join('')}</div>`).join('')}
  `;
}

function filaGasto(g) {
  const c = categoria(g.categoria_id);
  const eur = eurDe(g);
  const detalle = [g.lugar, g.nota, ...(g.etiquetas || []).map(e => `#${e}`)].filter(Boolean).join(' · ');
  return `<button class="mov" data-accion="editar" data-v="${g.id}">
    <span class="ico" style="--cat-color:${colorCat(c)}">${esc(c.icono)}</span>
    <span class="cuerpo">
      <div class="titulo">${esc(c.nombre)}</div>
      <div class="detalle"><span class="avatar">${esc(iniciales(g.persona))}</span>${esc(detalle || g.persona)}${pendiente('gastos', g) ? ' · <span class="pend">sin subir</span>' : ''}</div>
    </span>
    <span class="imp num privado">
      <div class="o">${fmtMon(g.importe, g.moneda)}</div>
      ${g.moneda !== 'EUR' ? `<div class="e">${eur === null ? 'sin tasa' : fmtEur(eur)}</div>` : ''}
    </span>
  </button>`;
}

function selectorMes(per, accion) {
  const siguiente = sumarMeses(per, 1);
  return `<div class="fila" style="margin-top:4px">
    <button class="btn sec" data-accion="${accion}" data-v="${sumarMeses(per, -1)}" aria-label="Mes anterior">‹</button>
    <strong>${nombreMes(per)}</strong>
    <button class="btn sec" data-accion="${accion}" data-v="${siguiente}" aria-label="Mes siguiente" ${siguiente > periodoActual() ? 'disabled' : ''}>›</button>
  </div>`;
}

/* ---------- Hoja de edición ---------- */
function abrirEdicion(id) {
  const g = E.gastos[id];
  if (!g) return;
  ui.hoja = {
    tipo: 'editar', id, importe: String(g.importe).replace('.', ','), moneda: g.moneda, categoriaId: g.categoria_id,
    fecha: g.fecha, persona: g.persona, nota: g.nota || '', lugar: g.lugar || '', etiquetas: (g.etiquetas || []).join(', '),
  };
  render();
}

function vistaHoja() {
  const h = ui.hoja;
  let cuerpo = '';
  if (h.tipo === 'editar') {
    cuerpo = `<h3>Editar gasto</h3>
      <div class="campo"><label for="h-importe">Importe</label><input class="input num" id="h-importe" inputmode="decimal" value="${esc(h.importe)}" data-cambio="hoja" data-campo="importe"></div>
      <div class="segmentado" style="margin-bottom:10px">${MONEDAS.map(m => `<button class="${h.moneda === m ? 'activo' : ''}" data-accion="hoja-set" data-campo="moneda" data-v="${m}">${m}</button>`).join('')}</div>
      <div class="categorias-grid" style="margin-bottom:10px">${categoriasOrdenadas(true).filter(c => c.activa || c.id === h.categoriaId).map(c => `
        <button class="cat ${h.categoriaId === c.id ? 'activa' : ''}" style="--cat-color:${colorCat(c)}" data-accion="hoja-set" data-campo="categoriaId" data-v="${c.id}"><span class="ico">${esc(c.icono)}</span><span>${esc(c.nombre)}</span></button>`).join('')}</div>
      <div class="campo"><label for="h-fecha">Fecha</label><input class="input" type="date" id="h-fecha" max="${hoyISO()}" value="${h.fecha}" data-cambio="hoja" data-campo="fecha"></div>
      ${personas().length > 1 ? `<div class="campo"><label>Pagó</label><div class="chips">${personas().map(p => `<button class="chip ${h.persona === p ? 'activo' : ''}" data-accion="hoja-set" data-campo="persona" data-v="${esc(p)}">${esc(p)}</button>`).join('')}</div></div>` : ''}
      <div class="campo"><label for="h-nota">Nota</label><input class="input" id="h-nota" value="${esc(h.nota)}" data-cambio="hoja" data-campo="nota"></div>
      <div class="campo"><label for="h-lugar">Lugar</label><input class="input" id="h-lugar" value="${esc(h.lugar)}" data-cambio="hoja" data-campo="lugar"></div>
      <div class="campo"><label for="h-etiq">Etiquetas</label><input class="input" id="h-etiq" value="${esc(h.etiquetas)}" data-cambio="hoja" data-campo="etiquetas"></div>
      <button class="btn bloque" data-accion="hoja-guardar">Guardar cambios</button>
      <button class="btn peligro bloque" style="margin-top:8px" data-accion="hoja-eliminar">Eliminar gasto</button>`;
  } else if (h.tipo === 'categoria') {
    const c = h.id ? E.categorias[h.id] : null;
    cuerpo = `<h3>${c ? 'Editar categoría' : 'Nueva categoría'}</h3>
      <div class="fila" style="align-items:flex-end">
        <div class="campo" style="width:84px"><label for="c-icono">Icono</label><input class="input" id="c-icono" value="${esc(h.icono)}" maxlength="4" data-cambio="hoja" data-campo="icono" style="text-align:center;font-size:22px"></div>
        <div class="campo" style="flex:1"><label for="c-nombre">Nombre</label><input class="input" id="c-nombre" value="${esc(h.nombre)}" data-cambio="hoja" data-campo="nombre"></div>
      </div>
      <div class="chips" style="margin-bottom:10px">${['🛒', '🍽️', '🎟️', '📦', '🚕', '💊', '🏠', '👕', '🎁', '✈️', '📱', '🐶', '⛽', '💡', '🍺', '🎓'].map(i => `<button class="chip" data-accion="hoja-set" data-campo="icono" data-v="${i}">${i}</button>`).join('')}</div>
      <div class="campo"><label for="c-presu">Presupuesto mensual en euros (opcional)</label><input class="input num" id="c-presu" inputmode="decimal" value="${esc(h.presupuesto)}" data-cambio="hoja" data-campo="presupuesto" placeholder="Sin presupuesto"></div>
      <button class="btn bloque" data-accion="hoja-guardar-cat">${c ? 'Guardar' : 'Crear categoría'}</button>
      ${c ? `<button class="btn sec bloque" style="margin-top:8px" data-accion="archivar-cat">${c.activa ? 'Ocultar de la pantalla de captura' : 'Volver a mostrar'}</button>` : ''}`;
  } else if (h.tipo === 'tasas') {
    const per = h.periodo;
    cuerpo = `<h3>Tipos de cambio · ${nombreMes(per)}</h3>
      <p class="sub">Unidades de cada moneda por 1 euro, al cambio al que de verdad compráis. Se usan para pasar los gastos a euros y viajan a Patrimonio en la exportación.</p>
      ${['USD', 'MXN', 'CUP'].map(m => {
        const t = E.tasas[`${per}|${m}`]; const ref = tasa(m, per);
        return `<div class="campo"><label for="t-${m}">${m} por 1 € (${NOMBRE_MONEDA[m]})</label>
          <input class="input num" id="t-${m}" inputmode="decimal" value="${esc(h.valores[m] ?? (t ? String(t.unidades_por_eur).replace('.', ',') : ''))}" data-cambio="tasa" data-campo="${m}" placeholder="${ref ? `${fmtNum(ref.valor, m === 'CUP' ? 0 : 2)} (de ${nombreMes(ref.periodo, false)})` : 'Sin dato'}"></div>`;
      }).join('')}
      <p class="mini">Para el peso cubano, la referencia informal diaria está en elTOQUE.</p>
      <button class="btn bloque" data-accion="guardar-tasas">Guardar</button>
      ${Object.values(E.tasas).some(t => t.periodo < per) ? `<button class="btn sec bloque" style="margin-top:8px" data-accion="copiar-tasas">Copiar las del mes anterior</button>` : ''}`;
  } else if (h.tipo === 'atajo') {
    const url = `${SUPABASE_URL}/rest/v1/rpc/registrar_gasto_atajo`;
    const fila = (etq, valor, clave) => `<div class="campo"><label>${etq}</label>
      <div style="display:flex;gap:8px"><input class="input num" readonly value="${esc(valor)}" style="font-size:12px">
      <button class="btn sec" data-accion="copiar" data-v="${clave}">Copiar</button></div></div>`;
    cuerpo = `<h3>Datos para tu atajo</h3>
      <div class="aviso">Guárdalo ahora: por seguridad, el código no se vuelve a mostrar. Si lo pierdes, genera otro.</div>
      ${fila('1 · Dirección (URL)', url, 'url')}
      ${fila('2 · Clave pública (apikey)', SUPABASE_ANON_KEY, 'apikey')}
      ${fila(`3 · Tu código personal (${esc(E.yo)})`, h.token, 'token')}
      <p class="mini">Pega cada valor en el paso correspondiente de la guía. El código solo permite añadir gastos a tu nombre en este hogar.</p>
      <button class="btn bloque" style="margin-top:8px" data-accion="cerrar-hoja">Hecho</button>`;
  } else if (h.tipo === 'exportado') {
    cuerpo = `<h3>Exportación lista</h3>
      <p class="sub">En Patrimonio Familiar: Movimientos → «Importar gastos de Bolsillo» → elige este fichero.</p>
      <button class="btn bloque" data-accion="compartir-export">Compartir o guardar el fichero</button>
      <button class="btn sec bloque" style="margin-top:8px" data-accion="cerrar-hoja">Hecho</button>`;
  }
  return `<div class="velo" data-accion="cerrar-hoja-fondo"><div class="hoja" role="dialog" aria-modal="true"><div class="asa"></div>${cuerpo}</div></div>`;
}

function guardarEdicion() {
  const h = ui.hoja;
  const g = E.gastos[h.id];
  const importe = Math.round(Number(String(h.importe).replace(/\./g, '').replace(',', '.')) * 100) / 100;
  if (!Number.isFinite(importe) || importe <= 0) { toast('El importe no es válido'); return; }
  if (h.fecha > hoyISO()) { toast('La fecha no puede ser futura'); return; }
  guardarFila('gastos', {
    ...g, importe, moneda: h.moneda, categoria_id: h.categoriaId, fecha: h.fecha, persona: h.persona,
    nota: h.nota.trim() || null, lugar: h.lugar.trim() || null,
    etiquetas: h.etiquetas.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean),
  });
  ui.hoja = null; render(); toast('Gasto actualizado');
}

function eliminarGasto(id) {
  const g = E.gastos[id];
  guardarFila('gastos', { ...g, eliminado: true });
  ui.hoja = null; render();
  toast('Gasto eliminado', 'Deshacer', () => { guardarFila('gastos', { ...E.gastos[id], eliminado: false }); render(); });
}

/* =====================================================================
   PANTALLA: RESUMEN (estadísticas)
   ===================================================================== */
function vistaResumen() {
  const per = ui.mesStats;
  const esActual = per === periodoActual();
  const dias = diasDelMes(per);
  const diaHoy = esActual ? Number(hoyISO().slice(8)) : dias;
  const lista = gastosDelMes(per, ui.filtroPersona);
  const { total, sinTasa } = sumaEur(lista);
  const prev = sumarMeses(per, -1);
  const listaPrev = gastosDelMes(prev, ui.filtroPersona);
  const prevMismoDia = sumaEur(listaPrev.filter(g => Number(g.fecha.slice(8)) <= diaHoy)).total;
  const prevTotal = sumaEur(listaPrev).total;
  const variacion = prevMismoDia ? ((total - prevMismoDia) / prevMismoDia) * 100 : null;
  const media = diaHoy ? total / diaHoy : 0;
  const proyeccion = esActual ? media * dias : total;
  const cats = categoriasOrdenadas(true);
  const presuTotal = categoriasOrdenadas().reduce((s, c) => s + (c.presupuesto || 0), 0);
  const miembros = personas();

  // Por categoría
  const porCat = {};
  lista.forEach(g => { const v = eurDe(g); if (v === null) return; porCat[g.categoria_id] = (porCat[g.categoria_id] || 0) + v; });
  const porCatPrev = {};
  listaPrev.forEach(g => { const v = eurDe(g); if (v === null) return; porCatPrev[g.categoria_id] = (porCatPrev[g.categoria_id] || 0) + v; });
  const filasCat = Object.entries(porCat).map(([id, v]) => ({ c: categoria(id), id, v, n: lista.filter(g => g.categoria_id === id).length }))
    .sort((a, b) => b.v - a.v);

  // Por día
  const porDia = Array.from({ length: dias }, () => 0);
  lista.forEach(g => { const v = eurDe(g); if (v !== null) porDia[Number(g.fecha.slice(8)) - 1] += v; });
  const porDiaPrev = Array.from({ length: diasDelMes(prev) }, () => 0);
  listaPrev.forEach(g => { const v = eurDe(g); if (v !== null) porDiaPrev[Number(g.fecha.slice(8)) - 1] += v; });

  // Por persona y por moneda
  const porPersona = {};
  lista.forEach(g => { const v = eurDe(g); if (v !== null) porPersona[g.persona] = (porPersona[g.persona] || 0) + v; });
  const porMoneda = {};
  lista.forEach(g => { porMoneda[g.moneda] = (porMoneda[g.moneda] || 0) + g.importe; });

  return `
    ${selectorMes(per, 'mes-stats')}
    ${miembros.length > 1 ? `<div class="chips" style="margin-top:10px">${['todos', ...miembros].map(p => `<button class="chip ${ui.filtroPersona === p ? 'activo' : ''}" data-accion="filtro-persona" data-v="${esc(p)}">${p === 'todos' ? 'Hogar' : esc(p)}</button>`).join('')}</div>` : ''}

    <div class="tarjeta" style="margin-top:12px">
      <div class="mini">Gastado en ${nombreMes(per).toLowerCase()}${esActual ? ' hasta hoy' : ''}</div>
      <div class="hero num privado">${fmtEur(total)}</div>
      ${variacion !== null ? `<div class="mini"><span class="${variacion > 0 ? 'sube' : 'baja'}">${variacion > 0 ? '▲' : '▼'} ${fmtPct(Math.abs(variacion))}</span> frente al mismo día de ${nombreMes(prev, false).toLowerCase()} (${fmtEur(prevMismoDia, 0)})</div>` : ''}
      ${sinTasa ? `<div class="aviso" style="margin:10px 0 0">${sinTasa} gasto${sinTasa === 1 ? '' : 's'} sin tipo de cambio fuera del total. <button class="enlace" data-accion="abrir-tasas" data-v="${per}">Añadir</button></div>` : ''}
      <div class="kpis" style="margin-top:12px">
        <div class="kpi"><div class="k">Media diaria</div><div class="v num privado">${fmtEur(media)}</div></div>
        <div class="kpi"><div class="k">${esActual ? 'Previsión a fin de mes' : 'Mes anterior'}</div><div class="v num privado">${fmtEur(esActual ? proyeccion : prevTotal, 0)}</div></div>
        <div class="kpi"><div class="k">Nº de gastos</div><div class="v num">${lista.length}</div></div>
        <div class="kpi"><div class="k">${presuTotal ? 'Presupuesto usado' : 'Gasto medio'}</div><div class="v num privado">${presuTotal ? fmtPct((total / presuTotal) * 100) : fmtEur(lista.length ? total / lista.length : 0)}</div></div>
      </div>
    </div>

    ${vistaPerspectivas({ per, lista, total, filasCat, porCatPrev, porDia, prevTotal, esActual, proyeccion, presuTotal, diaHoy, dias })}

    <div class="tarjeta">
      <h2>Ritmo del mes</h2>
      <p class="sub">Gasto acumulado día a día frente al mes anterior${presuTotal ? ' y al presupuesto' : ''}.</p>
      ${graficoRitmo(porDia, porDiaPrev, esActual ? diaHoy : dias, presuTotal, per, prev)}
    </div>

    ${presuTotal || cats.some(c => c.presupuesto) ? `<div class="tarjeta"><h2>Presupuestos</h2>
      <p class="sub">La marca indica dónde deberías ir a estas alturas del mes (día ${diaHoy} de ${dias}).</p>
      ${cats.filter(c => c.presupuesto).map(c => {
        const gastado = porCat[c.id] || 0; const pct = (gastado / c.presupuesto) * 100; const esperado = (diaHoy / dias) * 100;
        const estado = pct > 100 ? ['mal', '⚠ Superado'] : pct > esperado + 10 ? ['ojo', '● Por encima del ritmo'] : ['bien', '✓ En ritmo'];
        return `<div class="presu"><div class="fila"><span>${esc(c.icono)} ${esc(c.nombre)}</span><span class="num privado">${fmtEur(gastado, 0)} / ${fmtEur(c.presupuesto, 0)}</span></div>
          <div class="barra" style="--c:${colorCat(c)}"><span style="width:${Math.min(100, pct)}%"></span><i class="marca" style="left:${Math.min(100, esperado)}%"></i></div>
          <div class="fila" style="margin-top:4px"><span class="estado-presu ${estado[0]}">${estado[1]}</span><span class="mini">${pct > 100 ? `${fmtEur(gastado - c.presupuesto, 0)} de más` : `quedan ${fmtEur(c.presupuesto - gastado, 0)}`}</span></div></div>`;
      }).join('')}</div>` : ''}

    <div class="tarjeta">
      <h2>Por categoría</h2>
      ${filasCat.length ? `${graficoDonut(filasCat, total)}
      <div class="leyenda">${filasCat.map(f => {
        const pv = porCatPrev[f.id] || 0; const dif = pv ? ((f.v - pv) / pv) * 100 : null;
        return `<div class="li" style="--c:${colorCat(f.c)}"><span class="sw"></span><span>${esc(f.c.icono)} ${esc(f.c.nombre)} <span class="mini">· ${f.n}${dif !== null && !esActual ? ` · <span class="${dif > 0 ? 'sube' : 'baja'}">${dif > 0 ? '+' : ''}${fmtNum(dif, 0)} %</span>` : ''}</span></span><span class="num privado">${fmtEur(f.v, 0)}</span><span class="pct num">${fmtPct(total ? (f.v / total) * 100 : 0)}</span></div>`;
      }).join('')}</div>` : '<p class="sub">Sin gastos este mes.</p>'}
    </div>

    <div class="tarjeta">
      <h2>Gasto por día</h2>
      <p class="sub">La línea discontinua es la media diaria.</p>
      ${graficoBarrasDia(porDia, media, per)}
    </div>

    <div class="tarjeta">
      <h2>Calendario</h2>
      <p class="sub">Cuanto más oscuro, más gasto ese día.</p>
      ${calendario(porDia, per)}
    </div>

    ${Object.keys(porPersona).length > 1 ? `<div class="tarjeta"><h2>Quién pagó</h2>
      ${Object.entries(porPersona).sort((a, b) => b[1] - a[1]).map(([p, v]) => `<div class="presu"><div class="fila"><span><span class="avatar">${esc(iniciales(p))}</span>${esc(p)}</span><span class="num privado">${fmtEur(v, 0)} · ${fmtPct(total ? v / total * 100 : 0)}</span></div><div class="barra"><span style="width:${total ? v / total * 100 : 0}%;background:var(--primario)"></span></div></div>`).join('')}
    </div>` : ''}

    <div class="tarjeta"><h2>Efectivo gastado por moneda</h2>
      <p class="sub">Importes en su moneda original: lo que ha salido de cada bolsillo.</p>
      ${Object.keys(porMoneda).length ? MONEDAS.filter(m => porMoneda[m]).map(m => `<div class="fila"><span>${m} · ${NOMBRE_MONEDA[m]}</span><strong class="num privado">${fmtMon(porMoneda[m], m)}</strong></div>`).join('') : '<p class="sub">Sin gastos.</p>'}
    </div>

    ${vistaTops(lista)}
  `;
}

function vistaPerspectivas({ per, lista, total, filasCat, porCatPrev, porDia, prevTotal, esActual, proyeccion, presuTotal, diaHoy, dias }) {
  const ideas = [];
  if (esActual && presuTotal) {
    const quedan = dias - diaHoy + 1;
    const margen = presuTotal - total;
    ideas.push(margen >= 0
      ? ['🎯', `Te quedan ${fmtEur(margen, 0)} de presupuesto: ${fmtEur(margen / quedan, 0)} al día hasta fin de mes.`]
      : ['⚠️', `Ya has superado el presupuesto del mes en ${fmtEur(-margen, 0)}.`]);
  }
  if (esActual && prevTotal && proyeccion > prevTotal * 1.1) ideas.push(['📈', `A este ritmo cerrarías el mes en ${fmtEur(proyeccion, 0)}, un ${fmtPct((proyeccion / prevTotal - 1) * 100)} más que ${nombreMes(sumarMeses(per, -1), false).toLowerCase()}.`]);
  const subida = filasCat.map(f => ({ ...f, pv: porCatPrev[f.id] || 0 })).filter(f => f.pv > 20 && f.v > f.pv * 1.25 && !esActual).sort((a, b) => (b.v - b.pv) - (a.v - a.pv))[0];
  if (subida) ideas.push(['🔎', `${subida.c.nombre} sube ${fmtEur(subida.v - subida.pv, 0)} (${fmtPct((subida.v / subida.pv - 1) * 100)}) respecto al mes anterior.`]);
  if (filasCat.length && total) ideas.push(['🧺', `${filasCat[0].c.nombre} es el ${fmtPct(filasCat[0].v / total * 100)} del gasto del mes.`]);
  const mayor = [...lista].map(g => ({ g, v: eurDe(g) })).filter(x => x.v !== null).sort((a, b) => b.v - a.v)[0];
  if (mayor) {
    const cuando = [hoyISO(), sumarDias(hoyISO(), -1)].includes(mayor.g.fecha) ? nombreDia(mayor.g.fecha).toLowerCase() : `el ${nombreDia(mayor.g.fecha).toLowerCase()}`;
    ideas.push(['💸', `Mayor gasto: ${fmtMon(mayor.g.importe, mayor.g.moneda)} en ${categoria(mayor.g.categoria_id).nombre}${mayor.g.lugar ? ` (${mayor.g.lugar})` : ''}, ${cuando}.`]);
  }
  const porSemana = Array(7).fill(0); const cuenta = Array(7).fill(0);
  porDia.forEach((v, i) => { const d = (fechaLocal(`${per}-${pad(i + 1)}`).getDay() + 6) % 7; porSemana[d] += v; if (i < diaHoy) cuenta[d] += 1; });
  const medias = porSemana.map((v, i) => (cuenta[i] ? v / cuenta[i] : 0));
  const pico = medias.indexOf(Math.max(...medias));
  if (lista.length >= 8 && medias[pico] > 0) ideas.push(['📅', `Los ${['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'][pico]} son el día que más gastáis (${fmtEur(medias[pico], 0)} de media).`]);
  const sinGasto = porDia.slice(0, diaHoy).filter(v => v === 0).length;
  if (sinGasto && lista.length) ideas.push(['🌱', `${sinGasto} día${sinGasto === 1 ? '' : 's'} sin ningún gasto registrado este mes.`]);
  if (!ideas.length) return '';
  return `<div class="tarjeta"><h2>Lo más destacado</h2><div style="margin-top:10px">${ideas.slice(0, 5).map(([i, t]) => `<div class="insight"><span class="i">${i}</span><span class="privado">${esc(t)}</span></div>`).join('')}</div></div>`;
}

function vistaTops(lista) {
  const lugares = {}; const etiquetas = {};
  lista.forEach(g => {
    const v = eurDe(g); if (v === null) return;
    if (g.lugar) lugares[g.lugar] = (lugares[g.lugar] || 0) + v;
    (g.etiquetas || []).forEach(e => { etiquetas[e] = (etiquetas[e] || 0) + v; });
  });
  const tl = Object.entries(lugares).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const te = Object.entries(etiquetas).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (!tl.length && !te.length) return '';
  return `<div class="tarjeta">
    ${tl.length ? `<h2>Dónde más gastáis</h2>${tl.map(([l, v]) => `<div class="fila"><span>${esc(l)}</span><span class="num privado">${fmtEur(v, 0)}</span></div>`).join('')}` : ''}
    ${te.length ? `${tl.length ? '<div class="separador"></div>' : ''}<h2>Etiquetas</h2>${te.map(([e, v]) => `<div class="fila"><span>#${esc(e)}</span><span class="num privado">${fmtEur(v, 0)}</span></div>`).join('')}` : ''}
  </div>`;
}

/* ---------- Gráficos SVG propios (sin dependencias: funcionan sin conexión) ---------- */
function graficoDonut(filas, total) {
  const r = 70, grosor = 22, C = 2 * Math.PI * r;
  // Hasta 8 categorías con color propio; el resto se agrupa en «Otras»
  const visibles = filas.filter(f => f.c.color < COLORES).slice(0, 8);
  const resto = filas.filter(f => !visibles.includes(f)).reduce((s, f) => s + f.v, 0);
  const segs = [...visibles.map(f => ({ nombre: f.c.nombre, v: f.v, color: colorCat(f.c) })), ...(resto ? [{ nombre: 'Otras', v: resto, color: 'var(--c-otro)' }] : [])];
  let acum = 0;
  const hueco = segs.length > 1 ? 2 : 0;
  const arcos = segs.map(s => {
    const largo = (s.v / total) * C;
    const el = `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${s.color}" stroke-width="${grosor}"
      stroke-dasharray="${Math.max(0, largo - hueco)} ${C}" stroke-dashoffset="${-acum}" transform="rotate(-90 100 100)"
      data-tip="${esc(`${s.nombre}\n${fmtEur(s.v)} · ${fmtPct((s.v / total) * 100)}`)}" style="cursor:pointer"/>`;
    acum += largo;
    return el;
  }).join('');
  return `<svg class="grafico" viewBox="0 0 200 200" style="max-width:220px;margin:6px auto 0" role="img" aria-label="Reparto del gasto por categoría">
    <circle cx="100" cy="100" r="${r}" fill="none" stroke="var(--superficie-2)" stroke-width="${grosor}"/>
    ${arcos}
    <text x="100" y="96" text-anchor="middle" style="font-size:11px">Total</text>
    <text x="100" y="116" text-anchor="middle" class="privado" style="font-size:17px;font-weight:700;fill:var(--texto)">${esc(fmtEur(total, 0))}</text>
  </svg>`;
}

function graficoRitmo(porDia, porDiaPrev, hastaDia, presupuesto, per, prev) {
  const W = 340, H = 180, pl = 42, pr = 10, pt = 10, pb = 22;
  const dias = porDia.length;
  const acum = []; let s = 0; porDia.forEach((v, i) => { s += v; acum.push(s); });
  const acumPrev = []; s = 0; porDiaPrev.forEach(v => { s += v; acumPrev.push(s); });
  const maxY = Math.max(presupuesto || 0, acum[hastaDia - 1] || 0, acumPrev[acumPrev.length - 1] || 0, 1) * 1.08;
  const x = (d) => pl + ((d - 1) / Math.max(1, dias - 1)) * (W - pl - pr);
  const y = (v) => pt + (1 - v / maxY) * (H - pt - pb);
  const linea = (serie, n) => serie.slice(0, n).map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ticks = [0, maxY / 2, maxY].map(v => `<text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${fmtNum(v / 1000 >= 1 ? v / 1000 : v, v / 1000 >= 1 ? 1 : 0)}${v / 1000 >= 1 ? 'k' : ''}</text><line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--borde)" stroke-width="1"/>`).join('');
  const nPrev = Math.min(acumPrev.length, dias);
  const ultimo = acum[hastaDia - 1] || 0;
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gasto acumulado del mes" data-grafico="ritmo">
    ${ticks}
    ${[1, 8, 15, 22, dias].map(d => `<text x="${x(d)}" y="${H - 6}" text-anchor="middle">${d}</text>`).join('')}
    ${presupuesto ? `<line x1="${x(1)}" y1="${y(presupuesto / dias)}" x2="${x(dias)}" y2="${y(presupuesto)}" stroke="var(--texto-3)" stroke-width="1.5" stroke-dasharray="5 4"/>` : ''}
    <path d="${linea(acumPrev, nPrev)}" fill="none" stroke="var(--c-otro)" stroke-width="2"/>
    <path d="${linea(acum, hastaDia)}" fill="none" stroke="var(--c1)" stroke-width="2.5"/>
    <circle cx="${x(hastaDia)}" cy="${y(ultimo)}" r="4" fill="var(--c1)" stroke="var(--superficie)" stroke-width="2"/>
    <line class="cruz" x1="0" x2="0" y1="${pt}" y2="${H - pb}" stroke="var(--texto-3)" stroke-width="1" style="display:none"/>
    <rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}" fill="transparent" data-ritmo='${JSON.stringify({ acum: acum.slice(0, hastaDia).map(v => Math.round(v)), prev: acumPrev.map(v => Math.round(v)), dias, pl, pr, W, presupuesto: Math.round(presupuesto || 0) })}'/>
  </svg>
  <div class="leyenda" style="grid-template-columns:1fr">
    <div class="li" style="--c:var(--c1);grid-template-columns:12px 1fr auto"><span class="sw"></span><span>${esc(nombreMes(per, false))}</span><span class="num privado">${fmtEur(ultimo, 0)}</span></div>
    <div class="li" style="--c:var(--c-otro);grid-template-columns:12px 1fr auto"><span class="sw"></span><span>${esc(nombreMes(prev, false))}</span><span class="num privado">${fmtEur(acumPrev[acumPrev.length - 1] || 0, 0)}</span></div>
    ${presupuesto ? `<div class="li" style="--c:var(--texto-3);grid-template-columns:12px 1fr auto"><span class="sw" style="height:2px"></span><span>Presupuesto</span><span class="num privado">${fmtEur(presupuesto, 0)}</span></div>` : ''}
  </div>`;
}

function graficoBarrasDia(porDia, media, per) {
  const W = 340, H = 150, pl = 34, pr = 6, pt = 8, pb = 20;
  const n = porDia.length;
  const maxY = Math.max(...porDia, media, 1) * 1.1;
  const ancho = (W - pl - pr) / n;
  const y = (v) => pt + (1 - v / maxY) * (H - pt - pb);
  const base = H - pb;
  const barras = porDia.map((v, i) => {
    if (!v) return '';
    const bx = pl + i * ancho + 1, bw = Math.max(2, ancho - 2), by = y(v), bh = base - by, rr = Math.min(4, bw / 2, bh);
    const d = `M${bx},${base} L${bx},${by + rr} Q${bx},${by} ${bx + rr},${by} L${bx + bw - rr},${by} Q${bx + bw},${by} ${bx + bw},${by + rr} L${bx + bw},${base} Z`;
    return `<path d="${d}" fill="var(--c1)"/>`;
  }).join('');
  const zonas = porDia.map((v, i) => `<rect x="${pl + i * ancho}" y="${pt}" width="${ancho}" height="${base - pt}" fill="transparent" data-tip="${esc(`${nombreDia(`${per}-${pad(i + 1)}`)}\n${fmtEur(v)}`)}"/>`).join('');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gasto por día del mes">
    ${[0, maxY / 2].map(v => `<text x="${pl - 5}" y="${y(v) + 4}" text-anchor="end">${fmtNum(v, 0)}</text>`).join('')}
    <line x1="${pl}" x2="${W - pr}" y1="${base}" y2="${base}" stroke="var(--borde)"/>
    ${barras}
    ${media ? `<line x1="${pl}" x2="${W - pr}" y1="${y(media)}" y2="${y(media)}" stroke="var(--texto-2)" stroke-dasharray="4 3" stroke-width="1"/>` : ''}
    ${[1, 8, 15, 22, n].map(d => `<text x="${pl + (d - .5) * ancho}" y="${H - 5}" text-anchor="middle">${d}</text>`).join('')}
    ${zonas}
  </svg>`;
}

function calendario(porDia, per) {
  const primero = (fechaLocal(`${per}-01`).getDay() + 6) % 7;
  const max = Math.max(...porDia, 1);
  const hoy = hoyISO();
  const celdas = [];
  for (let i = 0; i < primero; i++) celdas.push('<div></div>');
  porDia.forEach((v, i) => {
    const iso = `${per}-${pad(i + 1)}`;
    const futuro = iso > hoy;
    const nivel = v ? Math.min(5, 1 + Math.floor((v / max) * 4.999)) : 0;
    const oscuro = nivel >= 4;
    celdas.push(`<div class="celda num" style="--c:var(--seq-${nivel});${oscuro ? '--t:#fff;' : ''}${futuro ? 'opacity:.35;' : ''}" data-tip="${esc(`${nombreDia(iso)}\n${fmtEur(v)}`)}">${i + 1}</div>`);
  });
  return `<div class="calendario">${DIAS_SEMANA.map(d => `<div class="cab">${d}</div>`).join('')}${celdas.join('')}</div>`;
}

/* =====================================================================
   PANTALLA: AJUSTES
   ===================================================================== */
function mesExportPorDefecto() {
  // Los primeros 10 días del mes se propone el mes anterior (el que toca cerrar en Patrimonio)
  return Number(hoyISO().slice(8)) <= 10 ? sumarMeses(periodoActual(), -1) : periodoActual();
}

function vistaAjustes() {
  const perExp = ui.mesExport || mesExportPorDefecto();
  const lista = gastosDelMes(perExp);
  const { total, sinTasa } = sumaEur(lista);
  const faltan = monedasSinTasaPropia(perExp);
  const porPersona = {};
  lista.forEach(g => { porPersona[g.persona] = (porPersona[g.persona] || 0) + 1; });
  const ultimoPorPersona = {};
  gastosVivos().forEach(g => { if (!ultimoPorPersona[g.persona] || g.creado_en > ultimoPorPersona[g.persona]) ultimoPorPersona[g.persona] = g.creado_en; });
  const cats = categoriasOrdenadas(true);
  const perTasas = periodoActual();

  return `
    <div class="etiqueta-sec">Pasar a Patrimonio Familiar</div>
    <div class="tarjeta">
      ${selectorMes(perExp, 'mes-export')}
      <div class="kpis" style="margin-top:12px">
        <div class="kpi"><div class="k">Gastos</div><div class="v num">${lista.length}</div></div>
        <div class="kpi"><div class="k">Total</div><div class="v num privado">${fmtEur(total)}</div></div>
      </div>
      ${Object.keys(porPersona).length ? `<p class="mini" style="margin:8px 0 0">${Object.entries(porPersona).map(([p, n]) => `${esc(p)}: ${n}`).join(' · ')}</p>` : ''}
      ${faltan.length ? `<div class="aviso" style="margin:10px 0 0">Falta el tipo de cambio de ${faltan.join(', ')} en ${nombreMes(perExp, false).toLowerCase()}${sinTasa ? ` (${sinTasa} gasto${sinTasa === 1 ? '' : 's'} sin convertir)` : ', se usará el de otro mes'}. <button class="enlace" data-accion="abrir-tasas" data-v="${perExp}">Añadir</button></div>` : ''}
      ${E.modo === 'nube' && E.cola.length ? `<div class="aviso" style="margin:10px 0 0">Tienes ${E.cola.length} cambio${E.cola.length === 1 ? '' : 's'} sin subir: el fichero los incluye, pero tu pareja aún no los ve.</div>` : ''}
      ${E.modo === 'nube' ? Object.entries(ultimoPorPersona).filter(([p]) => p !== E.yo).map(([p, f]) => `<p class="mini" style="margin:8px 0 0">Último gasto de ${esc(p)} recibido: ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(f))}. Si le falta algo por sincronizar, espera a que lo suba.</p>`).join('') : ''}
      ${E.exportaciones[perExp] ? `<p class="mini" style="margin:8px 0 0">Exportado por última vez el ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(E.exportaciones[perExp]))}. Puedes volver a exportarlo: Patrimonio sustituye lo importado antes de ese mes.</p>` : ''}
      <button class="btn bloque" style="margin-top:12px" data-accion="exportar-json" ${lista.length ? '' : 'disabled'}>Exportar para Patrimonio (JSON)</button>
      <button class="btn sec bloque" style="margin-top:8px" data-accion="exportar-csv" ${lista.length ? '' : 'disabled'}>Exportar a hoja de cálculo (CSV)</button>
    </div>

    <div class="etiqueta-sec">Categorías</div>
    <div class="lista">
      ${cats.map((c, i) => `<div class="mov" style="${c.activa ? '' : 'opacity:.5'}">
        <span class="ico" style="--cat-color:${colorCat(c)}">${esc(c.icono)}</span>
        <span class="cuerpo"><div class="titulo">${esc(c.nombre)}</div><div class="detalle">${c.presupuesto ? `Presupuesto ${fmtEur(c.presupuesto, 0)}/mes` : 'Sin presupuesto'}${c.activa ? '' : ' · oculta'}</div></span>
        <span style="display:flex;gap:4px">
          <button class="btn sec" style="min-height:36px;padding:0 10px" data-accion="subir-cat" data-v="${c.id}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
          <button class="btn sec" style="min-height:36px;padding:0 10px" data-accion="editar-cat" data-v="${c.id}">Editar</button>
        </span></div>`).join('')}
    </div>
    <button class="btn sec bloque" style="margin-top:8px" data-accion="nueva-categoria">＋ Nueva categoría</button>

    <div class="etiqueta-sec">Tipos de cambio</div>
    <div class="tarjeta">
      ${['USD', 'MXN', 'CUP'].map(m => { const t = tasa(m, perTasas); return `<div class="fila"><span>${m} por 1 €</span><span class="num">${t ? fmtNum(t.valor, m === 'CUP' ? 0 : 2) : '—'}${t && t.estimada ? ` <span class="mini">(${nombreMes(t.periodo, false)})</span>` : ''}</span></div>`; }).join('')}
      <button class="btn sec bloque" style="margin-top:12px" data-accion="abrir-tasas" data-v="${perTasas}">Editar las de ${nombreMes(perTasas, false).toLowerCase()}</button>
    </div>

    <div class="etiqueta-sec">Preferencias</div>
    <div class="tarjeta">
      <div class="fila"><span>Guardar al tocar la categoría</span>${interruptor('guardarAlTocar')}</div>
      <p class="mini" style="margin:4px 0 10px">Con esto activado, registrar un gasto es: importe y categoría. Nada más.</p>
      <div class="fila"><span>Ocultar importes</span>${interruptor('ocultar')}</div>
      <div class="separador"></div>
      <div class="campo"><label>Tema</label><div class="segmentado">${[['auto', 'Automático'], ['claro', 'Claro'], ['oscuro', 'Oscuro']].map(([v, l]) => `<button class="${E.prefs.tema === v ? 'activo' : ''}" data-accion="tema" data-v="${v}">${l}</button>`).join('')}</div></div>
    </div>

    <div class="etiqueta-sec">Atajo del iPhone</div>
    <div class="tarjeta">
      <p class="sub">Registra un gasto desde el Botón de Acción, un widget o Siri sin abrir la app. Cada persona genera su propio código en su móvil.</p>
      ${E.modo === 'nube'
        ? `<button class="btn bloque" data-accion="crear-token">Generar mi código del atajo</button>
           <button class="btn sec bloque" style="margin-top:8px" data-accion="revocar-tokens">Revocar mis códigos</button>
           <p class="mini" style="margin-top:8px">Categorías que debe tener el atajo, escritas igual: ${categoriasOrdenadas().map(c => esc(c.nombre)).join(', ')}.</p>`
        : '<p class="mini">Disponible cuando la app está conectada a Supabase.</p>'}
    </div>

    <div class="etiqueta-sec">Hogar y sincronización</div>
    <div class="tarjeta">
      ${E.modo === 'nube' ? `
        <div class="fila"><span>Hogar</span><strong>${esc(E.hogar.nombre)}</strong></div>
        <div class="fila"><span>Código para invitar</span><button class="enlace num" data-accion="copiar-codigo" style="font-size:18px;letter-spacing:.1em">${esc(E.hogar.codigo || '—')}</button></div>
        <div class="fila"><span>Miembros</span><span>${E.miembros.map(m => esc(m.nombre)).join(', ')}</span></div>
        <div class="fila"><span>Tu cuenta</span><span class="mini">${esc(E.usuario.email || '')}</span></div>
        <div class="fila"><span>Última sincronización</span><span class="mini">${E.ultimaSync ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(E.ultimaSync)) : 'nunca'}</span></div>
        ${estadoRed.tipo === 'error' ? `<div class="aviso rojo" style="margin-top:8px">${esc(estadoRed.detalle || 'Error de sincronización')}</div>` : ''}
        <button class="btn sec bloque" style="margin-top:12px" data-accion="sincronizar">Sincronizar ahora</button>
        ${estadoRed.tipo === 'sesion' ? '<button class="btn bloque" style="margin-top:8px" data-accion="reentrar">Volver a entrar</button>' : ''}
        <button class="btn peligro bloque" style="margin-top:8px" data-accion="cerrar-sesion">Cerrar sesión</button>`
      : `<p class="sub">Estás en modo local: los gastos solo están en este móvil. Para compartir con tu pareja, configura Supabase (README) y vuelve a abrir la app.</p>
        ${hayNube() ? '<button class="btn bloque" data-accion="pasar-a-nube">Conectar con mi cuenta</button>' : ''}
        <button class="btn sec bloque" style="margin-top:8px" data-accion="copia-local">Descargar copia de seguridad</button>`}
      <p class="mini" style="margin-top:12px">Bolsillo ${VERSION}</p>
    </div>
  `;
}

function interruptor(pref) {
  return `<div class="segmentado" style="width:120px"><button class="${!E.prefs[pref] ? 'activo' : ''}" data-accion="pref" data-campo="${pref}" data-v="0">No</button><button class="${E.prefs[pref] ? 'activo' : ''}" data-accion="pref" data-campo="${pref}" data-v="1">Sí</button></div>`;
}

/* ---------- Exportación ---------- */
function construirExportacion(periodo) {
  const lista = gastosDelMes(periodo).sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.creado_en).localeCompare(String(b.creado_en)));
  const tasasMes = {};
  ['USD', 'MXN', 'CUP'].forEach(m => {
    const t = tasa(m, periodo);
    if (t) tasasMes[m] = t.valor;
  });
  const usadas = new Set(lista.map(g => g.categoria_id));
  const resumen = { numGastos: lista.length, totalEur: 0, porCategoria: {}, porPersona: {}, porMoneda: {} };
  const avisos = [];
  const gastos = lista.map(g => {
    const eur = eurDe(g);
    const c = categoria(g.categoria_id);
    if (eur !== null) {
      resumen.totalEur += eur;
      resumen.porCategoria[c.nombre] = (resumen.porCategoria[c.nombre] || 0) + eur;
      resumen.porPersona[g.persona] = (resumen.porPersona[g.persona] || 0) + eur;
    }
    resumen.porMoneda[g.moneda] = (resumen.porMoneda[g.moneda] || 0) + g.importe;
    return {
      id: g.id, fecha: g.fecha, persona: g.persona, importe: g.importe, moneda: g.moneda,
      importeEur: eur === null ? null : Math.round(eur * 100) / 100,
      categoriaId: g.categoria_id, categoria: c.nombre, nota: g.nota || '', lugar: g.lugar || '', etiquetas: g.etiquetas || [],
    };
  });
  const redondear = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  resumen.totalEur = Math.round(resumen.totalEur * 100) / 100;
  resumen.porCategoria = redondear(resumen.porCategoria);
  resumen.porPersona = redondear(resumen.porPersona);
  resumen.porMoneda = redondear(resumen.porMoneda);
  monedasSinTasaPropia(periodo).forEach(m => avisos.push(tasasMes[m] ? `La tasa de ${m} es de otro mes.` : `No hay tasa de ${m}.`));
  return {
    formato: 'bolsillo-gastos', version: 1, generadoEn: new Date().toISOString(), app: `Bolsillo ${VERSION}`,
    hogar: E.hogar ? E.hogar.nombre : '', exportadoPor: E.yo,
    periodo, desde: `${periodo}-01`, hasta: `${periodo}-${pad(diasDelMes(periodo))}`,
    monedaBase: 'EUR', tasas: { [periodo]: tasasMes },
    categorias: categoriasOrdenadas(true).filter(c => usadas.has(c.id)).map(c => ({ id: c.id, nombre: c.nombre, icono: c.icono })),
    personas: [...new Set(lista.map(g => g.persona))],
    gastos, resumen, avisos,
  };
}

let ultimoFichero = null;
function descargar(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  ultimoFichero = { nombre, blob, tipo };
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function compartirFichero() {
  if (!ultimoFichero) return;
  const f = new File([ultimoFichero.blob], ultimoFichero.nombre, { type: ultimoFichero.tipo });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], title: ultimoFichero.nombre }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  descargar(ultimoFichero.nombre, ultimoFichero.blob, ultimoFichero.tipo);
}
function exportarJSON() {
  const per = ui.mesExport || mesExportPorDefecto();
  const datos = construirExportacion(per);
  descargar(`bolsillo_${per}.json`, JSON.stringify(datos, null, 2), 'application/json');
  E.exportaciones[per] = new Date().toISOString(); persistir();
  ui.hoja = { tipo: 'exportado' }; render();
}
function exportarCSV() {
  const per = ui.mesExport || mesExportPorDefecto();
  const d = construirExportacion(per);
  const cab = ['fecha', 'persona', 'categoria', 'importe', 'moneda', 'importe_eur', 'lugar', 'nota', 'etiquetas'];
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const filas = d.gastos.map(g => [g.fecha, g.persona, g.categoria, String(g.importe).replace('.', ','), g.moneda, g.importeEur === null ? '' : String(g.importeEur).replace('.', ','), g.lugar, g.nota, g.etiquetas.join(' ')].map(celda).join(';'));
  descargar(`bolsillo_${per}.csv`, '﻿' + [cab.join(';'), ...filas].join('\n'), 'text/csv');
}

/* ---------- Categorías y tasas ---------- */
function abrirCategoria(id) {
  const c = id ? E.categorias[id] : null;
  ui.hoja = { tipo: 'categoria', id: id || null, nombre: c ? c.nombre : '', icono: c ? c.icono : '📦', presupuesto: c && c.presupuesto ? String(c.presupuesto).replace('.', ',') : '' };
  render();
}
function guardarCategoria() {
  const h = ui.hoja;
  const nombre = h.nombre.trim();
  if (!nombre) { toast('Ponle un nombre'); return; }
  const presupuesto = h.presupuesto.trim() ? Number(h.presupuesto.replace(/\./g, '').replace(',', '.')) : null;
  if (presupuesto !== null && !(presupuesto >= 0)) { toast('El presupuesto no es válido'); return; }
  if (h.id) guardarFila('categorias', { ...E.categorias[h.id], nombre, icono: h.icono || '📦', presupuesto });
  else {
    const todas = Object.values(E.categorias).filter(c => !c.eliminado);
    const usados = new Set(todas.map(c => c.color));
    let color = 0; while (usados.has(color) && color < COLORES) color++;
    const nueva = guardarFila('categorias', { id: nuevoId(), nombre, icono: h.icono || '📦', color, orden: todas.length, presupuesto, activa: true, eliminado: false });
    if (ui.pestana === 'anadir') ui.entrada.categoriaId = nueva.id;
  }
  ui.hoja = null; render();
}
function subirCategoria(id) {
  const lista = categoriasOrdenadas(true);
  const i = lista.findIndex(c => c.id === id);
  if (i <= 0) return;
  lista.forEach((c, j) => { const orden = j === i ? i - 1 : j === i - 1 ? i : j; if (c.orden !== orden) guardarFila('categorias', { ...c, orden }); });
  render();
}
function abrirTasas(periodo) { ui.hoja = { tipo: 'tasas', periodo, valores: {} }; render(); }
function guardarTasas() {
  const h = ui.hoja;
  for (const [m, texto] of Object.entries(h.valores)) {
    const limpio = String(texto).trim();
    if (!limpio) continue;
    const v = Number(limpio.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    if (!(v > 0)) { toast(`La tasa de ${m} no es válida`); return; }
    guardarFila('tasas', { periodo: h.periodo, moneda: m, unidades_por_eur: v });
  }
  ui.hoja = null; render(); toast('Tipos de cambio guardados');
}
function copiarTasasAnteriores() {
  const h = ui.hoja;
  ['USD', 'MXN', 'CUP'].forEach(m => { const t = tasa(m, h.periodo); if (t && t.periodo < h.periodo) h.valores[m] = String(t.valor).replace('.', ','); });
  render();
}

/* =====================================================================
   AVISOS Y TOOLTIP
   ===================================================================== */
let temporizadorToast = null;
function toast(texto, accion, alPulsar) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(texto)}</span>${accion ? `<button>${esc(accion)}</button>` : ''}`;
  if (accion) el.querySelector('button').onclick = () => { el.remove(); alPulsar(); };
  document.body.appendChild(el);
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => el.remove(), accion ? 5000 : 2500);
}

const tip = document.createElement('div');
tip.className = 'tooltip'; tip.style.display = 'none';
document.body.appendChild(tip);
function mostrarTip(texto, x, y) {
  tip.textContent = texto; tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
  tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
}
const ocultarTip = () => { tip.style.display = 'none'; };

function manejarPuntero(e) {
  const t = e.target.closest('[data-tip]');
  if (t) { mostrarTip(t.getAttribute('data-tip'), e.clientX, e.clientY); return; }
  const r = e.target.closest('[data-ritmo]');
  if (r) {
    const d = JSON.parse(r.getAttribute('data-ritmo'));
    const svg = r.ownerSVGElement; const caja = svg.getBoundingClientRect();
    const xv = ((e.clientX - caja.left) / caja.width) * d.W;
    const dia = Math.max(1, Math.min(d.dias, Math.round(((xv - d.pl) / (d.W - d.pl - d.pr)) * (d.dias - 1)) + 1));
    const cruz = svg.querySelector('.cruz');
    const xd = d.pl + ((dia - 1) / Math.max(1, d.dias - 1)) * (d.W - d.pl - d.pr);
    cruz.setAttribute('x1', xd); cruz.setAttribute('x2', xd); cruz.style.display = '';
    const lineas = [`Día ${dia}`];
    if (d.acum[dia - 1] !== undefined) lineas.push(`Este mes: ${fmtEur(d.acum[dia - 1], 0)}`);
    if (d.prev[dia - 1] !== undefined) lineas.push(`Mes anterior: ${fmtEur(d.prev[dia - 1], 0)}`);
    if (d.presupuesto) lineas.push(`Presupuesto: ${fmtEur((d.presupuesto * dia) / d.dias, 0)}`);
    mostrarTip(lineas.join('\n'), e.clientX, e.clientY);
    return;
  }
  ocultarTip();
  document.querySelectorAll('.cruz').forEach(c => { c.style.display = 'none'; });
}
document.addEventListener('pointermove', manejarPuntero);
document.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') manejarPuntero(e); });
document.addEventListener('scroll', ocultarTip, { passive: true });

/* =====================================================================
   EVENTOS (delegación)
   ===================================================================== */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-accion]');
  if (!b) return;
  const a = b.dataset.accion, v = b.dataset.v;
  if (a === 'cerrar-hoja-fondo') { if (e.target === b) { ui.hoja = null; render(); } return; }
  switch (a) {
    case 'pestana': ui.pestana = v; ui.hoja = null; if (v === 'anadir' && !ui.entrada) ui.entrada = entradaNueva(); render(); window.scrollTo(0, 0); break;
    case 'tecla': pulsarTecla(v); break;
    case 'moneda': ui.entrada.moneda = v; if (DECIMALES[v] === 0) ui.entrada.texto = ui.entrada.texto.split(',')[0]; render(); break;
    case 'categoria':
      ui.entrada.categoriaId = v;
      if (E.prefs.guardarAlTocar && valorEntrada() > 0) guardarEntrada(); else render();
      break;
    case 'guardar-entrada': guardarEntrada(); break;
    case 'fecha': ui.entrada.fecha = v; render(); break;
    case 'persona': ui.entrada.persona = v; render(); break;
    case 'rapido': {
      const [importe, moneda, cat] = v.split('|');
      ui.entrada = entradaNueva({ texto: String(importe).replace('.', ','), moneda, categoriaId: cat, fecha: ui.entrada.fecha, persona: ui.entrada.persona });
      guardarEntrada(); break;
    }
    case 'nueva-categoria': abrirCategoria(null); break;
    case 'editar-cat': abrirCategoria(v); break;
    case 'subir-cat': subirCategoria(v); break;
    case 'archivar-cat': { const c = E.categorias[ui.hoja.id]; guardarFila('categorias', { ...c, activa: !c.activa }); ui.hoja = null; render(); break; }
    case 'hoja-guardar-cat': guardarCategoria(); break;
    case 'abrir-tasas': abrirTasas(v); break;
    case 'guardar-tasas': guardarTasas(); break;
    case 'copiar-tasas': copiarTasasAnteriores(); break;
    case 'editar': abrirEdicion(v); break;
    case 'hoja-set': ui.hoja[b.dataset.campo] = v; render(); break;
    case 'hoja-guardar': guardarEdicion(); break;
    case 'hoja-eliminar': eliminarGasto(ui.hoja.id); break;
    case 'cerrar-hoja': ui.hoja = null; render(); break;
    case 'mes-movs': ui.mesMovs = v; render(); break;
    case 'mes-stats': ui.mesStats = v; render(); break;
    case 'mes-export': ui.mesExport = v; render(); break;
    case 'filtro-persona': ui.filtroPersona = v; render(); break;
    case 'filtro-cat': ui.filtroCat = v; render(); break;
    case 'exportar-json': exportarJSON(); break;
    case 'exportar-csv': exportarCSV(); break;
    case 'compartir-export': compartirFichero(); break;
    case 'pref': E.prefs[b.dataset.campo] = v === '1'; persistir(); render(); break;
    case 'tema': E.prefs.tema = v; persistir(); render(); break;
    case 'privacidad': E.prefs.ocultar = !E.prefs.ocultar; persistir(); render(); break;
    case 'sincronizar': await sincronizar(); render(); break;
    case 'crear-token': {
      const c = await obtenerCliente();
      if (!c || !navigator.onLine) { toast('Necesitas conexión para generar el código'); break; }
      const r = await c.rpc('crear_token_atajo');
      if (r.error) { toast(traducirError(r.error.message)); break; }
      ui.hoja = { tipo: 'atajo', token: r.data }; render(); break;
    }
    case 'revocar-tokens': {
      if (!confirm('Tus atajos dejarán de funcionar hasta que generes un código nuevo. ¿Continuar?')) break;
      const c = await obtenerCliente();
      if (!c || !navigator.onLine) { toast('Necesitas conexión'); break; }
      const r = await c.rpc('revocar_tokens_atajo');
      toast(r.error ? traducirError(r.error.message) : `Códigos revocados: ${r.data}`); break;
    }
    case 'copiar': {
      const valores = { url: `${SUPABASE_URL}/rest/v1/rpc/registrar_gasto_atajo`, apikey: SUPABASE_ANON_KEY, token: ui.hoja && ui.hoja.token };
      try { await navigator.clipboard.writeText(valores[v]); toast('Copiado'); }
      catch (err) { toast('No se pudo copiar: mantén pulsado el campo y copia'); }
      break;
    }
    case 'pegar-atajo': await pegarDelAtajo(); break;
    case 'copiar-codigo':
      try { await navigator.clipboard.writeText(E.hogar.codigo); toast('Código copiado'); } catch (err) { toast(E.hogar.codigo); }
      break;
    case 'empezar-nube': E.modo = 'nube'; persistir(); render(); break;
    case 'empezar-local': mostrarAltaLocal(); break;
    case 'volver-bienvenida': E.modo = null; persistir(); render(); break;
    case 'crear-local': crearLocal(); break;
    case 'login': login(false); break;
    case 'registro': login(true); break;
    case 'reentrar': E.usuario = null; persistir(); render(); break;
    case 'crear-hogar': crearHogar(false); break;
    case 'unirse-hogar': crearHogar(true); break;
    case 'pasar-a-nube': E.modo = 'nube'; E.usuario = null; persistir(); render(); break;
    case 'copia-local': descargar(`bolsillo_copia_${hoyISO()}.json`, JSON.stringify(E, null, 2), 'application/json'); break;
    case 'cerrar-sesion': {
      if (E.cola.length && !confirm(`Hay ${E.cola.length} cambios sin subir que se perderán. ¿Cerrar sesión igualmente?`)) return;
      const c = await obtenerCliente(); try { if (c) await c.auth.signOut(); } catch (err) { /* sin red */ }
      const prefs = E.prefs; E = estadoVacio(); E.prefs = prefs; E.modo = 'nube'; persistir(); ui.entrada = null; render();
      break;
    }
    default: break;
  }
});

// Si el atajo no tuvo conexión, deja en el portapapeles «BOLSILLO|importe|moneda|categoría»
async function pegarDelAtajo() {
  let texto = '';
  try { texto = await navigator.clipboard.readText(); } catch (err) { toast('iOS no dejó leer el portapapeles. Vuelve a intentarlo y pulsa «Pegar».'); return; }
  const partes = String(texto || '').trim().split('|').map(s => s.trim());
  if (partes[0] !== 'BOLSILLO' || partes.length < 4) { toast('No hay ningún gasto del atajo en el portapapeles'); return; }
  const importe = Math.round(Number(partes[1].replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) * 100) / 100;
  const moneda = partes[2].toUpperCase();
  const cat = categoriasOrdenadas(true).find(c => normal(c.nombre) === normal(partes[3]));
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(partes[4] || '') && partes[4] <= hoyISO() ? partes[4] : hoyISO();
  if (!(importe > 0) || !MONEDAS.includes(moneda)) { toast('El gasto copiado no es válido'); return; }
  if (!cat) { toast(`No existe la categoría «${partes[3]}»`); return; }
  // Evita duplicarlo si el atajo sí llegó a guardarlo
  const hace = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const repetido = gastosVivos().find(g => g.persona === E.yo && g.importe === importe && g.moneda === moneda && g.categoria_id === cat.id && g.fecha === fecha && String(g.creado_en || g.updated_at) >= hace);
  if (repetido && !confirm('Ya hay un gasto igual de hoy (quizá lo guardó el atajo). ¿Añadirlo otra vez?')) return;
  ui.entrada = entradaNueva({ texto: String(importe).replace('.', ','), moneda, categoriaId: cat.id, fecha, etiquetas: 'atajo' });
  guardarEntrada();
  try { await navigator.clipboard.writeText(''); } catch (err) { /* no importa */ }
}

function mostrarAltaLocal() {
  const app = $('#app');
  app.innerHTML = `<div class="acceso">${LOGO}<h1>Solo en este móvil</h1>
    <p class="sub">Tus gastos se quedarán en este dispositivo. Podrás conectarte a tu cuenta más adelante sin perderlos.</p>
    <div class="campo"><label for="nombre-local">Tu nombre (el mismo que en Patrimonio)</label><input class="input" id="nombre-local" placeholder="Jose"></div>
    <div class="campo"><label for="pareja-local">Nombre de tu pareja (opcional)</label><input class="input" id="pareja-local" placeholder="Blanca"></div>
    <button class="btn bloque" data-accion="crear-local">Empezar</button></div>`;
}

document.addEventListener('input', (e) => {
  const el = e.target; const tipo = el.dataset.cambio;
  if (!tipo) return;
  if (tipo === 'entrada') ui.entrada[el.dataset.campo] = el.value;
  else if (tipo === 'hoja') ui.hoja[el.dataset.campo] = el.value;
  else if (tipo === 'tasa') ui.hoja.valores[el.dataset.campo] = el.value;
  else if (tipo === 'busqueda') { ui.busqueda = el.value; render(); }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.cambio === 'fecha-otra' && el.value) {
    if (el.value > hoyISO()) { toast('La fecha no puede ser futura'); return; }
    ui.entrada.fecha = el.value; render();
  }
});

// Teclado físico (iPad con teclado, ordenador)
document.addEventListener('keydown', (e) => {
  if (ui.pestana !== 'anadir' || ui.hoja || !E.modo || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (/^[0-9]$/.test(e.key)) pulsarTecla(e.key);
  else if (e.key === ',' || e.key === '.') pulsarTecla(',');
  else if (e.key === 'Backspace') pulsarTecla('⌫');
  else if (e.key === 'Enter' && ui.entrada.categoriaId) guardarEntrada();
});

/* =====================================================================
   ARRANQUE
   ===================================================================== */
window.addEventListener('online', () => sincronizar());
window.addEventListener('offline', () => ponerEstadoRed('sinred'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // Al volver a la app (quizá otro día), la captura empieza limpia y con la fecha de hoy
  if (ui.entrada && !ui.entrada.texto && E.modo) ui.entrada = entradaNueva({ moneda: ui.entrada.moneda });
  sincronizar();
  if (E.modo) render();
});
setInterval(() => { if (document.visibilityState === 'visible') sincronizar(); }, 60000);

async function arrancar() {
  if (!hayNube() && E.modo === 'nube') E.modo = null; // config.js vaciado: vuelve a la bienvenida
  const params = new URLSearchParams(location.search);
  if (params.get('accion') === 'nuevo') ui.pestana = 'anadir';
  if (params.get('accion') === 'resumen') ui.pestana = 'stats';
  render();
  if (E.modo === 'nube') {
    const c = await obtenerCliente();
    if (c && navigator.onLine) {
      try {
        const { data } = await c.auth.getSession();
        if (data && data.session) {
          E.usuario = { id: data.session.user.id, email: data.session.user.email };
          if (!E.hogar) await cargarHogar();
          persistir(); render();
          if (E.hogar) { sincronizar(); suscribirTiempoReal(); }
        } else if (E.usuario && E.hogar) {
          ponerEstadoRed('sesion'); // se sigue trabajando en local hasta volver a entrar
        }
      } catch (err) { ponerEstadoRed('sinred'); }
    } else ponerEstadoRed('sinred');
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
arrancar();

// Para pruebas automáticas
window.__bolsillo = { get estado() { return E; }, construirExportacion, sincronizar, tasa, render };
