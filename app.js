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

let _suppressNextSave = false;
let _saving = false;

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
    return;
  }
  if (!window.Auth?.currentUser) return;
  const tenantId = getTenantId();
  if (window.SUPABASE_ENABLED) {
    if (_saving) return;
    if (window.DataLayer.loadFailed) {
      toast("La carga inicial falló. Refresca la página antes de guardar para evitar perder datos.", "error", 6000);
      return;
    }
    _saving = true;
    const colecciones = ["productos", "familias", "categorias", "sucursales", "bodegas", "movimientos", "inventarios"];
    try {
      await Promise.all(colecciones.map((c) => window.DataLayer.replaceCollection(tenantId, c, state[c] || [])));
      await window.DataLayer.saveRecetas(tenantId, state.recetas || {});
    } catch (e) {
      console.error("Error guardando datos:", e);
      toast("Error al guardar: " + (e.message || e), "error", 5000);
    } finally {
      _saving = false;
    }
  } else {
    window.DataLayer._state = state;
    window.DataLayer._saveLocal(tenantId);
  }
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}

function byId(arr, id) {
  return arr.find((x) => x.id === id);
}

function stockBaseProducto(productoId) {
  let total = 0;
  for (const mov of state.movimientos) {
    if (mov.productoId !== productoId) continue;
    if (mov.tipo === "Ingreso") total += Number(mov.cantidadBase);
    if (mov.tipo === "Egreso") total -= Number(mov.cantidadBase);
  }
  return total;
}

function calcularStockVisible(producto) {
  const base = stockBaseProducto(producto.id);
  if (producto.tipo === "Normal") return `${base} unidad(es)`;
  return `${base} gr`;
}

function render() {
  renderDashboard();
  renderProductos();
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

function setupNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".view").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`view-${btn.dataset.view}`).classList.add("active");
      actualizarBotonNuevoInventario();
    });
  });
}

let _charts = {};

function renderDashboard() {
  const el = document.getElementById("view-dashboard");
  if (!el) return;

  const totalProductos = state.productos.length;
  const totalMovimientos = state.movimientos.length;
  const totalInventarios = state.inventarios.length;
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
      <div class="kpi-card"><div class="kpi-label">Productos</div><div class="kpi-value">${totalProductos}</div></div>
      <div class="kpi-card"><div class="kpi-label">Stock bajo (≤5)</div><div class="kpi-value" style="color:${stockBajo > 0 ? "#b91c1c" : "#16a34a"}">${stockBajo}</div></div>
      <div class="kpi-card"><div class="kpi-label">Valor estimado</div><div class="kpi-value">$${valorTotal.toFixed(2)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Movimientos</div><div class="kpi-value">${totalMovimientos}</div></div>
      <div class="kpi-card"><div class="kpi-label">Ingresos (cant.)</div><div class="kpi-value" style="color:#16a34a">${ingresos}</div></div>
      <div class="kpi-card"><div class="kpi-label">Egresos (cant.)</div><div class="kpi-value" style="color:#b91c1c">${egresos}</div></div>
      <div class="kpi-card"><div class="kpi-label">Tomas de inventario</div><div class="kpi-value">${totalInventarios}</div></div>
      <div class="kpi-card"><div class="kpi-label">Bodegas</div><div class="kpi-value">${totalBodegas}</div></div>
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
        <thead><tr><th>Fecha</th><th>Nombre</th><th>Tipo</th><th>Producto</th><th>Cantidad</th></tr></thead>
        <tbody>
          ${ultimos.map((m) => `<tr><td>${m.fecha || ""}</td><td>${m.nombre || ""}</td><td>${m.tipo || ""}</td><td>${byId(state.productos, m.productoId)?.nombre || ""}</td><td>${m.cantidad}</td></tr>`).join("")}
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

function renderProductos() {
  const el = document.getElementById("view-productos");
  const familiasOpts = state.familias.map((f) => `<option value="${f.id}">${f.nombre}</option>`).join("");
  const categoriasOpts = state.categorias.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join("");
  const data = editingIds.producto ? byId(state.productos, editingIds.producto) : {};
  const soloLectura = !puedeEditarCatalogos();
  const dis = soloLectura ? "disabled" : "";

  el.innerHTML = `
    ${soloLectura ? '<div class="read-only-banner">Modo solo lectura: tu rol es <strong>usuario</strong>. Solo administradores pueden modificar productos.</div>' : ""}
    <div class="card">
      <h2>Producto</h2>
      <div class="grid">
        <label>Id<input id="prod-id" value="${data?.id || uid("PROD")}" /></label>
        <label>Nombre<input id="prod-nombre" value="${data?.nombre || ""}" /></label>
        <label>Precio<input type="number" id="prod-precio" value="${data?.precio ?? 0}" /></label>
        <label>Cantidad<input type="number" id="prod-cantidad" value="${data?.cantidad ?? 0}" /></label>
        <label>Unidad de medida
          <select id="prod-um">
            ${["Unidad", "Gramo", "Kilo", "Litro", "Mililitro"].map((u) => `<option ${data?.unidad === u ? "selected" : ""}>${u}</option>`).join("")}
          </select>
        </label>
        <label>Tipo de Producto
          <select id="prod-tipo">
            <option ${data?.tipo === "Procesado" ? "selected" : ""}>Procesado</option>
            <option ${data?.tipo !== "Procesado" ? "selected" : ""}>Normal</option>
          </select>
        </label>
        <label>Familia
          <select id="prod-familia"><option value="">--</option>${familiasOpts}</select>
        </label>
        <label>Categoría
          <select id="prod-categoria"><option value="">--</option>${categoriasOpts}</select>
        </label>
      </div>
      <div class="actions">
        <button id="prod-guardar" ${dis}>Guardar</button>
        <button id="prod-editar" ${dis}>Editar</button>
        <button id="prod-eliminar" ${dis}>Eliminar</button>
      </div>
      <p class="small">Para productos procesados, la cantidad base se maneja en gramos.</p>
    </div>
    <div class="card">
      <h3>Receta de producto procesado</h3>
      <div class="grid">
        <label>Producto Procesado
          <select id="receta-procesado">
            <option value="">Seleccionar</option>
            ${state.productos.filter((p) => p.tipo === "Procesado").map((p) => `<option value="${p.id}">${p.nombre}</option>`).join("")}
          </select>
        </label>
        <label>Producto Normal
          <select id="receta-normal">
            <option value="">Seleccionar</option>
            ${state.productos.filter((p) => p.tipo === "Normal").map((p) => `<option value="${p.id}">${p.nombre}</option>`).join("")}
          </select>
        </label>
        <label>Cantidad base por unidad procesada (gramos/unidades)
          <input type="number" id="receta-cantidad" value="0"/>
        </label>
      </div>
      <div class="actions">
        <button id="receta-agregar" ${dis}>Agregar composición</button>
      </div>
      <table>
        <thead><tr><th>Producto procesado</th><th>Insumo normal</th><th>Cantidad</th></tr></thead>
        <tbody>
          ${Object.entries(state.recetas).flatMap(([procId, items]) => items.map((it) => {
            const proc = byId(state.productos, procId);
            const normal = byId(state.productos, it.normalId);
            return `<tr><td>${proc?.nombre || procId}</td><td>${normal?.nombre || it.normalId}</td><td>${it.cantidad}</td></tr>`;
          })).join("")}
        </tbody>
      </table>
    </div>
    <div class="card">
      <h3>Lista de productos</h3>
      <table>
        <thead><tr><th>Id</th><th>Nombre</th><th>Precio</th><th>Tipo</th><th>Familia</th><th>Categoría</th><th>Stock</th></tr></thead>
        <tbody>
          ${state.productos.map((p) => `<tr data-id="${p.id}" class="row-producto"><td>${p.id}</td><td>${p.nombre}</td><td>${p.precio}</td><td>${p.tipo}</td><td>${byId(state.familias, p.familiaId)?.nombre || ""}</td><td>${byId(state.categorias, p.categoriaId)?.nombre || ""}</td><td>${calcularStockVisible(p)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById("prod-familia").value = data?.familiaId || "";
  document.getElementById("prod-categoria").value = data?.categoriaId || "";

  document.querySelectorAll(".row-producto").forEach((r) => {
    r.addEventListener("click", () => {
      editingIds.producto = r.dataset.id;
      renderProductos();
    });
  });

  document.getElementById("prod-guardar").addEventListener("click", () => {
    const item = {
      id: document.getElementById("prod-id").value.trim(),
      nombre: document.getElementById("prod-nombre").value.trim(),
      precio: Number(document.getElementById("prod-precio").value || 0),
      cantidad: Number(document.getElementById("prod-cantidad").value || 0),
      unidad: document.getElementById("prod-um").value,
      tipo: document.getElementById("prod-tipo").value,
      familiaId: document.getElementById("prod-familia").value,
      categoriaId: document.getElementById("prod-categoria").value
    };
    if (!item.id || !item.nombre) { toast("Id y nombre son obligatorios", "warn"); return; }
    const i = state.productos.findIndex((x) => x.id === item.id);
    const editaba = i >= 0;
    if (editaba) state.productos[i] = item;
    else state.productos.push(item);
    editingIds.producto = null;
    toast(editaba ? "Producto actualizado" : "Producto creado", "success");
    render();
  });

  document.getElementById("prod-editar").addEventListener("click", () => {
    const id = document.getElementById("prod-id").value.trim();
    editingIds.producto = id;
    renderProductos();
  });

  document.getElementById("prod-eliminar").addEventListener("click", () => {
    const id = document.getElementById("prod-id").value.trim();
    if (!confirmar("¿Eliminar este producto?")) return;
    state.productos = state.productos.filter((x) => x.id !== id);
    delete state.recetas[id];
    Object.keys(state.recetas).forEach((k) => {
      state.recetas[k] = state.recetas[k].filter((x) => x.normalId !== id);
    });
    editingIds.producto = null;
    toast("Producto eliminado", "success");
    render();
  });

  document.getElementById("receta-agregar").addEventListener("click", () => {
    const procId = document.getElementById("receta-procesado").value;
    const normalId = document.getElementById("receta-normal").value;
    const cantidad = Number(document.getElementById("receta-cantidad").value || 0);
    if (!procId || !normalId || cantidad <= 0) { toast("Completa la composición", "warn"); return; }
    if (!state.recetas[procId]) state.recetas[procId] = [];
    state.recetas[procId].push({ normalId, cantidad });
    toast("Composición agregada", "success");
    render();
  });
}

function simpleCrudView(containerId, title, keyName, editingKey) {
  const el = document.getElementById(containerId);
  const list = state[keyName];
  const data = editingIds[editingKey] ? byId(list, editingIds[editingKey]) : {};
  const soloLectura = !puedeEditarCatalogos();
  const dis = soloLectura ? "disabled" : "";
  el.innerHTML = `
    ${soloLectura ? '<div class="read-only-banner">Modo solo lectura: tu rol es <strong>usuario</strong>.</div>' : ""}
    <div class="card">
      <h2>${title}</h2>
      <div class="grid">
        <label>Id<input id="${editingKey}-id" value="${data?.id || uid(title.slice(0, 3).toUpperCase())}" ${dis} /></label>
        <label>Nombre<input id="${editingKey}-nombre" value="${data?.nombre || ""}" ${dis} /></label>
      </div>
      <div class="actions">
        <button id="${editingKey}-guardar" ${dis}>Guardar</button>
        <button id="${editingKey}-editar" ${dis}>Editar</button>
        <button id="${editingKey}-eliminar" ${dis}>Eliminar</button>
      </div>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Id</th><th>Nombre</th></tr></thead>
        <tbody>
          ${list.map((x) => `<tr class="row-${editingKey}" data-id="${x.id}"><td>${x.id}</td><td>${x.nombre}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  document.querySelectorAll(`.row-${editingKey}`).forEach((r) => {
    r.addEventListener("click", () => {
      editingIds[editingKey] = r.dataset.id;
      simpleCrudView(containerId, title, keyName, editingKey);
    });
  });

  document.getElementById(`${editingKey}-guardar`).addEventListener("click", () => {
    const item = {
      id: document.getElementById(`${editingKey}-id`).value.trim(),
      nombre: document.getElementById(`${editingKey}-nombre`).value.trim()
    };
    if (!item.id || !item.nombre) { toast("Id y nombre son obligatorios", "warn"); return; }
    const i = list.findIndex((x) => x.id === item.id);
    const editaba = i >= 0;
    if (editaba) list[i] = item;
    else list.push(item);
    editingIds[editingKey] = null;
    toast(`${title.replace(/s$/, "")} ${editaba ? "actualizada" : "creada"}`, "success");
    render();
  });

  document.getElementById(`${editingKey}-editar`).addEventListener("click", () => {
    editingIds[editingKey] = document.getElementById(`${editingKey}-id`).value.trim();
    simpleCrudView(containerId, title, keyName, editingKey);
  });

  document.getElementById(`${editingKey}-eliminar`).addEventListener("click", () => {
    if (!confirmar(`¿Eliminar este registro?`)) return;
    const id = document.getElementById(`${editingKey}-id`).value.trim();
    state[keyName] = state[keyName].filter((x) => x.id !== id);
    editingIds[editingKey] = null;
    toast("Eliminado", "success");
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
  const receta = state.recetas[prod.id] || [];
  receta.forEach((insumo) => {
    state.movimientos.push({
      id: uid("AUTO-EG"),
      fecha: mov.fecha,
      nombre: `Consumo por ${prod.nombre}`,
      tipo: "Egreso",
      sucursal: mov.sucursal,
      bodegaId: mov.bodegaId,
      productoId: insumo.normalId,
      cantidad: insumo.cantidad * Number(mov.cantidad),
      cantidadBase: insumo.cantidad * Number(mov.cantidad),
      auto: true
    });
  });
}

let _movFilter = { fechaDesde: "", fechaHasta: "", tipo: "", productoId: "", nombre: "" };

function aplicarFiltroMovimientos(lista) {
  return lista.filter((m) => {
    if (_movFilter.fechaDesde && m.fecha < _movFilter.fechaDesde) return false;
    if (_movFilter.fechaHasta && m.fecha > _movFilter.fechaHasta) return false;
    if (_movFilter.tipo && m.tipo !== _movFilter.tipo) return false;
    if (_movFilter.productoId && m.productoId !== _movFilter.productoId) return false;
    if (_movFilter.nombre && !(m.nombre || "").toLowerCase().includes(_movFilter.nombre.toLowerCase())) return false;
    return true;
  });
}

function renderMovimientos() {
  const el = document.getElementById("view-movimientos");
  const data = editingIds.movimiento ? byId(state.movimientos, editingIds.movimiento) : {};
  const movimientosFiltrados = aplicarFiltroMovimientos(state.movimientos);
  el.innerHTML = `
    <div class="card">
      <h2>Movimientos de Mercaderías</h2>
      <div class="grid">
        <label>Id<input id="mov-id" value="${data?.id || uid("MOV")}" /></label>
        <label>Fecha<input type="date" id="mov-fecha" value="${data?.fecha || new Date().toISOString().slice(0, 10)}" /></label>
        <label>Nombre<input id="mov-nombre" value="${data?.nombre || ""}" /></label>
        <label>Tipo de Movimiento
          <select id="mov-tipo">
            ${["Ingreso", "Egreso", "Traspaso"].map((x) => `<option ${data?.tipo === x ? "selected" : ""}>${x}</option>`).join("")}
          </select>
        </label>
        <label>Sucursal<input id="mov-sucursal" value="${data?.sucursal || ""}" /></label>
        <label>Bodega
          <select id="mov-bodega">
            <option value="">--</option>
            ${state.bodegas.map((b) => `<option value="${b.id}" ${data?.bodegaId === b.id ? "selected" : ""}>${b.nombre}</option>`).join("")}
          </select>
        </label>
        <label>Producto
          <select id="mov-producto">
            <option value="">--</option>
            ${state.productos.map((p) => `<option value="${p.id}" ${data?.productoId === p.id ? "selected" : ""}>${p.nombre}</option>`).join("")}
          </select>
        </label>
        <label>Cantidad<input type="number" id="mov-cantidad" value="${data?.cantidad ?? 0}" /></label>
      </div>
      <div class="actions">
        <button id="mov-guardar">Guardar</button>
        <button id="mov-editar">Editar</button>
        <button id="mov-eliminar">Eliminar</button>
      </div>
    </div>
    <div class="card">
      <h3>Filtros</h3>
      <div class="grid">
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
        <label>Nombre<input id="filt-mov-nombre" value="${_movFilter.nombre}" placeholder="Buscar por nombre" /></label>
      </div>
      <div class="actions">
        <button id="filt-mov-aplicar">Aplicar</button>
        <button id="filt-mov-limpiar">Limpiar</button>
      </div>
    </div>

    <div class="card">
      <h3>Movimientos (${movimientosFiltrados.length}${movimientosFiltrados.length !== state.movimientos.length ? ` de ${state.movimientos.length}` : ""})</h3>
      ${movimientosFiltrados.length === 0 ? '<p class="empty-state">No hay movimientos que coincidan con los filtros.</p>' : `
      <table>
        <thead><tr><th>Id</th><th>Fecha</th><th>Nombre</th><th>Tipo</th><th>Sucursal</th><th>Producto</th><th>Cantidad</th></tr></thead>
        <tbody>
          ${movimientosFiltrados.map((m) => `<tr data-id="${m.id}" class="row-mov" style="cursor:pointer;"><td>${m.id}</td><td>${m.fecha}</td><td>${m.nombre}</td><td>${m.tipo}</td><td>${m.sucursal}</td><td>${byId(state.productos, m.productoId)?.nombre || ""}</td><td>${m.cantidad}</td></tr>`).join("")}
        </tbody>
      </table>`}
    </div>
  `;

  document.getElementById("filt-mov-aplicar").addEventListener("click", () => {
    _movFilter = {
      fechaDesde: document.getElementById("filt-mov-desde").value,
      fechaHasta: document.getElementById("filt-mov-hasta").value,
      tipo: document.getElementById("filt-mov-tipo").value,
      productoId: document.getElementById("filt-mov-producto").value,
      nombre: document.getElementById("filt-mov-nombre").value.trim()
    };
    renderMovimientos();
  });

  document.getElementById("filt-mov-limpiar").addEventListener("click", () => {
    _movFilter = { fechaDesde: "", fechaHasta: "", tipo: "", productoId: "", nombre: "" };
    renderMovimientos();
  });

  document.querySelectorAll(".row-mov").forEach((r) => r.addEventListener("click", () => {
    editingIds.movimiento = r.dataset.id;
    renderMovimientos();
  }));

  document.getElementById("mov-guardar").addEventListener("click", () => {
    const productoId = document.getElementById("mov-producto").value;
    const prod = byId(state.productos, productoId);
    if (!prod) { toast("Selecciona un producto", "warn"); return; }
    const cantidad = Number(document.getElementById("mov-cantidad").value || 0);
    const cantidadBase = prod.tipo === "Normal" ? cantidad : cantidad;
    const mov = {
      id: document.getElementById("mov-id").value.trim(),
      fecha: document.getElementById("mov-fecha").value,
      nombre: document.getElementById("mov-nombre").value.trim(),
      tipo: document.getElementById("mov-tipo").value,
      sucursal: document.getElementById("mov-sucursal").value.trim(),
      bodegaId: document.getElementById("mov-bodega").value,
      productoId,
      cantidad,
      cantidadBase
    };
    if (!mov.id || !mov.fecha || !mov.nombre) { toast("Completa datos obligatorios", "warn"); return; }
    const i = state.movimientos.findIndex((x) => x.id === mov.id);
    const editaba = i >= 0;
    if (editaba) state.movimientos[i] = mov;
    else {
      state.movimientos.push(mov);
      aplicarMovimiento(mov);
    }
    editingIds.movimiento = null;
    toast(`Movimiento ${editaba ? "actualizado" : "creado"}`, "success");
    render();
  });
  document.getElementById("mov-editar").addEventListener("click", () => {
    editingIds.movimiento = document.getElementById("mov-id").value.trim();
    renderMovimientos();
  });
  document.getElementById("mov-eliminar").addEventListener("click", () => {
    if (!confirmar("¿Eliminar este movimiento?")) return;
    const id = document.getElementById("mov-id").value.trim();
    state.movimientos = state.movimientos.filter((x) => x.id !== id);
    editingIds.movimiento = null;
    toast("Movimiento eliminado", "success");
    render();
  });
}

function renderInventarios() {
  const el = document.getElementById("view-inventarios");
  const data = editingIds.inventario ? byId(state.inventarios, editingIds.inventario) : {};
  const movimientos = filtrarMovimientosInventario();
  const inventarioActual = editingIds.inventario ? byId(state.inventarios, editingIds.inventario) : null;
  const detalles = inventarioActual?.detalles || [];
  const unidadesMedida = ["Unidad", "Gramo", "Kilo", "Litro", "Mililitro"];
  const enModoCreacion = showCabeceraInventarioForm || showDetalleInventarioForm;
  const cabeceraFija = showDetalleInventarioForm && editingIds.inventario;
  const detalleEditando = editingIds.detalleInventario
    ? detalles.find((d) => d.id === editingIds.detalleInventario)
    : null;
  const iconEditar = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm14.71-9.96l-3-3 2-2c.39-.39 1.02-.39 1.41 0l2.59 2.59c.39.39.39 1.02 0 1.41l-2 2-1-1z"/></svg>`;
  const iconEliminar = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;

  if (enModoCreacion) {
    el.innerHTML = `
      <div class="card">
        <fieldset style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
          <legend>Datos del Inventario</legend>
          <div class="grid">
            <label>Id<input id="inv-id" value="${data?.id || uid("INV")}" ${cabeceraFija ? "disabled" : ""} /></label>
            <label>Nombre<input id="inv-nombre" value="${data?.nombre || ""}" ${cabeceraFija ? "disabled" : ""} /></label>
            <label>Sucursal<input id="inv-sucursal" value="${data?.sucursal || ""}" ${cabeceraFija ? "disabled" : ""} /></label>
            <label>Bodega
              <select id="inv-bodega" ${cabeceraFija ? "disabled" : ""}>
                <option value="">--</option>
                ${state.bodegas.map((b) => `<option value="${b.id}" ${data?.bodegaId === b.id ? "selected" : ""}>${b.nombre}</option>`).join("")}
              </select>
            </label>
            <label>Fecha<input type="date" id="inv-fecha" value="${data?.fecha || new Date().toISOString().slice(0, 10)}" ${cabeceraFija ? "disabled" : ""} /></label>
          </div>
          ${!cabeceraFija ? `
          <div class="actions">
            <button id="inv-guardar">Guardar</button>
          </div>` : ""}
        </fieldset>
      </div>

      ${showDetalleInventarioForm ? `
      <div class="card">
        <fieldset style="border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
          <legend>Productos del Inventario</legend>
          <div class="grid">
            <label>Nombre
              <select id="det-prod">
                <option value="">--</option>
                ${state.productos.map((p) => `<option value="${p.id}" ${detalleEditando?.productoId === p.id ? "selected" : ""}>${p.nombre}</option>`).join("")}
              </select>
            </label>
            <label>Cantidad<input type="number" id="det-cantidad" value="${detalleEditando?.cantidad ?? 0}" /></label>
            <label>Unidad de Medida
              <select id="det-um">
                <option value="">--</option>
                ${unidadesMedida.map((u) => `<option ${detalleEditando?.unidad === u ? "selected" : ""}>${u}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="actions">
            <button id="det-agregar">${detalleEditando ? "Actualizar" : "Agregar"}</button>
            <button id="det-guardar">Guardar</button>
          </div>
        </fieldset>
        <h4 style="margin-top:14px;">Movimientos ingresados</h4>
        <table>
          <thead>
            <tr><th>Nombre</th><th>Cantidad</th><th>Unidad de Medida</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            ${detalles.length
              ? detalles.map((d) => {
                  const prod = byId(state.productos, d.productoId);
                  return `<tr><td>${prod?.nombre || d.productoId}</td><td>${d.cantidad}</td><td>${d.unidad || ""}</td><td><button class="btn-icon btn-det-editar" data-id="${d.id}" title="Editar">${iconEditar}</button><button class="btn-icon danger btn-det-eliminar" data-id="${d.id}" title="Eliminar">${iconEliminar}</button></td></tr>`;
                }).join("")
              : `<tr><td colspan="4" class="small">Sin movimientos ingresados.</td></tr>`}
          </tbody>
        </table>
      </div>` : ""}
    `;

    if (showCabeceraInventarioForm && !cabeceraFija) {
      document.getElementById("inv-guardar").addEventListener("click", () => {
        const item = {
          id: document.getElementById("inv-id").value.trim(),
          nombre: document.getElementById("inv-nombre").value.trim(),
          sucursal: document.getElementById("inv-sucursal").value.trim(),
          bodegaId: document.getElementById("inv-bodega").value,
          fecha: document.getElementById("inv-fecha").value,
          detalles: data?.detalles || []
        };
        if (!item.id || !item.nombre) { toast("Id y nombre son obligatorios", "warn"); return; }
        const i = state.inventarios.findIndex((x) => x.id === item.id);
        if (i >= 0) state.inventarios[i] = item;
        else state.inventarios.push(item);
        editingIds.inventario = item.id;
        showDetalleInventarioForm = true;
        saveData();
        toast("Cabecera guardada. Ahora agrega productos.", "success");
        renderInventarios();
      });
    }

    if (showDetalleInventarioForm) {
      const agregarProducto = () => {
        if (!editingIds.inventario) { toast("No hay un inventario activo", "warn"); return; }
        const inv = byId(state.inventarios, editingIds.inventario);
        if (!inv) return;
        const productoId = document.getElementById("det-prod").value;
        const cantidad = Number(document.getElementById("det-cantidad").value || 0);
        const unidad = document.getElementById("det-um").value.trim();
        if (!productoId) { toast("Selecciona producto", "warn"); return; }
        if (!inv.detalles) inv.detalles = [];
        if (editingIds.detalleInventario) {
          const idx = inv.detalles.findIndex((d) => d.id === editingIds.detalleInventario);
          if (idx >= 0) inv.detalles[idx] = { ...inv.detalles[idx], productoId, cantidad, unidad };
          editingIds.detalleInventario = null;
        } else {
          inv.detalles.push({ id: uid("DET"), productoId, cantidad, unidad });
        }
        saveData();
        renderInventarios();
      };

      document.getElementById("det-agregar").addEventListener("click", agregarProducto);

      document.getElementById("det-guardar").addEventListener("click", () => {
        const productoId = document.getElementById("det-prod").value;
        if (productoId) agregarProducto();
        showCabeceraInventarioForm = false;
        showDetalleInventarioForm = false;
        editingIds.detalleInventario = null;
        render();
      });

      document.querySelectorAll(".btn-det-editar").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation();
        editingIds.detalleInventario = b.dataset.id;
        renderInventarios();
      }));

      document.querySelectorAll(".btn-det-eliminar").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation();
        const inv = byId(state.inventarios, editingIds.inventario);
        if (!inv) return;
        inv.detalles = (inv.detalles || []).filter((d) => d.id !== b.dataset.id);
        if (editingIds.detalleInventario === b.dataset.id) editingIds.detalleInventario = null;
        render();
      }));
    }
    return;
  }

  el.innerHTML = `
    <div class="card">
      <h3>Filtros</h3>
      <div class="grid">
        <label>Fecha<input type="date" id="f-fecha"/></label>
        <label>Nombre Inventario<input id="f-inv"/></label>
        <label>Nombre Producto<input id="f-prod"/></label>
        <label>Periodo
          <select id="f-periodo">
            <option>Día</option><option>Mes</option><option>Año</option><option>Personalizado</option>
          </select>
        </label>
      </div>
      <div class="actions"><button id="aplicar-filtro">Aplicar filtros</button></div>
    </div>
    <div class="card">
      <h3>Lista de inventarios</h3>
      <table>
        <thead><tr><th>Id</th><th>Nombre</th><th>Sucursal</th><th>Bodega</th><th>Fecha</th><th>Items</th></tr></thead>
        <tbody>
          ${state.inventarios.map((i) => `<tr data-id="${i.id}" class="row-inv" style="cursor:pointer;"><td>${i.id}</td><td>${i.nombre}</td><td>${i.sucursal || ""}</td><td>${byId(state.bodegas, i.bodegaId)?.nombre || ""}</td><td>${i.fecha}</td><td>${i.detalles?.length || 0}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="card">
      <h3>Lista de movimientos</h3>
      <table>
        <thead><tr><th>Fecha</th><th>Nombre</th><th>Tipo</th><th>Sucursal</th><th>Cantidad</th></tr></thead>
        <tbody>
          ${movimientos.map((m) => `<tr><td>${m.fecha}</td><td>${m.nombre}</td><td>${m.tipo}</td><td>${m.sucursal}</td><td>${m.cantidad}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  document.querySelectorAll(".row-inv").forEach((r) => r.addEventListener("click", () => {
    editingIds.inventario = r.dataset.id;
    editingIds.detalleInventario = null;
    showCabeceraInventarioForm = true;
    showDetalleInventarioForm = true;
    renderInventarios();
  }));

  document.getElementById("aplicar-filtro").addEventListener("click", () => {
    renderInventarios();
  });
}

function filtrarMovimientosInventario() {
  const fecha = document.getElementById("f-fecha")?.value || "";
  const nombreInv = (document.getElementById("f-inv")?.value || "").toLowerCase();
  const nombreProd = (document.getElementById("f-prod")?.value || "").toLowerCase();
  const inv = editingIds.inventario ? byId(state.inventarios, editingIds.inventario) : null;
  const invNombre = (inv?.nombre || "").toLowerCase();
  return state.movimientos.filter((m) => {
    const prod = byId(state.productos, m.productoId);
    const okFecha = !fecha || m.fecha === fecha;
    const okInv = !nombreInv || invNombre.includes(nombreInv);
    const okProd = !nombreProd || (prod?.nombre || "").toLowerCase().includes(nombreProd);
    return okFecha && okInv && okProd;
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
    showCabeceraInventarioForm = true;
    showDetalleInventarioForm = false;
    renderInventarios();
  });
}

function setupServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./service-worker.js")
        .catch((err) => console.warn("Service worker registro fallido:", err));
    });
  }
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
    ? "Modo multiusuario (Supabase) — sesión sincronizada en la nube"
    : "Modo local — los usuarios se guardan en este dispositivo";

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
        document.getElementById("userInfo").innerHTML = `${user.nombre || user.email}<br><small>${user.email}</small><span class="role-badge">${user.role}</span>`;
        aplicarVisibilidadAdmin();
        await window.DataLayer.load(user.tenantId);
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

function aplicarVisibilidadAdmin() {
  const esAdmin = window.Auth?.isAdmin();
  document.querySelectorAll('[data-admin-only="true"]').forEach((el) => {
    el.style.display = esAdmin ? "" : "none";
  });
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
        <li>Una vez registrada, vuelve aquí y cámbiale el rol (por defecto queda como <em>admin</em>)</li>
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
  setupServiceWorker();

  window.DataLayer.setOnChange((nuevoState) => {
    state.productos = nuevoState.productos;
    state.familias = nuevoState.familias;
    state.categorias = nuevoState.categorias;
    state.sucursales = nuevoState.sucursales;
    state.bodegas = nuevoState.bodegas;
    state.movimientos = nuevoState.movimientos;
    state.inventarios = nuevoState.inventarios;
    state.recetas = nuevoState.recetas || {};
    if (window.Auth?.currentUser) {
      _suppressNextSave = true;
      render();
    }
  });

  await window.Auth.init();
}

boot();
