// Módulo de autenticación.
// - Modo Supabase: cuando window.SUPABASE_ENABLED === true.
// - Modo local: usuarios y sesión guardados en localStorage (multi-usuario por dispositivo).

const LOCAL_USERS_KEY = "inventario_app_users_v1";
const LOCAL_SESSION_KEY = "inventario_app_session_v1";

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Tiempo de espera agotado en ${label}. Revisa tu conexión a internet.`)), ms))
  ]);
}

const Auth = {
  currentUser: null,
  listeners: [],

  onChange(cb) {
    this.listeners.push(cb);
    cb(this.currentUser);
  },

  _emit() {
    this.listeners.forEach((cb) => cb(this.currentUser));
  },

  async init() {
    if (window.SUPABASE_ENABLED) {
      await this._initSupabase();
    } else {
      this._initLocal();
    }
  },

  async _initSupabase() {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supabase = createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    window.__SB__ = { supabase };

    supabase.auth.onAuthStateChange(async (_event, session) => {
      try {
        await this._loadProfile(session?.user || null);
      } catch (e) {
        console.warn("loadProfile error:", e);
      }
    });

    try {
      const { data } = await withTimeout(supabase.auth.getSession(), 5000, "getSession");
      await this._loadProfile(data?.session?.user || null);
    } catch (e) {
      console.warn("Init session error:", e);
      this.currentUser = null;
      this._emit();
    }
  },

  async _loadProfile(authUser) {
    if (!authUser) {
      this.currentUser = null;
      this._emit();
      return;
    }
    const { supabase } = window.__SB__;
    let profile = null;
    try {
      const res = await withTimeout(
        supabase.from("usuarios").select("*").eq("id", authUser.id).maybeSingle(),
        5000,
        "perfil"
      );
      profile = res?.data || null;
    } catch (e) {
      console.warn("Error cargando perfil, usando defaults:", e);
    }

    if (!profile) {
      const meta = authUser.user_metadata || {};
      const tenantFromMeta = meta.tenant_id || this._toTenant(meta.empresa || authUser.email);
      try {
        const { data: inserted, error: insertError } = await withTimeout(
          supabase
            .from("usuarios")
            .upsert(
              {
                id: authUser.id,
                email: authUser.email,
                nombre: meta.nombre || authUser.email,
                tenant_id: tenantFromMeta,
                role: "admin"
              },
              { onConflict: "id" }
            )
            .select()
            .maybeSingle(),
          5000,
          "crear perfil"
        );
        if (insertError) {
          console.error("No se pudo crear el perfil automáticamente:", insertError);
        } else {
          profile = inserted;
        }
      } catch (e) {
        console.warn("Error creando perfil:", e);
      }
    }

    this.currentUser = {
      uid: authUser.id,
      email: authUser.email,
      nombre: profile?.nombre || authUser.email,
      tenantId: profile?.tenant_id || (authUser.user_metadata?.tenant_id) || authUser.id,
      role: profile?.role || "admin"
    };
    this._emit();
  },

  _initLocal() {
    const sessionRaw = localStorage.getItem(LOCAL_SESSION_KEY);
    if (sessionRaw) {
      this.currentUser = JSON.parse(sessionRaw);
    }
    this._emit();
  },

  _getLocalUsers() {
    const raw = localStorage.getItem(LOCAL_USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  },

  _saveLocalUsers(users) {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  },

  _toTenant(value) {
    return (value || "").toLowerCase().replace(/[^a-z0-9]/g, "_") || "default";
  },

  async register({ email, password, nombre, empresa }) {
    if (window.SUPABASE_ENABLED) {
      const { supabase } = window.__SB__;
      const tenantId = this._toTenant(empresa || email);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { nombre, tenant_id: tenantId }
        }
      });
      if (error) throw error;
      const userId = data.user?.id;
      if (userId) {
        const { error: insertError } = await supabase.from("usuarios").upsert({
          id: userId,
          email,
          nombre: nombre || email,
          tenant_id: tenantId,
          role: "admin"
        });
        if (insertError && insertError.code !== "23505") throw insertError;
      }
      return data.user;
    }

    const users = this._getLocalUsers();
    if (users.some((u) => u.email === email)) {
      throw new Error("Ya existe un usuario con ese correo.");
    }
    const tenantId = this._toTenant(empresa || email);
    const newUser = {
      uid: "u-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      email,
      password,
      nombre: nombre || email,
      tenantId,
      role: "admin",
      creadoEn: new Date().toISOString()
    };
    users.push(newUser);
    this._saveLocalUsers(users);
    this.currentUser = { ...newUser };
    delete this.currentUser.password;
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(this.currentUser));
    this._emit();
    return this.currentUser;
  },

  async login({ email, password }) {
    if (window.SUPABASE_ENABLED) {
      const { supabase } = window.__SB__;
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        10000,
        "login"
      );
      if (error) throw error;
      return data.user;
    }
    const users = this._getLocalUsers();
    const user = users.find((u) => u.email === email && u.password === password);
    if (!user) throw new Error("Credenciales inválidas.");
    this.currentUser = { ...user };
    delete this.currentUser.password;
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(this.currentUser));
    this._emit();
    return this.currentUser;
  },

  async logout() {
    if (window.SUPABASE_ENABLED) {
      const { supabase } = window.__SB__;
      await supabase.auth.signOut();
      return;
    }
    this.currentUser = null;
    localStorage.removeItem(LOCAL_SESSION_KEY);
    this._emit();
  },

  isAdmin() {
    return this.currentUser?.role === "admin";
  }
};

window.Auth = Auth;
