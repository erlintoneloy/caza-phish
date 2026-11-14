# 👥 Casos de Uso - CazaPhish

## Actores del Sistema
1. **Funcionario Público (Usuario Final):** Recibe correos sospechosos y necesita saber si son seguros.
2. **Administrador de Entidad (Admin SaaS):** Gestiona la cuenta de la institución, las API Keys de sistemas externos y audita las amenazas.
3. **Sistema Tercero (API):** Sistemas automatizados (ej. un bot de WhatsApp o un filtro de correo) que envían texto a CazaPhish para su análisis.

---

## Caso de Uso 1: Analizar correo sospechoso (Web)
- **Actor:** Funcionario Público.
- **Precondición:** El funcionario ha recibido un correo dudoso.
- **Flujo Principal:**
  1. El funcionario ingresa a la Landing Page de CazaPhish.
  2. Hace clic en "Ingresar al Sistema Detector".
  3. Pega el texto del correo sospechoso en el área de texto.
  4. Hace clic en "Analizar Correo".
  5. El sistema procesa la solicitud con IA (Llama 3.1) en el Edge.
  6. El sistema muestra el resultado con un semáforo (Rojo, Amarillo o Verde), las razones del veredicto y una recomendación.
- **Flujo Alternativo:** Si la IA falla o el texto está vacío, el sistema muestra un mensaje de error o un veredicto de precaución (MEDIO).

## Caso de Uso 2: Integración de Sistemas Externos vía API
- **Actor:** Sistema Tercero (API).
- **Precondición:** El sistema tiene una API Key válida generada por el Administrador.
- **Flujo Principal:**
  1. El sistema externo envía una petición POST a `/api/analyze` con el texto y su `api_key`.
  2. CazaPhish valida la API Key contra la base de datos D1.
  3. La IA analiza el texto.
  4. El sistema devuelve un JSON estructurado con el riesgo, razones y recomendación.
  5. El análisis se guarda en el historial de D1 de forma anonimizada.
- **Flujo Alternativo:** Si la API Key es inválida o ha sido revocada, el sistema devuelve un error HTTP 401 (No autorizado).

## Caso de Uso 3: Gestión de API Keys (Panel SaaS)
- **Actor:** Administrador de Entidad.
- **Precondición:** El administrador ha iniciado sesión en el Panel SaaS.
- **Flujo Principal:**
  1. El administrador accede a la sección "Generar API para Terceros".
  2. Introduce el nombre del sistema o departamento (ej. "Bot WhatsApp RRHH").
  3. El sistema genera una API Key única y la guarda en D1.
  4. El administrador puede ver la lista de APIs, su consumo y revocar el acceso con un clic.
- **Flujo Alternativo:** Si el administrador revoca una API, los intentos de análisis con esa llave fallarán inmediatamente.

## Caso de Uso 4: Auditoría y Revocación de Reportes (Panel SaaS)
- **Actor:** Administrador de Entidad.
- **Precondición:** Existen reportes de análisis en la base de datos.
- **Flujo Principal:**
  1. El administrador ingresa a la tabla de reportes en el Panel SaaS.
  2. Revisa los reportes (fecha, extracto anonimizado, nivel de riesgo).
  3. Si un análisis fue un falso positivo o el correo ya fue mitigado, el administrador hace clic en "Revocar".
  4. El estado del reporte cambia a "REVOCADO" en D1.
  5. El reporte se tacha en la interfaz y el sistema registra la acción en el log de auditoría.

usecaseDiagram
    actor Funcionario as "Funcionario Público"
    actor Admin as "Administrador (SaaS)"
    actor API as "Sistema Tercero (API)"
    
    package CazaPhish {
        usecase UC1 as "Analizar correo web (Detector)"
        usecase UC2 as "Consumir API de Análisis"
        usecase UC3 as "Gestionar API Keys (Crear/Revocar)"
        usecase UC4 as "Auditar y Revocar Reportes"
        usecase UC5 as "Iniciar Sesión Admin"
        
        Funcionario --> UC1
        API --> UC2
        Admin --> UC5
        Admin --> UC3
        Admin --> UC4
    }