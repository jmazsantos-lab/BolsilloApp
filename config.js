// =====================================================================
// CONFIGURACIÓN DE SUPABASE
// Pega aquí los dos valores de Supabase → Project Settings → API.
// La «anon key» es pública por diseño: los datos los protege la seguridad
// por filas (RLS) del fichero supabase/schema.sql, que exige iniciar sesión
// y pertenecer al hogar.
// Si lo dejas vacío, la app funciona solo en el móvil (modo local).
// =====================================================================
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
