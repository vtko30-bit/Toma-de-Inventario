let state = {
  productos: [],
  familias: [],
  categorias: [],
  sucursales: [],
  bodegas: [],
  movimientos: [],
  inventarios: [],
  recetas: {}
};
let editingIds = {
  producto: null,
  familia: null,
  categoria: null,
  sucursal: null,
  bodega: null,
  movimiento: null,
  inventario: null,
  detalleInventario: null
};
let showDetalleInventarioForm = false;
let showCabeceraInventarioForm = false;
let showVerInventario = false;
let showProductoForm = false;
let _movLineasDraft = [];
let _movCabeceraDraft = null;
let _invDetalleDraft = { productoId: "", cantidad: 0 };
let _invCabeceraDraft = null;
let _invListaFilter = { fecha: "", bodegaId: "", estado: "activos" };
let _invProductoBusqueda = "";
let _invTomaDraft = {};
let _usuariosTenantNombres = [];
let _usuariosTenantPromise = null;

const ESTADOS_INVENTARIO = ["borrador", "cerrado", "anulado"];

function esAdmin() {
  return window.Auth?.isAdmin() === true;
}

function soloTomaInventario() {
  return window.Auth?.isSoloInventario() === true;
}

function etiquetaRol(role) {
  const map = { admin: "admin", usuario: "usuario", inventario: "solo inventario" };
  return map[role] || role || "";
}

function puedeAccederVista(viewId) {
  if (!soloTomaInventario()) return true;
  return viewId === "inventarios";
}

function normalizarEstadoInventario(inv) {
  if (inv.estado && ESTADOS_INVENTARIO.includes(inv.estado)) return inv.estado;
  return (inv.detalles || []).length > 0 ? "cerrado" : "borrador";
}

function normalizarInventariosEstado() {
  state.inventarios = (state.inventarios || []).map((inv) => ({
    ...inv,
    estado: normalizarEstadoInventario(inv)
  }));
}

function etiquetaEstadoInventario(estado) {
  const map = { borrador: "Borrador", cerrado: "Cerrado", anulado: "Anulado" };
  return map[estado] || estado;
}

function htmlBadgeEstadoInventario(estadoOInv) {
  const e = typeof estadoOInv === "string"
    ? (ESTADOS_INVENTARIO.includes(estadoOInv) ? estadoOInv : "borrador")
    : normalizarEstadoInventario(estadoOInv);
  return `<span class="inv-estado-badge inv-estado-${e}">${etiquetaEstadoInventario(e)}</span>`;
}

function inventarioCoincideFiltroEstado(inv, filtroEstado) {
  const estado = normalizarEstadoInventario(inv);
  if (filtroEstado === "todos") return true;
  if (filtroEstado === "activos") return estado !== "anulado";
  return estado === filtroEstado;
}

function _formularioInventarioActivo() {
  return showCabeceraInventarioForm || showDetalleInventarioForm;
}

function capturarInvDetalleDesdeDom() {
  const nombre = document.getElementById("det-prod-nombre")?.value?.trim() || "";
  const productoId =
    document.getElementById("det-prod")?.value ||
    resolverProductoIdPorNombre(nombre) ||
    "";
  return {
    productoId,
    cantidad: Number(document.getElementById("det-cantidad")?.value || 0)
  };
}

function resolverProductoIdPorNombre(nombre) {
  const q = String(nombre || "").trim().toLowerCase();
  if (!q) return "";
  const exacto = state.productos.find((p) => String(p.nombre || "").trim().toLowerCase() === q);
  if (exacto) return exacto.id;
  const parciales = state.productos.filter((p) => String(p.nombre || "").toLowerCase().includes(q));
  return parciales.length === 1 ? parciales[0].id : "";
}

function htmlDatalistProductosInv(productos) {
  return (productos || [])
    .map((p) => `<option value="${escapeAttr(p.nombre || "")}"></option>`)
    .join("");
}

function limpiarFormularioProductoInv() {
  const nombre = document.getElementById("det-prod-nombre");
  const idHidden = document.getElementById("det-prod");
  const cantidad = document.getElementById("det-cantidad");
  const um = document.getElementById("det-um");
  const stock = document.getElementById("det-stock-info");
  if (nombre) nombre.value = "";
  if (idHidden) idHidden.value = "";
  if (cantidad) cantidad.value = "0";
  if (um) um.textContent = "—";
  if (stock) stock.textContent = "—";
  _invDetalleDraft = { productoId: "", cantidad: 0 };
  _invProductoBusqueda = "";
  editingIds.detalleInventario = null;
}

function capturarInvCabeceraDesdeDom() {
  return {
    id: document.getElementById("inv-id")?.value?.trim() || "",
    nombre: document.getElementById("inv-nombre")?.value?.trim() || "",
    sucursalId: document.getElementById("inv-sucursal")?.value || "",
    bodegaId: document.getElementById("inv-bodega")?.value || "",
    fecha: document.getElementById("inv-fecha")?.value || new Date().toISOString().slice(0, 10)
  };
}

function preservarBorradoresInventario() {
  if (document.getElementById("det-prod-nombre") || document.querySelector(".inv-toma-row")) {
    const nombre = document.getElementById("det-prod-nombre")?.value || "";
    if (nombre) _invProductoBusqueda = nombre;
    capturarInvTomaDraftDesdeDom();
  }
  const cabeceraFija = showDetalleInventarioForm && editingIds.inventario;
  if (showCabeceraInventarioForm && !cabeceraFija && document.getElementById("inv-nombre")) {
    _invCabeceraDraft = capturarInvCabeceraDesdeDom();
  }
}

function capturarInvTomaDraftDesdeDom() {
  document.querySelectorAll(".inv-toma-row").forEach((row) => {
    const productoId = row.dataset.productoId;
    if (!productoId) return;
    const checked = !!row.querySelector(".inv-toma-check")?.checked;
    const cantidad = Number(row.querySelector(".inv-toma-cant")?.value || 0);
    _invTomaDraft[productoId] = { checked, cantidad };
  });
}

function busquedaOcultaFila(nombre, busqueda) {
  const q = String(busqueda || "").trim().toLowerCase();
  if (!q) return false;
  return !String(nombre || "").toLowerCase().includes(q);
}

function filtrarFilasTomaPorBusqueda(texto) {
  const q = String(texto || "").trim().toLowerCase();
  _invProductoBusqueda = texto || "";
  let visibles = 0;
  document.querySelectorAll(".inv-toma-row").forEach((row) => {
    const nombre = (row.dataset.prodNombre || "").toLowerCase();
    const show = !q || nombre.includes(q);
    row.style.display = show ? "" : "none";
    if (show) visibles += 1;
  });
  const count = document.getElementById("inv-toma-count");
  const total = document.querySelectorAll(".inv-toma-row").length;
  if (count) count.textContent = q ? `${visibles} de ${total} productos` : `${total} productos`;
}

function filasTomaInventario(bodegaId, detalles) {
  const porProducto = {};
  (detalles || []).forEach((d) => {
    porProducto[d.productoId] = d;
  });
  return productosOrdenadosPorNombre(state.productos).map((p) => {
    const det = porProducto[p.id];
    const draft = _invTomaDraft[p.id];
    const stock = stockBaseProductoEnBodega(p.id, bodegaId);
    return {
      producto: p,
      stock,
      cantidad: draft?.cantidad ?? det?.cantidad ?? 0,
      checked: draft?.checked ?? (det ? Number(det.cantidad) > 0 : false),
      detalleId: det?.id || null
    };
  });
}

function aplicarAjusteStockBodega({ productoId, bodegaId, sucursalId, sucursal, fecha, stockActual, cantidadNueva, nombreInv }) {
  const diff = Number(cantidadNueva) - Number(stockActual);
  if (!diff) return null;
  const prod = byId(state.productos, productoId);
  const mov = {
    id: uid(diff > 0 ? "AJ-IN" : "AJ-EG"),
    fecha: fecha || new Date().toISOString().slice(0, 10),
    nombre: `Ajuste inventario${nombreInv ? `: ${nombreInv}` : ""}`,
    tipo: diff > 0 ? "Ingreso" : "Egreso",
    sucursalId: sucursalId || "",
    sucursal: sucursal || "",
    bodegaId: bodegaId || "",
    productoId,
    cantidad: Math.abs(diff),
    cantidadBase: Math.abs(diff),
    auto: true,
    ajusteInventario: true
  };
  state.movimientos.push(mov);
  return mov;
}

function fusionarInventarioEnEdicion(invLocal) {
  if (!invLocal?.id) return;
  const idx = state.inventarios.findIndex((x) => x.id === invLocal.id);
  const detallesLocal = invLocal.detalles || [];
  if (idx >= 0) {
    const remoto = state.inventarios[idx];
    const detallesRemoto = remoto.detalles || [];
    state.inventarios[idx] = {
      ...remoto,
      ...invLocal,
      detalles: detallesLocal.length >= detallesRemoto.length ? detallesLocal : detallesRemoto
    };
  } else {
    state.inventarios.push(invLocal);
  }
}

function capturarCabeceraMovDesdeDom() {
  return {
    fecha: document.getElementById("mov-fecha")?.value || new Date().toISOString().slice(0, 10),
    tipo: document.getElementById("mov-tipo")?.value || "Ingreso",
    sucursalId: document.getElementById("mov-sucursal")?.value || "",
    bodegaId: document.getElementById("mov-bodega")?.value || ""
  };
}

let _suppressNextSave = false;
let _saving = false;
let _saveQueued = false;
let _saveWaiters = [];
let _renderTimer = null;
let _saveHintShown = false;

function _hayInputEnfocado() {
  const el = document.activeElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}

function programarRender() {
  if (_renderTimer) clearTimeout(_renderTimer);
  _renderTimer = setTimeout(() => {
    _renderTimer = null;
    if (_saving || window.DataLayer?._writeLock) {
      programarRender();
      return;
    }
    if (_formularioInventarioActivo()) {
      preservarBorradoresInventario();
      if (_hayInputEnfocado()) {
        programarRender();
        return;
      }
      _suppressNextSave = true;
      renderInventarios();
      return;
    }
    if (_hayInputEnfocado()) {
      programarRender();
      return;
    }
    _suppressNextSave = true;
    render();
  }, 250);
}

function toast(message, type = "info", duration = 3500) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function confirmar(mensaje) {
  return window.confirm(mensaje);
}

function puedeEditarCatalogos() {
  return window.Auth?.isAdmin() === true;
}

function getTenantId() {
  return window.Auth?.currentUser?.tenantId || "default";
}

async function saveData() {
  if (_suppressNextSave) {
    _suppressNextSave = false;
    return true;
  }
  if (!window.Auth?.currentUser) return false;
  const tenantId = getTenantId();
  if (window.SUPABASE_ENABLED) {
    if (_saving) {
      _saveQueued = true;
      return new Promise((resolve) => {
        _saveWaiters.push(resolve);
      });
    }
    if (window.DataLayer.loadFailed) {
      toast(
        "La carga inicial fue incompleta. Refresca la página (Ctrl+Shift+R) antes de guardar para no perder datos." +
          (window.DataLayer.loadErrorMessage ? ` (${window.DataLayer.loadErrorMessage})` : ""),
        "error",
        7000
      );
      return false;
    }
    _saving = true;
    window.DataLayer._writeLock = true;
    const colecciones = ["productos", "familias", "categorias", "sucursales", "bodegas", "movimientos", "inventarios"];
    // Capturar snapshot ya, antes de que realtime pueda mutar state
    const snapshot = {};
    colecciones.forEach((c) => {
      snapshot[c] = Array.isArray(state[c]) ? state[c].map((x) => ({ ...x })) : [];
    });
    const recetasSnap = state.recetas && typeof state.recetas === "object" ? JSON.parse(JSON.stringify(state.recetas)) : {};
    let ok = false;
    try {
      await Promise.all(colecciones.map((c) => window.DataLayer.replaceCollection(tenantId, c, snapshot[c])));
      await window.DataLayer.saveRecetas(tenantId, recetasSnap);
      // Mantener DataLayer alineado con lo guardado
      colecciones.forEach((c) => {
        window.DataLayer._state[c] = snapshot[c];
      });
      window.DataLayer._state.recetas = recetasSnap;
      ok = true;
    } catch (e) {
      console.error("Error guardando datos:", e);
      const msg = e.message || String(e);
      let ayuda = "";
      if (/row-level security|RLS|permission|policy/i.test(msg)) {
        ayuda = " Revisa que tu usuario exista en la tabla usuarios de Supabase y que ejecutaste supabase-schema.sql.";
      } else if (/timeout|network|fetch/i.test(msg)) {
        ayuda = " Revisa tu conexión e inténtalo de nuevo.";
      }
      toast("Error al guardar: " + msg + ayuda, "error", 7000);
      ok = false;
    } finally {
      window.DataLayer._writeLock = false;
      _saving = false;
      if (_saveQueued) {
        _saveQueued = false;
        const waiters = _saveWaiters.splice(0);
        saveData().then((queuedOk) => waiters.forEach((w) => w(queuedOk)));
      } else if (_saveWaiters.length) {
        const waiters = _saveWaiters.splice(0);
        waiters.forEach((w) => w(ok));
      }
    }
    return ok;
  } else {
    window.DataLayer._state = state;
    window.DataLayer._saveLocal(tenantId);
    return true;
  }
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

function byId(arr, id) {
  return (arr || []).find((x) => x.id === id);
}

function monedaPorLocale(locale) {
  const lang = String(locale || "").toLowerCase();
  if (lang.startsWith("es-cl") || lang === "es") return "CLP";
  if (lang.startsWith("es-mx")) return "MXN";
  if (lang.startsWith("es-ar")) return "ARS";
  if (lang.startsWith("es-co")) return "COP";
  if (lang.startsWith("es-pe")) return "PEN";
  if (lang.startsWith("es-uy")) return "UYU";
  if (lang.startsWith("en-us")) return "USD";
  if (lang.startsWith("en-gb")) return "GBP";
  if (lang.startsWith("pt-br")) return "BRL";
  if (lang.startsWith("eu")) return "EUR";
  return "CLP";
}

function formatMoneda(valor) {
  const n = Number(valor) || 0;
  const locale = navigator.language || "es-CL";
  const currency = monedaPorLocale(locale);
  const tieneDecimales = Math.abs(n % 1) >= 0.005;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: tieneDecimales ? 2 : 0,
      maximumFractionDigits: tieneDecimales ? 2 : 0
    }).format(n);
  } catch {
    return new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency: "CLP",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(n);
  }
}

function stockBaseProducto(productoId) {
  return stockBaseProductoEnBodega(productoId, null);
}

function stockBaseProductoEnBodega(productoId, bodegaId) {
  let total = 0;
  for (const mov of state.movimientos) {
    if (mov.productoId !== productoId) continue;
    if (bodegaId && mov.bodegaId !== bodegaId) continue;
    const base = Number(mov.cantidadBase ?? mov.cantidad) || 0;
    if (mov.tipo === "Ingreso") total += base;
    if (mov.tipo === "Egreso") total -= base;
  }
  return total;
}

function calcularStockVisible(producto) {
  if (!producto) return "—";
  const base = stockBaseProducto(producto.id);
  if (producto.tipo === "Normal") return `${base} ${producto.unidad || "unidad"}(es)`;
  return `${base} ${producto.unidad || "gr"}`;
}

function stockLabelProducto(productoId) {
  const p = byId(state.productos, productoId);
  if (!p) return "Selecciona un producto para ver el stock";
  return `Stock actual: ${calcularStockVisible(p)}`;
}

function opcionProductoConStock(p, selectedId) {
  return `<option value="${p.id}" ${selectedId === p.id ? "selected" : ""}>${p.nombre} — Stock: ${calcularStockVisible(p)}</option>`;
}

function opcionProductoNombre(p, selectedId) {
  return `<option value="${p.id}" ${selectedId === p.id ? "selected" : ""}>${p.nombre}</option>`;
}

function productosOrdenadosPorNombre(lista) {
  return [...(lista || [])].sort((a, b) =>
    String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" })
  );
}

function detallesInventarioOrdenados(detalles) {
  return [...(detalles || [])].sort((a, b) => {
    const na = byId(state.productos, a.productoId)?.nombre || a.productoId || "";
    const nb = byId(state.productos, b.productoId)?.nombre || b.productoId || "";
    return String(na).localeCompare(String(nb), "es", { sensitivity: "base" });
  });
}

const TIPOS_EMPAQUE = ["Unidad", "Caja", "Saco", "Tarro", "Bolsa", "Botella", "Pack", "Otro"];

function cantidadPorEmpaqueProducto(prod) {
  if (!prod) return 1;
  const n = Number(prod.cantidadPorEmpaque);
  if (prod.empaque === "Unidad" || !prod.empaque) return 1;
  return n > 0 ? n : 1;
}

function calcularCantidadBase(cantidad, modoIngreso, cantidadPorEmpaque) {
  const c = Number(cantidad) || 0;
  const factor = Number(cantidadPorEmpaque) || 1;
  if (modoIngreso === "empaque") return c * factor;
  return c;
}

function etiquetaEmpaque(empaque, cantidadPorEmpaque) {
  if (!empaque || empaque === "Unidad") return "Unidad";
  const n = Number(cantidadPorEmpaque) || 1;
  return `${empaque} (×${n})`;
}

function formatoCantidadMovimiento(mov, prod) {
  const um = prod?.unidad || "Unidad";
  const empaque = mov.empaque || prod?.empaque || "Unidad";
  const porEmpaque = Number(mov.cantidadPorEmpaque) || cantidadPorEmpaqueProducto(prod);
  const base = Number(mov.cantidadBase ?? mov.cantidad) || 0;
  if (mov.modoIngreso === "base" || empaque === "Unidad") {
    return `${base} ${um}`;
  }
  return `${mov.cantidad} ${empaque} = ${base} ${um}`;
}

let _recetaUi = {
  showForm: false,
  showIngrediente: false,
  editingId: null,
  draft: null
};

function getRecetasLista() {
  const raw = state.recetas;
  if (Array.isArray(raw)) return raw;
  if (raw?.lista && Array.isArray(raw.lista)) return raw.lista;
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw).map(([procId, items]) => ({
    id: `REC-LEG-${procId}`,
    nombre: byId(state.productos, procId)?.nombre || procId,
    productoProcesadoId: procId,
    ingredientes: (items || []).map((it) => ({
      productoId: it.normalId,
      cantidad: it.cantidad
    }))
  }));
}

function setRecetasLista(lista) {
  state.recetas = { version: 2, lista };
}

function nombresRecetasUnicos() {
  return [...new Set(getRecetasLista().map((r) => (r.nombre || "").trim()).filter(Boolean))];
}

function htmlDatalistNombresRecetas() {
  const nombres = nombresRecetasUnicos();
  if (!nombres.length) return "";
  return `<datalist id="prod-nombre-recetas">${nombres.map((n) => `<option value="${n.replace(/"/g, "&quot;")}"></option>`).join("")}</datalist>`;
}

function validarNombreProductoNormal(nombre, productoId) {
  const n = (nombre || "").trim();
  if (!n) return { ok: true };
  const duplicado = state.productos.some(
    (p) => p.id !== productoId && (p.nombre || "").trim().toLowerCase() === n.toLowerCase()
  );
  if (duplicado) {
    return { ok: false, mensaje: "Ya existe un producto con ese nombre. Ingresa un nombre nuevo." };
  }
  return { ok: true };
}

function validarNombreProductoProcesado(nombre) {
  const n = (nombre || "").trim();
  if (!n) return { ok: true };
  const nombresRec = nombresRecetasUnicos();
  if (!nombresRec.length) {
    return { ok: false, mensaje: "Crea al menos una receta en la vista Receta" };
  }
  const coincide = nombresRec.some((r) => r.toLowerCase() === n.toLowerCase());
  if (!coincide) {
    return { ok: false, mensaje: "Selecciona un nombre de la lista de recetas" };
  }
  return { ok: true };
}

function obtenerInsumosRecetaParaProducto(procesadoId) {
  const lista = getRecetasLista();
  const rec = lista.find((r) => r.productoProcesadoId === procesadoId);
  if (rec) return rec.ingredientes || [];
  if (state.recetas && typeof state.recetas === "object" && !state.recetas.lista && !Array.isArray(state.recetas)) {
    return (state.recetas[procesadoId] || []).map((it) => ({
      productoId: it.normalId,
      cantidad: it.cantidad
    }));
  }
  return [];
}

function limpiarRecetasPorProducto(productoId) {
  const lista = getRecetasLista()
    .map((r) => ({
      ...r,
      ingredientes: (r.ingredientes || []).filter((i) => i.productoId !== productoId)
    }))
    .filter((r) => r.productoProcesadoId !== productoId && (r.ingredientes || []).length > 0);
  setRecetasLista(lista);
}

function render() {
  renderDashboard();
  renderProductos();
  renderRecetas();
  renderFamilias();
  renderCategorias();
  renderSucursales();
  renderBodegas();
  renderMovimientos();
  renderInventarios();
  if (typeof renderUsuarios === "function") renderUsuarios();
  saveData();
}

function actualizarBotonNuevoInventario() {
  const btn = document.getElementById("btnNuevoInventarioTop");
  if (!btn) return;
  const activa = document.querySelector(".nav-btn.active")?.dataset.view;
  btn.style.display = activa === "inventarios" ? "" : "none";
}

function closeMobileNav() {
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("nav-backdrop")?.classList.remove("open");
  const btn = document.getElementById("btnNavMenu");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function toggleMobileNav() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("nav-backdrop");
  const btn = document.getElementById("btnNavMenu");
  if (!sidebar || !backdrop || !btn) return;
  const abrir = !sidebar.classList.contains("open");
  sidebar.classList.toggle("open", abrir);
  backdrop.classList.toggle("open", abrir);
  btn.setAttribute("aria-expanded", abrir ? "true" : "false");
}

function navigateToView(viewId) {
  if (!viewId) return;
  if (!puedeAccederVista(viewId)) viewId = "inventarios";
  document.querySelectorAll(".nav-btn").forEach((x) => {
    x.classList.toggle("active", x.dataset.view === viewId);
  });
  document.querySelectorAll(".view").forEach((x) => x.classList.remove("active"));
  const viewEl = document.getElementById(`view-${viewId}`);
  if (viewEl) viewEl.classList.add("active");
  closeMobileNav();
  actualizarBotonNuevoInventario();
}

function setupNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => navigateToView(btn.dataset.view));
  });
  document.getElementById("btnNavMenu")?.addEventListener("click", toggleMobileNav);
  document.getElementById("nav-backdrop")?.addEventListener("click", closeMobileNav);
}

let _charts = {};

function renderDashboard() {
  const el = document.getElementById("view-dashboard");
  if (!el) return;

  const totalProductos = state.productos.length;
  const totalMovimientos = state.movimientos.length;
  const totalInventarios = state.inventarios.filter((i) => normalizarEstadoInventario(i) === "cerrado").length;
  const totalBodegas = state.bodegas.length;

  const valorTotal = state.productos.reduce((acc, p) => {
    const stock = stockBaseProducto(p.id);
    return acc + Number(p.precio || 0) * stock;
  }, 0);

  const stockBajo = state.productos.filter((p) => stockBaseProducto(p.id) <= 5).length;

  const ingresos = state.movimientos.filter((m) => m.tipo === "Ingreso").reduce((a, m) => a + Number(m.cantidad || 0), 0);
  const egresos = state.movimientos.filter((m) => m.tipo === "Egreso").reduce((a, m) => a + Number(m.cantidad || 0), 0);

  const porCategoria = {};
  state.productos.forEach((p) => {
    const catNombre = byId(state.categorias, p.categoriaId)?.nombre || "Sin categoría";
    porCategoria[catNombre] = (porCategoria[catNombre] || 0) + stockBaseProducto(p.id);
  });

  const ultimos = state.movimientos.slice(-7).reverse();

  const movPorDia = {};
  state.movimientos.forEach((m) => {
    const fecha = m.fecha || "Sin fecha";
    if (!movPorDia[fecha]) movPorDia[fecha] = { ingreso: 0, egreso: 0 };
    if (m.tipo === "Ingreso") movPorDia[fecha].ingreso += Number(m.cantidad || 0);
    if (m.tipo === "Egreso") movPorDia[fecha].egreso += Number(m.cantidad || 0);
  });
  const fechasOrdenadas = Object.keys(movPorDia).sort().slice(-10);

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon-productos" aria-hidden="true"><i class="fa-solid fa-box"></i></div>
        <div class="kpi-body">
          <div class="kpi-label">Productos</div>
          <div class="kpi-value">${totalProductos}</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon-alerta" aria-hidden="true"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div class="kpi-body">
          <div class="kpi-label">Stock bajo (≤5)</div>
          <div class="kpi-value" style="color:${stockBajo > 0 ? "#b91c1c" : "#16a34a"}">${stockBajo}</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon-valor" aria-hidden="true"><i class="fa-solid fa-coins"></i></div>
        <div class="kpi-body">
          <div class="kpi-label">Valor estimado</div>
          <div class="kpi-value">${formatMoneda(valorTotal)}</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon-movimientos" aria-hidden="true"><i class="fa-solid fa-arrows-rotate"></i></div>
        <div class="kpi-body">
          <div class="kpi-label">Movimientos</div>
          <div class="kpi-value">${totalMovimientos}</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon-ingreso" aria-hidden="true"><i class="fa-solid fa-arrow-trend-up"></i></div>
        <div class="kpi-body">
          <div class="kpi-label">Ingresos (cant.)</div>
          <div class="kpi-value kpi-value-ingreso">${ingresos}</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon-egreso" aria-hidden="true"><i class="fa-solid fa-arrow-trend-down"></i></div>
        <div class="kpi-body">
          <div class="kpi-label">Egresos (cant.)</div>
          <div class="kpi-value kpi-value-egreso">${egresos}</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon-inventario" aria-hidden="true"><i class="fa-solid fa-clipboard-list"></i></div>
        <div class="kpi-body">
          <div class="kpi-label">Tomas de inventario</div>
          <div class="kpi-value">${totalInventarios}</div>
        </div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon kpi-icon-bodega" aria-hidden="true"><i class="fa-solid fa-warehouse"></i></div>
        <div class="kpi-body">
          <div class="kpi-label">Bodegas</div>
          <div class="kpi-value">${totalBodegas}</div>
        </div>
      </div>
    </div>

    <div class="chart-grid">
      <div class="card">
        <h3>Stock por categoría</h3>
        <canvas id="chart-categorias" height="180"></canvas>
      </div>
      <div class="card">
        <h3>Movimientos por día</h3>
        <canvas id="chart-movimientos" height="180"></canvas>
      </div>
    </div>

    <div class="card">
      <h3>Últimos movimientos</h3>
      ${ultimos.length === 0 ? '<p class="empty-state">Aún no hay movimientos registrados.</p>' : `
      <table>
        <thead><tr><th>Fecha</th><th>Nombre</th><th>Tipo</th><th>Producto</th><th>Stock</th><th>Cantidad</th></tr></thead>
        <tbody>
          ${ultimos.map((m) => {
            const p = byId(state.productos, m.productoId);
            return `<tr><td>${m.fecha || ""}</td><td>${m.nombre || ""}</td><td>${m.tipo || ""}</td><td>${p?.nombre || ""}</td><td>${p ? calcularStockVisible(p) : "—"}</td><td>${m.cantidad}</td></tr>`;
          }).join("")}
        </tbody>
      </table>`}
    </div>
  `;

  if (window.Chart) {
    if (_charts.categorias) { _charts.categorias.destroy(); }
    const ctxCat = document.getElementById("chart-categorias");
    if (ctxCat) {
      _charts.categorias = new window.Chart(ctxCat, {
        type: "doughnut",
        data: {
          labels: Object.keys(porCategoria),
          datasets: [{
            data: Object.values(porCategoria),
            backgroundColor: ["#2563eb", "#16a34a", "#ca8a04", "#b91c1c", "#7c3aed", "#0891b2", "#db2777", "#ea580c"]
          }]
        },
        options: { responsive: true, plugins: { legend: { position: "bottom" } } }
      });
    }

    if (_charts.movimientos) { _charts.movimientos.destroy(); }
    const ctxMov = document.getElementById("chart-movimientos");
    if (ctxMov) {
      _charts.movimientos = new window.Chart(ctxMov, {
        type: "bar",
        data: {
          labels: fechasOrdenadas,
          datasets: [
            {
              label: "Ingreso",
              data: fechasOrdenadas.map((f) => movPorDia[f].ingreso),
              backgroundColor: "#16a34a"
            },
            {
              label: "Egreso",
              data: fechasOrdenadas.map((f) => movPorDia[f].egreso),
              backgroundColor: "#b91c1c"
            }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: "bottom" } },
          scales: { y: { beginAtZero: true } }
        }
      });
    }
  }
}

function abrirFormularioProducto(productoId = null) {
  try {
    if (!puedeEditarCatalogos()) {
      toast("Solo administradores pueden crear o editar productos. Tu rol: " + (etiquetaRol(window.Auth?.currentUser?.role) || "desconocido"), "warn", 5000);
      return;
    }
    editingIds.producto = productoId || null;
    showProductoForm = true;
    renderProductos();
    const formCard = document.getElementById("prod-form-card");
    formCard?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => {
      const nombre = document.getElementById("prod-nombre");
      nombre?.focus();
      if (!productoId) nombre?.select?.();
    }, 50);
  } catch (e) {
    console.error("abrirFormularioProducto:", e);
    toast("Error al abrir formulario: " + (e.message || e), "error", 5000);
  }
}
window.abrirFormularioProducto = abrirFormularioProducto;

function setupProductosUI() {
  const root = document.getElementById("view-productos");
  if (!root || root.dataset.uiReady === "1") return;
  root.dataset.uiReady = "1";
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("#btn-nuevo-producto, .btn-nuevo-producto");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      abrirFormularioProducto(null);
      return;
    }
    const row = e.target.closest("tr.row-producto");
    if (row?.dataset?.id) {
      e.preventDefault();
      abrirFormularioProducto(row.dataset.id);
    }
  });
}

function renderProductos() {
  const el = document.getElementById("view-productos");
  if (!el) return;
  if (!Array.isArray(state.productos)) state.productos = [];
  const familiasOpts = (state.familias || []).map((f) => `<option value="${f.id}">${f.nombre}</option>`).join("");
  const categoriasOpts = (state.categorias || []).map((c) => `<option value="${c.id}">${c.nombre}</option>`).join("");
  const data = editingIds.producto ? byId(state.productos, editingIds.producto) : {};
  const soloLectura = !puedeEditarCatalogos();
  const dis = soloLectura ? "disabled" : "";
  const esProcesado = data?.tipo === "Procesado";
  const listRecetas = esProcesado ? ' list="prod-nombre-recetas"' : "";
  const editando = !!editingIds.producto;

  el.innerHTML = `
    ${soloLectura ? `<div class="read-only-banner">Modo solo lectura: tu rol es <strong>${etiquetaRol(window.Auth?.currentUser?.role)}</strong>. Solo administradores pueden modificar productos.</div>` : ""}
    <div class="card" id="prod-form-card">
      <div class="prod-lista-head">
        <h2 style="margin:0;">${editando ? "Editar producto" : "Nuevo producto"}</h2>
        ${editando ? `<button type="button" id="btn-nuevo-producto" class="btn-nuevo-producto">Nuevo producto</button>` : ""}
      </div>
      <input type="hidden" id="prod-id" value="${data?.id || uid("PROD")}" />
      <div class="grid prod-form-grid">
        <div class="prod-nombre-cell">
          <label>Nombre<input id="prod-nombre" value="${data?.nombre || ""}"${listRecetas} ${dis} placeholder="${esProcesado ? "Nombre de receta" : ""}" /></label>
          <label class="prod-checkbox-field">
            <input type="checkbox" id="prod-procesado" ${data?.tipo === "Procesado" ? "checked" : ""} ${dis} />
            Procesado
          </label>
        </div>
        <label>Familia
          <select id="prod-familia" ${dis}><option value="">--</option>${familiasOpts}</select>
        </label>
        <label>Categoría
          <select id="prod-categoria" ${dis}><option value="">--</option>${categoriasOpts}</select>
        </label>
        <label>U. de Med.
          <select id="prod-um" ${dis}>
            ${["Unidad", "Gramo", "Kilo", "Litro", "Mililitro"].map((u) => `<option ${data?.unidad === u ? "selected" : ""}>${u}</option>`).join("")}
          </select>
        </label>
        <label>Formato
          <select id="prod-empaque" ${dis}>
            ${TIPOS_EMPAQUE.map((e) => `<option ${(data?.empaque || "Unidad") === e ? "selected" : ""}>${e}</option>`).join("")}
          </select>
        </label>
        <label>Precio<input type="number" id="prod-precio" value="${data?.precio ?? 0}" ${dis} /></label>
      </div>
      ${htmlDatalistNombresRecetas()}
      <div class="grid prod-form-extra">
        <label id="prod-empaque-cant-wrap">Unidades por formato
          <input type="number" id="prod-empaque-cant" min="1" step="any" value="${data?.cantidadPorEmpaque ?? (data?.empaque && data.empaque !== "Unidad" ? 1 : 1)}" ${dis} />
        </label>
      </div>
      <div class="actions prod-form-actions">
        <button type="button" id="prod-guardar" ${dis}>Guardar</button>
        ${editando ? `<button type="button" id="prod-eliminar" ${dis}>Eliminar</button>` : ""}
        ${editando ? `<button type="button" id="prod-cancelar" class="btn-link">Cancelar</button>` : ""}
      </div>
    </div>
    <div class="card">
      <div class="prod-lista-head">
        <h3 style="margin:0;">Productos</h3>
      </div>
      ${state.productos.length === 0
        ? '<p class="empty-state">Aún no hay productos. Completa el formulario de arriba y pulsa <strong>Guardar</strong>.</p>'
        : `<div class="table-scroll"><table class="prod-lista-table">
        <thead><tr><th>Id</th><th>Nombre</th><th>Precio</th><th>Tipo</th><th>Formato</th><th>Familia</th><th>Categoría</th><th>Stock</th></tr></thead>
        <tbody>
          ${state.productos.map((p) => `<tr data-id="${p.id}" class="row-producto" style="cursor:pointer;"><td>${p.id}</td><td>${p.nombre}</td><td>${p.precio}</td><td>${p.tipo}</td><td>${etiquetaEmpaque(p.empaque || "Unidad", cantidadPorEmpaqueProducto(p))}</td><td>${byId(state.familias, p.familiaId)?.nombre || ""}</td><td>${byId(state.categorias, p.categoriaId)?.nombre || ""}</td><td>${calcularStockVisible(p)}</td></tr>`).join("")}
        </tbody>
      </table></div>`}
    </div>
  `;

  document.getElementById("prod-familia").value = data?.familiaId || "";
  document.getElementById("prod-categoria").value = data?.categoriaId || "";

  const prodEmpaqueSel = document.getElementById("prod-empaque");
  const prodEmpaqueCant = document.getElementById("prod-empaque-cant");
  const prodEmpaqueCantWrap = document.getElementById("prod-empaque-cant-wrap");
  function syncProdEmpaqueCant() {
    const esUnidad = prodEmpaqueSel.value === "Unidad";
    prodEmpaqueCantWrap.style.display = esUnidad ? "none" : "";
    if (esUnidad) prodEmpaqueCant.value = "1";
  }
  prodEmpaqueSel.addEventListener("change", syncProdEmpaqueCant);
  syncProdEmpaqueCant();

  const prodProcesado = document.getElementById("prod-procesado");
  const prodNombre = document.getElementById("prod-nombre");
  function syncProdNombreRecetaAutocomplete() {
    if (!prodProcesado || !prodNombre) return;
    if (prodProcesado.checked) {
      prodNombre.setAttribute("list", "prod-nombre-recetas");
      prodNombre.placeholder = nombresRecetasUnicos().length ? "Nombre de receta" : "Crea recetas primero";
    } else {
      prodNombre.removeAttribute("list");
      prodNombre.placeholder = "";
    }
  }
  function marcarNombreProductoInvalido(invalido) {
    if (!prodNombre) return;
    prodNombre.classList.toggle("input-invalido", invalido);
  }

  function validarProdNombreAlSalir() {
    if (!prodNombre) return;
    const nombre = prodNombre.value.trim();
    const productoId = document.getElementById("prod-id")?.value?.trim() || "";
    if (!nombre) {
      marcarNombreProductoInvalido(false);
      return;
    }
    const resultado = prodProcesado?.checked
      ? validarNombreProductoProcesado(nombre)
      : validarNombreProductoNormal(nombre, productoId);
    marcarNombreProductoInvalido(!resultado.ok);
    if (!resultado.ok) toast(resultado.mensaje, "warn");
  }

  prodProcesado?.addEventListener("change", () => {
    syncProdNombreRecetaAutocomplete();
    validarProdNombreAlSalir();
  });
  syncProdNombreRecetaAutocomplete();
  prodNombre?.addEventListener("blur", validarProdNombreAlSalir);
  prodNombre?.addEventListener("input", () => marcarNombreProductoInvalido(false));

  document.getElementById("prod-cancelar")?.addEventListener("click", () => {
    editingIds.producto = null;
    showProductoForm = true;
    renderProductos();
  });

  document.getElementById("prod-guardar").addEventListener("click", async () => {
    const id = document.getElementById("prod-id").value.trim();
    const prev = byId(state.productos, id);
    const item = {
      id,
      nombre: document.getElementById("prod-nombre").value.trim(),
      precio: Number(document.getElementById("prod-precio").value || 0),
      cantidad: prev?.cantidad ?? 0,
      unidad: document.getElementById("prod-um").value,
      tipo: document.getElementById("prod-procesado").checked ? "Procesado" : "Normal",
      familiaId: document.getElementById("prod-familia").value,
      categoriaId: document.getElementById("prod-categoria").value,
      empaque: document.getElementById("prod-empaque").value,
      cantidadPorEmpaque: document.getElementById("prod-empaque").value === "Unidad"
        ? 1
        : Number(document.getElementById("prod-empaque-cant").value || 0)
    };
    if (!item.id || !item.nombre) { toast("Id y nombre son obligatorios", "warn"); return; }
    const validacionNombre = item.tipo === "Procesado"
      ? validarNombreProductoProcesado(item.nombre)
      : validarNombreProductoNormal(item.nombre, item.id);
    if (!validacionNombre.ok) {
      toast(validacionNombre.mensaje, "warn");
      document.getElementById("prod-nombre")?.focus();
      return;
    }
    if (item.empaque !== "Unidad" && item.cantidadPorEmpaque <= 0) {
      toast("Indica cuántas unidades trae cada formato", "warn");
      return;
    }
    const i = state.productos.findIndex((x) => x.id === item.id);
    const editaba = i >= 0;
    if (editaba) state.productos[i] = item;
    else state.productos.push(item);
    editingIds.producto = null;
    showProductoForm = true;
    const ok = await saveData();
    if (!ok) return;
    toast(editaba ? "Producto actualizado" : "Producto creado", "success");
    _suppressNextSave = true;
    render();
  });

  document.getElementById("prod-eliminar")?.addEventListener("click", async () => {
    const id = document.getElementById("prod-id").value.trim();
    if (!confirmar("¿Eliminar este producto?")) return;
    state.productos = state.productos.filter((x) => x.id !== id);
    limpiarRecetasPorProducto(id);
    editingIds.producto = null;
    showProductoForm = true;
    const ok = await saveData();
    if (!ok) return;
    toast("Producto eliminado", "success");
    _suppressNextSave = true;
    render();
  });
}

function guardarRecetaDesdeDraft() {
  const draft = _recetaUi.draft;
  if (!draft) return false;
  const nombre = (draft.nombre || "").trim();
  if (!nombre) {
    toast("El nombre de la receta es obligatorio", "warn");
    return false;
  }
  if (!draft.ingredientes.length) {
    toast("Agrega al menos un ingrediente", "warn");
    return false;
  }
  const lista = getRecetasLista().slice();
  const proc = state.productos.find(
    (p) => p.tipo === "Procesado" && p.nombre.trim().toLowerCase() === nombre.toLowerCase()
  );
  const receta = {
    id: _recetaUi.editingId || uid("REC"),
    nombre,
    productoProcesadoId: proc?.id || null,
    ingredientes: draft.ingredientes.map((i) => ({ ...i }))
  };
  const idx = lista.findIndex((r) => r.id === receta.id);
  if (idx >= 0) lista[idx] = receta;
  else lista.push(receta);
  setRecetasLista(lista);
  _recetaUi = { showForm: false, showIngrediente: false, editingId: null, draft: null };
  return true;
}

function renderRecetas() {
  const el = document.getElementById("view-recetas");
  if (!el) return;
  const soloLectura = !puedeEditarCatalogos();
  const dis = soloLectura ? "disabled" : "";
  const lista = getRecetasLista();
  const draft = _recetaUi.draft;
  const productosOpts = state.productos
    .map((p) => `<option value="${p.id}">${p.nombre} (${p.tipo})</option>`)
    .join("");
  const iconEliminar = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;

  if (_recetaUi.showForm && draft) {
    el.innerHTML = `
      ${soloLectura ? '<div class="read-only-banner">Modo solo lectura.</div>' : ""}
      <div class="card">
        <h2>${_recetaUi.editingId ? "Editar receta" : "Crear receta"}</h2>
        <fieldset style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
          <legend>Datos de la receta</legend>
          <div class="grid" style="grid-template-columns:1fr auto;align-items:end;gap:12px;">
            <label>Nombre<input id="rec-nombre" value="${draft.nombre || ""}" ${dis} /></label>
            <button type="button" id="btn-agregar-ingrediente" ${dis} ${state.productos.length === 0 ? "disabled" : ""}>Agregar ingrediente</button>
          </div>
        </fieldset>
        ${_recetaUi.showIngrediente ? `
        <fieldset style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;margin-top:14px;">
          <legend>Ingrediente</legend>
          ${state.productos.length === 0 ? '<p class="empty-state">Crea productos en la vista Productos primero.</p>' : `
          <div class="grid">
            <label>Producto
              <select id="ing-producto" ${dis}>
                <option value="">Seleccionar</option>
                ${productosOpts}
              </select>
            </label>
            <label>Cantidad<input type="number" id="ing-cantidad" min="0" step="any" value="0" ${dis} /></label>
          </div>`}
        </fieldset>` : ""}
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap;">
          <h4 style="margin:0;">Ingredientes (${draft.ingredientes.length})</h4>
          ${_recetaUi.showIngrediente ? `
          <div style="display:flex;gap:8px;flex-shrink:0;">
            <button type="button" id="btn-ing-anadir" ${dis}>Añadir</button>
            <button type="button" id="btn-ing-guardar" ${dis}>Guardar</button>
          </div>` : ""}
        </div>
        ${draft.ingredientes.length > 0
          ? `<table>
              <thead><tr><th>Producto</th><th>Cantidad</th><th>Unidad</th>${soloLectura ? "" : "<th></th>"}</tr></thead>
              <tbody>
                ${draft.ingredientes.map((ing, idx) => {
                  const p = byId(state.productos, ing.productoId);
                  return `<tr>
                    <td>${p?.nombre || ing.productoId}</td>
                    <td>${ing.cantidad}</td>
                    <td>${p?.unidad || ""}</td>
                    ${soloLectura ? "" : `<td><button type="button" class="btn-icon danger btn-quitar-ing-draft" data-idx="${idx}" title="Quitar">${iconEliminar}</button></td>`}
                  </tr>`;
                }).join("")}
              </tbody>
            </table>` : ""}
        <div class="actions" style="display:flex;justify-content:flex-end;margin-top:14px;">
          <button type="button" id="btn-receta-salir" class="btn-link">Salir</button>
        </div>
      </div>
    `;

    document.getElementById("rec-nombre")?.addEventListener("input", (e) => {
      draft.nombre = e.target.value;
    });

    document.getElementById("btn-agregar-ingrediente")?.addEventListener("click", () => {
      _recetaUi.showIngrediente = true;
      renderRecetas();
    });

    document.getElementById("btn-receta-salir")?.addEventListener("click", () => {
      _recetaUi = { showForm: false, showIngrediente: false, editingId: null, draft: null };
      renderRecetas();
    });

    document.querySelectorAll(".btn-quitar-ing-draft").forEach((btn) => {
      btn.addEventListener("click", () => {
        draft.ingredientes.splice(Number(btn.dataset.idx), 1);
        renderRecetas();
      });
    });

    document.getElementById("btn-ing-anadir")?.addEventListener("click", () => {
      const productoId = document.getElementById("ing-producto").value;
      const cantidad = Number(document.getElementById("ing-cantidad").value || 0);
      if (!productoId) { toast("Selecciona un producto", "warn"); return; }
      if (cantidad <= 0) { toast("La cantidad debe ser mayor a 0", "warn"); return; }
      draft.ingredientes.push({ productoId, cantidad });
      document.getElementById("ing-producto").value = "";
      document.getElementById("ing-cantidad").value = "0";
      toast("Ingrediente añadido", "success");
      renderRecetas();
    });

    document.getElementById("btn-ing-guardar")?.addEventListener("click", () => {
      draft.nombre = document.getElementById("rec-nombre")?.value?.trim() || draft.nombre;
      const eraEdicion = !!_recetaUi.editingId;
      if (guardarRecetaDesdeDraft()) {
        toast(eraEdicion ? "Receta actualizada" : "Receta guardada", "success");
        render();
      }
    });
    return;
  }

  el.innerHTML = `
    ${soloLectura ? '<div class="read-only-banner">Modo solo lectura: tu rol es <strong>usuario</strong>. Solo administradores pueden modificar recetas.</div>' : ""}
    <div class="card">
      <h2>Receta</h2>
      <div class="actions">
        <button type="button" id="btn-crear-receta" ${dis}>Crear Receta</button>
      </div>
    </div>
    <div class="card">
      <h3>Recetas registradas (${lista.length})</h3>
      ${lista.length === 0
        ? '<p class="empty-state">No hay recetas. Presiona <strong>Crear Receta</strong>.</p>'
        : `<table>
            <thead>
              <tr><th>Nombre</th><th>Ingredientes</th><th>Producto procesado</th>${soloLectura ? "" : "<th></th>"}</tr>
            </thead>
            <tbody>
              ${lista.map((r) => {
                const proc = r.productoProcesadoId ? byId(state.productos, r.productoProcesadoId) : null;
                return `<tr class="row-receta" data-id="${r.id}" style="cursor:pointer;">
                  <td>${r.nombre}</td>
                  <td>${(r.ingredientes || []).length}</td>
                  <td>${proc?.nombre || "—"}</td>
                  ${soloLectura ? "" : `<td><button type="button" class="btn-icon danger btn-eliminar-receta" data-id="${r.id}" title="Eliminar receta">${iconEliminar}</button></td>`}
                </tr>`;
              }).join("")}
            </tbody>
          </table>`}
    </div>
  `;

  document.getElementById("btn-crear-receta")?.addEventListener("click", () => {
    _recetaUi = {
      showForm: true,
      showIngrediente: false,
      editingId: null,
      draft: { nombre: "", ingredientes: [] }
    };
    renderRecetas();
  });

  document.querySelectorAll(".row-receta").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".btn-eliminar-receta")) return;
      const rec = lista.find((r) => r.id === row.dataset.id);
      if (!rec) return;
      _recetaUi = {
        showForm: true,
        showIngrediente: false,
        editingId: rec.id,
        draft: {
          nombre: rec.nombre,
          ingredientes: (rec.ingredientes || []).map((i) => ({ ...i }))
        }
      };
      renderRecetas();
    });
  });

  document.querySelectorAll(".btn-eliminar-receta").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirmar("¿Eliminar esta receta completa?")) return;
      setRecetasLista(lista.filter((r) => r.id !== btn.dataset.id));
      toast("Receta eliminada", "success");
      render();
    });
  });
}

function simpleCrudView(containerId, title, keyName, editingKey) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!Array.isArray(state[keyName])) state[keyName] = [];
  const list = state[keyName];
  const data = editingIds[editingKey] ? byId(list, editingIds[editingKey]) : {};
  const soloLectura = !puedeEditarCatalogos();
  const dis = soloLectura ? "disabled" : "";
  const editando = !!editingIds[editingKey];
  const singular = title.replace(/es$/, "").replace(/s$/, "") || title;

  el.innerHTML = `
    ${soloLectura ? '<div class="read-only-banner">Modo solo lectura: tu rol es <strong>usuario</strong>.</div>' : ""}
    <div class="card">
      <div class="prod-lista-head">
        <h2 style="margin:0;">${editando ? `Editar ${singular}` : `Crear ${singular}`}</h2>
        ${editando ? `<button type="button" id="${editingKey}-nuevo" class="btn-link">Nueva</button>` : ""}
      </div>
      <div class="grid">
        <input type="hidden" id="${editingKey}-id" value="${data?.id || uid(editingKey.slice(0, 3).toUpperCase())}" />
        <label>Nombre<input id="${editingKey}-nombre" value="${data?.nombre || ""}" ${dis} placeholder="Nombre de la ${singular.toLowerCase()}" /></label>
      </div>
      <div class="actions prod-form-actions">
        <button type="button" id="${editingKey}-guardar" ${dis}>Guardar</button>
        ${editando ? `<button type="button" id="${editingKey}-eliminar" ${dis}>Eliminar</button>` : ""}
        ${editando ? `<button type="button" id="${editingKey}-cancelar" class="btn-link">Cancelar</button>` : ""}
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0;">${title}</h3>
      ${list.length === 0
        ? `<p class="empty-state">Aún no hay ${title.toLowerCase()}. Escribe un nombre arriba y pulsa <strong>Guardar</strong>.</p>`
        : `<div class="table-scroll"><table class="prod-lista-table">
        <thead><tr><th>Id</th><th>Nombre</th></tr></thead>
        <tbody>
          ${list.map((x) => `<tr class="row-${editingKey}" data-id="${x.id}" style="cursor:pointer;"><td>${x.id}</td><td>${x.nombre}</td></tr>`).join("")}
        </tbody>
      </table></div>`}
    </div>
  `;

  document.querySelectorAll(`.row-${editingKey}`).forEach((r) => {
    r.addEventListener("click", () => {
      if (soloLectura) return;
      editingIds[editingKey] = r.dataset.id;
      simpleCrudView(containerId, title, keyName, editingKey);
    });
  });

  document.getElementById(`${editingKey}-nuevo`)?.addEventListener("click", () => {
    editingIds[editingKey] = null;
    simpleCrudView(containerId, title, keyName, editingKey);
  });

  document.getElementById(`${editingKey}-cancelar`)?.addEventListener("click", () => {
    editingIds[editingKey] = null;
    simpleCrudView(containerId, title, keyName, editingKey);
  });

  document.getElementById(`${editingKey}-guardar`).addEventListener("click", async () => {
    if (!Array.isArray(state[keyName])) state[keyName] = [];
    const item = {
      id: document.getElementById(`${editingKey}-id`).value.trim(),
      nombre: document.getElementById(`${editingKey}-nombre`).value.trim()
    };
    if (!item.id || !item.nombre) { toast("El nombre es obligatorio", "warn"); return; }
    const i = state[keyName].findIndex((x) => x.id === item.id);
    const editaba = i >= 0;
    if (editaba) state[keyName][i] = item;
    else state[keyName].push(item);
    editingIds[editingKey] = null;
    const ok = await saveData();
    if (!ok) {
      toast(`No se pudo guardar la ${singular.toLowerCase()}. Revisa el mensaje de error.`, "error", 6000);
      return;
    }
    toast(`${singular} ${editaba ? "actualizada" : "creada"}`, "success");
    _suppressNextSave = true;
    render();
  });

  document.getElementById(`${editingKey}-eliminar`)?.addEventListener("click", async () => {
    if (!confirmar(`¿Eliminar este registro?`)) return;
    const id = document.getElementById(`${editingKey}-id`).value.trim();
    state[keyName] = (state[keyName] || []).filter((x) => x.id !== id);
    editingIds[editingKey] = null;
    const ok = await saveData();
    if (!ok) {
      toast("No se pudo eliminar. Revisa el mensaje de error.", "error", 6000);
      return;
    }
    toast("Eliminado", "success");
    _suppressNextSave = true;
    render();
  });
}

function renderFamilias() {
  simpleCrudView("view-familias", "Familias", "familias", "familia");
}

function renderCategorias() {
  simpleCrudView("view-categorias", "Categorías", "categorias", "categoria");
}

function renderSucursales() {
  const el = document.getElementById("view-sucursales");
  const data = editingIds.sucursal ? byId(state.sucursales, editingIds.sucursal) : {};
  const soloLectura = !puedeEditarCatalogos();
  const dis = soloLectura ? "disabled" : "";
  el.innerHTML = `
    ${soloLectura ? '<div class="read-only-banner">Modo solo lectura: tu rol es <strong>usuario</strong>.</div>' : ""}
    <div class="card">
      <h2>Crear Sucursal</h2>
      <div class="grid">
        <label>Id<input id="suc-id" value="${data?.id || uid("SUC")}" ${dis} /></label>
        <label>Nombre<input id="suc-nombre" value="${data?.nombre || ""}" ${dis} /></label>
        <label>Dirección<input id="suc-direccion" value="${data?.direccion || ""}" ${dis} /></label>
        <label>Teléfono<input id="suc-telefono" value="${data?.telefono || ""}" ${dis} /></label>
      </div>
      <div class="actions">
        <button id="suc-guardar" ${dis}>Guardar</button>
        <button id="suc-editar" ${dis}>Editar</button>
        <button id="suc-eliminar" ${dis}>Eliminar</button>
      </div>
    </div>
    <div class="card">
      <h3>Lista de sucursales</h3>
      <table>
        <thead><tr><th>Id</th><th>Nombre</th><th>Dirección</th><th>Teléfono</th></tr></thead>
        <tbody>
          ${state.sucursales.map((x) => `<tr class="row-sucursal" data-id="${x.id}" style="cursor:pointer;"><td>${x.id}</td><td>${x.nombre}</td><td>${x.direccion || ""}</td><td>${x.telefono || ""}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  document.querySelectorAll(".row-sucursal").forEach((r) => r.addEventListener("click", () => {
    editingIds.sucursal = r.dataset.id;
    renderSucursales();
  }));

  document.getElementById("suc-guardar").addEventListener("click", () => {
    const item = {
      id: document.getElementById("suc-id").value.trim(),
      nombre: document.getElementById("suc-nombre").value.trim(),
      direccion: document.getElementById("suc-direccion").value.trim(),
      telefono: document.getElementById("suc-telefono").value.trim()
    };
    if (!item.id || !item.nombre) { toast("Id y nombre son obligatorios", "warn"); return; }
    const i = state.sucursales.findIndex((x) => x.id === item.id);
    const editaba = i >= 0;
    if (editaba) state.sucursales[i] = item;
    else state.sucursales.push(item);
    editingIds.sucursal = null;
    toast(`Sucursal ${editaba ? "actualizada" : "creada"}`, "success");
    render();
  });

  document.getElementById("suc-editar").addEventListener("click", () => {
    editingIds.sucursal = document.getElementById("suc-id").value.trim();
    renderSucursales();
  });

  document.getElementById("suc-eliminar").addEventListener("click", () => {
    if (!confirmar("¿Eliminar esta sucursal?")) return;
    const id = document.getElementById("suc-id").value.trim();
    state.sucursales = state.sucursales.filter((x) => x.id !== id);
    editingIds.sucursal = null;
    toast("Sucursal eliminada", "success");
    render();
  });
}

function renderBodegas() {
  const el = document.getElementById("view-bodegas");
  const data = editingIds.bodega ? byId(state.bodegas, editingIds.bodega) : {};
  const soloLectura = !puedeEditarCatalogos();
  const dis = soloLectura ? "disabled" : "";
  const sinSucursales = state.sucursales.length === 0;
  const sucursalIdActual = data?.sucursalId || "";

  el.innerHTML = `
    ${soloLectura ? '<div class="read-only-banner">Modo solo lectura: tu rol es <strong>usuario</strong>.</div>' : ""}
    ${sinSucursales && !soloLectura ? '<div class="read-only-banner">Aún no hay sucursales creadas. Crea al menos una sucursal antes de crear bodegas.</div>' : ""}
    <div class="card">
      <h2>Crear Bodega</h2>
      <div class="grid">
        <label>Id<input id="bod-id" value="${data?.id || uid("BOD")}" ${dis} /></label>
        <label>Nombre<input id="bod-nombre" value="${data?.nombre || ""}" ${dis} /></label>
        <label>Sucursal
          <select id="bod-sucursal" ${dis}>
            <option value="">Seleccionar sucursal...</option>
            ${state.sucursales.map((s) => `<option value="${s.id}" ${sucursalIdActual === s.id ? "selected" : ""}>${s.nombre}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="actions">
        <button id="bod-guardar" ${dis}>Guardar</button>
        <button id="bod-editar" ${dis}>Editar</button>
        <button id="bod-eliminar" ${dis}>Eliminar</button>
      </div>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Id</th><th>Nombre</th><th>Sucursal</th></tr></thead>
        <tbody>
          ${state.bodegas.map((x) => {
            const nombreSucursal = byId(state.sucursales, x.sucursalId)?.nombre || x.sucursal || "—";
            return `<tr class="row-bodega" data-id="${x.id}" style="cursor:pointer;"><td>${x.id}</td><td>${x.nombre}</td><td>${nombreSucursal}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
  document.querySelectorAll(".row-bodega").forEach((r) => r.addEventListener("click", () => {
    editingIds.bodega = r.dataset.id;
    renderBodegas();
  }));
  document.getElementById("bod-guardar").addEventListener("click", () => {
    const sucursalId = document.getElementById("bod-sucursal").value;
    const sucursalNombre = byId(state.sucursales, sucursalId)?.nombre || "";
    const item = {
      id: document.getElementById("bod-id").value.trim(),
      nombre: document.getElementById("bod-nombre").value.trim(),
      sucursalId,
      sucursal: sucursalNombre
    };
    if (!item.id || !item.nombre) { toast("Id y nombre obligatorios", "warn"); return; }
    if (!sucursalId) { toast("Selecciona una sucursal", "warn"); return; }
    const i = state.bodegas.findIndex((x) => x.id === item.id);
    const editaba = i >= 0;
    if (editaba) state.bodegas[i] = item;
    else state.bodegas.push(item);
    editingIds.bodega = null;
    toast(`Bodega ${editaba ? "actualizada" : "creada"}`, "success");
    render();
  });
  document.getElementById("bod-editar").addEventListener("click", () => {
    editingIds.bodega = document.getElementById("bod-id").value.trim();
    renderBodegas();
  });
  document.getElementById("bod-eliminar").addEventListener("click", () => {
    if (!confirmar("¿Eliminar esta bodega?")) return;
    const id = document.getElementById("bod-id").value.trim();
    state.bodegas = state.bodegas.filter((x) => x.id !== id);
    editingIds.bodega = null;
    toast("Bodega eliminada", "success");
    render();
  });
}

function aplicarMovimiento(mov) {
  if (mov.tipo !== "Ingreso") return;
  const prod = byId(state.productos, mov.productoId);
  if (!prod || prod.tipo !== "Procesado") return;
  const insumos = obtenerInsumosRecetaParaProducto(prod.id);
  insumos.forEach((insumo) => {
    state.movimientos.push({
      id: uid("AUTO-EG"),
      fecha: mov.fecha,
      nombre: `Consumo por ${prod.nombre}`,
      tipo: "Egreso",
      sucursalId: mov.sucursalId,
      sucursal: mov.sucursal,
      bodegaId: mov.bodegaId,
      productoId: insumo.productoId,
      cantidad: insumo.cantidad * Number(mov.cantidadBase),
      cantidadBase: insumo.cantidad * Number(mov.cantidadBase),
      auto: true
    });
  });
}

let _movFilter = { fechaDesde: "", fechaHasta: "", tipo: "", productoId: "" };

function aplicarFiltroMovimientos(lista) {
  return lista.filter((m) => {
    if (_movFilter.fechaDesde && m.fecha < _movFilter.fechaDesde) return false;
    if (_movFilter.fechaHasta && m.fecha > _movFilter.fechaHasta) return false;
    if (_movFilter.tipo && m.tipo !== _movFilter.tipo) return false;
    if (_movFilter.productoId && m.productoId !== _movFilter.productoId) return false;
    return true;
  });
}

function sincronizarFiltroMovDesdeDom() {
  _movFilter = {
    fechaDesde: document.getElementById("filt-mov-desde")?.value || "",
    fechaHasta: document.getElementById("filt-mov-hasta")?.value || "",
    tipo: document.getElementById("filt-mov-tipo")?.value || "",
    productoId: document.getElementById("filt-mov-producto")?.value || ""
  };
}

function htmlListaMovimientosFiltrada() {
  const movimientosFiltrados = aplicarFiltroMovimientos(state.movimientos);
  const total = state.movimientos.length;
  const contador = movimientosFiltrados.length !== total
    ? ` (${movimientosFiltrados.length} de ${total})`
    : ` (${movimientosFiltrados.length})`;
  if (movimientosFiltrados.length === 0) {
    return `<h3>Movimientos${contador}</h3><p class="empty-state">No hay movimientos que coincidan con los filtros.</p>`;
  }
  return `
    <h3>Movimientos${contador}</h3>
    <table>
      <thead><tr><th>Id</th><th>Fecha</th><th>Tipo</th><th>Sucursal</th><th>Producto</th><th>Stock</th><th>Cantidad</th><th>Base</th></tr></thead>
      <tbody>
        ${movimientosFiltrados.map((m) => {
          const p = byId(state.productos, m.productoId);
          return `<tr data-id="${m.id}" class="row-mov" style="cursor:pointer;"><td>${m.id}</td><td>${m.fecha}</td><td>${m.tipo}</td><td>${m.sucursal}</td><td>${p?.nombre || ""}</td><td>${p ? calcularStockVisible(p) : "—"}</td><td>${formatoCantidadMovimiento(m, p)}</td><td>${m.cantidadBase ?? m.cantidad}</td></tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function enlazarFilasMovimiento() {
  document.querySelectorAll(".row-mov").forEach((r) => r.addEventListener("click", () => {
    editingIds.movimiento = r.dataset.id;
    _movLineasDraft = [];
    renderMovimientos();
  }));
}

function actualizarListaMovimientosFiltrada() {
  sincronizarFiltroMovDesdeDom();
  const card = document.getElementById("mov-lista-card");
  if (!card) return;
  card.innerHTML = htmlListaMovimientosFiltrada();
  enlazarFilasMovimiento();
}

function setupFiltrosMovimiento() {
  const onCambio = () => actualizarListaMovimientosFiltrada();
  ["filt-mov-desde", "filt-mov-hasta", "filt-mov-tipo", "filt-mov-producto"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", onCambio);
    el.addEventListener("input", onCambio);
  });
  document.getElementById("filt-mov-limpiar")?.addEventListener("click", () => {
    _movFilter = { fechaDesde: "", fechaHasta: "", tipo: "", productoId: "" };
    const desde = document.getElementById("filt-mov-desde");
    const hasta = document.getElementById("filt-mov-hasta");
    const tipo = document.getElementById("filt-mov-tipo");
    const producto = document.getElementById("filt-mov-producto");
    if (desde) desde.value = "";
    if (hasta) hasta.value = "";
    if (tipo) tipo.value = "";
    if (producto) producto.value = "";
    actualizarListaMovimientosFiltrada();
  });
}

function htmlLineaMovimiento(linea, index, esUltima, esEdicionUnica) {
  const prod = byId(state.productos, linea.productoId);
  const empaque = linea.empaque || prod?.empaque || "Unidad";
  const bloqueada = linea.bloqueada && !esEdicionUnica;

  if (bloqueada) {
    return `
      <div class="mov-linea grid mov-linea-grid mov-linea-bloqueada" data-linea="${index}">
        <div><span class="inv-dato-label">Producto</span><span class="inv-dato-valor">${prod?.nombre || "—"}</span></div>
        <div><span class="inv-dato-label">Formato</span><span class="inv-dato-valor">${empaque}</span></div>
        <div><span class="inv-dato-label">Cantidad</span><span class="inv-dato-valor">${linea.cantidad}</span></div>
        <div><span class="inv-dato-label">Stock</span><span class="inv-dato-valor">${prod ? calcularStockVisible(prod) : "—"}</span></div>
        <div class="mov-add-cell"></div>
      </div>`;
  }

  return `
    <div class="mov-linea grid mov-linea-grid" data-linea="${index}">
      <label>Producto
        <select id="mov-producto-${index}">
          <option value="">--</option>
          ${state.productos.map((p) => opcionProductoConStock(p, linea.productoId)).join("")}
        </select>
      </label>
      <label>Formato
        <select id="mov-empaque-${index}">
          ${TIPOS_EMPAQUE.map((e) => `<option ${empaque === e ? "selected" : ""}>${e}</option>`).join("")}
        </select>
      </label>
      <label><span class="mov-cantidad-label" data-linea="${index}">Cantidad</span>
        <input type="number" id="mov-cantidad-${index}" min="0" step="any" value="${linea.cantidad ?? 0}" />
      </label>
      <label>Stock
        <div id="mov-stock-info-${index}" class="stock-display">${prod ? calcularStockVisible(prod) : "—"}</div>
      </label>
      <label class="mov-add-cell">
        <span class="mov-add-label">&nbsp;</span>
        ${esUltima && !esEdicionUnica ? `<button type="button" class="btn-mov-add" data-linea="${index}" title="Agregar otra línea">+</button>` : ""}
      </label>
    </div>
    <p class="small mov-linea-preview" id="mov-preview-${index}"></p>`;
}

function capturarLineaMovDesdeDom(index) {
  return {
    productoId: document.getElementById(`mov-producto-${index}`)?.value || "",
    empaque: document.getElementById(`mov-empaque-${index}`)?.value || "Unidad",
    cantidad: Number(document.getElementById(`mov-cantidad-${index}`)?.value || 0),
    bloqueada: false
  };
}

function setupLineaMovimiento(index, esEdicionUnica) {
  const prodSel = document.getElementById(`mov-producto-${index}`);
  const empaqueSel = document.getElementById(`mov-empaque-${index}`);
  const cantInp = document.getElementById(`mov-cantidad-${index}`);
  const cantLabel = document.querySelector(`.mov-cantidad-label[data-linea="${index}"]`);
  const stockEl = document.getElementById(`mov-stock-info-${index}`);
  const preview = document.getElementById(`mov-preview-${index}`);
  if (!prodSel) return;

  const actualizar = () => {
    const prod = byId(state.productos, prodSel.value);
    if (stockEl) stockEl.textContent = prod ? calcularStockVisible(prod) : "—";
    const empaque = empaqueSel.value;
    const porEmpaque = cantidadPorEmpaqueProducto(prod);
    const cant = Number(cantInp.value || 0);
    const um = prod?.unidad || "unidad base";
    if (cantLabel) cantLabel.textContent = `Cantidad (${empaque}${empaque !== "Unidad" ? "s" : ""})`;
    if (preview) {
      preview.textContent = porEmpaque > 0 && cant > 0 ? `Equivale a ${calcularCantidadBase(cant, "empaque", porEmpaque)} ${um} en stock` : "";
    }
  };

  prodSel.addEventListener("change", () => {
    const prod = byId(state.productos, prodSel.value);
    if (prod) empaqueSel.value = prod.empaque || "Unidad";
    actualizar();
  });
  empaqueSel.addEventListener("change", actualizar);
  cantInp.addEventListener("input", actualizar);
  actualizar();
}

function renderMovimientos() {
  const el = document.getElementById("view-movimientos");
  const data = editingIds.movimiento ? byId(state.movimientos, editingIds.movimiento) : {};
  const esEdicionUnica = !!editingIds.movimiento;

  if (esEdicionUnica) {
    _movCabeceraDraft = {
      fecha: data.fecha || new Date().toISOString().slice(0, 10),
      tipo: data.tipo || "Ingreso",
      sucursalId: data.sucursalId || state.sucursales.find((s) => s.nombre === data.sucursal)?.id || "",
      bodegaId: data.bodegaId || ""
    };
    _movLineasDraft = [{
      productoId: data.productoId || "",
      empaque: data.empaque || "Unidad",
      cantidad: data.cantidad ?? 0,
      bloqueada: false
    }];
  } else {
    if (!_movCabeceraDraft) {
      _movCabeceraDraft = {
        fecha: new Date().toISOString().slice(0, 10),
        tipo: "Ingreso",
        sucursalId: "",
        bodegaId: ""
      };
    }
    if (_movLineasDraft.length === 0) {
      _movLineasDraft = [{ productoId: "", empaque: "Unidad", cantidad: 0, bloqueada: false }];
    }
  }

  const cab = _movCabeceraDraft;
  const sinSucursales = state.sucursales.length === 0;
  const sucursalIdActual = cab.sucursalId || "";
  const bodegasFiltradas = sucursalIdActual
    ? state.bodegas.filter((b) => b.sucursalId === sucursalIdActual)
    : state.bodegas;

  const lineasHtml = _movLineasDraft.map((linea, i) =>
    htmlLineaMovimiento(linea, i, i === _movLineasDraft.length - 1, esEdicionUnica)
  ).join("");

  el.innerHTML = `
    <div class="card">
      <h2>Movimientos de Mercaderías</h2>
      ${sinSucursales ? '<p class="empty-state">Primero crea al menos una sucursal en la vista <strong>Sucursales</strong>.</p>' : ""}
      <input type="hidden" id="mov-id" value="${data?.id || uid("MOV")}" />
      <div class="grid mov-form-grid">
        <label>Fecha<input type="date" id="mov-fecha" value="${cab.fecha}" /></label>
        <label>Tipo de Movimiento
          <select id="mov-tipo">
            ${["Ingreso", "Egreso", "Traspaso"].map((x) => `<option ${cab.tipo === x ? "selected" : ""}>${x}</option>`).join("")}
          </select>
        </label>
        <label>Sucursal
          <select id="mov-sucursal" ${sinSucursales ? "disabled" : ""}>
            <option value="">--</option>
            ${state.sucursales.map((s) => `<option value="${s.id}" ${sucursalIdActual === s.id ? "selected" : ""}>${s.nombre}</option>`).join("")}
          </select>
        </label>
        <label>Bodega
          <select id="mov-bodega">
            <option value="">--</option>
            ${bodegasFiltradas.map((b) => `<option value="${b.id}" ${cab.bodegaId === b.id ? "selected" : ""}>${b.nombre}</option>`).join("")}
          </select>
        </label>
      </div>
      <div id="mov-lineas-container" style="margin-top:12px;">
        ${lineasHtml}
      </div>
      <div class="actions">
        <button id="mov-guardar">Guardar</button>
        <button id="mov-editar">Editar</button>
        <button id="mov-eliminar">Eliminar</button>
      </div>
    </div>
    <div class="card">
      <div class="filt-mov-row">
        <label>Desde<input type="date" id="filt-mov-desde" value="${_movFilter.fechaDesde}" /></label>
        <label>Hasta<input type="date" id="filt-mov-hasta" value="${_movFilter.fechaHasta}" /></label>
        <label>Tipo
          <select id="filt-mov-tipo">
            <option value="">--</option>
            ${["Ingreso", "Egreso", "Traspaso"].map((t) => `<option ${_movFilter.tipo === t ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </label>
        <label>Producto
          <select id="filt-mov-producto">
            <option value="">--</option>
            ${state.productos.map((p) => `<option value="${p.id}" ${_movFilter.productoId === p.id ? "selected" : ""}>${p.nombre}</option>`).join("")}
          </select>
        </label>
        <button type="button" id="filt-mov-limpiar">Limpiar</button>
      </div>
    </div>

    <div class="card" id="mov-lista-card">
      ${htmlListaMovimientosFiltrada()}
    </div>
  `;

  setupFiltrosMovimiento();
  enlazarFilasMovimiento();

  const movSucSel = document.getElementById("mov-sucursal");
  if (movSucSel) {
    movSucSel.addEventListener("change", () => {
      const nuevaSucId = movSucSel.value;
      const select = document.getElementById("mov-bodega");
      const filtradas = nuevaSucId ? state.bodegas.filter((b) => b.sucursalId === nuevaSucId) : state.bodegas;
      select.innerHTML = `<option value="">--</option>` + filtradas.map((b) => `<option value="${b.id}">${b.nombre}</option>`).join("");
    });
  }

  _movLineasDraft.forEach((linea, i) => {
    if (!linea.bloqueada) setupLineaMovimiento(i, esEdicionUnica);
  });

  document.querySelectorAll(".btn-mov-add").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.linea);
      const actual = capturarLineaMovDesdeDom(idx);
      if (!actual.productoId) {
        toast("Selecciona un producto antes de agregar otra línea", "warn");
        return;
      }
      _movCabeceraDraft = capturarCabeceraMovDesdeDom();
      _movLineasDraft[idx] = { ...actual, bloqueada: true };
      _movLineasDraft.push({ productoId: "", empaque: "Unidad", cantidad: 0, bloqueada: false });
      renderMovimientos();
    });
  });

  document.getElementById("mov-guardar").addEventListener("click", () => {
    const sucursalId = document.getElementById("mov-sucursal").value;
    const sucursalNombre = byId(state.sucursales, sucursalId)?.nombre || "";
    const tipoMov = document.getElementById("mov-tipo").value;
    const fecha = document.getElementById("mov-fecha").value;
    const bodegaId = document.getElementById("mov-bodega").value;
    const movIdHidden = document.getElementById("mov-id").value.trim();

    if (!fecha) { toast("Completa la fecha", "warn"); return; }
    if (!sucursalId) { toast("Selecciona una sucursal", "warn"); return; }

    const lineasAGuardar = _movLineasDraft.map((linea, i) =>
      linea.bloqueada ? linea : capturarLineaMovDesdeDom(i)
    ).filter((l) => l.productoId);

    if (lineasAGuardar.length === 0) {
      toast("Agrega al menos un producto", "warn");
      return;
    }

    if (esEdicionUnica) {
      const linea = lineasAGuardar[0];
      const prod = byId(state.productos, linea.productoId);
      const cantidadPorEmpaque = cantidadPorEmpaqueProducto(prod);
      const cantidadBase = calcularCantidadBase(linea.cantidad, "empaque", cantidadPorEmpaque);
      const mov = {
        id: movIdHidden,
        fecha,
        nombre: `${tipoMov} - ${prod.nombre}`,
        tipo: tipoMov,
        sucursalId,
        sucursal: sucursalNombre,
        bodegaId,
        productoId: linea.productoId,
        empaque: linea.empaque,
        cantidadPorEmpaque,
        modoIngreso: "empaque",
        cantidad: linea.cantidad,
        cantidadBase
      };
      const i = state.movimientos.findIndex((x) => x.id === mov.id);
      if (i >= 0) state.movimientos[i] = mov;
      editingIds.movimiento = null;
      _movLineasDraft = [];
      toast("Movimiento actualizado", "success");
      render();
      return;
    }

    let creados = 0;
    lineasAGuardar.forEach((linea) => {
      const prod = byId(state.productos, linea.productoId);
      const cantidadPorEmpaque = cantidadPorEmpaqueProducto(prod);
      const cantidadBase = calcularCantidadBase(linea.cantidad, "empaque", cantidadPorEmpaque);
      const mov = {
        id: uid("MOV"),
        fecha,
        nombre: `${tipoMov} - ${prod.nombre}`,
        tipo: tipoMov,
        sucursalId,
        sucursal: sucursalNombre,
        bodegaId,
        productoId: linea.productoId,
        empaque: linea.empaque,
        cantidadPorEmpaque,
        modoIngreso: "empaque",
        cantidad: linea.cantidad,
        cantidadBase
      };
      state.movimientos.push(mov);
      aplicarMovimiento(mov);
      creados++;
    });
    _movCabeceraDraft = capturarCabeceraMovDesdeDom();
    _movLineasDraft = [{ productoId: "", empaque: "Unidad", cantidad: 0, bloqueada: false }];
    toast(`${creados} movimiento(s) creado(s)`, "success");
    render();
  });

  document.getElementById("mov-editar").addEventListener("click", () => {
    editingIds.movimiento = document.getElementById("mov-id").value.trim();
    _movLineasDraft = [];
    renderMovimientos();
  });
  document.getElementById("mov-eliminar").addEventListener("click", () => {
    if (!confirmar("¿Eliminar este movimiento?")) return;
    const id = document.getElementById("mov-id").value.trim();
    state.movimientos = state.movimientos.filter((x) => x.id !== id);
    editingIds.movimiento = null;
    _movLineasDraft = [];
    toast("Movimiento eliminado", "success");
    render();
  });
}

function cancelarInventarioCreacion() {
  const id = editingIds.inventario;
  const inv = id ? byId(state.inventarios, id) : null;
  if (inv && (!inv.detalles || inv.detalles.length === 0)) {
    state.inventarios = state.inventarios.filter((x) => x.id !== id);
    saveData();
  }
  showCabeceraInventarioForm = false;
  showDetalleInventarioForm = false;
  showVerInventario = false;
  editingIds.inventario = null;
  editingIds.detalleInventario = null;
  _invDetalleDraft = { productoId: "", cantidad: 0 };
  _invCabeceraDraft = null;
  _invProductoBusqueda = "";
  _invTomaDraft = {};
  renderInventarios();
}

function sincronizarFiltroInvListaDesdeDom() {
  _invListaFilter = {
    fecha: document.getElementById("f-fecha")?.value || "",
    bodegaId: document.getElementById("f-inv-bodega")?.value || "",
    estado: document.getElementById("f-inv-estado")?.value || "activos"
  };
}

function bodegasPorSucursal(sucursalId) {
  return sucursalId ? state.bodegas.filter((b) => b.sucursalId === sucursalId) : [];
}

const INV_BODEGA_NUEVA = "__nueva__";

function opcionesSelectBodegas(bodegas, selectedId) {
  const lista = bodegas.map((b) =>
    `<option value="${b.id}" ${selectedId === b.id ? "selected" : ""}>${b.nombre}</option>`
  ).join("");
  const agregar = bodegas.length
    ? `<option value="${INV_BODEGA_NUEVA}">+ Agregar bodega...</option>`
    : "";
  return `<option value="">--</option>` + lista + agregar;
}

async function crearBodegaInventario(nombre, sucursalId) {
  const trimmed = (nombre || "").trim();
  if (!sucursalId) {
    toast("Selecciona una sucursal primero", "warn");
    return null;
  }
  if (!trimmed) {
    toast("Escribe el nombre de la bodega", "warn");
    return null;
  }
  const duplicada = state.bodegas.some(
    (b) => b.sucursalId === sucursalId && (b.nombre || "").toLowerCase() === trimmed.toLowerCase()
  );
  if (duplicada) {
    toast("Ya existe una bodega con ese nombre en la sucursal", "warn");
    return null;
  }
  const sucursalNombre = byId(state.sucursales, sucursalId)?.nombre || "";
  const item = { id: uid("BOD"), nombre: trimmed, sucursalId, sucursal: sucursalNombre };
  state.bodegas.push(item);
  await saveData();
  toast("Bodega creada", "success");
  return item;
}

function setupInvBodegaControls(cabeceraFija) {
  if (cabeceraFija) return;
  const invSucSel = document.getElementById("inv-sucursal");
  const select = document.getElementById("inv-bodega");
  const bloqueCrear = document.getElementById("inv-bodega-crear");
  const inputNombre = document.getElementById("inv-bodega-nombre");
  const btnAgregar = document.getElementById("inv-bodega-agregar");
  const btnCancelar = document.getElementById("inv-bodega-cancelar");
  if (!select) return;

  const mostrarModoCrear = (enfocar) => {
    const hayBodegas = bodegasPorSucursal(invSucSel?.value || "").length > 0;
    select.classList.add("is-hidden");
    select.disabled = true;
    select.removeAttribute("required");
    bloqueCrear?.classList.add("is-visible");
    btnCancelar?.classList.toggle("is-hidden", !hayBodegas);
    if (enfocar) inputNombre?.focus();
  };

  const mostrarModoSelect = () => {
    select.classList.remove("is-hidden");
    bloqueCrear?.classList.remove("is-visible");
    btnCancelar?.classList.add("is-hidden");
    if (inputNombre) inputNombre.value = "";
  };

  const actualizarUiBodega = (enfocarCrear) => {
    const sucursalId = invSucSel?.value || "";
    const filtradas = bodegasPorSucursal(sucursalId);
    const prev = select.value === INV_BODEGA_NUEVA ? "" : select.value;
    const prevValido = filtradas.some((b) => b.id === prev);
    const seleccionado = prevValido ? prev : "";
    select.innerHTML = opcionesSelectBodegas(filtradas, seleccionado);
    if (seleccionado) select.dataset.lastValue = seleccionado;

    if (!sucursalId) {
      mostrarModoSelect();
      select.value = "";
      select.disabled = true;
      select.removeAttribute("required");
      return;
    }

    if (filtradas.length) {
      mostrarModoSelect();
      select.disabled = false;
      select.setAttribute("required", "");
      select.value = seleccionado;
      return;
    }

    mostrarModoCrear(enfocarCrear);
  };

  const agregarBodega = async () => {
    const sucursalId = invSucSel?.value || "";
    const item = await crearBodegaInventario(inputNombre?.value || "", sucursalId);
    if (!item) return;
    if (inputNombre) inputNombre.value = "";
    actualizarUiBodega(false);
    select.value = item.id;
  };

  invSucSel?.addEventListener("change", () => actualizarUiBodega(true));
  select.addEventListener("change", () => {
    if (select.value === INV_BODEGA_NUEVA) {
      select.value = select.dataset.lastValue || "";
      mostrarModoCrear(true);
      return;
    }
    if (select.value) select.dataset.lastValue = select.value;
  });
  select.addEventListener("focus", () => {
    const sucursalId = invSucSel?.value || "";
    if (sucursalId && !bodegasPorSucursal(sucursalId).length) mostrarModoCrear(true);
  });
  btnCancelar?.addEventListener("click", () => {
    mostrarModoSelect();
    const sucursalId = invSucSel?.value || "";
    const filtradas = bodegasPorSucursal(sucursalId);
    select.innerHTML = opcionesSelectBodegas(filtradas, select.dataset.lastValue || "");
    select.value = select.dataset.lastValue || "";
    select.disabled = false;
    select.setAttribute("required", "");
  });
  btnAgregar?.addEventListener("click", agregarBodega);
  inputNombre?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      agregarBodega();
    }
  });
  const sucursalInicial = invSucSel?.value || "";
  actualizarUiBodega(sucursalInicial && !bodegasPorSucursal(sucursalInicial).length);
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function cargarUsuariosTenant() {
  if (_usuariosTenantPromise) return _usuariosTenantPromise;
  _usuariosTenantPromise = (async () => {
    try {
      const tenantId = getTenantId();
      let lista = [];
      if (window.SUPABASE_ENABLED) {
        const { supabase } = window.__SB__ || {};
        if (supabase) {
          const { data, error } = await supabase
            .from("usuarios")
            .select("nombre,email")
            .eq("tenant_id", tenantId);
          if (error) throw error;
          lista = (data || []).map((u) => (u.nombre || u.email || "").trim()).filter(Boolean);
        }
      } else {
        const users = JSON.parse(localStorage.getItem("inventario_app_users_v1") || "[]");
        lista = users
          .filter((u) => u.tenantId === tenantId)
          .map((u) => (u.nombre || u.email || "").trim())
          .filter(Boolean);
      }
      const actual = window.Auth?.currentUser;
      const propio = (actual?.nombre || actual?.email || "").trim();
      if (propio && !lista.some((n) => n.toLowerCase() === propio.toLowerCase())) {
        lista.push(propio);
      }
      _usuariosTenantNombres = [...new Set(lista)].sort((a, b) =>
        a.localeCompare(b, "es", { sensitivity: "base" })
      );
    } catch (e) {
      console.warn("No se pudieron cargar usuarios para autocompletar:", e);
    }
    return _usuariosTenantNombres;
  })();
  try {
    return await _usuariosTenantPromise;
  } finally {
    _usuariosTenantPromise = null;
  }
}

function htmlDatalistUsuariosInv() {
  return _usuariosTenantNombres
    .map((nombre) => `<option value="${escapeAttr(nombre)}"></option>`)
    .join("");
}

function actualizarDatalistUsuariosInv() {
  const dl = document.getElementById("inv-usuarios-list");
  if (!dl) return;
  dl.innerHTML = htmlDatalistUsuariosInv();
}

function setupInvFormularioProducto() {
  const nombreInput = document.getElementById("det-prod-nombre");
  const idHidden = document.getElementById("det-prod");
  const detStockInfo = document.getElementById("det-stock-info");
  const detUmInfo = document.getElementById("det-um");
  const detCantidad = document.getElementById("det-cantidad");
  if (!nombreInput || !idHidden) return;

  const sincronizarProductoDesdeNombre = () => {
    const texto = nombreInput.value.trim();
    _invProductoBusqueda = texto;
    const id = resolverProductoIdPorNombre(texto);
    idHidden.value = id;
    const prod = id ? byId(state.productos, id) : null;
    if (detStockInfo) detStockInfo.textContent = prod ? calcularStockVisible(prod) : "—";
    if (detUmInfo) detUmInfo.textContent = prod?.unidad || "—";
    if (prod && texto !== prod.nombre) {
      // keep typed text for autocomplete; don't rewrite until exact match
    }
    if (prod && texto.toLowerCase() === String(prod.nombre || "").trim().toLowerCase()) {
      nombreInput.value = prod.nombre;
    }
  };

  nombreInput.addEventListener("input", sincronizarProductoDesdeNombre);
  nombreInput.addEventListener("change", sincronizarProductoDesdeNombre);
  nombreInput.addEventListener("blur", sincronizarProductoDesdeNombre);

  if (detCantidad) {
    detCantidad.addEventListener("input", () => {
      const digits = String(detCantidad.value).replace(/\D/g, "").slice(0, 6);
      if (String(detCantidad.value) !== digits) detCantidad.value = digits;
    });
  }

  sincronizarProductoDesdeNombre();
}

async function asegurarUsuariosTenantEnFormInv() {
  await cargarUsuariosTenant();
  actualizarDatalistUsuariosInv();
}

function filtrarInventariosLista() {
  const fecha = _invListaFilter.fecha;
  const bodegaId = _invListaFilter.bodegaId || "";
  const filtroEstado = _invListaFilter.estado || "activos";
  return state.inventarios.filter((i) => {
    const okFecha = !fecha || i.fecha === fecha;
    const okBodega = !bodegaId || i.bodegaId === bodegaId;
    const okEstado = inventarioCoincideFiltroEstado(i, filtroEstado);
    return okFecha && okBodega && okEstado;
  });
}

function renderInventarios() {
  normalizarInventariosEstado();

  const el = document.getElementById("view-inventarios");
  const data = editingIds.inventario ? byId(state.inventarios, editingIds.inventario) : {};
  const inventarioActual = editingIds.inventario ? byId(state.inventarios, editingIds.inventario) : null;
  const detalles = detallesInventarioOrdenados(inventarioActual?.detalles || []);
  const productosParaInv = productosOrdenadosPorNombre(state.productos);
  const enModoCreacion = showCabeceraInventarioForm || showDetalleInventarioForm;
  const cabeceraFija = showDetalleInventarioForm && editingIds.inventario;
  const cab = cabeceraFija
    ? {
        id: data?.id || "",
        nombre: data?.nombre || "",
        sucursalId: data?.sucursalId || state.sucursales.find((s) => s.nombre === data?.sucursal)?.id || "",
        bodegaId: data?.bodegaId || "",
        fecha: data?.fecha || new Date().toISOString().slice(0, 10)
      }
    : (_invCabeceraDraft || {
        id: data?.id || uid("INV"),
        nombre: data?.nombre || window.Auth?.currentUser?.nombre || window.Auth?.currentUser?.email || "",
        sucursalId: data?.sucursalId || "",
        bodegaId: data?.bodegaId || "",
        fecha: data?.fecha || new Date().toISOString().slice(0, 10)
      });
  const detalleEditando = editingIds.detalleInventario
    ? detalles.find((d) => d.id === editingIds.detalleInventario)
    : null;
  const productoIdForm = detalleEditando?.productoId || _invDetalleDraft.productoId || "";
  const prodDetForm = productoIdForm ? byId(state.productos, productoIdForm) : null;
  const nombreProdForm = prodDetForm?.nombre || _invProductoBusqueda || "";

  const invSucursalIdActual = cab.sucursalId || "";
  const invBodegasFiltradas = bodegasPorSucursal(invSucursalIdActual);
  const invSinSucursales = state.sucursales.length === 0;
  const invSinBodegasSucursal = !!invSucursalIdActual && invBodegasFiltradas.length === 0;
  const filasToma = cabeceraFija
    ? filasTomaInventario(cab.bodegaId, inventarioActual?.detalles || [])
    : [];

  if (enModoCreacion) {
    el.innerHTML = `
      <div class="card">
        <fieldset style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
          <legend>Datos del Inventario</legend>
          ${invSinSucursales && !cabeceraFija ? '<p class="empty-state">Primero crea al menos una sucursal en la vista <strong>Sucursales</strong>.</p>' : ""}
          <input type="hidden" id="inv-id" value="${cab.id}" />
          <div class="inv-cabecera-grid">
            <div class="inv-cabecera-row">
              <label class="inv-cab-fecha">Fecha<input type="date" id="inv-fecha" value="${cab.fecha}" ${cabeceraFija ? "disabled" : ""} /></label>
              <label class="inv-cab-nombre">Usuario
                <input id="inv-nombre" list="inv-usuarios-list" value="${escapeAttr(cab.nombre)}" ${cabeceraFija ? "disabled" : ""} autocomplete="off" placeholder="Selecciona o escribe el usuario" />
                <datalist id="inv-usuarios-list">${htmlDatalistUsuariosInv()}</datalist>
              </label>
            </div>
            <div class="inv-cabecera-row">
              <label class="inv-cab-sucursal">Sucursal
                <select id="inv-sucursal" ${cabeceraFija || invSinSucursales ? "disabled" : ""}>
                  <option value="">--</option>
                  ${state.sucursales.map((s) => `<option value="${s.id}" ${invSucursalIdActual === s.id ? "selected" : ""}>${s.nombre}</option>`).join("")}
                </select>
              </label>
              <label class="inv-cab-bodega">Bodega
                <div class="inv-bodega-field">
                  <select id="inv-bodega" class="${invSinBodegasSucursal && !cabeceraFija ? "is-hidden" : ""}" ${cabeceraFija ? "disabled" : (invBodegasFiltradas.length ? "required" : "disabled")}>
                    ${opcionesSelectBodegas(invBodegasFiltradas, cab.bodegaId)}
                  </select>
                  ${!cabeceraFija ? `
                  <div id="inv-bodega-crear" class="inv-bodega-crear${invSinBodegasSucursal ? " is-visible" : ""}">
                    <button type="button" id="inv-bodega-cancelar" class="btn-inv-bod-cancel is-hidden" title="Volver" aria-label="Volver al listado de bodegas">×</button>
                    <input type="text" id="inv-bodega-nombre" placeholder="Nombre nueva bodega" autocomplete="off" />
                    <button type="button" id="inv-bodega-agregar">Agregar</button>
                  </div>` : ""}
                </div>
              </label>
            </div>
          </div>
          ${showDetalleInventarioForm ? `
          <div class="inv-prod-entry inv-prod-entry-buscar">
            <label class="inv-prod-buscar">Buscar producto
              <input type="search" id="det-prod-nombre" list="inv-productos-list" value="${escapeAttr(nombreProdForm)}" placeholder="Filtrar por nombre..." autocomplete="off" />
              <datalist id="inv-productos-list">${htmlDatalistProductosInv(productosParaInv)}</datalist>
            </label>
          </div>` : ""}
          ${!cabeceraFija ? `
          <div class="actions inv-cabecera-actions">
            <button type="button" id="inv-guardar">Crear</button>
            <button type="button" id="inv-cancelar" class="btn-link">Cancelar</button>
          </div>` : ""}
        </fieldset>
      </div>

      ${showDetalleInventarioForm ? `
      <div class="card">
        <div class="inv-toma-head">
          <h4 style="margin:0;">Productos de la bodega</h4>
          <span class="small" id="inv-toma-count">${filasToma.length} productos</span>
        </div>
        <div class="table-scroll">
        <table class="inv-toma-table">
          <thead>
            <tr>
              <th class="inv-toma-check-col"><input type="checkbox" id="inv-check-all" title="Seleccionar todos" /></th>
              <th>Nombre</th>
              <th>Uni. de Med.</th>
              <th>Stock</th>
              <th>Cantidad</th>
            </tr>
          </thead>
          <tbody>
            ${filasToma.length === 0
              ? `<tr><td colspan="5" class="small">No hay productos en el catálogo. Crea productos primero.</td></tr>`
              : filasToma.map((f) => {
                    const p = f.producto;
                    const oculta = busquedaOcultaFila(p.nombre, _invProductoBusqueda);
                    return `<tr class="inv-toma-row"${oculta ? ' style="display:none"' : ""} data-producto-id="${escapeAttr(p.id)}" data-stock="${f.stock}" data-prod-nombre="${escapeAttr(p.nombre || "")}">
                      <td class="inv-toma-check-col"><input type="checkbox" class="inv-toma-check" ${f.checked ? "checked" : ""} /></td>
                      <td>${escapeAttr(p.nombre || "")}</td>
                      <td>${escapeAttr(p.unidad || "—")}</td>
                      <td class="inv-toma-stock">${f.stock}</td>
                      <td><input type="text" class="inv-toma-cant" value="${f.cantidad}" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" /></td>
                    </tr>`;
                  }).join("")}
          </tbody>
        </table>
        </div>
        <div class="actions inv-salir-wrap inv-toma-actions">
          <button type="button" id="det-actualizar">Actualizar</button>
          <button type="button" id="det-guardar">Guardar</button>
          <button type="button" id="inv-salir">Salir</button>
        </div>
      </div>` : ""}
    `;

    if (showCabeceraInventarioForm && !cabeceraFija) {
      asegurarUsuariosTenantEnFormInv();
      setupInvBodegaControls(cabeceraFija);
      document.getElementById("inv-cancelar")?.addEventListener("click", () => {
        if (confirmar("¿Cancelar la creación del inventario? No se guardará.")) {
          cancelarInventarioCreacion();
        }
      });

      document.getElementById("inv-guardar").addEventListener("click", async () => {
        const sucursalId = document.getElementById("inv-sucursal").value;
        const sucursalNombre = byId(state.sucursales, sucursalId)?.nombre || "";
        const prev = byId(state.inventarios, document.getElementById("inv-id").value.trim());
        if (prev?.estado === "anulado") {
          toast("No se puede editar un inventario anulado", "warn");
          return;
        }
        const item = {
          id: document.getElementById("inv-id").value.trim(),
          nombre: document.getElementById("inv-nombre").value.trim(),
          sucursalId,
          sucursal: sucursalNombre,
          bodegaId: document.getElementById("inv-bodega").value,
          fecha: document.getElementById("inv-fecha").value,
          detalles: data?.detalles || [],
          estado: prev?.estado === "cerrado" ? "cerrado" : "borrador"
        };
        if (!item.nombre) { toast("El usuario es obligatorio", "warn"); return; }
        if (!item.sucursalId) { toast("Selecciona una sucursal", "warn"); return; }
        if (!item.bodegaId) { toast("Selecciona o agrega una bodega", "warn"); return; }
        const i = state.inventarios.findIndex((x) => x.id === item.id);
        if (i >= 0) state.inventarios[i] = { ...state.inventarios[i], ...item };
        else state.inventarios.push(item);
        editingIds.inventario = item.id;
        showDetalleInventarioForm = true;
        _invCabeceraDraft = null;
        const ok = await saveData();
        if (!ok) {
          toast("No se pudo guardar el inventario. Revisa el mensaje de error e inténtalo de nuevo.", "error", 6000);
          return;
        }
        toast("Cabecera guardada. Ahora cuenta los productos de la bodega.", "success");
        renderInventarios();
      });
    }

    if (showDetalleInventarioForm) {
      const buscarInput = document.getElementById("det-prod-nombre");
      if (buscarInput) {
        buscarInput.addEventListener("input", () => filtrarFilasTomaPorBusqueda(buscarInput.value));
        if (_invProductoBusqueda) filtrarFilasTomaPorBusqueda(_invProductoBusqueda);
      }

      document.querySelectorAll(".inv-toma-cant").forEach((input) => {
        const seleccionarTodo = () => {
          requestAnimationFrame(() => {
            try { input.select(); } catch (_) { /* ignore */ }
          });
        };
        input.addEventListener("focus", seleccionarTodo);
        input.addEventListener("mouseup", (e) => {
          // Evita que el clic quite la selección hecha en focus
          e.preventDefault();
        });
        input.addEventListener("keydown", (e) => {
          if (["e", "E", "+", "-", ".", ","].includes(e.key)) e.preventDefault();
        });
        input.addEventListener("input", () => {
          const digits = String(input.value).replace(/\D/g, "").slice(0, 6);
          if (String(input.value) !== digits) input.value = digits;
          const row = input.closest(".inv-toma-row");
          const check = row?.querySelector(".inv-toma-check");
          if (check && Number(input.value) > 0) check.checked = true;
          capturarInvTomaDraftDesdeDom();
        });
      });

      document.querySelectorAll(".inv-toma-check").forEach((check) => {
        check.addEventListener("change", () => capturarInvTomaDraftDesdeDom());
      });

      const checkAll = document.getElementById("inv-check-all");
      if (checkAll) {
        const visibles = [...document.querySelectorAll(".inv-toma-row .inv-toma-check")];
        checkAll.checked = visibles.length > 0 && visibles.every((c) => c.checked);
        checkAll.addEventListener("change", () => {
          visibles.forEach((c) => { c.checked = checkAll.checked; });
          capturarInvTomaDraftDesdeDom();
        });
      }

      document.getElementById("det-actualizar")?.addEventListener("click", async () => {
        const inv = byId(state.inventarios, editingIds.inventario);
        if (!inv) { toast("No hay un inventario activo", "warn"); return; }
        if (inv.estado === "anulado") {
          toast("Este inventario está anulado", "warn");
          return;
        }
        capturarInvTomaDraftDesdeDom();
        const seleccionadas = [...document.querySelectorAll(".inv-toma-row")].filter((row) =>
          row.querySelector(".inv-toma-check")?.checked
        );
        if (!seleccionadas.length) {
          toast("Selecciona al menos una línea para actualizar", "warn");
          return;
        }
        if (!inv.detalles) inv.detalles = [];
        let aplicados = 0;
        seleccionadas.forEach((row) => {
          const productoId = row.dataset.productoId;
          const prod = byId(state.productos, productoId);
          if (!prod) return;
          const cantidad = Number(row.querySelector(".inv-toma-cant")?.value || 0);
          const stockRef = Number(row.dataset.stock || 0);
          const unidad = prod.unidad || "";
          const idx = inv.detalles.findIndex((d) => d.productoId === productoId);
          const itemDet = {
            id: idx >= 0 ? inv.detalles[idx].id : uid("DET"),
            productoId,
            cantidad,
            unidad,
            stockReferencia: stockRef
          };
          if (idx >= 0) inv.detalles[idx] = { ...inv.detalles[idx], ...itemDet };
          else inv.detalles.push(itemDet);

          aplicarAjusteStockBodega({
            productoId,
            bodegaId: inv.bodegaId,
            sucursalId: inv.sucursalId,
            sucursal: inv.sucursal,
            fecha: inv.fecha,
            stockActual: stockRef,
            cantidadNueva: cantidad,
            nombreInv: inv.nombre
          });
          aplicados += 1;
          _invTomaDraft[productoId] = { checked: true, cantidad };
        });
        if (inv.estado !== "cerrado") inv.estado = "borrador";
        await saveData();
        toast(`Stock actualizado en ${aplicados} producto${aplicados === 1 ? "" : "s"}`, "success");
        renderInventarios();
      });

      document.getElementById("det-guardar").addEventListener("click", async () => {
        const inv = byId(state.inventarios, editingIds.inventario);
        if (!inv) { toast("No hay un inventario activo", "warn"); return; }
        if (inv.estado === "anulado") {
          toast("Este inventario está anulado", "warn");
          return;
        }
        capturarInvTomaDraftDesdeDom();
        if (!inv.detalles) inv.detalles = [];
        document.querySelectorAll(".inv-toma-row").forEach((row) => {
          const checked = row.querySelector(".inv-toma-check")?.checked;
          const cantidad = Number(row.querySelector(".inv-toma-cant")?.value || 0);
          if (!checked && !(cantidad > 0)) return;
          const productoId = row.dataset.productoId;
          const prod = byId(state.productos, productoId);
          if (!prod) return;
          const idx = inv.detalles.findIndex((d) => d.productoId === productoId);
          const itemDet = {
            id: idx >= 0 ? inv.detalles[idx].id : uid("DET"),
            productoId,
            cantidad,
            unidad: prod.unidad || "",
            stockReferencia: Number(row.dataset.stock || 0)
          };
          if (idx >= 0) inv.detalles[idx] = { ...inv.detalles[idx], ...itemDet };
          else inv.detalles.push(itemDet);
        });
        if (!(inv.detalles || []).length) {
          toast("Marca o ingresa cantidad en al menos un producto antes de guardar", "warn");
          return;
        }
        inv.estado = "cerrado";
        await saveData();
        showCabeceraInventarioForm = false;
        showDetalleInventarioForm = false;
        showVerInventario = false;
        editingIds.detalleInventario = null;
        _invDetalleDraft = { productoId: "", cantidad: 0 };
        _invCabeceraDraft = null;
        _invProductoBusqueda = "";
        _invTomaDraft = {};
        toast("Inventario cerrado y guardado", "success");
        render();
      });

      document.getElementById("inv-salir")?.addEventListener("click", () => {
        capturarInvTomaDraftDesdeDom();
        const hayPendiente = Object.values(_invTomaDraft).some((d) => d.checked || Number(d.cantidad) > 0);
        if (hayPendiente && !confirmar("Hay cantidades o selecciones sin guardar. ¿Salir de todos modos?")) return;
        showCabeceraInventarioForm = false;
        showDetalleInventarioForm = false;
        showVerInventario = false;
        editingIds.detalleInventario = null;
        _invDetalleDraft = { productoId: "", cantidad: 0 };
        _invCabeceraDraft = null;
        _invProductoBusqueda = "";
        _invTomaDraft = {};
        renderInventarios();
      });
    }

    return;
  }

  const inventariosFiltrados = filtrarInventariosLista();
  const invVer = showVerInventario && inventarioActual ? inventarioActual : null;
  const detallesVer = detallesInventarioOrdenados(invVer?.detalles || []);
  const admin = esAdmin();

  el.innerHTML = `
    <div class="card">
      <h3>Filtros</h3>
      <div class="grid inv-lista-filtros">
        <label>Fecha<input type="date" id="f-fecha" value="${_invListaFilter.fecha}" /></label>
        <label>Bodega
          <select id="f-inv-bodega">
            <option value="">Todas</option>
            ${productosOrdenadosPorNombre(state.bodegas).map((b) =>
              `<option value="${b.id}" ${_invListaFilter.bodegaId === b.id ? "selected" : ""}>${b.nombre}</option>`
            ).join("")}
          </select>
        </label>
        <label>Estado
          <select id="f-inv-estado">
            <option value="activos" ${_invListaFilter.estado === "activos" ? "selected" : ""}>Activos (sin anulados)</option>
            <option value="borrador" ${_invListaFilter.estado === "borrador" ? "selected" : ""}>Borrador</option>
            <option value="cerrado" ${_invListaFilter.estado === "cerrado" ? "selected" : ""}>Cerrado</option>
            <option value="anulado" ${_invListaFilter.estado === "anulado" ? "selected" : ""}>Anulado</option>
            <option value="todos" ${_invListaFilter.estado === "todos" ? "selected" : ""}>Todos</option>
          </select>
        </label>
      </div>
    </div>
    <div class="card">
      <h3>Lista de inventarios (${inventariosFiltrados.length}${inventariosFiltrados.length !== state.inventarios.length ? ` de ${state.inventarios.length}` : ""})</h3>
      ${inventariosFiltrados.length === 0
        ? '<p class="empty-state">No hay inventarios que coincidan con los filtros.</p>'
        : `<div class="table-scroll"><table class="inv-lista-table">
        <thead><tr><th>Nombre</th><th>Estado</th><th>Sucursal</th><th>Bodega</th><th>Fecha</th><th>Items</th>${admin ? "<th></th>" : ""}</tr></thead>
        <tbody>
          ${inventariosFiltrados.map((i) => {
            const estado = normalizarEstadoInventario(i);
            const btnAnular = admin && estado !== "anulado"
              ? `<button type="button" class="btn-link btn-inv-anular" data-id="${i.id}" title="Anular inventario">Anular</button>`
              : "";
            return `<tr data-id="${i.id}" class="row-inv" style="cursor:pointer;"><td>${i.nombre}</td><td>${htmlBadgeEstadoInventario(estado)}</td><td>${i.sucursal || ""}</td><td>${byId(state.bodegas, i.bodegaId)?.nombre || ""}</td><td>${i.fecha}</td><td>${i.detalles?.length || 0}</td>${admin ? `<td>${btnAnular}</td>` : ""}</tr>`;
          }).join("")}
        </tbody>
      </table></div>`}
    </div>
    ${invVer ? `
    <div class="inv-modal-overlay" id="inv-modal-overlay">
      <div class="inv-modal card" role="dialog" aria-labelledby="inv-modal-titulo">
        <h2 id="inv-modal-titulo">${invVer.nombre}</h2>
        <fieldset class="inv-modal-fieldset">
          <legend>Datos del Inventario</legend>
          <div class="inv-datos-grid">
            <div><span class="inv-dato-label">Nombre</span><span class="inv-dato-valor">${invVer.nombre}</span></div>
            <div><span class="inv-dato-label">Sucursal</span><span class="inv-dato-valor">${invVer.sucursal || byId(state.sucursales, invVer.sucursalId)?.nombre || "—"}</span></div>
            <div><span class="inv-dato-label">Bodega</span><span class="inv-dato-valor">${byId(state.bodegas, invVer.bodegaId)?.nombre || "—"}</span></div>
            <div><span class="inv-dato-label">Fecha</span><span class="inv-dato-valor">${invVer.fecha || ""}</span></div>
            <div><span class="inv-dato-label">Estado</span><span class="inv-dato-valor">${htmlBadgeEstadoInventario(normalizarEstadoInventario(invVer))}</span></div>
          </div>
        </fieldset>
        <h4 style="margin-top:16px;">Movimientos ingresados</h4>
        ${detallesVer.length === 0
          ? '<p class="empty-state">Sin movimientos ingresados en este inventario.</p>'
          : `<div class="table-scroll"><table class="inv-detalle-table">
              <thead>
                <tr><th>Nombre</th><th>Cantidad</th><th>U. de Med.</th><th>Stock</th></tr>
              </thead>
              <tbody>
                ${detallesVer.map((d) => {
                  const prod = byId(state.productos, d.productoId);
                  const unidad = d.unidad || prod?.unidad || "";
                  return `<tr><td>${prod?.nombre || d.productoId}</td><td>${d.cantidad}</td><td>${unidad}</td><td>${prod ? calcularStockVisible(prod) : "—"}</td></tr>`;
                }).join("")}
              </tbody>
            </table></div>`}
        <div class="actions inv-modal-actions">
          ${normalizarEstadoInventario(invVer) !== "anulado"
            ? '<button type="button" id="inv-ver-editar">Editar</button>'
            : '<span class="small">Inventario anulado (solo lectura)</span>'}
          <button type="button" id="inv-ver-cerrar" class="btn-salir">Salir</button>
        </div>
      </div>
    </div>` : ""}
  `;

  document.querySelectorAll(".row-inv").forEach((r) => r.addEventListener("click", () => {
    const inv = byId(state.inventarios, r.dataset.id);
    if (!inv) return;
    const estado = normalizarEstadoInventario(inv);
    editingIds.inventario = inv.id;
    editingIds.detalleInventario = null;
    _invDetalleDraft = { productoId: "", cantidad: 0 };
    _invCabeceraDraft = null;
    _invProductoBusqueda = "";
    _invTomaDraft = {};

    // Borrador / no cerrado: ir directo a la toma de inventario
    if (estado !== "cerrado" && estado !== "anulado") {
      showVerInventario = false;
      showCabeceraInventarioForm = true;
      showDetalleInventarioForm = true;
      renderInventarios();
      return;
    }

    // Cerrado o anulado: solo vista de datos
    showCabeceraInventarioForm = false;
    showDetalleInventarioForm = false;
    showVerInventario = true;
    renderInventarios();
  }));

  const aplicarFiltroInvLista = () => {
    sincronizarFiltroInvListaDesdeDom();
    renderInventarios();
  };
  ["f-fecha", "f-inv-bodega", "f-inv-estado"].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener("change", aplicarFiltroInvLista);
    if (input.tagName === "INPUT") input.addEventListener("input", aplicarFiltroInvLista);
  });

  document.querySelectorAll(".btn-inv-anular").forEach((btn) => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!esAdmin()) return;
    const inv = byId(state.inventarios, btn.dataset.id);
    if (!inv) return;
    if (normalizarEstadoInventario(inv) === "anulado") return;
    if (!confirmar(`¿Anular el inventario "${inv.nombre}"?\n\nNo se borrará; quedará marcado como anulado y podrás filtrarlo aparte.`)) return;
    inv.estado = "anulado";
    if (editingIds.inventario === inv.id) {
      showCabeceraInventarioForm = false;
      showDetalleInventarioForm = false;
      showVerInventario = false;
      editingIds.inventario = null;
      editingIds.detalleInventario = null;
    }
    await saveData();
    toast("Inventario anulado", "success");
    renderInventarios();
  }));

  document.getElementById("inv-ver-editar")?.addEventListener("click", () => {
    showVerInventario = false;
    showCabeceraInventarioForm = true;
    showDetalleInventarioForm = true;
    editingIds.detalleInventario = null;
    renderInventarios();
  });

  document.getElementById("inv-ver-cerrar")?.addEventListener("click", () => {
    showVerInventario = false;
    editingIds.inventario = null;
    renderInventarios();
  });

  document.getElementById("inv-modal-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "inv-modal-overlay") {
      showVerInventario = false;
      editingIds.inventario = null;
      renderInventarios();
    }
  });
}

function setupExport() {
  const btnExport = document.getElementById("btnExport");
  const exportMenu = document.getElementById("exportMenu");
  btnExport.addEventListener("click", (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!document.getElementById("exportDropdown").contains(e.target)) {
      exportMenu.classList.remove("open");
    }
  });

  document.getElementById("btnExportCsv").addEventListener("click", () => {
    exportMenu.classList.remove("open");
    const rows = [["Tipo", "Id", "Nombre", "Extra1", "Extra2"]];
    state.productos.forEach((p) => rows.push(["Producto", p.id, p.nombre, p.tipo, p.precio]));
    state.familias.forEach((f) => rows.push(["Familia", f.id, f.nombre, "", ""]));
    state.categorias.forEach((c) => rows.push(["Categoria", c.id, c.nombre, "", ""]));
    state.bodegas.forEach((b) => rows.push(["Bodega", b.id, b.nombre, b.sucursal, ""]));
    state.movimientos.forEach((m) => rows.push(["Movimiento", m.id, m.nombre, m.tipo, m.cantidad]));
    const csv = rows.map((r) => r.join(",")).join("\n");
    downloadFile("inventario.csv", "text/csv;charset=utf-8;", csv);
  });

  document.getElementById("btnExportXlsx").addEventListener("click", () => {
    exportMenu.classList.remove("open");
    const wb = XLSX.utils.book_new();
    const wsProd = XLSX.utils.json_to_sheet(state.productos);
    const wsMov = XLSX.utils.json_to_sheet(state.movimientos);
    const wsInv = XLSX.utils.json_to_sheet(state.inventarios);
    XLSX.utils.book_append_sheet(wb, wsProd, "Productos");
    XLSX.utils.book_append_sheet(wb, wsMov, "Movimientos");
    XLSX.utils.book_append_sheet(wb, wsInv, "Inventarios");
    XLSX.writeFile(wb, "inventario.xlsx");
  });
}

function downloadFile(fileName, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

function setupNuevoInventarioTop() {
  document.getElementById("btnNuevoInventarioTop").addEventListener("click", () => {
    editingIds.inventario = null;
    editingIds.detalleInventario = null;
    showVerInventario = false;
    showCabeceraInventarioForm = true;
    showDetalleInventarioForm = false;
    renderInventarios();
  });
}

function setupServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./service-worker.js");
      reg.update?.();
    } catch (err) {
      console.warn("Service worker registro fallido:", err);
    }
  });
}

function setupAuthUI() {
  const screen = document.getElementById("auth-screen");
  const shell = document.getElementById("app-shell");
  const titulo = document.getElementById("auth-title");
  const submit = document.getElementById("auth-submit");
  const toggle = document.getElementById("auth-toggle");
  const fieldsRegister = document.getElementById("auth-fields-register");
  const errorEl = document.getElementById("auth-error");
  const modeLabel = document.getElementById("auth-mode-label");

  modeLabel.textContent = window.SUPABASE_ENABLED
    ? ""
    : "Modo local — los usuarios se guardan en este dispositivo";
  modeLabel.style.display = modeLabel.textContent ? "" : "none";

  let modoRegistro = false;

  function aplicarModo() {
    titulo.textContent = modoRegistro ? "Crear cuenta" : "Iniciar sesión";
    submit.textContent = modoRegistro ? "Registrarme" : "Entrar";
    toggle.textContent = modoRegistro ? "Ya tengo cuenta" : "Crear cuenta";
    fieldsRegister.style.display = modoRegistro ? "block" : "none";
    errorEl.textContent = "";
  }

  toggle.addEventListener("click", () => {
    modoRegistro = !modoRegistro;
    aplicarModo();
  });

  function resetSubmitButton() {
    submit.disabled = false;
    submit.textContent = modoRegistro ? "Registrarme" : "Entrar";
  }

  const form = document.getElementById("auth-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    errorEl.textContent = "";
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    if (!email || !password) {
      errorEl.textContent = "Correo y contraseña son obligatorios.";
      return;
    }
    if (modoRegistro && password.length < 6) {
      errorEl.textContent = "La contraseña debe tener al menos 6 caracteres.";
      return;
    }
    if (modoRegistro) {
      const empresa = document.getElementById("auth-empresa").value.trim();
      if (!empresa) {
        errorEl.textContent = "Indica el nombre de tu empresa.";
        return;
      }
    }

    submit.disabled = true;
    submit.textContent = modoRegistro ? "Registrando..." : "Entrando...";

    const timeoutId = setTimeout(() => {
      console.warn("Auth timeout - resetting button");
      errorEl.textContent = "La operación está tardando demasiado. Verifica tu conexión y vuelve a intentar.";
      resetSubmitButton();
    }, 12000);

    try {
      if (modoRegistro) {
        const nombre = document.getElementById("auth-nombre").value.trim();
        const empresa = document.getElementById("auth-empresa").value.trim();
        await window.Auth.register({ email, password, nombre, empresa });
        toast("Cuenta creada. ¡Bienvenido!", "success");
      } else {
        await window.Auth.login({ email, password });
        toast("Bienvenido de vuelta", "success");
      }
    } catch (e) {
      console.error("Auth error:", e);
      errorEl.textContent = e.message || "Ocurrió un error al autenticar.";
      toast(e.message || "Error de autenticación", "error");
    } finally {
      clearTimeout(timeoutId);
      resetSubmitButton();
    }
  });

  window.Auth.onChange(async (user) => {
    try {
      if (user) {
        screen.style.display = "none";
        shell.style.display = "";
        document.getElementById("userInfo").innerHTML = `${user.nombre || user.email}<br><small>${user.email}</small><span class="role-badge">${etiquetaRol(user.role)}</span>`;
        aplicarPermisosPorRol();
        await window.DataLayer.load(user.tenantId);
        if (window.DataLayer.loadFailed) {
          toast("Carga incompleta de datos. Refresca con Ctrl+Shift+R antes de editar.", "error", 7000);
        } else if (window.DataLayer.loadErrorMessage && !_saveHintShown) {
          _saveHintShown = true;
          toast("No se pudo leer la nube al inicio; puedes crear datos y se intentará guardar.", "warn", 6000);
        }
      } else {
        shell.style.display = "none";
        screen.style.display = "";
      }
    } catch (e) {
      console.error("Error en onChange auth:", e);
      toast("Error cargando datos: " + (e.message || e), "error");
    }
  });

  aplicarModo();
}

function aplicarPermisosPorRol() {
  const admin = esAdmin();
  const soloInv = soloTomaInventario();
  document.querySelectorAll('[data-admin-only="true"]').forEach((el) => {
    el.style.display = admin ? "" : "none";
  });
  document.querySelectorAll('[data-hide-inventario-only="true"]').forEach((el) => {
    el.style.display = soloInv ? "none" : "";
  });
  const exportDrop = document.getElementById("exportDropdown");
  if (exportDrop) exportDrop.style.display = soloInv ? "none" : "";
  if (soloInv) navigateToView("inventarios");
}

function setupUserMenu() {
  const btn = document.getElementById("btnUser");
  const menu = document.getElementById("userMenu");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!document.getElementById("userDropdown").contains(e.target)) {
      menu.classList.remove("open");
    }
  });
  document.getElementById("btnLogout").addEventListener("click", async () => {
    menu.classList.remove("open");
    try {
      if (window.DataLayer && typeof window.DataLayer._cleanup === "function") {
        await window.DataLayer._cleanup();
      }
      await window.Auth.logout();
    } catch (e) {
      console.warn("Error al cerrar sesión:", e);
    }
    window.location.reload();
  });
}

function renderUsuarios() {
  const el = document.getElementById("view-usuarios");
  if (!el) return;
  if (!window.Auth?.isAdmin()) {
    el.innerHTML = `<div class="card"><p>Solo administradores pueden ver esta sección.</p></div>`;
    return;
  }
  if (!window.SUPABASE_ENABLED) {
    const users = JSON.parse(localStorage.getItem("inventario_app_users_v1") || "[]");
    const tenantActual = getTenantId();
    const usuariosTenant = users.filter((u) => u.tenantId === tenantActual);
    el.innerHTML = `
      <div class="card">
        <h2>Usuarios del dispositivo</h2>
        <p class="small">En modo local, los usuarios se guardan en este dispositivo. Para gestionar usuarios entre dispositivos, configura Supabase.</p>
        <table>
          <thead><tr><th>Email</th><th>Nombre</th><th>Rol</th></tr></thead>
          <tbody>
            ${usuariosTenant.map((u) => `<tr><td>${u.email}</td><td>${u.nombre || ""}</td><td>${u.role}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>`;
    return;
  }
  renderUsuariosSupabase(el);
}

async function renderUsuariosSupabase(el) {
  const tenantActual = getTenantId();
  const { supabase } = window.__SB__ || {};
  if (!supabase) return;
  const { data: users } = await supabase
    .from("usuarios")
    .select("id,email,nombre,role,created_at")
    .eq("tenant_id", tenantActual)
    .order("email");

  const appUrl = window.location.origin + window.location.pathname;
  const mensajeInvitacion = `Únete a mi inventario en ${appUrl}\nRegístrate con el nombre de empresa: ${tenantActual}`;

  el.innerHTML = `
    <div class="card">
      <h2>Invitar nuevo usuario</h2>
      <p>Por seguridad de Supabase, los usuarios nuevos deben <strong>registrarse ellos mismos</strong>. Sigue estos pasos:</p>
      <ol style="line-height:1.8;">
        <li>Comparte el enlace de la app y el nombre de tu empresa: <strong>${tenantActual}</strong></li>
        <li>La otra persona entra al enlace y presiona <em>Crear cuenta</em></li>
        <li>Se registra con su correo, contraseña y exactamente ese mismo nombre de empresa</li>
        <li>Una vez registrada, vuelve aquí y asígnale el rol: <em>admin</em>, <em>usuario</em> o <em>solo inventario</em> (solo Toma de Inventario)</li>
      </ol>
      <div class="grid">
        <label>URL de la app<input id="inv-url" value="${appUrl}" readonly /></label>
        <label>Nombre de empresa<input id="inv-tenant" value="${tenantActual}" readonly /></label>
      </div>
      <div class="actions">
        <button id="btn-copiar-invitacion">Copiar invitación al portapapeles</button>
        <button id="btn-abrir-app" class="btn-link">Abrir app en nueva pestaña</button>
      </div>
    </div>

    <div class="card">
      <h2>Usuarios de la empresa (${users?.length || 0})</h2>
      <p class="small">Empresa: <strong>${tenantActual}</strong></p>
      ${(!users || users.length === 0)
        ? '<p class="empty-state">Aún no hay usuarios registrados.</p>'
        : `<table>
            <thead><tr><th>Email</th><th>Nombre</th><th>Registrado</th><th>Rol</th></tr></thead>
            <tbody>
              ${users.map((u) => `
                <tr>
                  <td>${u.email}</td>
                  <td>${u.nombre || ""}</td>
                  <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : ""}</td>
                  <td>
                    ${u.id === window.Auth.currentUser.uid
                      ? '<span class="role-badge">tú · ' + u.role + '</span>'
                      : `<select class="rol-usuario" data-id="${u.id}">
                          <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
                          <option value="usuario" ${u.role === "usuario" ? "selected" : ""}>usuario</option>
                          <option value="inventario" ${u.role === "inventario" ? "selected" : ""}>solo inventario</option>
                        </select>`}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>`}
    </div>`;

  document.getElementById("btn-copiar-invitacion").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(mensajeInvitacion);
      toast("Invitación copiada al portapapeles", "success");
    } catch (e) {
      toast("No se pudo copiar. Copia manualmente desde el campo URL.", "warn");
    }
  });

  document.getElementById("btn-abrir-app").addEventListener("click", (ev) => {
    ev.preventDefault();
    window.open(appUrl, "_blank");
  });

  el.querySelectorAll(".rol-usuario").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const { error } = await supabase.from("usuarios").update({ role: sel.value }).eq("id", sel.dataset.id);
      if (error) {
        toast("No se pudo cambiar el rol: " + error.message, "error");
      } else {
        toast("Rol actualizado", "success");
      }
    });
  });
}

async function boot() {
  setupAuthUI();
  setupNav();
  setupExport();
  setupNuevoInventarioTop();
  setupUserMenu();
  setupProductosUI();
  setupServiceWorker();

  window.DataLayer.setOnChange((nuevoState) => {
    if (_saving || window.DataLayer._writeLock) return;
    const invId = editingIds.inventario;
    const invLocal = invId ? byId(state.inventarios, invId) : null;
    state.productos = Array.isArray(nuevoState.productos) ? nuevoState.productos : [];
    state.familias = Array.isArray(nuevoState.familias) ? nuevoState.familias : [];
    state.categorias = Array.isArray(nuevoState.categorias) ? nuevoState.categorias : [];
    state.sucursales = Array.isArray(nuevoState.sucursales) ? nuevoState.sucursales : [];
    state.bodegas = Array.isArray(nuevoState.bodegas) ? nuevoState.bodegas : [];
    state.movimientos = Array.isArray(nuevoState.movimientos) ? nuevoState.movimientos : [];
    state.inventarios = Array.isArray(nuevoState.inventarios) ? nuevoState.inventarios : [];
    state.recetas = nuevoState.recetas || {};
    normalizarInventariosEstado();
    if (invLocal && _formularioInventarioActivo()) {
      fusionarInventarioEnEdicion(invLocal);
    }
    if (window.Auth?.currentUser) {
      programarRender();
    }
  });

  await window.Auth.init();
}

boot();
