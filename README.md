# Control de Inventario

Aplicación web instalable (PWA) y multiusuario para control de inventario. Funciona en **Windows, iOS y Android** desde el navegador y se puede instalar como app nativa. Backend en **Supabase**, hosting en **Vercel** y código en **GitHub**.

## Características

- **PWA instalable** en Windows (Chrome/Edge), Android (Chrome) e iOS (Safari).
- **Modo offline** mediante service worker.
- **Multi-empresa**: cada empresa (tenant) tiene sus datos aislados.
- **Roles**: `admin` (gestiona catálogos y usuarios) y `usuario` (registra movimientos e inventarios).
- **Realtime**: los cambios hechos por un usuario se sincronizan al instante en los demás dispositivos.
- **Doble modo**:
  - **Local** (sin configuración): usuarios y datos en `localStorage`. Útil para desarrollo y demo.
  - **Cloud (Supabase)**: al pegar credenciales, los datos se mueven a Postgres con Row Level Security.

## Estructura de archivos

```
inventario-app/
├── index.html               # Estructura, login y app shell
├── styles.css               # Estilos
├── app.js                   # Lógica principal de UI
├── auth.js                  # Autenticación (Supabase o local)
├── data.js                  # Capa de datos (Supabase o localStorage)
├── supabase-config.js       # URL + anonKey (placeholders por defecto)
├── supabase-schema.sql      # Schema y políticas RLS
├── manifest.json            # Manifiesto PWA
├── service-worker.js        # Cache offline
├── icons/icon.svg           # Icono de la app
├── vercel.json              # Configuración de hosting
├── .gitignore
└── README.md
```

## Modo Local (sin configuración)

1. Sirve `index.html` desde un servidor (no `file://`):
   - VS Code Live Server
   - `npx serve`
   - `python -m http.server`
2. Abre `http://localhost:...` y crea una cuenta.

## Modo Multiusuario (Supabase + Vercel + GitHub)

### 1. Crear proyecto en Supabase

1. Entra a [supabase.com/dashboard](https://supabase.com/dashboard) y crea un proyecto.
2. Espera a que termine de aprovisionarse.
3. En **Project Settings → API** copia:
   - Project URL
   - `anon` `public` key
4. En **SQL Editor** pega el contenido de `supabase-schema.sql` y ejecútalo. Esto crea:
   - Tabla `usuarios` ligada a `auth.users`.
   - Tablas `productos`, `familias`, `categorias`, `sucursales`, `bodegas`, `movimientos`, `inventarios`, `config`.
   - Funciones helper `current_tenant()` y `current_role()`.
   - Políticas RLS que aíslan los datos por `tenant_id`.
   - Realtime habilitado en las tablas.
5. En **Authentication → Providers** verifica que **Email** esté habilitado.
   - Si no quieres que los usuarios deban confirmar el correo para probar, en **Authentication → Settings** desactiva "Confirm email".

### 2. Pegar credenciales

Edita `supabase-config.js` y reemplaza los `PLACEHOLDER`:

```js
window.SUPABASE_CONFIG = {
  url: "https://xxxxx.supabase.co",
  anonKey: "eyJhbGciOi..."
};
```

`window.SUPABASE_ENABLED` se calcula automáticamente. Estos valores son seguros de exponer en el frontend porque la `anon key` solo otorga lo permitido por las políticas RLS.

### 3. Subir el código a GitHub

```bash
cd inventario-app
git init
git add .
git commit -m "Inventario PWA con Supabase"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/inventario-app.git
git push -u origin main
```

### 4. Deploy en Vercel

1. En [vercel.com](https://vercel.com) → **Add new project** → importa el repo.
2. Como es un sitio estático, deja el framework como **Other** y los campos por defecto. Vercel detectará `vercel.json`.
3. Click en **Deploy**.
4. Vercel asigna una URL pública con HTTPS — listo para PWA.

> Cualquier `git push` a `main` despliega automáticamente en Vercel.

## Instalación como app

- **Windows / Chrome / Edge**: aparece un icono "Instalar" en la barra de direcciones.
- **Android / Chrome**: menú → "Instalar app" o "Agregar a pantalla principal".
- **iOS / Safari**: botón Compartir → "Agregar a pantalla de inicio".

## Multi-empresa y roles

- Al registrarse, el usuario indica el **nombre de su empresa**. Internamente se genera un `tenant_id` único por empresa.
- El primer usuario que se registra para una empresa queda como `admin`.
- Para sumar usuarios a la misma empresa, deben registrarse usando exactamente el **mismo nombre de empresa**.
- Desde la sección **Usuarios** (visible solo para admins), puedes cambiar el rol de los demás integrantes.
- Las políticas RLS de Supabase garantizan que un tenant nunca pueda leer/modificar datos de otro.

## Variables de entorno (opcional)

Si prefieres no comprometer las credenciales en el repo, puedes:

1. Eliminar `supabase-config.js` del repo y agregarlo a `.gitignore`.
2. En Vercel, definir variables `SUPABASE_URL` y `SUPABASE_ANON_KEY` en **Project Settings → Environment Variables**.
3. Generar `supabase-config.js` en el build con un script. Para este proyecto estático lo más simple es mantener las credenciales hardcoded (la `anon key` está pensada para exposición pública siempre que las RLS estén activas).

## Limitaciones conocidas

- El Service Worker requiere `https://` o `http://localhost`; no funciona desde `file://`.
- En modo local cada dispositivo tiene su propia base. Para sincronizar configura Supabase.
- El icono actual es SVG; para mejor compatibilidad con iOS conviene generar PNG 192×192 y 512×512 desde `icons/icon.svg`.
