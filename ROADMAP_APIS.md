# 🛡️ Roadmap y Especificación de APIs - CazaPhish

Este documento define la arquitectura, contratos RESTful, casos de error y baterías de prueba de las APIs de CazaPhish desplegadas en Cloudflare Workers + Workers AI + D1 SQLite.

---

## 📌 Matriz de Endpoints Implementados

| Endpoint | Método | Estado | Requerimiento PRD | Propósito |
| :--- | :--- | :--- | :--- | :--- |
| `/api/analyze` | `POST` | ✅ **Completado & Calibrado** | RF1, RF2, RNF | Análisis con IA (Llama 3.1), anonimización PII y persistencia en D1. |
| `/api/reports` | `GET` | ✅ **Completado & Verificado** | RF3 | Listado histórico de los últimos 50 reportes del cliente. |
| `/api/reports/:id` | `GET` | ✅ **Completado & Verificado** | RF3 | Detalle completo y forense de un reporte específico. |
| `/api/reports/stats` | `GET` | ✅ **Completado & Verificado** | RF3 / SaaS | Métricas y KPIs agregados (total, desglose de riesgo, % crítico, % mitigado). |
| `/api/revoke/:id` | `PUT` | ✅ **Completado & Verificado** | RF3 | Revocación preventiva de un incidente/reporte comprometido. |
| `/api/terceros/rotate-key` | `POST` | ✅ **Completado & Verificado** | SaaS / Seguridad | Rotación criptográfica de API Key para clientes B2B/B2G. |
| `/api/test-ia` | `GET` | ✅ **Completado & Verificado** | Diagnóstico | Healthcheck del enlace con Cloudflare Workers AI. |

---

## 1. `POST /api/analyze` (Motor de Detección)

### 1.1 Funcionalidad
Recibe el texto de un correo sospechoso, autentica al cliente por su API Key, evalúa los vectores de ingeniería social mediante **Llama 3.1** con calibración estricta de semáforo ético (ALTO/MEDIO/BAJO), anonimiza datos personales sensibles (emails, teléfonos, tarjetas) para cumplir con el RNF de privacidad, persiste el incidente en D1 y devuelve el veredicto estructurado.

- **Autenticación:** Header `x-api-key: <clave>` o campo `api_key` en el body.
- **Body JSON:**
  ```json
  {
    "texto": "Texto del correo a auditar...",
    "api_key": "alpha-secret-key-2026"
  }
  ```
- **Respuesta Exitosa (`200 OK`):**
  ```json
  {
    "exito": true,
    "reporte_id": 6,
    "tercero": "UNETI Demo",
    "riesgo": "MEDIO",
    "razones": [
      "El correo aparenta provenir de un canal interno legítimo (@uneti.edu.ve)",
      "Solicita actualizar datos bancarios a través de una plataforma externa de terceros (Google Drive)",
      "No pide contraseñas directas, pero utiliza un pretexto laboral creíble con fecha límite moderada"
    ],
    "recomendacion": "El funcionario debe verificar con el emisor por un canal seguro antes de enviar información.",
    "texto_anonimizado": "De: [EMAIL_PROTEGIDO]... formulario en: http://drive.google.com/..."
  }
  ```

### 1.2 Casos de Error
| Caso | Código HTTP | Condición | Payload |
| :--- | :--- | :--- | :--- |
| **Sin API Key** | `401 Unauthorized` | Falta `api_key` en body y headers. | `{"error": "Falta la API Key obligatoria..."}` |
| **API Key Inválida** | `401 Unauthorized` | La API Key no existe en D1. | `{"error": "API Key no registrada o no válida"}` |
| **Cuenta Suspendida** | `403 Forbidden` | `activo = 0` en `terceros`. | `{"error": "La cuenta corporativa asociada se encuentra suspendida"}` |
| **Falta Texto** | `400 Bad Request` | Campo `texto` ausente o vacío. | `{"error": "El campo \"texto\" es obligatorio..."}` |
| **Método Inválido** | `405 Method Not Allowed` | Se invocó con `GET` o `PUT`. | `{"error": "Método no permitido. Utiliza POST."}` |
| **Fallo en Workers AI**| `502 Bad Gateway` | Error en la API remota de IA. | `{"exito": false, "error": "Error al procesar con Workers AI..."}` |

### 1.3 Pruebas (Test)
```powershell
$body = @{
  api_key = "alpha-secret-key-2026"
  texto = "De: soporte@banco.com Asunto: Urgente valide clave en http://falso-login.com"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/analyze" -Method Post -Body $body -ContentType "application/json"
```

---

## 2. `GET /api/reports/stats` (Métricas & KPIs)

### 2.1 Funcionalidad
Calcula en tiempo real los indicadores clave de rendimiento (KPIs) de seguridad para alimentar los paneles de control y dashboards de los directores: total de incidentes, desglose por nivel de riesgo, incidentes mitigados vs activos y porcentaje de criticidad.

- **Autenticación:** Header `x-api-key: <clave>`
- **Respuesta Exitosa (`200 OK`):**
  ```json
  {
    "exito": true,
    "tercero": "UNETI Demo",
    "kpis": {
      "total_incidentes": 11,
      "activos": 10,
      "revocados": 1,
      "desglose_riesgo": {
        "alto": 6,
        "medio": 4,
        "bajo": 1
      },
      "porcentaje_critico": 54.5,
      "porcentaje_mitigado": 9.1
    }
  }
  ```

### 2.2 Casos de Error
| Caso | Código HTTP | Condición | Payload |
| :--- | :--- | :--- | :--- |
| **Sin Autenticación** | `401 Unauthorized` | API Key inválida o no enviada. | `{"error": "API Key no registrada o no válida"}` |
| **Método Inválido** | `405 Method Not Allowed` | No es `GET`. | `{"error": "Método no permitido. Utiliza GET."}` |

### 2.3 Pruebas (Test)
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/reports/stats" -Method Get -Headers @{ "x-api-key" = "alpha-secret-key-2026" }
```

---

## 3. `GET /api/reports` (Listado Histórico)

### 3.1 Funcionalidad
Retorna los últimos 50 reportes registrados pertenecientes exclusivamente a la empresa autenticada.

- **Autenticación:** Header `x-api-key: <clave>`
- **Respuesta Exitosa (`200 OK`):**
  ```json
  {
    "exito": true,
    "tercero": "UNETI Demo",
    "total": 2,
    "reportes": [
      {
        "id": 6,
        "texto_anonimizado": "De: [EMAIL_PROTEGIDO]...",
        "veredicto": { "riesgo": "MEDIO", "razones": ["..."], "recomendacion": "..." },
        "estado": "ACTIVO",
        "fecha": "2026-11-14 02:42:47"
      }
    ]
  }
  ```

### 3.2 Casos de Error
| Caso | Código HTTP | Condición | Payload |
| :--- | :--- | :--- | :--- |
| **Sin Autenticación** | `401 Unauthorized` | Clave ausente o errónea. | `{"error": "API Key no registrada o no válida"}` |
| **Método Inválido** | `405 Method Not Allowed` | Se envió `POST` o `PUT`. | `{"error": "Método no permitido. Utiliza GET."}` |

### 3.3 Pruebas (Test)
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/reports" -Method Get -Headers @{ "x-api-key" = "alpha-secret-key-2026" }
```

---

## 4. `GET /api/reports/:id` (Detalle de Reporte)

### 4.1 Funcionalidad
Obtiene la ficha técnica individual de un reporte por su ID. Implementa aislamiento multi-inquilino (un tercero no puede ver reportes de otra empresa).

- **Autenticación:** Header `x-api-key: <clave>`
- **URL Param:** `:id` (entero).
- **Respuesta Exitosa (`200 OK`):**
  ```json
  {
    "exito": true,
    "tercero": "UNETI Demo",
    "reporte": {
      "id": 6,
      "texto_anonimizado": "De: [EMAIL_PROTEGIDO]...",
      "veredicto": { "riesgo": "MEDIO", "razones": ["..."], "recomendacion": "..." },
      "estado": "ACTIVO",
      "fecha": "2026-11-14 02:42:47"
    }
  }
  ```

### 4.2 Casos de Error
| Caso | Código HTTP | Condición | Payload |
| :--- | :--- | :--- | :--- |
| **No Encontrado / Ajeno**| `404 Not Found` | El ID no existe o pertenece a otro tercero. | `{"error": "Reporte #999 no encontrado o no pertenece a tu cuenta."}` |
| **Sin Autenticación** | `401 Unauthorized` | API Key inválida. | `{"error": "API Key no registrada o no válida"}` |

### 4.3 Pruebas (Test)
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/reports/6" -Method Get -Headers @{ "x-api-key" = "alpha-secret-key-2026" }
```

---

## 5. `PUT /api/revoke/:id` (Revocación de Incidente)

### 5.1 Funcionalidad
Marca el reporte como `REVOCADO` tras una acción de mitigación de los administradores (ej. reseteo de claves del funcionario afectado o revocación de accesos).

- **Autenticación:** Header `x-api-key: <clave>`
- **URL Param:** `:id` (entero).
- **Respuesta Exitosa (`200 OK`):**
  ```json
  {
    "exito": true,
    "mensaje": "Reporte #2 revocado exitosamente.",
    "reporte_id": 2,
    "nuevo_estado": "REVOCADO"
  }
  ```

### 5.2 Casos de Error
| Caso | Código HTTP | Condición | Payload |
| :--- | :--- | :--- | :--- |
| **No Encontrado** | `404 Not Found` | El reporte no existe para este tercero. | `{"error": "Reporte #X no encontrado..."}` |
| **Método Inválido** | `405 Method Not Allowed` | No es `PUT`. | `{"error": "Método no permitido. Utiliza PUT."}` |

### 5.3 Pruebas (Test)
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/revoke/2" -Method Put -Headers @{ "x-api-key" = "alpha-secret-key-2026" }
```

---

## 6. `POST /api/terceros/rotate-key` (Rotación Segura)

### 6.1 Funcionalidad
Genera una nueva API Key criptográfica para la empresa y revoca la anterior de forma inmediata, permitiendo el cumplimiento de políticas de rotación periódica de credenciales.

- **Autenticación:** Header `x-api-key: <clave_actual>`
- **Respuesta Exitosa (`200 OK`):**
  ```json
  {
    "exito": true,
    "mensaje": "API Key rotada con éxito. Actualiza tus sistemas e integraciones.",
    "tercero": "UNETI Demo",
    "nueva_api_key": "alpha-8f3b21a09d4c7e5a"
  }
  ```

### 6.2 Casos de Error
| Caso | Código HTTP | Condición | Payload |
| :--- | :--- | :--- | :--- |
| **Sin Autenticación** | `401 Unauthorized` | La clave actual no es válida. | `{"error": "API Key no registrada o no válida"}` |
| **Método Inválido** | `405 Method Not Allowed` | Se envió `GET`. | `{"error": "Método no permitido. Utiliza POST."}` |
