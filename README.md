# Bolsillo

Registro rápido de gastos en efectivo para la familia. Pensado para Cuba: funciona **sin conexión**, guarda todo en el móvil y lo sincroniza con Supabase cuando hay red. Al final de cada mes exporta un fichero que **Patrimonio Familiar** importa para explicar lo que ha salido de las cuentas de efectivo.

- Registrar un gasto: importe → categoría. Dos toques (más los dígitos).
- Cuatro monedas: EUR, USD, MXN y CUP, con tipo de cambio mensual editable.
- Hogar compartido: cada uno ve sus gastos y los del otro, casi al instante.
- Resumen del mes: ritmo frente al mes anterior, presupuestos con marca de ritmo, reparto por categoría, calendario, quién pagó, efectivo gastado por moneda, lugares y etiquetas.

---

## 1. Base de datos (Supabase) · 10 minutos

1. Entra en [supabase.com](https://supabase.com) y crea un proyecto nuevo (por ejemplo, `bolsillo`). El plan gratuito permite dos proyectos activos: si ya usas uno para DailyHabits, este puede ser el segundo.
2. En el menú izquierdo: **SQL Editor → New query**. Pega el contenido completo de `supabase/schema.sql` y pulsa **Run**. Debe terminar con «Success». Se puede volver a ejecutar sin problemas.
3. **Authentication → Sign In / Providers → Email**: déjalo activado. Para no depender del correo de confirmación, desactiva **Confirm email** (recomendado: en Cuba los correos pueden tardar).
4. **Project Settings → API**: copia la **Project URL** y la **anon public key**.
5. Abre `config.js` y pégalas:

```js
export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

La *anon key* es pública por diseño. Los datos los protegen las políticas de seguridad del esquema: sin sesión no se puede leer nada, y cada usuario solo ve los datos de su hogar. Por eso el repositorio puede ser público sin exponer los gastos.

> Supabase pausa los proyectos gratuitos tras una semana sin uso. Con uso diario no pasa; si ocurre, se reactiva desde el panel y no se pierde nada. Mientras tanto, la app sigue funcionando en el móvil y sube lo pendiente al volver.

## 2. Publicar en GitHub Pages · 5 minutos

1. Crea un repositorio **público** en tu cuenta personal, por ejemplo `Bolsillo-App` (con una organización gratuita, Pages pide plan de pago en repos privados).
2. **Add file → Upload files**: sube todos los ficheros de esta carpeta. La carpeta `icons` sube a veces mejor en una segunda tanda: comprueba que aparece con sus 4 imágenes dentro.
3. **Settings → Pages → Build and deployment**: *Deploy from a branch*, rama `main`, carpeta `/ (root)`, **Save**.
4. En uno o dos minutos tendrás la URL: `https://TU-USUARIO.github.io/Bolsillo-App/`.

## 3. Instalar en el iPhone

1. Abre la URL en **Safari** → botón **Compartir** → **Añadir a pantalla de inicio**.
2. Ábrela desde el icono, pulsa **Entrar con mi cuenta**, crea tu cuenta y después **Crear hogar**. Usa tu nombre exactamente como está en Patrimonio (`Jose`), porque así casan las cuentas al importar.
3. En **Ajustes** verás el **código para invitar**. Blanca instala la app igual, crea su cuenta y en «Unirme con un código» escribe ese código y su nombre (`Blanca`).
4. En **Ajustes → Tipos de cambio**, pon las tasas del mes (USD, MXN y CUP por 1 €). Para el CUP usa el cambio al que de verdad compráis.

### Abrir la app aún más rápido

- **Toque atrás** (iPhone 8 o posterior): Ajustes → Accesibilidad → Tocar → **Tocar atrás** → Doble toque → elige un atajo que abra la URL `https://TU-USUARIO.github.io/Bolsillo-App/?accion=nuevo`. Dos toques en la parte trasera del móvil y estás apuntando un gasto.
- **Atajos de iOS**: crea un atajo con la acción «Abrir URL» y la misma dirección; puedes ponerlo en la pantalla de bloqueo o pedírselo a Siri («Oye Siri, gasto»).

## 3 bis. Atajo del iPhone (registrar sin abrir la app)

Cada persona, en su móvil: Bolsillo → **Ajustes → Atajo del iPhone → Generar mi código del atajo**. Aparecen tres datos (dirección, clave pública y código personal) que se pegan en el atajo «Nuevo gasto» de la app Atajos. El paso a paso completo, con el Botón de Acción, el widget y Siri, está en la guía de instalación.

- El atajo necesita conexión. Sin red, deja el gasto copiado y muestra un error: abre Bolsillo y pulsa **📋 Pegar gasto guardado por el atajo sin conexión**.
- Las categorías del atajo deben escribirse igual que en Bolsillo (sin distinguir mayúsculas).
- Si pierdes el móvil: **Revocar mis códigos** desde otro dispositivo con tu cuenta.

## 4. El ciclo de cada mes

1. **Durante el mes**: al pagar, abre Bolsillo, escribe el importe y toca la categoría. Sin conexión también funciona: verás «pendiente de subir» y se sincroniza sola cuando vuelva la red.
2. **Al cerrar el mes** (los 10 primeros días, la app propone el mes anterior): **Ajustes → Pasar a Patrimonio Familiar → Exportar para Patrimonio (JSON)**. Guárdalo en Archivos o compártelo por AirDrop o WhatsApp.
3. **En Patrimonio Familiar** (versión 3.1 o posterior): **Movimientos → Importar gastos de Bolsillo → Elegir fichero**. La primera vez indica de qué cuenta sale cada combinación persona + moneda (por ejemplo, *Jose · pagos en CUP → Efectivo Cuba USD Jose*) y a qué categoría va cada una. Se recuerda para los meses siguientes.
4. La vista previa muestra cuánto baja lo «sin explicar» del mes antes de importar. Si vuelves a exportar e importar el mismo mes, se **sustituye** lo importado antes: sin duplicados, y con las ediciones y los borrados aplicados.

## 5. Formato del fichero de exportación

```json
{
  "formato": "bolsillo-gastos",
  "version": 1,
  "periodo": "2026-09",
  "desde": "2026-09-01", "hasta": "2026-09-30",
  "monedaBase": "EUR",
  "tasas": { "2026-09": { "USD": 1.17, "CUP": 520, "MXN": 21.4 } },
  "categorias": [{ "id": "…", "nombre": "Comida", "icono": "🛒" }],
  "personas": ["Jose", "Blanca"],
  "gastos": [{
    "id": "uuid", "fecha": "2026-09-14", "persona": "Blanca",
    "importe": 20, "moneda": "USD", "importeEur": 17.09,
    "categoriaId": "…", "categoria": "Comida",
    "nota": "", "lugar": "Mercado 19 y B", "etiquetas": ["casa"]
  }],
  "resumen": { "numGastos": 1, "totalEur": 17.09, "porCategoria": {}, "porPersona": {}, "porMoneda": {} },
  "avisos": []
}
```

Las tasas son **unidades de la moneda por 1 euro**, la misma convención que Patrimonio. El `id` de cada gasto no cambia nunca, y es lo que permite reimportar sin duplicar.

## 6. Actualizar la app

Sube los ficheros cambiados a GitHub y aumenta el número de `VERSION` en `sw.js` (por ejemplo, `bolsillo-v1.0.1`). La próxima vez que se abra con conexión, se descargará la versión nueva.

## Estructura

| Fichero | Para qué sirve |
|---|---|
| `index.html` | Página de la app |
| `app.js` | Toda la lógica: captura, sincronización, estadísticas y exportación |
| `styles.css` | Estilos (tema claro y oscuro automático) |
| `config.js` | Claves de Supabase (vacío = modo solo en el móvil) |
| `sw.js` | Funcionamiento sin conexión |
| `manifest.webmanifest` | Instalación como app y accesos directos |
| `icons/` | Iconos |
| `supabase/schema.sql` | Tablas, seguridad por hogar, tiempo real y funciones del atajo |
