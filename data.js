// Capa de datos. Usa Supabase (multiusuario por tenant) o localStorage (modo local).

const LOCAL_DATA_PREFIX = "inventario_app_data_v2_";
const COLLECTIONS = ["productos", "familias", "categorias", "sucursales", "bodegas", "movimientos", "inventarios"];

const DataLayer = {
  _state: null,
  _channels: [],
  _onChange: null,
  _tenantId: null,
  loadFailed: false,
  loadErrorMessage: "",
  _writeLock: false,

  _emptyState() {
    return {
      productos: [],
      familias: [],
      categorias: [],
      sucursales: [],
      bodegas: [],
      movimientos: [],
      inventarios: [],
      recetas: {}
    };
  },

  getState() {
    return this._state || this._emptyState();
  },

  setOnChange(cb) {
    this._onChange = cb;
  },

  _emit() {
    if (this._writeLock) return;
    if (this._onChange) this._onChange(this.getState());
  },

  _localKey(tenantId) {
    return LOCAL_DATA_PREFIX + (tenantId || "default");
  },

  async load(tenantId) {
    await this._cleanup();
    this._tenantId = tenantId;
    if (window.SUPABASE_ENABLED) {
      await this._loadSupabase(tenantId);
    } else {
      this._loadLocal(tenantId);
    }
  },

  async _cleanup() {
    if (window.SUPABASE_ENABLED && window.__SB__) {
      const { supabase } = window.__SB__;
      try {
        await Promise.race([
          Promise.resolve(supabase.removeAllChannels()).catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 2000))
        ]);
      } catch (e) {
        console.warn("Error limpiando canales:", e);
      }
    }
    this._channels = [];
  },

  _loadLocal(tenantId) {
    const raw = localStorage.getItem(this._localKey(tenantId));
    if (raw) {
      const parsed = JSON.parse(raw);
      const empty = this._emptyState();
      this._state = { ...empty, ...parsed };
    } else {
      this._state = this._emptyState();
    }
    this.loadFailed = false;
    this.loadErrorMessage = "";
    this._emit();
  },

  _saveLocal(tenantId) {
    localStorage.setItem(this._localKey(tenantId), JSON.stringify(this._state));
  },

  async _loadSupabase(tenantId) {
    const { supabase } = window.__SB__;
    this._state = this._emptyState();
    this.loadFailed = false;
    this.loadErrorMessage = "";

    const timeoutQuery = (p, ms = 15000) =>
      Promise.race([
        p,
        new Promise((resolve) => setTimeout(() => resolve({ data: null, error: { message: "timeout" } }), ms))
      ]);

    const cargarTodo = async () => {
      const errores = [];
      let colOk = 0;
      let colErr = 0;

      const tareasColecciones = COLLECTIONS.map((col) =>
        timeoutQuery(supabase.from(col).select("id,data").eq("tenant_id", tenantId)).then(({ data, error }) => {
          if (!error && data) {
            this._state[col] = data.map((r) => ({ id: r.id, ...(r.data || {}) }));
            colOk += 1;
          } else if (error) {
            console.warn(`Error cargando ${col}:`, error.message);
            errores.push(`${col}: ${error.message}`);
            colErr += 1;
          }
        })
      );

      const tareaRecetas = timeoutQuery(
        supabase.from("config").select("data").eq("tenant_id", tenantId).eq("key", "recetas").maybeSingle()
      ).then(({ data, error }) => {
        if (!error) {
          this._state.recetas = data?.data || {};
        } else if (error) {
          errores.push(`config: ${error.message}`);
        }
      });

      await Promise.all([...tareasColecciones, tareaRecetas]);
      return { errores, colOk, colErr };
    };

    let { errores, colOk, colErr } = await cargarTodo();

    // Reintento único si ninguna colección cargó (p. ej. cold start de Supabase free)
    if (colOk === 0 && errores.length) {
      console.warn("Carga inicial falló, reintentando...", errores);
      await new Promise((r) => setTimeout(r, 1200));
      ({ errores, colOk, colErr } = await cargarTodo());
    }

    // Solo bloquear guardado si la carga de colecciones fue PARCIAL
    if (colOk > 0 && colErr > 0) {
      this.loadFailed = true;
      this.loadErrorMessage = errores.join("; ");
      console.error("Carga parcial; bloqueando guardado para no perder datos:", errores);
    } else if (colOk === 0 && errores.length) {
      this.loadFailed = false;
      this.loadErrorMessage = errores.join("; ");
      console.warn("No se pudo cargar datos remotos; se inicia vacío:", errores);
    } else {
      this.loadFailed = false;
      this.loadErrorMessage = "";
    }

    this._emit();
    this._subscribeRealtime(tenantId);
  },

  _subscribeRealtime(tenantId) {
    if (!window.SUPABASE_ENABLED || !window.__SB__) return;
    const { supabase } = window.__SB__;
    const sufijo = Math.random().toString(36).slice(2, 10);

    for (const col of COLLECTIONS) {
      const channel = supabase
        .channel(`${col}-${tenantId}-${sufijo}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: col, filter: `tenant_id=eq.${tenantId}` },
          () => this._refreshCollection(tenantId, col)
        )
        .subscribe();
      this._channels.push(channel);
    }

    const configChannel = supabase
      .channel(`config-${tenantId}-${sufijo}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "config", filter: `tenant_id=eq.${tenantId}` },
        () => this._refreshRecetas(tenantId)
      )
      .subscribe();
    this._channels.push(configChannel);
  },

  async _refreshCollection(tenantId, col) {
    if (this._writeLock) return;
    const { supabase } = window.__SB__;
    const { data, error } = await supabase
      .from(col)
      .select("id,data")
      .eq("tenant_id", tenantId);
    if (this._writeLock) return;
    if (!error && data) {
      this._state[col] = data.map((r) => ({ id: r.id, ...(r.data || {}) }));
      this._emit();
    }
  },

  async _refreshRecetas(tenantId) {
    if (this._writeLock) return;
    const { supabase } = window.__SB__;
    const { data } = await supabase
      .from("config")
      .select("data")
      .eq("tenant_id", tenantId)
      .eq("key", "recetas")
      .maybeSingle();
    if (this._writeLock) return;
    this._state.recetas = data?.data || {};
    this._emit();
  },

  async save(tenantId, collection, item) {
    if (window.SUPABASE_ENABLED) {
      const { supabase } = window.__SB__;
      const { id, ...rest } = item;
      const { error } = await supabase
        .from(collection)
        .upsert({ id, tenant_id: tenantId, data: rest }, { onConflict: "tenant_id,id" });
      if (error) {
        console.error(`save(${collection}) error:`, error);
        throw new Error(error.message || `Error guardando en ${collection}`);
      }
      const arr = this._state[collection] || [];
      const idx = arr.findIndex((x) => x.id === item.id);
      if (idx >= 0) arr[idx] = item; else arr.push(item);
      this._state[collection] = arr;
      return;
    }
    const arr = this._state[collection] || [];
    const idx = arr.findIndex((x) => x.id === item.id);
    if (idx >= 0) arr[idx] = item;
    else arr.push(item);
    this._state[collection] = arr;
    this._saveLocal(tenantId);
    this._emit();
  },

  async remove(tenantId, collection, id) {
    if (window.SUPABASE_ENABLED) {
      const { supabase } = window.__SB__;
      const { error } = await supabase
        .from(collection)
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) {
        console.error(`remove(${collection}) error:`, error);
        throw new Error(error.message || `Error eliminando de ${collection}`);
      }
      this._state[collection] = (this._state[collection] || []).filter((x) => x.id !== id);
      return;
    }
    this._state[collection] = (this._state[collection] || []).filter((x) => x.id !== id);
    this._saveLocal(tenantId);
    this._emit();
  },

  async saveRecetas(tenantId, recetas) {
    if (window.SUPABASE_ENABLED) {
      const { supabase } = window.__SB__;
      const { error } = await supabase
        .from("config")
        .upsert(
          { tenant_id: tenantId, key: "recetas", data: recetas },
          { onConflict: "tenant_id,key" }
        );
      if (error) {
        console.error("saveRecetas error:", error);
        throw new Error(error.message || "Error guardando recetas");
      }
      this._state.recetas = recetas;
      return;
    }
    this._state.recetas = recetas;
    this._saveLocal(tenantId);
    this._emit();
  },

  async replaceCollection(tenantId, collection, items) {
    this._state[collection] = items;
    if (window.SUPABASE_ENABLED) {
      const { supabase } = window.__SB__;
      const { data: existing, error: selErr } = await supabase
        .from(collection)
        .select("id")
        .eq("tenant_id", tenantId);
      if (selErr) {
        console.error(`replaceCollection(${collection}) select error:`, selErr);
        throw new Error(selErr.message || `Error leyendo ${collection}`);
      }
      const existingIds = (existing || []).map((r) => r.id);
      const newIds = items.map((i) => i.id);
      const toDelete = existingIds.filter((id) => !newIds.includes(id));
      if (toDelete.length) {
        const { error: delErr } = await supabase
          .from(collection)
          .delete()
          .eq("tenant_id", tenantId)
          .in("id", toDelete);
        if (delErr) {
          console.error(`replaceCollection(${collection}) delete error:`, delErr);
          throw new Error(delErr.message || `Error borrando filas de ${collection}`);
        }
      }
      if (items.length) {
        const rows = items.map((it) => {
          const { id, ...rest } = it;
          return { id, tenant_id: tenantId, data: rest };
        });
        const { error: upErr } = await supabase
          .from(collection)
          .upsert(rows, { onConflict: "tenant_id,id" });
        if (upErr) {
          console.error(`replaceCollection(${collection}) upsert error:`, upErr);
          throw new Error(upErr.message || `Error guardando ${collection}`);
        }
      }
      return;
    }
    this._saveLocal(tenantId);
    this._emit();
  }
};

window.DataLayer = DataLayer;
