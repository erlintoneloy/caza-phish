# PRD: CazaPhish - Protección B2B/B2G contra Phishing

## 1. Visión General
CazaPhish nace para mitigar las brechas de seguridad causadas por phishing dirigido a entidades públicas. Ofrecemos una API abierta y un dashboard de administración para terceros (empresas o instituciones) que necesitan auditar y proteger a sus empleados.

## 2. El Problema
Los atacantes usan IA para crear correos perfectos. Las herramientas tradicionales bloquean por reglas fijas (falsos positivos). Los funcionarios necesitan contexto y explicabilidad.

## 3. Propuesta de Valor (SaaS)
- **Capa Gratuita:** Funcionarios usan el analizador web.
- **Capa Corporativa:** Empresas asignan un `API_KEY`. Los reportes se guardan en su panel privado. Pueden revocar accesos si detectan compromiso.

## 4. Requerimientos Funcionales
- **RF1:** Endpoint `/api/analyze` que recibe texto y devuelve JSON con veredicto.
- **RF2:** Autenticación básica por API Key para proteger los endpoints.
- **RF3:** Dashboard de administración para listar reportes y ejecutar revocación (`PUT /api/revoke/:id`).
- **RF4:** Landing page informativa con llamados a la acción.

## 5. Requerimientos No Funcionales
- **Rendimiento:** Respuesta en < 3 segundos vía Edge.
- **Privacidad:** Los correos se guardan de forma anonimizada en D1.
- **Escalabilidad:** Serverless, sin mantenimiento de servidores.