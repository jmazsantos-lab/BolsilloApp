// =====================================================================
// CONFIGURACIÓN DE SUPABASE
// Pega aquí los dos valores de Supabase → Project Settings → API.
// La «anon key» es pública por diseño: los datos los protege la seguridad
// por filas (RLS) del fichero supabase/schema.sql, que exige iniciar sesión
// y pertenecer al hogar.
// Si lo dejas vacío, la app funciona solo en el móvil (modo local).
// =====================================================================
export const SUPABASE_URL = 'https://ybujlbwnipwmbrzlbxum.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_IZ3F9Keu5NwFY20LvztVYQ_wdmTQQJ8';
