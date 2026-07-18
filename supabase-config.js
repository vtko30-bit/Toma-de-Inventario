// === CONFIGURACIÓN DE SUPABASE ===
//
// Para activar el modo multiusuario:
// 1. Crea un proyecto en https://supabase.com/dashboard
// 2. En "Project Settings" -> "API" copia la URL del proyecto y la "anon public" key
// 3. Reemplaza los PLACEHOLDER de abajo
// 4. Ejecuta el script supabase-schema.sql en "SQL Editor" del dashboard
//
// Mientras los valores sean PLACEHOLDER la app trabaja en MODO LOCAL
// (localStorage, un solo dispositivo). Al colocar credenciales reales
// se activa el modo multiusuario en la nube.
//
// Estas credenciales son seguras de exponer en el frontend porque la
// "anon key" solo otorga permisos protegidos por las políticas RLS
// definidas en supabase-schema.sql.

window.SUPABASE_CONFIG = {
  url: "https://vwoqjbyyxcrbcqrjiksk.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3b3FqYnl5eGNyYmNxcmppa3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzODgxMjIsImV4cCI6MjA5OTk2NDEyMn0.xw_losdhK2MEv62sNxKnFlfEVOwlM1q5t0v5M_Q1bzM"
};

window.SUPABASE_ENABLED = Object.values(window.SUPABASE_CONFIG).every(
  (v) => v && v !== "PLACEHOLDER"
);
