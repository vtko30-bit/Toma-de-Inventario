// Capa de datos. Usa Supabase (multiusuario por tenant) o localStorage (modo local).

const LOCAL_DATA_PREFIX = "inventario_app_data_v2_";
const COLLECTIONS = ["productos", "familias", "categorias", "sucursales", "bodegas", "movimientos", "inventarios"];

const DataLayer = {
  _state: null,
  _channels: [],
  _onChange: null,
  _tenantId: null,

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
    this._emit();
  },

  _saveLocal(tenantId) {
    localStorage.setItem(this._localKey(tenantId), JSON.stringify(this._state));
  },

  async _loadSupabase(tenantId) {
    const { supabase } = window.__SB__;
    this._state = this._emptyState();

    const timeoutQuery = (p) =>
      Promise.race([
        p,
        new Promise((resolve) => setTimeout(() => resolve({ data: null, error: { message: "timeout" } }), 8000))
      ]);

    const tareasColecciones = COLLECTIONS.map((col) =>
      timeoutQuery(supabase.from(col).select("id,data").eq("tenant_id", tenantId)).then(({ data, error }) => {
        if (!error && data) {
          this._state[col] = data.map((r) => ({ id: r.id, ...(r.data || {}) }));
        } else if (error) {
          console.warn(`Error cargando ${col}:`, error.message);
        }
      })
    );

    const tareaRecetas = timeoutQuery(
      supabase.from("config").select("data").eq("tenant_id", tenantId).eq("key", "recetas").maybeSingle()
    ).then(({ data, error }) => {
      if (!error) this._state.recetas = data?.data || {};
    });

    await Promise.all([...tareasColecciones, tareaRecetas]);
    this._emit();

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
    const { supabase } = window.__SB__;
    const { data, error } = await supabase
      .from(col)
      .select("id,data")
      .eq("tenant_id", tenantId);
    if (!error && data) {
      this._state[col] = data.map((r) => ({ id: r.id, ...(r.data || {}) }));
      this._emit();
    }
  },

  async _refreshRecetas(tenantId) {
    const { supabase } = window.__SB__;
    const { data } = await supabase
      .from("config")
      .select("data")
      .eq("tenant_id", tenantId)
      .eq("key", "recetas")
      .maybeSingle();
    this._state.recetas = data?.data || {};
    this._emit();
  },

  async save(tenantId, collection, item) {
    if (window.SUPABASE_ENABLED) {
      const { supabase } = window.__SB__;
      const { id, ...rest } = item;
      await supabase.from(collection).upsert({ id, tenant_id: tenantId, data: rest });
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
      await supabase.from(collection).delete().eq("id", id).eq("tenant_id", tenantId);
      return;
    }
    this._state[collection] = (this._state[collection] || []).filter((x) => x.id !== id);
    this._saveLocal(tenantId);
    this._emit();
  },

  async saveRecetas(tenantId, recetas) {
    if (window.SUPABASE_ENABLED) {
      const { supabase } = window.__SB__;
      await supabase.from("config").upsert({
        tenant_id: tenantId,
        key: "recetas",
        data: recetas
      });
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
      const { data: existing } = await supabase
        .from(collection)
        .select("id")
        .eq("tenant_id", tenantId);
      const existingIds = (existing || []).map((r) => r.id);
      const newIds = items.map((i) => i.id);
      const toDelete = existingIds.filter((id) => !newIds.includes(id));
      if (toDelete.length) {
        await supabase
          .from(collection)
          .delete()
          .eq("tenant_id", tenantId)
          .in("id", toDelete);
      }
      if (items.length) {
        const rows = items.map((it) => {
          const { id, ...rest } = it;
          return { id, tenant_id: tenantId, data: rest };
        });
        await supabase.from(collection).upsert(rows);
      }
    } else {
      this._saveLocal(tenantId);
    }
    this._emit();
  }
};

window.DataLayer = DataLayer;
